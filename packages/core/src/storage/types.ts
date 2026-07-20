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

/* ————————————————————————————————————————————————————————————————
 * Typed repositories. All feature services depend on these interfaces
 * (never on adapters directly), so storage stays swappable end-to-end.
 * ———————————————————————————————————————————————————————————————— */

import type {
  Course,
  ExamPrepPlan,
  GamificationState,
  KnowledgeChunk,
  Lecture,
  LectureAnalysis,
  MaterialType,
  QuizAttempt,
  SlideDeck,
  StudyMaterial,
  StudyMaterialMeta,
  Transcript,
} from '@studdybuddy/shared';

export interface CourseRepo {
  list(): Promise<Course[]>;
  get(id: string): Promise<Course | null>;
  put(course: Course): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LectureRepo {
  /** Lectures for a course, ordered by lecture number ascending. */
  byCourse(courseId: string): Promise<Lecture[]>;
  /** Most recently recorded lectures across all courses. */
  recent(limit: number): Promise<Lecture[]>;
  get(id: string): Promise<Lecture | null>;
  put(lecture: Lecture): Promise<void>;
  delete(id: string): Promise<void>;
  /** Next lecture number within a course (1-based). */
  nextNumber(courseId: string): Promise<number>;
}

/** Per-lecture singleton documents (transcript, analysis) keyed by lectureId. */
export interface LectureDocRepo<T> {
  getByLecture(lectureId: string): Promise<T | null>;
  put(doc: T): Promise<void>;
  deleteByLecture(lectureId: string): Promise<void>;
}

export interface MaterialRepo {
  /** Listing rows (content stripped), newest first. */
  listMeta(lectureId: string): Promise<StudyMaterialMeta[]>;
  get(id: string): Promise<StudyMaterial | null>;
  /** Latest material of a type for a lecture, if any. */
  latestOfType(lectureId: string, type: MaterialType): Promise<StudyMaterial | null>;
  byCourseAndType(courseId: string, type: MaterialType): Promise<StudyMaterial[]>;
  put(material: StudyMaterial): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByLecture(lectureId: string): Promise<void>;
}

export interface QuizAttemptRepo {
  byLecture(lectureId: string): Promise<QuizAttempt[]>;
  put(attempt: QuizAttempt): Promise<void>;
  deleteByLecture(lectureId: string): Promise<void>;
}

export interface SlideDeckRepo {
  byLecture(lectureId: string): Promise<SlideDeck | null>;
  get(id: string): Promise<SlideDeck | null>;
  put(deck: SlideDeck): Promise<void>;
  deleteByLecture(lectureId: string): Promise<void>;
}

export interface ExamPrepRepo {
  latest(courseId: string): Promise<ExamPrepPlan | null>;
  put(plan: ExamPrepPlan): Promise<void>;
}

export interface ChunkRepo {
  byLecture(lectureId: string): Promise<KnowledgeChunk[]>;
  all(): Promise<KnowledgeChunk[]>;
  putMany(chunks: KnowledgeChunk[]): Promise<void>;
  deleteByLecture(lectureId: string): Promise<void>;
}

export interface EmbeddingRepo {
  all(): Promise<{ chunkId: string; vector: number[] }[]>;
  putMany(entries: { chunkId: string; vector: number[] }[]): Promise<void>;
  deleteByChunkIds(chunkIds: string[]): Promise<void>;
}

export interface GamificationRepo {
  get(): Promise<GamificationState | null>;
  put(state: GamificationState): Promise<void>;
}

/** Small typed key-value store for counters, plugin snapshots, misc state. */
export interface KvRepo {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface Repositories {
  courses: CourseRepo;
  lectures: LectureRepo;
  transcripts: LectureDocRepo<Transcript>;
  analyses: LectureDocRepo<LectureAnalysis>;
  materials: MaterialRepo;
  quizAttempts: QuizAttemptRepo;
  slideDecks: SlideDeckRepo;
  examPreps: ExamPrepRepo;
  chunks: ChunkRepo;
  embeddings: EmbeddingRepo;
  gamification: GamificationRepo;
  kv: KvRepo;
  /** Delete a lecture and every derived artifact (transcript, analysis, materials…). */
  deleteLectureCascade(lectureId: string): Promise<void>;
  /** Delete a course, its lectures, and all derived artifacts. */
  deleteCourseCascade(courseId: string): Promise<void>;
}

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
