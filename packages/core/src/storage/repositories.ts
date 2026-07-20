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
import {
  Collections,
  type LectureDocRepo,
  type Repositories,
  type StorageAdapter,
} from './types';

/**
 * Fixed id for singleton documents (gamification state). Kept stable so the
 * doc is an upsert target rather than an append-only series.
 */
const SINGLETON_ID = 'singleton';

/**
 * Build the typed repository layer over any StorageAdapter. Feature services
 * depend on these interfaces only, never on adapters, so the backend stays
 * swappable end-to-end.
 *
 * Storage conventions encoded here:
 * - Transcript/analysis docs are per-lecture singletons stored with
 *   `id = lectureId` (a synthetic `id` is added on write and stripped on read,
 *   since the shared types carry only `lectureId`).
 * - Embeddings are stored with `id = chunkId` so chunk deletion can delete the
 *   matching embedding by primary key.
 * - The kv repo lives in the `settings` collection as `{ id: key, value }`
 *   wrapper docs, so non-object values (counters, arrays) round-trip cleanly.
 * - `deleteLectureCascade` / `deleteCourseCascade` remove every derived
 *   artifact (transcript, analysis, materials, quiz attempts, slide decks,
 *   chunks + their embeddings, and — for courses — exam preps), leaving no
 *   orphans behind.
 */
export function createRepositories(adapter: StorageAdapter): Repositories {
  /** Delete the given chunks' embeddings, then the chunks themselves. */
  async function deleteChunksWithEmbeddings(
    where: Record<string, string>,
  ): Promise<void> {
    const chunks = await adapter.query<KnowledgeChunk>(Collections.knowledgeChunks, { where });
    // Embeddings use id = chunkId, so a primary-key delete per chunk suffices.
    for (const chunk of chunks) await adapter.delete(Collections.embeddings, chunk.id);
    await adapter.deleteWhere(Collections.knowledgeChunks, where);
  }

  async function deleteLectureCascade(lectureId: string): Promise<void> {
    await deleteChunksWithEmbeddings({ lectureId });
    await adapter.delete(Collections.transcripts, lectureId);
    await adapter.delete(Collections.analyses, lectureId);
    await adapter.deleteWhere(Collections.materials, { lectureId });
    await adapter.deleteWhere(Collections.quizAttempts, { lectureId });
    await adapter.deleteWhere(Collections.slideDecks, { lectureId });
    await adapter.delete(Collections.lectures, lectureId);
  }

  async function deleteCourseCascade(courseId: string): Promise<void> {
    const lectures = await adapter.query<Lecture>(Collections.lectures, {
      where: { courseId },
    });
    for (const lecture of lectures) await deleteLectureCascade(lecture.id);
    // Sweep course-scoped docs whose lecture rows were already gone (defensive:
    // guarantees no orphans even after a previous partial failure).
    await deleteChunksWithEmbeddings({ courseId });
    await adapter.deleteWhere(Collections.materials, { courseId });
    await adapter.deleteWhere(Collections.slideDecks, { courseId });
    await adapter.deleteWhere(Collections.examPreps, { courseId });
    await adapter.delete(Collections.courses, courseId);
  }

  return {
    courses: {
      // Alphabetical: the course list is a stable navigation surface in the UI.
      list: () =>
        adapter.query<Course>(Collections.courses, {
          orderBy: { field: 'name', direction: 'asc' },
        }),
      get: (id) => adapter.get<Course>(Collections.courses, id),
      put: (course) => adapter.put(Collections.courses, course),
      delete: (id) => adapter.delete(Collections.courses, id),
    },

    lectures: {
      byCourse: (courseId) =>
        adapter.query<Lecture>(Collections.lectures, {
          where: { courseId },
          orderBy: { field: 'number', direction: 'asc' },
        }),
      recent: (limit) =>
        adapter.query<Lecture>(Collections.lectures, {
          orderBy: { field: 'recordedAt', direction: 'desc' },
          limit,
        }),
      get: (id) => adapter.get<Lecture>(Collections.lectures, id),
      put: (lecture) => adapter.put(Collections.lectures, lecture),
      delete: (id) => adapter.delete(Collections.lectures, id),
      nextNumber: async (courseId) => {
        // Max existing number + 1 (not count + 1) so deleting a middle lecture
        // never reissues a number already referenced elsewhere.
        const existing = await adapter.query<Lecture>(Collections.lectures, {
          where: { courseId },
        });
        return existing.reduce((max, l) => Math.max(max, l.number), 0) + 1;
      },
    },

    transcripts: lectureDocRepo<Transcript>(adapter, Collections.transcripts),
    analyses: lectureDocRepo<LectureAnalysis>(adapter, Collections.analyses),

    materials: {
      listMeta: async (lectureId) => {
        const rows = await adapter.query<StudyMaterial>(Collections.materials, {
          where: { lectureId },
          orderBy: { field: 'createdAt', direction: 'desc' },
        });
        // Strip the (potentially large) content payload for listing rows.
        return rows.map(({ content: _content, ...meta }) => meta as StudyMaterialMeta);
      },
      get: (id) => adapter.get<StudyMaterial>(Collections.materials, id),
      latestOfType: async (lectureId, type: MaterialType) => {
        const rows = await adapter.query<StudyMaterial>(Collections.materials, {
          where: { lectureId, type },
          orderBy: { field: 'createdAt', direction: 'desc' },
          limit: 1,
        });
        return rows[0] ?? null;
      },
      // Chronological (lecture order) — consumers like exam prep walk the
      // course's materials oldest → newest.
      byCourseAndType: (courseId, type: MaterialType) =>
        adapter.query<StudyMaterial>(Collections.materials, {
          where: { courseId, type },
          orderBy: { field: 'createdAt', direction: 'asc' },
        }),
      put: (material) => adapter.put(Collections.materials, material),
      delete: (id) => adapter.delete(Collections.materials, id),
      deleteByLecture: (lectureId) =>
        adapter.deleteWhere(Collections.materials, { lectureId }),
    },

    quizAttempts: {
      byLecture: (lectureId) =>
        adapter.query<QuizAttempt>(Collections.quizAttempts, {
          where: { lectureId },
          orderBy: { field: 'startedAt', direction: 'asc' },
        }),
      put: (attempt) => adapter.put(Collections.quizAttempts, attempt),
      deleteByLecture: (lectureId) =>
        adapter.deleteWhere(Collections.quizAttempts, { lectureId }),
    },

    slideDecks: {
      byLecture: async (lectureId) => {
        const rows = await adapter.query<SlideDeck>(Collections.slideDecks, {
          where: { lectureId },
          orderBy: { field: 'createdAt', direction: 'desc' },
          limit: 1,
        });
        return rows[0] ?? null;
      },
      get: (id) => adapter.get<SlideDeck>(Collections.slideDecks, id),
      put: (deck) => adapter.put(Collections.slideDecks, deck),
      deleteByLecture: (lectureId) =>
        adapter.deleteWhere(Collections.slideDecks, { lectureId }),
    },

    examPreps: {
      latest: async (courseId) => {
        const rows = await adapter.query<ExamPrepPlan>(Collections.examPreps, {
          where: { courseId },
          orderBy: { field: 'createdAt', direction: 'desc' },
          limit: 1,
        });
        return rows[0] ?? null;
      },
      put: (plan) => adapter.put(Collections.examPreps, plan),
    },

    chunks: {
      byLecture: (lectureId) =>
        adapter.query<KnowledgeChunk>(Collections.knowledgeChunks, {
          where: { lectureId },
          orderBy: { field: 'createdAt', direction: 'asc' },
        }),
      all: () => adapter.query<KnowledgeChunk>(Collections.knowledgeChunks),
      putMany: (chunks) => adapter.putMany(Collections.knowledgeChunks, chunks),
      // Also removes the chunks' embeddings: once a chunk row is gone its id is
      // unrecoverable, so this is the last safe moment to clean them up.
      deleteByLecture: (lectureId) => deleteChunksWithEmbeddings({ lectureId }),
    },

    embeddings: {
      all: async () => {
        const rows = await adapter.query<{ id: string; chunkId: string; vector: number[] }>(
          Collections.embeddings,
        );
        return rows.map(({ chunkId, vector }) => ({ chunkId, vector }));
      },
      putMany: (entries) =>
        adapter.putMany(
          Collections.embeddings,
          entries.map((e) => ({ id: e.chunkId, chunkId: e.chunkId, vector: e.vector })),
        ),
      deleteByChunkIds: async (chunkIds) => {
        for (const chunkId of chunkIds) await adapter.delete(Collections.embeddings, chunkId);
      },
    },

    gamification: {
      get: async () => {
        const row = await adapter.get<GamificationState & { id: string }>(
          Collections.gamification,
          SINGLETON_ID,
        );
        if (!row) return null;
        const { id: _id, ...state } = row;
        return state as GamificationState;
      },
      put: (state) => adapter.put(Collections.gamification, { ...state, id: SINGLETON_ID }),
    },

    kv: {
      get: async <T>(key: string) => {
        const row = await adapter.get<{ id: string; value: T }>(Collections.settings, key);
        return row ? row.value : null;
      },
      put: <T>(key: string, value: T) =>
        adapter.put(Collections.settings, { id: key, value }),
    },

    deleteLectureCascade,
    deleteCourseCascade,
  };
}

/**
 * Per-lecture singleton doc repo (transcript, analysis). Docs are stored with
 * `id = lectureId`; the synthetic id is stripped on read so callers get back
 * exactly the shape they put in.
 */
function lectureDocRepo<T extends { lectureId: string }>(
  adapter: StorageAdapter,
  collection: string,
): LectureDocRepo<T> {
  return {
    getByLecture: async (lectureId) => {
      const row = await adapter.get<T & { id: string }>(collection, lectureId);
      if (!row) return null;
      const { id: _id, ...doc } = row;
      return doc as unknown as T;
    },
    put: (doc) => adapter.put(collection, { ...doc, id: doc.lectureId }),
    deleteByLecture: (lectureId) => adapter.delete(collection, lectureId),
  };
}
