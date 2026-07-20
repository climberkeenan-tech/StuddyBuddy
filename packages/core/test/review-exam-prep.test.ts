import { describe, expect, it } from 'vitest';
import type {
  Concept,
  Course,
  Definition,
  EmphasisCue,
  ExamPrepPlan,
  Lecture,
  LectureAnalysis,
  QuizAttempt,
} from '@studdybuddy/shared';
import type { AIFacade } from '../src/ai/types';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEventBus } from '../src/infra/core-events';
import { LogManager } from '../src/infra/logger';
import type { Repositories } from '../src/storage/types';
import { ExamPrepService } from '../src/review/exam-prep-service';
import type { RawExamPrep } from '../src/review/schemas';

const logger = new LogManager().getLogger('test');
const T0 = 1_700_000_000_000;

/* ————————————————————————— in-memory repositories ————————————————————————— */

interface Backing {
  courses: Map<string, Course>;
  lectures: Map<string, Lecture>;
  analyses: Map<string, LectureAnalysis>;
  quizAttempts: QuizAttempt[];
  examPreps: ExamPrepPlan[];
}

function makeRepos(): { repos: Repositories; backing: Backing } {
  const backing: Backing = {
    courses: new Map(),
    lectures: new Map(),
    analyses: new Map(),
    quizAttempts: [],
    examPreps: [],
  };
  const repos = {
    courses: { get: async (id: string) => backing.courses.get(id) ?? null },
    lectures: {
      byCourse: async (courseId: string) =>
        [...backing.lectures.values()]
          .filter((l) => l.courseId === courseId)
          .sort((a, b) => a.number - b.number),
    },
    analyses: { getByLecture: async (lid: string) => backing.analyses.get(lid) ?? null },
    transcripts: { getByLecture: async () => null },
    quizAttempts: {
      byLecture: async (lid: string) =>
        backing.quizAttempts
          .filter((q) => q.lectureId === lid)
          .sort((a, b) => a.startedAt - b.startedAt),
    },
    examPreps: {
      latest: async (courseId: string) =>
        backing.examPreps
          .filter((p) => p.courseId === courseId)
          .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      put: async (p: ExamPrepPlan) => {
        backing.examPreps.push(p);
      },
    },
  };
  return { repos: repos as unknown as Repositories, backing };
}

/* ————————————————————————— fixtures ————————————————————————— */

const offlineAi: AIFacade = {
  available: async () => false,
  activeLabel: () => 'mock',
  chat: async () => ({ text: '', model: 'mock' }),
  generate: (async () => {
    throw new Error('offline: structured generation unavailable');
  }) as AIFacade['generate'],
};

function bus(): CoreEventBus {
  return new EventBus();
}

function course(id: string): Course {
  return {
    id,
    name: 'Biology 101',
    instructor: 'Dr. Grant',
    semester: 'Fall 2026',
    color: '#10b981',
    icon: 'dna',
    archived: false,
    createdAt: T0,
    updatedAt: T0,
  };
}

function lecture(id: string, courseId: string, number: number): Lecture {
  return {
    id,
    courseId,
    title: `Lecture ${number}`,
    number,
    status: 'ready',
    recordedAt: T0 + number * 1_000,
    durationMs: 1_000,
    topics: [],
    tags: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function concept(id: string, name: string, opts: Partial<Concept> = {}): Concept {
  return {
    id,
    name,
    summary: `${name} is important.`,
    importance: opts.importance ?? 0.7,
    examLikelihood: opts.examLikelihood ?? 0.7,
    difficulty: opts.difficulty ?? 0.5,
    mentions: 3,
    firstMentionMs: 0,
    related: [],
  };
}

function definition(id: string, term: string): Definition {
  return { id, term, definition: `${term} means something.`, atMs: 0 };
}

function emphasis(id: string, conceptId: string): EmphasisCue {
  return { id, quote: 'This will be on the exam.', conceptId, atMs: 0 };
}

function analysis(
  lectureId: string,
  concepts: Concept[],
  opts: Partial<LectureAnalysis> = {},
): LectureAnalysis {
  return {
    lectureId,
    gist: `Gist of ${lectureId}.`,
    concepts,
    definitions: opts.definitions ?? [],
    formulas: [],
    examples: [],
    keyDates: [],
    emphasisCues: opts.emphasisCues ?? [],
    vocabulary: [],
    examWatchlist: [],
    struggleWatchlist: opts.struggleWatchlist ?? [],
    crossLectureLinks: [],
    generatedBy: 'heuristic',
    createdAt: T0,
  };
}

/** Two lectures sharing the "Photosynthesis" concept, plus quiz + struggle signals. */
function seedCourse(backing: Backing): void {
  backing.courses.set('c1', course('c1'));
  backing.lectures.set('l1', lecture('l1', 'c1', 1));
  backing.lectures.set('l2', lecture('l2', 'c1', 2));

  backing.analyses.set(
    'l1',
    analysis(
      'l1',
      [
        concept('l1-photo', 'Photosynthesis', { importance: 0.9, examLikelihood: 0.9 }),
        concept('l1-chloro', 'Chlorophyll', { difficulty: 0.6 }),
        concept('l1-calvin', 'Calvin Cycle', { difficulty: 0.7 }),
      ],
      {
        definitions: [definition('d1', 'Photosynthesis')],
        emphasisCues: [emphasis('e1', 'l1-photo')],
      },
    ),
  );
  backing.analyses.set(
    'l2',
    analysis(
      'l2',
      [
        concept('l2-photo', 'Photosynthesis', { importance: 0.85, examLikelihood: 0.85 }),
        concept('l2-light', 'Light Reactions', { difficulty: 0.6 }),
        concept('l2-atp', 'ATP Synthesis', { difficulty: 0.8 }),
      ],
      { struggleWatchlist: ['l2-atp'] },
    ),
  );

  // Two quiz attempts, each missing "Chlorophyll" — weakness from misses.
  const attempt = (id: string): QuizAttempt => ({
    id,
    materialId: 'quiz-m',
    lectureId: 'l1',
    answers: [],
    score: 0.5,
    missedConceptIds: ['l1-chloro'],
    startedAt: T0,
    finishedAt: T0 + 1_000,
  });
  backing.quizAttempts.push(attempt('a1'), attempt('a2'));
}

describe('ExamPrepService.weakAreas', () => {
  it('fuses quiz misses and the struggle watchlist into ranked weak areas', async () => {
    const { repos, backing } = makeRepos();
    seedCourse(backing);
    const svc = new ExamPrepService({ repos, ai: offlineAi, bus: bus(), logger });

    const areas = await svc.weakAreas('c1');
    const byName = new Map(areas.map((a) => [a.conceptName, a]));

    // Chlorophyll: missed in 2 attempts → min(1, 2 * 0.35) = 0.70.
    const chloro = byName.get('Chlorophyll');
    expect(chloro).toBeDefined();
    expect(chloro!.weakness).toBeCloseTo(0.7, 5);
    expect(chloro!.reason).toMatch(/missed 2 quiz questions/);

    // ATP Synthesis: struggle watchlist, difficulty 0.8 → 0.8 * 0.7 = 0.56.
    const atp = byName.get('ATP Synthesis');
    expect(atp).toBeDefined();
    expect(atp!.weakness).toBeCloseTo(0.56, 5);
    expect(atp!.reason).toMatch(/hard topic/);

    // Sorted strongest-weakness first.
    expect(areas[0]!.conceptName).toBe('Chlorophyll');
  });

  it('throws NOT_FOUND for an unknown course', async () => {
    const { repos } = makeRepos();
    const svc = new ExamPrepService({ repos, ai: offlineAi, bus: bus(), logger });
    await expect(svc.weakAreas('nope')).rejects.toThrow(/not found/i);
  });
});

describe('ExamPrepService.generate (heuristic path)', () => {
  it('builds a specific plan offline: recurring topic, full study order, 8+ questions', async () => {
    const { repos, backing } = makeRepos();
    seedCourse(backing);
    const eventBus = bus();
    const progress: string[] = [];
    eventBus.on('job:progress', (p) => progress.push(`${p.state}:${p.kind}`));

    const svc = new ExamPrepService({ repos, ai: offlineAi, bus: eventBus, logger });
    const plan = await svc.generate('c1');

    // Recurring concept shared by both lectures is detected.
    expect(plan.recurringTopics).toContain('Photosynthesis');

    // Study order covers every lecture.
    expect(plan.studyOrder).toHaveLength(2);
    const lectureIds = plan.studyOrder.map((s) => s.lectureId).sort();
    expect(lectureIds).toEqual(['l1', 'l2']);
    for (const step of plan.studyOrder) expect(step.rationale.length).toBeGreaterThan(0);

    // A substantial, deterministic question set.
    expect(plan.likelyExamQuestions.length).toBeGreaterThanOrEqual(8);

    // Cumulative review mentions lecture titles and concepts.
    expect(plan.cumulativeReview).toMatch(/Cumulative Review/);
    expect(plan.cumulativeReview).toMatch(/Photosynthesis/);

    // Key concepts resolved to real lectures; weak areas embedded.
    expect(plan.keyConcepts.length).toBeGreaterThan(0);
    for (const kc of plan.keyConcepts) expect(['l1', 'l2']).toContain(kc.lectureId);
    expect(plan.weakAreas.length).toBeGreaterThanOrEqual(2);

    expect(plan.generatedBy).toBe('studdybuddy/heuristic');

    // Persisted and retrievable via latest().
    const latest = await svc.latest('c1');
    expect(latest!.id).toBe(plan.id);

    // Emitted a succeeded job-progress event.
    expect(progress).toContain('succeeded:exam-prep');
  });
});

describe('ExamPrepService.generate (AI path)', () => {
  it('maps the model plan onto shared types, resolving lecture numbers to ids', async () => {
    const { repos, backing } = makeRepos();
    seedCourse(backing);

    const modelPlan: RawExamPrep = {
      cumulativeReview: '# AI Review\nEverything you need.',
      keyConcepts: [
        { conceptName: 'Photosynthesis', lectureNumber: 1, importance: 0.95 },
        { conceptName: 'ATP Synthesis', lectureNumber: 2, importance: 0.8 },
      ],
      recurringTopics: ['Photosynthesis'],
      likelyExamQuestions: Array.from({ length: 9 }, (_, i) => `Question ${i + 1}?`),
      studyOrder: [
        { title: 'Start with fundamentals', lectureNumber: 1, rationale: 'Foundation first.' },
        { title: 'Then energy', lectureNumber: 2, rationale: 'Builds on lecture 1.' },
      ],
    };

    const aiOn: AIFacade = {
      available: async () => true,
      activeLabel: () => 'anthropic/claude-test',
      chat: async () => ({ text: '', model: 'x' }),
      generate: (async () => modelPlan) as AIFacade['generate'],
    };

    const svc = new ExamPrepService({ repos, ai: aiOn, bus: bus(), logger });
    const plan = await svc.generate('c1');

    expect(plan.generatedBy).toBe('anthropic/claude-test');
    expect(plan.cumulativeReview).toMatch(/AI Review/);
    expect(plan.keyConcepts.find((k) => k.conceptName === 'Photosynthesis')!.lectureId).toBe('l1');
    expect(plan.keyConcepts.find((k) => k.conceptName === 'ATP Synthesis')!.lectureId).toBe('l2');
    expect(plan.studyOrder.map((s) => s.lectureId)).toEqual(['l1', 'l2']);
    expect(plan.likelyExamQuestions).toHaveLength(9);
    // Weak areas are always the deterministic ones, embedded regardless of path.
    expect(plan.weakAreas.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to heuristics when the AI generation throws', async () => {
    const { repos, backing } = makeRepos();
    seedCourse(backing);
    const aiBroken: AIFacade = {
      available: async () => true,
      activeLabel: () => 'anthropic/claude-test',
      chat: async () => ({ text: '', model: 'x' }),
      generate: (async () => {
        throw new Error('model exploded');
      }) as AIFacade['generate'],
    };

    const svc = new ExamPrepService({ repos, ai: aiBroken, bus: bus(), logger });
    const plan = await svc.generate('c1');
    expect(plan.generatedBy).toBe('studdybuddy/heuristic');
    expect(plan.studyOrder).toHaveLength(2);
  });
});
