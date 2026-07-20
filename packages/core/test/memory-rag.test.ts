import { describe, expect, it } from 'vitest';
import type {
  Course,
  KnowledgeChunk,
  Lecture,
  LectureAnalysis,
  StudyMaterial,
  Transcript,
  TranscriptSegment,
} from '@studdybuddy/shared';
import type { AIFacade } from '../src/ai/types';
import type { EmbeddingProvider } from '../src/ai/types';
import type { Logger } from '../src/infra/logger';
import { LogManager } from '../src/infra/logger';
import type { Repositories } from '../src/storage/types';
import { LocalVectorStore } from '../src/memory/local-vector-store';
import { KnowledgeIndexer } from '../src/memory/indexer';
import { KnowledgeService } from '../src/memory/knowledge-service';

const logger: Logger = new LogManager().getLogger('test');

/* ————————————————————————— test embedder ————————————————————————— */

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic 64-dim hashing embedder — independent of the ai module so these
 * tests never depend on another agent's provider landing. Shared vocabulary +
 * bigrams push similar texts to a higher cosine, exactly like the real one.
 */
class TestEmbedder implements EmbeddingProvider {
  readonly id = 'test-hash-64';
  readonly name = 'Test hash (64d)';
  readonly dimensions = 64;

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const dims = this.dimensions;
    const v = new Array<number>(dims).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const add = (term: string, w: number): void => {
      const i = fnv1a(term) % dims;
      v[i] = (v[i] ?? 0) + w;
    };
    for (const token of tokens) add(token, 1);
    for (let i = 0; i < tokens.length - 1; i++) add(`${tokens[i]!}_${tokens[i + 1]!}`, 0.5);
    let ss = 0;
    for (const x of v) ss += x * x;
    if (ss === 0) return v;
    const n = Math.sqrt(ss);
    for (let i = 0; i < dims; i++) v[i] = (v[i] ?? 0) / n;
    return v;
  }
}

/* ————————————————————————— in-memory repositories ————————————————————————— */

interface Backing {
  courses: Map<string, Course>;
  lectures: Map<string, Lecture>;
  transcripts: Map<string, Transcript>;
  analyses: Map<string, LectureAnalysis>;
  materials: StudyMaterial[];
  chunks: Map<string, KnowledgeChunk>;
  embeddings: Map<string, number[]>;
}

function makeRepos(): { repos: Repositories; backing: Backing } {
  const backing: Backing = {
    courses: new Map(),
    lectures: new Map(),
    transcripts: new Map(),
    analyses: new Map(),
    materials: [],
    chunks: new Map(),
    embeddings: new Map(),
  };

  const repos = {
    courses: {
      list: async () => [...backing.courses.values()].sort((a, b) => a.name.localeCompare(b.name)),
      get: async (id: string) => backing.courses.get(id) ?? null,
    },
    lectures: {
      byCourse: async (courseId: string) =>
        [...backing.lectures.values()]
          .filter((l) => l.courseId === courseId)
          .sort((a, b) => a.number - b.number),
      get: async (id: string) => backing.lectures.get(id) ?? null,
    },
    transcripts: {
      getByLecture: async (lectureId: string) => backing.transcripts.get(lectureId) ?? null,
    },
    analyses: {
      getByLecture: async (lectureId: string) => backing.analyses.get(lectureId) ?? null,
    },
    materials: {
      latestOfType: async (lectureId: string, type: string) => {
        const rows = backing.materials
          .filter((m) => m.lectureId === lectureId && m.type === type)
          .sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ?? null;
      },
    },
    chunks: {
      all: async () => [...backing.chunks.values()],
      byLecture: async (lectureId: string) =>
        [...backing.chunks.values()].filter((c) => c.lectureId === lectureId),
      putMany: async (chunks: KnowledgeChunk[]) => {
        for (const c of chunks) backing.chunks.set(c.id, c);
      },
      deleteByLecture: async (lectureId: string) => {
        for (const [id, c] of backing.chunks) {
          if (c.lectureId === lectureId) {
            backing.chunks.delete(id);
            backing.embeddings.delete(id);
          }
        }
      },
    },
    embeddings: {
      all: async () =>
        [...backing.embeddings.entries()].map(([chunkId, vector]) => ({ chunkId, vector })),
      putMany: async (entries: { chunkId: string; vector: number[] }[]) => {
        for (const e of entries) backing.embeddings.set(e.chunkId, e.vector);
      },
      deleteByChunkIds: async (chunkIds: string[]) => {
        for (const id of chunkIds) backing.embeddings.delete(id);
      },
    },
  };

  return { repos: repos as unknown as Repositories, backing };
}

/* ————————————————————————— fixtures ————————————————————————— */

const T0 = 1_700_000_000_000;

function course(id: string, name: string): Course {
  return {
    id,
    name,
    instructor: 'Dr. Grant',
    semester: 'Fall 2026',
    color: '#7c3aed',
    icon: 'dna',
    archived: false,
    createdAt: T0,
    updatedAt: T0,
  };
}

function lecture(id: string, courseId: string, number: number, title: string): Lecture {
  return {
    id,
    courseId,
    title,
    number,
    status: 'ready',
    recordedAt: T0,
    durationMs: 60_000,
    topics: [],
    tags: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function transcriptOf(lectureId: string, texts: string[]): Transcript {
  const segments: TranscriptSegment[] = texts.map((text, index) => ({
    id: `${lectureId}-s${index}`,
    index,
    startMs: index * 5000,
    endMs: index * 5000 + 4500,
    text,
    kind: 'speech',
  }));
  return {
    lectureId,
    segments,
    paragraphs: [],
    sections: [],
    language: 'en',
    engine: 'simulated',
    updatedAt: T0,
  };
}

function analysisOf(lectureId: string): LectureAnalysis {
  return {
    lectureId,
    gist: 'DNA replication and its enzymes.',
    concepts: [
      {
        id: `${lectureId}-c-helicase`,
        name: 'Helicase',
        summary: 'Helicase is the enzyme that unwinds the double helix at the replication fork.',
        importance: 0.9,
        examLikelihood: 0.8,
        difficulty: 0.5,
        mentions: 3,
        firstMentionMs: 15000,
        related: [],
      },
      {
        id: `${lectureId}-c-polymerase`,
        name: 'DNA polymerase',
        summary: 'DNA polymerase synthesizes new DNA strands in the five to three direction.',
        importance: 0.85,
        examLikelihood: 0.7,
        difficulty: 0.6,
        mentions: 2,
        firstMentionMs: 30000,
        related: [],
      },
    ],
    definitions: [],
    formulas: [],
    examples: [],
    keyDates: [],
    emphasisCues: [],
    vocabulary: [],
    examWatchlist: [],
    struggleWatchlist: [],
    crossLectureLinks: [],
    generatedBy: 'test',
    createdAt: T0,
  };
}

const DNA_SEGMENTS = [
  'Today we are going to talk about DNA replication and why it matters.',
  'DNA replication is the process by which a cell copies its genome before division.',
  'Helicase is the enzyme that unwinds the double helix at the replication fork.',
  'DNA polymerase synthesizes new DNA strands in the five to three direction.',
  'Ligase seals the gaps between Okazaki fragments on the lagging strand.',
  'The whole process is fast, accurate, and tightly regulated inside the cell.',
];

function seedDnaLecture(backing: Backing): { courseId: string; lectureId: string } {
  const c = course('course-bio', 'Molecular Biology');
  const l = lecture('lec-1', 'course-bio', 1, 'DNA Replication');
  backing.courses.set(c.id, c);
  backing.lectures.set(l.id, l);
  backing.transcripts.set(l.id, transcriptOf(l.id, DNA_SEGMENTS));
  backing.analyses.set(l.id, analysisOf(l.id));
  return { courseId: c.id, lectureId: l.id };
}

function makeAI(available: boolean, chatText = ''): AIFacade {
  return {
    available: async () => available,
    activeLabel: () => 'mock/test-model',
    chat: async () => {
      if (!available) throw new Error('AI chat should not be called offline');
      return { text: chatText, model: 'test-model' };
    },
    generate: (async () => {
      throw new Error('generate unused in these tests');
    }) as unknown as AIFacade['generate'],
  };
}

/* ————————————————————————— LocalVectorStore ————————————————————————— */

describe('LocalVectorStore', () => {
  it('upserts, searches by cosine, filters by course/lecture, and removes by lecture', async () => {
    const { repos, backing } = makeRepos();
    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });

    const chunks: KnowledgeChunk[] = [
      {
        id: 'k1',
        courseId: 'bio',
        lectureId: 'L1',
        source: 'transcript',
        text: 'helicase unwinds the double helix at the replication fork',
        atMs: 1000,
        createdAt: T0,
      },
      {
        id: 'k2',
        courseId: 'bio',
        lectureId: 'L2',
        source: 'transcript',
        text: 'dna polymerase synthesizes new strands during replication',
        atMs: 2000,
        createdAt: T0,
      },
      {
        id: 'k3',
        courseId: 'hist',
        lectureId: 'L3',
        source: 'transcript',
        text: 'the french revolution began in 1789 with the storming of the bastille',
        atMs: 3000,
        createdAt: T0,
      },
    ];
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    await store.upsert(chunks, vectors);

    // Persisted through the repositories.
    expect(backing.chunks.size).toBe(3);
    expect(backing.embeddings.size).toBe(3);

    const [helicaseQuery] = await embedder.embed(['what enzyme unwinds the double helix']);
    const top = await store.search(helicaseQuery!, { limit: 3 });
    expect(top[0]?.chunk.id).toBe('k1');
    expect(top[0]!.score).toBeGreaterThan(top[top.length - 1]!.score);

    // courseId filter excludes the history chunk.
    const bioOnly = await store.search(helicaseQuery!, { limit: 10, courseId: 'bio' });
    expect(bioOnly.every((h) => h.chunk.courseId === 'bio')).toBe(true);
    expect(bioOnly.map((h) => h.chunk.id).sort()).toEqual(['k1', 'k2']);

    // lectureId filter narrows to one lecture.
    const l2 = await store.search(helicaseQuery!, { limit: 10, lectureId: 'L2' });
    expect(l2.map((h) => h.chunk.id)).toEqual(['k2']);

    // removeByLecture drops chunks + embeddings from storage and the cache.
    await store.removeByLecture('L1');
    expect(backing.chunks.has('k1')).toBe(false);
    expect(backing.embeddings.has('k1')).toBe(false);
    const afterRemove = await store.search(helicaseQuery!, { limit: 10 });
    expect(afterRemove.map((h) => h.chunk.id).sort()).toEqual(['k2', 'k3']);
  });

  it('skips stored vectors whose dimension differs from the query (embedder switch)', async () => {
    const { repos, backing } = makeRepos();
    const embedder = new TestEmbedder();

    // Pre-seed storage directly with mixed dimensions before the store loads.
    const [vec64] = await embedder.embed(['alpha beta gamma']);
    backing.chunks.set('good', {
      id: 'good',
      courseId: 'c',
      lectureId: 'L',
      source: 'transcript',
      text: 'alpha beta gamma',
      createdAt: T0,
    });
    backing.embeddings.set('good', vec64!);
    backing.chunks.set('stale', {
      id: 'stale',
      courseId: 'c',
      lectureId: 'L',
      source: 'transcript',
      text: 'old embedder output',
      createdAt: T0,
    });
    backing.embeddings.set('stale', new Array<number>(32).fill(0.1)); // wrong dimension

    const store = new LocalVectorStore({ repos, logger });
    const [query] = await embedder.embed(['alpha beta gamma']);
    const results = await store.search(query!, { limit: 10 });
    // The 32-dim vector is skipped, not compared, and nothing throws.
    expect(results.map((r) => r.chunk.id)).toEqual(['good']);
  });
});

/* ————————————————————————— KnowledgeIndexer ————————————————————————— */

describe('KnowledgeIndexer', () => {
  it('produces transcript + analysis chunks with monotonic atMs', async () => {
    const { repos, backing } = makeRepos();
    const { lectureId } = seedDnaLecture(backing);
    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });
    const indexer = new KnowledgeIndexer({
      repos,
      getEmbedder: () => embedder,
      store,
      logger,
    });

    const result = await indexer.indexLecture(lectureId);
    expect(result.chunkCount).toBeGreaterThan(0);

    const all = [...backing.chunks.values()];
    const bySource = (s: string) => all.filter((c) => c.source === s);
    expect(bySource('transcript').length).toBeGreaterThan(0);
    expect(bySource('analysis').length).toBe(2); // one chunk per concept

    // Analysis chunks are the "Concept: <name>. <summary>" form.
    expect(bySource('analysis').some((c) => c.text.startsWith('Concept: Helicase.'))).toBe(true);

    // Every transcript chunk carries an atMs, non-decreasing in emission order.
    const transcriptChunks = bySource('transcript');
    let prev = -1;
    for (const c of transcriptChunks) {
      expect(c.atMs).toBeTypeOf('number');
      expect(c.atMs!).toBeGreaterThanOrEqual(prev);
      prev = c.atMs!;
    }

    // Embeddings were written for every chunk.
    expect(backing.embeddings.size).toBe(all.length);
  });

  it('is idempotent: re-indexing replaces chunks without duplicating them', async () => {
    const { repos, backing } = makeRepos();
    const { lectureId } = seedDnaLecture(backing);
    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });
    const indexer = new KnowledgeIndexer({ repos, getEmbedder: () => embedder, store, logger });

    const first = await indexer.indexLecture(lectureId);
    const countAfterFirst = backing.chunks.size;
    const second = await indexer.indexLecture(lectureId);

    expect(second.chunkCount).toBe(first.chunkCount);
    expect(backing.chunks.size).toBe(countAfterFirst);
    expect(backing.embeddings.size).toBe(countAfterFirst);

    // Search still returns exactly the re-indexed corpus (no orphans).
    const [q] = await embedder.embed(['helicase unwinds the helix']);
    const hits = await store.search(q!, { limit: 100 });
    expect(hits.length).toBe(countAfterFirst);
  });

  it('indexes generated notes material as notes-source chunks', async () => {
    const { repos, backing } = makeRepos();
    const { courseId, lectureId } = seedDnaLecture(backing);
    const notes: StudyMaterial = {
      id: 'mat-notes',
      lectureId,
      courseId,
      type: 'notes',
      title: 'Notes',
      difficulty: 'medium',
      content: {
        blocks: [
          { id: 'b1', type: 'heading', level: 2, text: 'DNA Replication' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Replication is semiconservative: each new molecule keeps one original strand.',
          },
          { id: 'b3', type: 'bullets', items: ['Helicase unwinds', 'Polymerase synthesizes'] },
        ],
      },
      generatedBy: 'test',
      createdAt: T0,
    };
    backing.materials.push(notes);

    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });
    const indexer = new KnowledgeIndexer({ repos, getEmbedder: () => embedder, store, logger });
    await indexer.indexLecture(lectureId);

    const noteChunks = [...backing.chunks.values()].filter((c) => c.source === 'notes');
    expect(noteChunks.length).toBeGreaterThan(0);
    expect(noteChunks.some((c) => c.text.includes('semiconservative'))).toBe(true);
  });
});

/* ————————————————————————— KnowledgeService ————————————————————————— */

describe('KnowledgeService', () => {
  async function seededService(ai: AIFacade): Promise<{
    service: KnowledgeService;
    backing: Backing;
    ids: { courseId: string; lectureId: string };
  }> {
    const { repos, backing } = makeRepos();
    const ids = seedDnaLecture(backing);
    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });
    const indexer = new KnowledgeIndexer({ repos, getEmbedder: () => embedder, store, logger });
    await indexer.indexLecture(ids.lectureId);
    const service = new KnowledgeService({
      repos,
      getEmbedder: () => embedder,
      store,
      ai,
      logger,
    });
    return { service, backing, ids };
  }

  it('semanticSearch hydrates hits with course/lecture display metadata', async () => {
    const { service } = await seededService(makeAI(false));
    const hits = await service.semanticSearch('what enzyme unwinds the double helix');
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0]!;
    expect(top.courseName).toBe('Molecular Biology');
    expect(top.lectureTitle).toBe('DNA Replication');
    expect(top.lectureNumber).toBe(1);
    expect(top.score).toBeGreaterThan(0);
  });

  it('keywordSearch finds a seeded phrase with correct lecture metadata', async () => {
    const { service } = await seededService(makeAI(false));
    const hits = await service.keywordSearch('Okazaki fragments lagging strand');
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0]!;
    expect(hit.chunk.source).toBe('transcript');
    expect(hit.chunk.text.toLowerCase()).toContain('okazaki');
    // atMs comes straight from the matching segment (index 4 -> 20000ms).
    expect(hit.chunk.atMs).toBe(20000);
    expect(hit.courseName).toBe('Molecular Biology');
    expect(hit.lectureNumber).toBe(1);
  });

  it('ask (offline) returns an extractive answer with citations', async () => {
    const { service, ids } = await seededService(makeAI(false));
    const answer = await service.ask('What does helicase do?');
    expect(answer.noSources).toBe(false);
    expect(answer.markdown).toContain('From your lectures:');
    expect(answer.generatedBy).toBe('studdybuddy/extractive');
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations[0]!.lectureId).toBe(ids.lectureId);
    expect(answer.citations[0]!.courseName).toBe('Molecular Biology');
    expect(answer.citations[0]!.excerpt.length).toBeGreaterThan(0);
  });

  it('ask (AI) parses bracketed citations from the model answer', async () => {
    const ai = makeAI(true, 'Helicase unwinds the double helix at the replication fork [1].');
    const { service, ids } = await seededService(ai);
    const answer = await service.ask('What does helicase do?');
    expect(answer.noSources).toBe(false);
    expect(answer.generatedBy).toBe('mock/test-model');
    expect(answer.markdown).toContain('[1]');
    expect(answer.citations.length).toBe(1);
    expect(answer.citations[0]!.lectureId).toBe(ids.lectureId);
  });

  it('ask reports noSources honestly when nothing is indexed', async () => {
    const { repos, backing } = makeRepos();
    // A course/lecture exist but nothing was indexed into the vector store.
    seedDnaLecture(backing);
    const embedder = new TestEmbedder();
    const store = new LocalVectorStore({ repos, logger });
    const service = new KnowledgeService({
      repos,
      getEmbedder: () => embedder,
      store,
      ai: makeAI(false),
      logger,
    });

    const answer = await service.ask('What did the professor say about mitochondria?');
    expect(answer.noSources).toBe(true);
    expect(answer.citations).toEqual([]);
    expect(answer.markdown.toLowerCase()).toContain("couldn't find");
  });
});
