import {
  formatOffset,
  newId,
  truncate,
  type AskAnswer,
  type Citation,
  type Course,
  type KnowledgeChunk,
  type Lecture,
  type SearchHit,
  type SearchScope,
} from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import type { AIFacade, EmbeddingProvider } from '../ai/types';
import type { Repositories } from '../storage/types';
import type { ScoredChunk, VectorStore } from './types';

export interface KnowledgeServiceDeps {
  repos: Repositories;
  /** Resolved lazily so the active embedding provider can change at runtime. */
  getEmbedder: () => EmbeddingProvider;
  store: VectorStore;
  ai: AIFacade;
  logger: Logger;
}

/** Best-score floor below which a question is treated as unanswered. */
const MIN_ANSWER_SCORE = 0.15;
/** How many hits the RAG answer is grounded in. */
const ASK_HITS = 8;
/** Default hit cap for semantic search. */
const DEFAULT_SEMANTIC_LIMIT = 12;
/** Default hit cap for keyword search. */
const DEFAULT_KEYWORD_LIMIT = 20;
/** Number of chunks the extractive (offline) answer quotes. */
const EXTRACTIVE_CHUNKS = 3;
/** Characters of a chunk kept as a citation excerpt. */
const EXCERPT_CHARS = 140;

const NO_SOURCES_MARKDOWN =
  "I couldn't find that in your lectures yet.\n\n" +
  'Try rephrasing the question, or record/import the lecture that covers this topic — ' +
  "once it's transcribed and indexed I'll be able to answer it with citations.";

/** Split a query into lowercase alphanumeric terms of length ≥ 2. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Split text into trimmed sentences for extractive answering. */
function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?\n]*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * The knowledge base: semantic + keyword retrieval and grounded Q&A over every
 * indexed lecture. Q&A degrades gracefully — when no AI provider is available
 * it returns a real extractive answer quoting the top chunks, so "Ask your
 * lectures" works with zero API keys, never with filler text.
 */
export class KnowledgeService {
  private readonly repos: Repositories;
  private readonly getEmbedder: () => EmbeddingProvider;
  private readonly store: VectorStore;
  private readonly ai: AIFacade;
  private readonly logger: Logger;

  constructor(deps: KnowledgeServiceDeps) {
    this.repos = deps.repos;
    this.getEmbedder = deps.getEmbedder;
    this.store = deps.store;
    this.ai = deps.ai;
    this.logger = deps.logger.child('knowledge');
  }

  /**
   * Semantic search: embed the query, retrieve nearest chunks from the vector
   * store, and hydrate each with display metadata.
   */
  async semanticSearch(
    query: string,
    scope?: SearchScope,
    limit = DEFAULT_SEMANTIC_LIMIT,
  ): Promise<SearchHit[]> {
    const [vector] = await this.getEmbedder().embed([query]);
    if (!vector) return [];
    const scored = await this.store.search(vector, {
      limit,
      ...(scope?.courseId ? { courseId: scope.courseId } : {}),
      ...(scope?.lectureId ? { lectureId: scope.lectureId } : {}),
    });
    return this.hydrate(scored);
  }

  /**
   * Keyword search across raw transcripts of in-scope lectures. Segments are
   * scored by how many query terms they contain; segments matching all terms
   * are preferred, falling back to any-term matches when nothing matches every
   * term. Backs `transcripts.search` in the IPC contract.
   */
  async keywordSearch(
    query: string,
    scope?: SearchScope,
    limit = DEFAULT_KEYWORD_LIMIT,
  ): Promise<SearchHit[]> {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];

    const lectures = await this.scopedLectures(scope);
    const now = Date.now();
    const rows: { scored: ScoredChunk; matched: number }[] = [];

    for (const lecture of lectures) {
      const transcript = await this.repos.transcripts.getByLecture(lecture.id);
      if (!transcript) continue;
      for (const segment of transcript.segments) {
        const lower = segment.text.toLowerCase();
        let matched = 0;
        let occurrences = 0;
        for (const term of terms) {
          let idx = lower.indexOf(term);
          if (idx < 0) continue;
          matched++;
          while (idx >= 0) {
            occurrences++;
            idx = lower.indexOf(term, idx + term.length);
          }
        }
        if (matched === 0) continue;
        const density = matched / terms.length;
        const score = Math.min(1, density * 0.8 + (Math.min(occurrences, 5) / 5) * 0.2);
        const chunk: KnowledgeChunk = {
          id: newId(),
          courseId: lecture.courseId,
          lectureId: lecture.id,
          source: 'transcript',
          text: segment.text,
          atMs: segment.startMs,
          createdAt: now,
        };
        rows.push({ scored: { chunk, score }, matched });
      }
    }

    const full = rows.filter((r) => r.matched === terms.length);
    const pool = full.length > 0 ? full : rows;
    pool.sort((a, b) => b.matched - a.matched || b.scored.score - a.scored.score);
    return this.hydrate(pool.slice(0, limit).map((r) => r.scored));
  }

  /**
   * RAG Q&A. Retrieves the top semantic hits; when the best is too weak it
   * honestly reports that nothing was found. With an AI provider it asks the
   * model to answer in markdown citing numbered context blocks; offline it
   * returns an extractive answer quoting the strongest chunks. Either way the
   * answer carries {@link Citation}s the UI can deep-link.
   */
  async ask(question: string, scope?: SearchScope): Promise<AskAnswer> {
    const hits = await this.semanticSearch(question, scope, ASK_HITS);
    const best = hits[0]?.score ?? 0;
    if (hits.length === 0 || best < MIN_ANSWER_SCORE) {
      return {
        question,
        markdown: NO_SOURCES_MARKDOWN,
        citations: [],
        noSources: true,
        generatedBy: 'studdybuddy/retrieval',
      };
    }

    if (await this.ai.available()) {
      try {
        return await this.answerWithAI(question, hits);
      } catch (e) {
        this.logger.warn('AI answer failed; falling back to extractive answer', {
          error: (e as Error).message,
        });
      }
    }
    return this.answerExtractively(question, hits);
  }

  /* ————————————————————————— internals ————————————————————————— */

  /** Resolve the lectures a scope covers (one, a course's, or all). */
  private async scopedLectures(scope?: SearchScope): Promise<Lecture[]> {
    if (scope?.lectureId) {
      const lecture = await this.repos.lectures.get(scope.lectureId);
      return lecture ? [lecture] : [];
    }
    if (scope?.courseId) return this.repos.lectures.byCourse(scope.courseId);
    const courses = await this.repos.courses.list();
    const all: Lecture[] = [];
    for (const course of courses) all.push(...(await this.repos.lectures.byCourse(course.id)));
    return all;
  }

  /** Attach course/lecture display metadata to scored chunks, caching lookups. */
  private async hydrate(scored: ScoredChunk[]): Promise<SearchHit[]> {
    const courseCache = new Map<string, Course | null>();
    const lectureCache = new Map<string, Lecture | null>();
    const getCourse = async (id: string): Promise<Course | null> => {
      if (!courseCache.has(id)) courseCache.set(id, await this.repos.courses.get(id));
      return courseCache.get(id) ?? null;
    };
    const getLecture = async (id: string): Promise<Lecture | null> => {
      if (!lectureCache.has(id)) lectureCache.set(id, await this.repos.lectures.get(id));
      return lectureCache.get(id) ?? null;
    };

    const hits: SearchHit[] = [];
    for (const { chunk, score } of scored) {
      const course = await getCourse(chunk.courseId);
      const lecture = await getLecture(chunk.lectureId);
      hits.push({
        chunk,
        score,
        courseName: course?.name ?? 'Unknown course',
        lectureTitle: lecture?.title ?? 'Unknown lecture',
        lectureNumber: lecture?.number ?? 0,
      });
    }
    return hits;
  }

  private citationOf(hit: SearchHit): Citation {
    return {
      lectureId: hit.chunk.lectureId,
      lectureTitle: hit.lectureTitle,
      courseName: hit.courseName,
      atMs: hit.chunk.atMs,
      excerpt: truncate(hit.chunk.text, EXCERPT_CHARS),
    };
  }

  private async answerWithAI(question: string, hits: SearchHit[]): Promise<AskAnswer> {
    const context = hits
      .map((hit, i) => {
        const stamp = hit.chunk.atMs !== undefined ? ` @ ${formatOffset(hit.chunk.atMs)}` : '';
        const head = `[${i + 1}] ${hit.courseName} — Lecture ${hit.lectureNumber} (${hit.lectureTitle})${stamp}`;
        return `${head}\n${hit.chunk.text}`;
      })
      .join('\n\n');

    const system =
      'You are StuddyBuddy, a study assistant that answers strictly from a student\'s own ' +
      'lecture recordings. Use ONLY the numbered excerpts provided. If they do not contain ' +
      'the answer, say so plainly. Write a concise markdown answer and, after each claim, ' +
      'cite the supporting excerpt like [1] or [2]. Never invent citations or facts.';
    const user = `Question: ${question}\n\nLecture excerpts:\n${context}\n\nAnswer in markdown with bracketed citations.`;

    const result = await this.ai.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    });

    const markdown = result.text.trim();
    const citations = this.parseCitations(markdown, hits);
    return {
      question,
      markdown,
      citations,
      noSources: false,
      generatedBy: this.ai.activeLabel(),
    };
  }

  /** Map bracketed [n] references in the answer back to citations, in order. */
  private parseCitations(markdown: string, hits: SearchHit[]): Citation[] {
    const seen = new Set<number>();
    const ordered: number[] = [];
    for (const match of markdown.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= hits.length && !seen.has(n)) {
        seen.add(n);
        ordered.push(n);
      }
    }
    // If the model cited nothing parseable, ground the answer on the top hit so
    // the UI still has a source to link.
    if (ordered.length === 0 && hits[0]) return [this.citationOf(hits[0])];
    return ordered.map((n) => this.citationOf(hits[n - 1]!));
  }

  private answerExtractively(question: string, hits: SearchHit[]): AskAnswer {
    const terms = queryTerms(question);
    const top = hits.slice(0, EXTRACTIVE_CHUNKS);
    const parts: string[] = ['From your lectures:', ''];
    const citations: Citation[] = [];

    top.forEach((hit, i) => {
      const n = i + 1;
      const lead = this.bestSentences(hit.chunk.text, terms);
      const stamp = hit.chunk.atMs !== undefined ? ` (${formatOffset(hit.chunk.atMs)})` : '';
      parts.push(`> ${lead} [${n}]`);
      parts.push(`— ${hit.courseName}, Lecture ${hit.lectureNumber}: ${hit.lectureTitle}${stamp}`);
      parts.push('');
      citations.push(this.citationOf(hit));
    });

    return {
      question,
      markdown: parts.join('\n').trim(),
      citations,
      noSources: false,
      generatedBy: 'studdybuddy/extractive',
    };
  }

  /**
   * Pick the sentence(s) from a chunk that best answer the question: the single
   * sentence containing the most query terms, plus its neighbour when short, so
   * the quote reads naturally. Falls back to the chunk's opening when no term
   * matches a sentence.
   */
  private bestSentences(text: string, terms: string[]): string {
    const list = sentences(text);
    if (list.length === 0) return truncate(text, EXCERPT_CHARS);
    let bestIdx = 0;
    let bestScore = -1;
    list.forEach((sentence, i) => {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const term of terms) if (lower.includes(term)) score++;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    if (bestScore <= 0) return truncate(list[0]!, EXCERPT_CHARS * 2);
    const picked = [list[bestIdx]!];
    if (picked[0]!.length < 80 && list[bestIdx + 1]) picked.push(list[bestIdx + 1]!);
    return truncate(picked.join(' '), EXCERPT_CHARS * 2);
  }
}
