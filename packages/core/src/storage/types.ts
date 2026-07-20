/**
 * Local-first document storage.
 *
 * The app persists typed JSON documents in named collections. Two adapters
 * implement this interface:
 *   - SqliteAdapter  — node:sqlite (WAL, indexed), the default
 *   - JsonFileAdapter — plain JSON files, zero-dependency fallback
 * Both are swappable via the `storage-adapter` concept; ChromaDB/Postgres
 * could be added the same way for future cloud sync.
 */

export interface QueryOptions {
  /** Equality filters on top-level indexed fields (courseId, lectureId, type…). */
  where?: Record<string, string | number | boolean>;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface StorageAdapter {
  readonly kind: string;
  init(): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T extends { id: string }>(collection: string, doc: T): Promise<void>;
  /** Bulk upsert inside a single transaction where supported. */
  putMany<T extends { id: string }>(collection: string, docs: T[]): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  deleteWhere(collection: string, where: Record<string, string | number | boolean>): Promise<void>;
  query<T>(collection: string, options?: QueryOptions): Promise<T[]>;
  count(collection: string, where?: Record<string, string | number | boolean>): Promise<number>;
  /** All docs across collections, for backup. */
  dump(): Promise<Record<string, unknown[]>>;
  /** Replace entire contents from a backup dump. */
  restore(dump: Record<string, unknown[]>): Promise<void>;
  close(): Promise<void>;
}

/** Collection names — single registry so adapters can index consistently. */
export const Collections = {
  courses: 'courses',
  lectures: 'lectures',
  transcripts: 'transcripts',
  analyses: 'analyses',
  materials: 'materials',
  quizAttempts: 'quiz_attempts',
  slideDecks: 'slide_decks',
  knowledgeChunks: 'knowledge_chunks',
  embeddings: 'embeddings',
  examPreps: 'exam_preps',
  gamification: 'gamification',
  settings: 'settings',
  plugins: 'plugins',
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];

/**
 * Fields adapters should index (SQLite creates real indexes; the JSON adapter
 * ignores this). Keep in sync with QueryOptions.where usage in repositories.
 */
export const IndexedFields: Record<string, string[]> = {
  [Collections.lectures]: ['courseId', 'status'],
  [Collections.transcripts]: ['lectureId'],
  [Collections.analyses]: ['lectureId'],
  [Collections.materials]: ['lectureId', 'courseId', 'type'],
  [Collections.quizAttempts]: ['lectureId', 'materialId'],
  [Collections.slideDecks]: ['lectureId', 'courseId'],
  [Collections.knowledgeChunks]: ['courseId', 'lectureId', 'source'],
  [Collections.embeddings]: ['chunkId'],
  [Collections.examPreps]: ['courseId'],
};
