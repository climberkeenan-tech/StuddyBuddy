import type { KnowledgeChunk } from '@studdybuddy/shared';

/**
 * Vector store abstraction for semantic retrieval. The built-in
 * LocalVectorStore persists vectors in the storage layer and does exact
 * cosine search — plenty for a semester of lectures. A ChromaDB/FAISS
 * adapter can replace it behind this interface for larger corpora.
 */
export interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
}

export interface VectorStore {
  readonly kind: string;
  /** Index (or re-index) chunks with their embeddings. */
  upsert(chunks: KnowledgeChunk[], embeddings: number[][]): Promise<void>;
  /** Remove all chunks for a lecture (used on re-transcription/delete). */
  removeByLecture(lectureId: string): Promise<void>;
  search(
    queryEmbedding: number[],
    options: { limit: number; courseId?: string; lectureId?: string },
  ): Promise<ScoredChunk[]>;
}
