import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Course,
  ExamPrepPlan,
  GamificationState,
  KnowledgeChunk,
  Lecture,
  LectureAnalysis,
  QuizAttempt,
  SlideDeck,
  StudyMaterial,
  Transcript,
} from '@studdybuddy/shared';
import { JsonFileAdapter } from '../src/storage/json-file-adapter';
import { SqliteAdapter } from '../src/storage/sqlite-adapter';
import { createRepositories } from '../src/storage/repositories';
import { Collections, type Repositories, type StorageAdapter } from '../src/storage/types';
import { LogManager } from '../src/infra/logger';

const logger = new LogManager().getLogger('test');

let sqliteAvailable = true;
try {
  await import('node:sqlite');
} catch {
  sqliteAvailable = false;
}

/* ——— minimal but type-complete entity builders ——— */

const T0 = 1_700_000_000_000;

const course = (id: string, name = `Course ${id}`): Course => ({
  id,
  name,
  instructor: 'Dr. Grant',
  semester: 'Fall 2026',
  color: '#7c3aed',
  icon: 'dna',
  archived: false,
  createdAt: T0,
  updatedAt: T0,
});

const lecture = (id: string, courseId: string, number: number, recordedAt = T0): Lecture => ({
  id,
  courseId,
  title: `Lecture ${number}`,
  number,
  status: 'ready',
  recordedAt,
  durationMs: 60_000,
  topics: ['topic'],
  tags: [],
  createdAt: recordedAt,
  updatedAt: recordedAt,
});

const transcript = (lectureId: string): Transcript => ({
  lectureId,
  segments: [
    { id: `${lectureId}-s0`, index: 0, startMs: 0, endMs: 1500, text: 'Hello class.', kind: 'speech' },
  ],
  paragraphs: [],
  sections: [],
  language: 'en',
  engine: 'simulated',
  updatedAt: T0,
});

const analysis = (lectureId: string): LectureAnalysis => ({
  lectureId,
  gist: 'A short gist.',
  concepts: [],
  definitions: [],
  formulas: [],
  examples: [],
  keyDates: [],
  emphasisCues: [],
  vocabulary: [],
  examWatchlist: [],
  struggleWatchlist: [],
  crossLectureLinks: [],
  generatedBy: 'test/heuristic',
  createdAt: T0,
});

const material = (
  id: string,
  lectureId: string,
  courseId: string,
  createdAt: number,
  type: StudyMaterial['type'] = 'summary-concise',
): StudyMaterial => ({
  id,
  lectureId,
  courseId,
  type,
  title: `Material ${id}`,
  difficulty: 'medium',
  content: { markdown: `# ${id}` },
  generatedBy: 'test/heuristic',
  createdAt,
});

const quizAttempt = (id: string, lectureId: string, materialId: string): QuizAttempt => ({
  id,
  materialId,
  lectureId,
  answers: [],
  score: 0.5,
  missedConceptIds: [],
  startedAt: T0,
  finishedAt: T0 + 60_000,
});

const slideDeck = (id: string, lectureId: string, courseId: string): SlideDeck => ({
  id,
  lectureId,
  courseId,
  title: `Deck ${id}`,
  slides: [],
  theme: 'auto',
  generatedBy: 'test/heuristic',
  createdAt: T0,
});

const chunk = (id: string, lectureId: string, courseId: string): KnowledgeChunk => ({
  id,
  courseId,
  lectureId,
  source: 'transcript',
  text: `chunk ${id}`,
  createdAt: T0,
});

const examPrep = (id: string, courseId: string, createdAt = T0): ExamPrepPlan => ({
  id,
  courseId,
  cumulativeReview: '## Review',
  keyConcepts: [],
  recurringTopics: [],
  likelyExamQuestions: [],
  weakAreas: [],
  studyOrder: [],
  generatedBy: 'test/heuristic',
  createdAt,
});

const gamification = (xp: number): GamificationState => ({
  xp,
  level: 1,
  streak: { current: 2, best: 5, lastStudyDay: '2026-07-20' },
  unlocked: [],
  studyMinutes: 42,
  dailyMinutes: { '2026-07-20': 42 },
  updatedAt: T0,
});

/* ——— suite, run against both adapters ——— */

const cases = [
  { name: 'JsonFileAdapter', enabled: true, make: (dir: string) => new JsonFileAdapter(dir, logger) },
  {
    name: 'SqliteAdapter',
    enabled: sqliteAvailable,
    make: (dir: string) => new SqliteAdapter(dir, logger),
  },
];

for (const c of cases) {
  const d = c.enabled ? describe : describe.skip;

  d(`repositories over ${c.name}`, () => {
    let dir: string;
    let adapter: StorageAdapter;
    let repos: Repositories;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-repos-'));
      adapter = c.make(dir);
      await adapter.init();
      repos = createRepositories(adapter);
    });

    afterEach(async () => {
      await adapter.close();
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('nextNumber is 1 for an empty course and max+1 afterwards', async () => {
      await repos.courses.put(course('c1'));
      expect(await repos.lectures.nextNumber('c1')).toBe(1);

      await repos.lectures.put(lecture('l1', 'c1', 1));
      await repos.lectures.put(lecture('l2', 'c1', 2));
      expect(await repos.lectures.nextNumber('c1')).toBe(3);

      // Deleting a middle lecture must not reissue an already-used number.
      await repos.lectures.delete('l1');
      expect(await repos.lectures.nextNumber('c1')).toBe(3);
      // Other courses are unaffected.
      expect(await repos.lectures.nextNumber('c2')).toBe(1);
    });

    it('byCourse orders by lecture number; recent orders newest first with limit', async () => {
      await repos.lectures.put(lecture('l2', 'c1', 2, T0 + 2000));
      await repos.lectures.put(lecture('l1', 'c1', 1, T0 + 1000));
      await repos.lectures.put(lecture('l3', 'c2', 1, T0 + 3000));

      expect((await repos.lectures.byCourse('c1')).map((l) => l.id)).toEqual(['l1', 'l2']);
      expect((await repos.lectures.recent(2)).map((l) => l.id)).toEqual(['l3', 'l2']);
    });

    it('transcript and analysis docs roundtrip exactly, keyed by lectureId', async () => {
      const t = transcript('l1');
      const a = analysis('l1');
      await repos.transcripts.put(t);
      await repos.analyses.put(a);

      // Stored with id = lectureId…
      expect(await adapter.get(Collections.transcripts, 'l1')).not.toBeNull();
      // …but the synthetic id never leaks back out.
      expect(await repos.transcripts.getByLecture('l1')).toEqual(t);
      expect(await repos.analyses.getByLecture('l1')).toEqual(a);
      expect(await repos.transcripts.getByLecture('l1')).not.toHaveProperty('id');

      await repos.transcripts.deleteByLecture('l1');
      expect(await repos.transcripts.getByLecture('l1')).toBeNull();
    });

    it('listMeta strips content and sorts newest first', async () => {
      await repos.materials.put(material('m-old', 'l1', 'c1', T0 + 1000));
      await repos.materials.put(material('m-new', 'l1', 'c1', T0 + 3000));
      await repos.materials.put(material('m-mid', 'l1', 'c1', T0 + 2000));
      await repos.materials.put(material('m-other', 'l2', 'c1', T0 + 9000));

      const metas = await repos.materials.listMeta('l1');
      expect(metas.map((m) => m.id)).toEqual(['m-new', 'm-mid', 'm-old']);
      for (const meta of metas) {
        expect(meta).not.toHaveProperty('content');
        expect(meta.title).toBeTruthy();
      }
      // Full doc still has its content.
      expect((await repos.materials.get('m-new'))?.content).toEqual({ markdown: '# m-new' });
    });

    it('latestOfType and byCourseAndType filter and order correctly', async () => {
      await repos.materials.put(material('m1', 'l1', 'c1', T0 + 1000, 'flashcards'));
      await repos.materials.put(material('m2', 'l1', 'c1', T0 + 2000, 'flashcards'));
      await repos.materials.put(material('m3', 'l1', 'c1', T0 + 3000, 'summary-concise'));

      expect((await repos.materials.latestOfType('l1', 'flashcards'))?.id).toBe('m2');
      expect(await repos.materials.latestOfType('l1', 'quiz-mcq')).toBeNull();
      expect(
        (await repos.materials.byCourseAndType('c1', 'flashcards')).map((m) => m.id),
      ).toEqual(['m1', 'm2']);
    });

    it('kv and gamification round-trip their values', async () => {
      expect(await repos.kv.get('counter')).toBeNull();
      await repos.kv.put('counter', 41);
      await repos.kv.put('counter', 42);
      expect(await repos.kv.get<number>('counter')).toBe(42);
      await repos.kv.put('plugin-state', { a: true });
      expect(await repos.kv.get('plugin-state')).toEqual({ a: true });

      expect(await repos.gamification.get()).toBeNull();
      const state = gamification(120);
      await repos.gamification.put(state);
      expect(await repos.gamification.get()).toEqual(state);
      expect(await repos.gamification.get()).not.toHaveProperty('id');
    });

    it('examPreps.latest returns the newest plan for the course', async () => {
      await repos.examPreps.put(examPrep('p1', 'c1', T0 + 1000));
      await repos.examPreps.put(examPrep('p2', 'c1', T0 + 2000));
      await repos.examPreps.put(examPrep('p3', 'c2', T0 + 9000));
      expect((await repos.examPreps.latest('c1'))?.id).toBe('p2');
      expect(await repos.examPreps.latest('c9')).toBeNull();
    });

    describe('cascade deletion', () => {
      /** Populate a course with two fully-derived lectures. */
      async function seed(): Promise<void> {
        await repos.courses.put(course('c1'));
        for (const [lid, num] of [
          ['l1', 1],
          ['l2', 2],
        ] as const) {
          await repos.lectures.put(lecture(lid, 'c1', num));
          await repos.transcripts.put(transcript(lid));
          await repos.analyses.put(analysis(lid));
          await repos.materials.put(material(`m-${lid}`, lid, 'c1', T0));
          await repos.quizAttempts.put(quizAttempt(`q-${lid}`, lid, `m-${lid}`));
          await repos.slideDecks.put(slideDeck(`d-${lid}`, lid, 'c1'));
          await repos.chunks.putMany([chunk(`k-${lid}-1`, lid, 'c1'), chunk(`k-${lid}-2`, lid, 'c1')]);
          await repos.embeddings.putMany([
            { chunkId: `k-${lid}-1`, vector: [0.1, 0.2] },
            { chunkId: `k-${lid}-2`, vector: [0.3, 0.4] },
          ]);
        }
        await repos.examPreps.put(examPrep('p1', 'c1'));
      }

      it('deleteLectureCascade removes every derived artifact for that lecture only', async () => {
        await seed();
        await repos.deleteLectureCascade('l1');

        expect(await repos.lectures.get('l1')).toBeNull();
        expect(await repos.transcripts.getByLecture('l1')).toBeNull();
        expect(await repos.analyses.getByLecture('l1')).toBeNull();
        expect(await repos.materials.listMeta('l1')).toEqual([]);
        expect(await repos.quizAttempts.byLecture('l1')).toEqual([]);
        expect(await repos.slideDecks.byLecture('l1')).toBeNull();
        expect(await repos.chunks.byLecture('l1')).toEqual([]);
        const embeddings = await repos.embeddings.all();
        expect(embeddings.map((e) => e.chunkId).sort()).toEqual(['k-l2-1', 'k-l2-2']);

        // The sibling lecture is untouched.
        expect(await repos.lectures.get('l2')).not.toBeNull();
        expect(await repos.transcripts.getByLecture('l2')).not.toBeNull();
        expect(await repos.materials.listMeta('l2')).toHaveLength(1);
        expect(await repos.examPreps.latest('c1')).not.toBeNull();
      });

      it('deleteCourseCascade leaves no orphans in any collection', async () => {
        await seed();
        // A stray course-scoped doc whose lecture row is already gone must be
        // swept too.
        await repos.materials.put(material('m-stray', 'l-gone', 'c1', T0));
        await repos.deleteCourseCascade('c1');

        for (const collection of [
          Collections.courses,
          Collections.lectures,
          Collections.transcripts,
          Collections.analyses,
          Collections.materials,
          Collections.quizAttempts,
          Collections.slideDecks,
          Collections.knowledgeChunks,
          Collections.embeddings,
          Collections.examPreps,
        ]) {
          expect(await adapter.count(collection), `collection ${collection}`).toBe(0);
        }
      });

      it('chunks.deleteByLecture also removes those chunks\' embeddings', async () => {
        await seed();
        await repos.chunks.deleteByLecture('l1');
        expect(await repos.chunks.byLecture('l1')).toEqual([]);
        expect((await repos.embeddings.all()).map((e) => e.chunkId).sort()).toEqual([
          'k-l2-1',
          'k-l2-2',
        ]);
      });
    });
  });
}
