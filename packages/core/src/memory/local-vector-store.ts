import type { KnowledgeChunk } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Repositories } from '../storage/types';
import type { ScoredChunk, VectorStore } from './types';

export interface LocalVectorStoreDeps {
  repos: Repositories;
  logger: Logger;
}

/** Cache entry: the persisted chunk paired with its embedding vector. */
interface IndexEntry {
  vector: number[];
  chunk: KnowledgeChunk;
}

/**
 * Cosine similarity of two equal-length vectors. Returns 0 when either vector
 * has zero magnitude (e.g. an empty/stopword-only chunk), so such chunks never
 * outrank real matches. Callers guarantee equal length by filtering on
 * dimension first.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The built-in vector store: persists chunks + embeddings through the storage
 * repositories and keeps an in-memory index for exact cosine search. Exact
 * search over a fully-cached corpus is more than fast enough for a semester of
 * lectures (thousands of chunks), and needs no native/vector-DB dependency,
 * keeping the offline-first guarantee intact. A ChromaDB/FAISS adapter can
 * replace it behind {@link VectorStore} for larger corpora.
 *
 * The index is loaded lazily on first use and then kept in sync incrementally
 * by {@link upsert}/{@link removeByLecture}, so steady-state reads never touch
 * disk.
 */
export class LocalVectorStore implements VectorStore {
  readonly kind = 'local-vector';

  private readonly repos: Repositories;
  private readonly logger: Logger;
  private index = new Map<string, IndexEntry>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  /** Guards the dimension-mismatch warning so an embedder switch logs once. */
  private warnedDimMismatch = false;

  constructor(deps: LocalVectorStoreDeps) {
    this.repos = deps.repos;
    this.logger = deps.logger.child('vector-store');
  }

  /**
   * Load every chunk and every embedding into the in-memory index once. Chunks
   * without a matching embedding are ignored (they cannot be searched); a
   * single in-flight load is shared so concurrent callers don't double-read.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) this.loadPromise = this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    const [chunks, embeddings] = await Promise.all([
      this.repos.chunks.all(),
      this.repos.embeddings.all(),
    ]);
    const byId = new Map(chunks.map((c) => [c.id, c]));
    const index = new Map<string, IndexEntry>();
    for (const { chunkId, vector } of embeddings) {
      const chunk = byId.get(chunkId);
      if (chunk) index.set(chunkId, { vector, chunk });
    }
    this.index = index;
    this.loaded = true;
    this.logger.debug('index loaded', { chunks: index.size });
  }

  async upsert(chunks: KnowledgeChunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `upsert requires one embedding per chunk (got ${chunks.length} chunks, ${embeddings.length} embeddings)`,
      );
    }
    if (chunks.length === 0) return;
    await this.ensureLoaded();

    const entries = chunks.map((chunk, i) => ({ chunkId: chunk.id, vector: embeddings[i]! }));
    await this.repos.chunks.putMany(chunks);
    await this.repos.embeddings.putMany(entries);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      this.index.set(chunk.id, { vector: embeddings[i]!, chunk });
    }
    this.logger.debug('upsert', { count: chunks.length, total: this.index.size });
  }

  async removeByLecture(lectureId: string): Promise<void> {
    await this.ensureLoaded();
    const existing = await this.repos.chunks.byLecture(lectureId);
    const chunkIds = existing.map((c) => c.id);
    if (chunkIds.length > 0) {
      await this.repos.embeddings.deleteByChunkIds(chunkIds);
      await this.repos.chunks.deleteByLecture(lectureId);
    }
    // Refresh the cache by dropping every entry for this lecture, independent of
    // what the DB reported, so a re-index starts from a clean slate.
    for (const [id, entry] of this.index) {
      if (entry.chunk.lectureId === lectureId) this.index.delete(id);
    }
    this.logger.debug('removeByLecture', { lectureId, removed: chunkIds.length });
  }

  async search(
    queryEmbedding: number[],
    options: { limit: number; courseId?: string; lectureId?: string },
  ): Promise<ScoredChunk[]> {
    await this.ensureLoaded();
    const dim = queryEmbedding.length;
    const results: ScoredChunk[] = [];
    for (const { vector, chunk } of this.index.values()) {
      if (options.courseId && chunk.courseId !== options.courseId) continue;
      if (options.lectureId && chunk.lectureId !== options.lectureId) continue;
      // An embedder change mid-semester leaves vectors of a different dimension
      // in storage; they can't be compared against the current query, so skip
      // them (and warn once — they'll disappear as their lectures are re-indexed).
      if (vector.length !== dim) {
        if (!this.warnedDimMismatch) {
          this.warnedDimMismatch = true;
          this.logger.warn('skipping embeddings of mismatched dimension', {
            queryDim: dim,
            storedDim: vector.length,
          });
        }
        continue;
      }
      results.push({ chunk, score: cosine(queryEmbedding, vector) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, Math.max(0, options.limit));
  }
}
