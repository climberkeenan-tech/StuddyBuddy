import {
  chunkText,
  newId,
  type KnowledgeChunk,
  type NoteBlock,
  type Transcript,
} from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { EmbeddingProvider } from '../ai/types';
import type { Repositories } from '../storage/types';
import type { VectorStore } from './types';

/** Target size of a transcript retrieval window, in characters. */
const WINDOW_CHARS = 900;
/** Embedding requests are batched to bound provider round-trips/memory. */
const EMBED_BATCH = 32;

export interface KnowledgeIndexerDeps {
  repos: Repositories;
  /** Resolved lazily so the active embedding provider can change at runtime. */
  getEmbedder: () => EmbeddingProvider;
  store: VectorStore;
  logger: Logger;
}

export interface IndexResult {
  lectureId: string;
  /** Number of chunks written for the lecture (0 when there was nothing to index). */
  chunkCount: number;
}

/** An ordered unit of transcript text with the audio offset it begins at. */
interface TimedBlock {
  text: string;
  atMs: number;
}

/**
 * Flatten a transcript into ordered timed blocks. When the transcript carries
 * paragraph groupings, each paragraph (its segments joined in order) is one
 * block starting at the paragraph offset; otherwise every segment is its own
 * block. Blocks are emitted in ascending time so downstream windows keep
 * monotonic `atMs`.
 */
function transcriptBlocks(transcript: Transcript): TimedBlock[] {
  const segments = [...transcript.segments].sort((a, b) => a.index - b.index);
  const segById = new Map(segments.map((s) => [s.id, s]));

  if (transcript.paragraphs.length > 0) {
    const paragraphs = [...transcript.paragraphs].sort((a, b) => a.startMs - b.startMs);
    const blocks: TimedBlock[] = [];
    for (const paragraph of paragraphs) {
      const parts: string[] = [];
      let atMs = paragraph.startMs;
      let first = true;
      for (const segId of paragraph.segmentIds) {
        const seg = segById.get(segId);
        if (!seg) continue;
        if (first) {
          atMs = seg.startMs;
          first = false;
        }
        const text = seg.text.trim();
        if (text) parts.push(text);
      }
      const text = parts.join(' ').trim();
      if (text) blocks.push({ text, atMs });
    }
    if (blocks.length > 0) return blocks;
    // Paragraphs referenced no resolvable segments — fall through to segments.
  }

  return segments
    .map((s) => ({ text: s.text.trim(), atMs: s.startMs }))
    .filter((b) => b.text.length > 0);
}

/**
 * Greedily pack ordered blocks into ~{@link WINDOW_CHARS}-char windows. Each
 * window's `atMs` is the start offset of its first block — an approximation
 * (a window may span several segments), but exact at the window boundary, which
 * is what a citation deep-link needs. A single oversized block becomes its own
 * window rather than being split, keeping `atMs` exact.
 */
function windowize(blocks: TimedBlock[]): TimedBlock[] {
  const windows: TimedBlock[] = [];
  let text = '';
  let atMs = 0;
  let open = false;
  for (const block of blocks) {
    if (open && text.length + 1 + block.text.length > WINDOW_CHARS) {
      windows.push({ text, atMs });
      open = false;
    }
    if (!open) {
      text = block.text;
      atMs = block.atMs;
      open = true;
    } else {
      text = `${text} ${block.text}`;
    }
  }
  if (open) windows.push({ text, atMs });
  return windows;
}

/** Render note blocks to plain markdown so they can be chunked and embedded. */
function noteBlocksToMarkdown(blocks: NoteBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(Math.max(block.level ?? 2, 1), 3);
        if (block.text) lines.push(`${'#'.repeat(level)} ${block.text}`);
        break;
      }
      case 'bullets':
        for (const item of block.items ?? []) if (item.trim()) lines.push(`- ${item}`);
        break;
      case 'definition':
        if (block.term || block.text) lines.push(`**${block.term ?? ''}**: ${block.text ?? ''}`.trim());
        break;
      case 'formula':
        if (block.term || block.text) lines.push(`${block.term ? `${block.term}: ` : ''}${block.text ?? ''}`.trim());
        break;
      default:
        if (block.text) lines.push(block.text);
        break;
    }
  }
  return lines.join('\n\n');
}

/**
 * Extract a markdown body from a study material's content payload. Notes carry
 * structured `blocks`; markdown-based materials carry a `markdown` string. Both
 * shapes are handled so the indexer stays robust if the notes payload evolves.
 */
function materialMarkdown(content: unknown): string {
  const c = content as { markdown?: unknown; blocks?: unknown };
  if (typeof c.markdown === 'string') return c.markdown;
  if (Array.isArray(c.blocks)) return noteBlocksToMarkdown(c.blocks as NoteBlock[]);
  return '';
}

/**
 * Builds the searchable knowledge base for a lecture. It re-derives every chunk
 * from the lecture's transcript, analysis, and notes, embeds them, and hands
 * them to the vector store. Re-indexing is idempotent: existing chunks for the
 * lecture are removed first, so calling {@link indexLecture} again after
 * re-transcription/editing never leaves stale or duplicate chunks behind.
 */
export class KnowledgeIndexer {
  private readonly repos: Repositories;
  private readonly getEmbedder: () => EmbeddingProvider;
  private readonly store: VectorStore;
  private readonly logger: Logger;

  constructor(deps: KnowledgeIndexerDeps) {
    this.repos = deps.repos;
    this.getEmbedder = deps.getEmbedder;
    this.store = deps.store;
    this.logger = deps.logger.child('indexer');
  }

  async indexLecture(lectureId: string): Promise<IndexResult> {
    const lecture = await this.repos.lectures.get(lectureId);
    if (!lecture) {
      throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${lectureId}" not found`, {
        details: { lectureId },
      });
    }

    // Idempotency: clear any previously-indexed chunks before rebuilding.
    await this.store.removeByLecture(lectureId);

    const courseId = lecture.courseId;
    const now = Date.now();
    const chunks: KnowledgeChunk[] = [];

    // (a) Transcript retrieval windows.
    const transcript = await this.repos.transcripts.getByLecture(lectureId);
    if (transcript) {
      for (const window of windowize(transcriptBlocks(transcript))) {
        chunks.push({
          id: newId(),
          courseId,
          lectureId,
          source: 'transcript',
          text: window.text,
          atMs: window.atMs,
          createdAt: now,
        });
      }
    }

    // (b) One chunk per analyzed concept, deep-linked to its first mention.
    const analysis = await this.repos.analyses.getByLecture(lectureId);
    if (analysis) {
      for (const concept of analysis.concepts) {
        const text = `Concept: ${concept.name}. ${concept.summary}`.trim();
        if (!text) continue;
        chunks.push({
          id: newId(),
          courseId,
          lectureId,
          source: 'analysis',
          text,
          atMs: concept.firstMentionMs,
          createdAt: now,
        });
      }
    }

    // (c) Generated notes, split into overlapping chunks.
    const notes = await this.repos.materials.latestOfType(lectureId, 'notes');
    if (notes) {
      const markdown = materialMarkdown(notes.content);
      for (const piece of chunkText(markdown, WINDOW_CHARS)) {
        if (!piece.text.trim()) continue;
        chunks.push({
          id: newId(),
          courseId,
          lectureId,
          source: 'notes',
          text: piece.text,
          createdAt: now,
        });
      }
    }

    if (chunks.length === 0) {
      this.logger.info('nothing to index for lecture', { lectureId });
      return { lectureId, chunkCount: 0 };
    }

    const embedder = this.getEmbedder();
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.text);
      const embedded = await embedder.embed(batch);
      vectors.push(...embedded);
    }

    await this.store.upsert(chunks, vectors);
    this.logger.info('indexed lecture', {
      lectureId,
      chunks: chunks.length,
      embedder: embedder.id,
    });
    return { lectureId, chunkCount: chunks.length };
  }
}
