import { describe, expect, it } from 'vitest';
import type {
  FlashcardsContent,
  JobProgress,
  QuizContent,
  StudyMaterial,
} from '@studdybuddy/shared';
import { LogManager, type Logger } from '../src/infra/logger';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEventBus } from '../src/infra/core-events';
import { SbError } from '../src/infra/errors';
import { PluginRegistry } from '../src/plugins/registry';
import { MaterialsService } from '../src/materials/materials-service';
import { QuizService, heuristicGrade, parseGradeResponse } from '../src/materials/quiz-service';
import { registerBuiltinGenerators } from '../src/materials/builtin-plugin';
import { initialSrs } from '../src/materials/srs';
import { buildShortAnswer } from '../src/materials/generators/quizzes';
import { conceptById } from '../src/materials/common';
import {
  LECTURE_ID,
  analysis,
  fakeRepos,
  lecture,
  offlineAi,
  stubAi,
} from './materials-fixtures';

const logger: Logger = new LogManager().getLogger('test');

function registry(): PluginRegistry {
  const reg = new PluginRegistry(logger);
  registerBuiltinGenerators(reg);
  return reg;
}

/* ————————————————————————————————— srs ————————————————————————————————— */

describe('initialSrs', () => {
  it('seeds SM-2 defaults due at the given time', () => {
    expect(initialSrs(4242)).toEqual({ ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: 4242 });
  });
});

/* ————————————————————————————————— MaterialsService ————————————————————————————————— */

describe('MaterialsService.generate', () => {
  it('generates, stamps and persists a material', async () => {
    const { repos, state } = fakeRepos();
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const material = await service.generate(LECTURE_ID, 'notes', { difficulty: 'easy' });

    expect(material.id).toBeTruthy();
    expect(material.lectureId).toBe(LECTURE_ID);
    expect(material.courseId).toBe(lecture().courseId);
    expect(material.type).toBe('notes');
    expect(material.difficulty).toBe('easy');
    expect(material.generatedBy).toBe('heuristic');
    expect(state.materials).toHaveLength(1);

    const fetched = await service.get(material.id);
    expect(fetched?.id).toBe(material.id);
  });

  it('stamps flashcards with fresh SRS due at the material createdAt and a conceptId', async () => {
    const { repos } = fakeRepos();
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const material = await service.generate(LECTURE_ID, 'flashcards', { difficulty: 'medium' });
    const deck = material.content as FlashcardsContent;

    expect(deck.cards.length).toBeGreaterThan(0);
    for (const card of deck.cards) {
      expect(card.srs.ease).toBe(2.5);
      expect(card.srs.dueAt).toBe(material.createdAt); // deck shares one due time
    }
    // "Define Glycolysis." resolves to the Glycolysis concept.
    const glyco = deck.cards.find((c) => c.front.includes('Glycolysis'));
    expect(glyco?.conceptId).toBe('c1');
  });

  it('uses the AI label as generatedBy when a provider succeeds', async () => {
    const ai = stubAi(async () => ({ markdown: '# AI summary\nGenerated.' }) as never, 'anthropic/claude');
    const { repos } = fakeRepos();
    const service = new MaterialsService({
      repos,
      ai,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const material = await service.generate(LECTURE_ID, 'summary-concise');
    expect(material.generatedBy).toBe('anthropic/claude');
    expect((material.content as { markdown: string }).markdown).toContain('AI summary');
  });

  it('falls back to the heuristic path when the AI provider throws', async () => {
    const ai = stubAi(async () => {
      throw new Error('provider exploded');
    });
    const { repos } = fakeRepos();
    const service = new MaterialsService({
      repos,
      ai,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const material = await service.generate(LECTURE_ID, 'summary-concise');
    expect(material.generatedBy).toBe('heuristic');
    expect((material.content as { markdown: string }).markdown.length).toBeGreaterThan(0);
  });

  it('throws NOT_FOUND when the lecture is missing', async () => {
    const { repos } = fakeRepos({ lecture: null });
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const err = await service.generate('nope', 'notes').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SbError);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });

  it('throws NOT_FOUND when the transcript is missing', async () => {
    const { repos } = fakeRepos({ lecture: lecture(), transcript: null });
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const err = await service.generate(LECTURE_ID, 'notes').catch((e: unknown) => e);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });

  it('throws VALIDATION when the analysis is missing', async () => {
    const { repos } = fakeRepos({ lecture: lecture(), transcript: undefined, analysis: null });
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    // transcript defaults to the fixture since we passed undefined; analysis is null.
    const err = await service.generate(LECTURE_ID, 'notes').catch((e: unknown) => e);
    expect((err as SbError).code).toBe('VALIDATION');
  });

  it('throws NOT_FOUND when no generator is registered for the type', async () => {
    const { repos } = fakeRepos();
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: new PluginRegistry(logger), // nothing registered
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const err = await service.generate(LECTURE_ID, 'notes').catch((e: unknown) => e);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });
});

describe('MaterialsService.generateKit', () => {
  it('runs the kit, emits study-kit progress, and persists most materials', async () => {
    const { repos, state } = fakeRepos();
    const bus = new EventBus() as CoreEventBus;
    const events: JobProgress[] = [];
    const done = new Promise<JobProgress>((resolve) => {
      bus.on('job:progress', (p) => {
        events.push(p);
        if (p.kind === 'study-kit' && (p.state === 'succeeded' || p.state === 'failed')) resolve(p);
      });
    });
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus,
      logger,
    });

    const { jobId } = await service.generateKit(LECTURE_ID, 'medium');
    expect(jobId).toBeTruthy();

    const final = await done;
    expect(final.state).toBe('succeeded');
    expect(final.jobId).toBe(jobId);
    expect(events.every((e) => e.kind === 'study-kit')).toBe(true);
    expect(events.some((e) => e.message.includes('Flashcards'))).toBe(true);
    // Nine kit materials produced.
    expect(state.materials.length).toBe(9);
    const meta = await service.list(LECTURE_ID);
    expect(meta.length).toBe(9);
  });

  it('throws NOT_FOUND for an unknown lecture', async () => {
    const { repos } = fakeRepos({ lecture: null });
    const service = new MaterialsService({
      repos,
      ai: offlineAi,
      pluginRegistry: registry(),
      bus: new EventBus() as CoreEventBus,
      logger,
    });
    const err = await service.generateKit('nope').catch((e: unknown) => e);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });
});

/* ————————————————————————————————— QuizService ————————————————————————————————— */

/** Build a persisted short-answer material from a fixture concept. */
function shortAnswerMaterial(): StudyMaterial {
  const a = analysis();
  const byId = conceptById(a);
  const concept = byId.get('c1')!;
  const question = buildShortAnswer(a, concept, byId, 0);
  // Pin a known rubric so the grading tests are precise.
  question.rubric = ['Glycolysis', 'pyruvate', 'glucose'];
  question.modelAnswer = 'Glycolysis breaks glucose into two pyruvate molecules.';
  const content: QuizContent = { questions: [question], difficulty: 'medium' };
  return {
    id: 'mat-sa',
    lectureId: LECTURE_ID,
    courseId: 'course-bio',
    type: 'quiz-short-answer',
    title: 'SA',
    difficulty: 'medium',
    content,
    generatedBy: 'heuristic',
    createdAt: 1_700_000_000_000,
  };
}

describe('QuizService.gradeShortAnswer (heuristic)', () => {
  const material = shortAnswerMaterial();
  const qid = (material.content as QuizContent).questions[0]!.id;

  function service() {
    const { repos } = fakeRepos({ materials: [material] });
    return new QuizService({ repos, ai: offlineAi, logger });
  }

  it('full rubric coverage scores 1.0', async () => {
    const grade = await service().gradeShortAnswer(
      material.id,
      qid,
      'Glycolysis splits glucose into two pyruvate molecules.',
    );
    expect(grade.score).toBe(1);
    expect(grade.correct).toBe(true);
    expect(grade.missing).toHaveLength(0);
  });

  it('partial coverage scores between 0 and 1 and lists what is missing', async () => {
    const grade = await service().gradeShortAnswer(material.id, qid, 'It involves glucose somehow.');
    expect(grade.score).toBeGreaterThan(0);
    expect(grade.score).toBeLessThan(1);
    expect(grade.correct).toBe(false);
    expect(grade.missing).toContain('Glycolysis');
    expect(grade.missing).toContain('pyruvate');
  });

  it('no overlap scores 0', async () => {
    const grade = await service().gradeShortAnswer(material.id, qid, 'I have absolutely no idea.');
    expect(grade.score).toBe(0);
    expect(grade.correct).toBe(false);
  });

  it('throws NOT_FOUND for an unknown question', async () => {
    const err = await service().gradeShortAnswer(material.id, 'nope', 'x').catch((e: unknown) => e);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });
});

describe('QuizService.gradeShortAnswer (AI)', () => {
  it('parses a SCORE line from the model and falls back on a malformed reply', async () => {
    const material = shortAnswerMaterial();
    const qid = (material.content as QuizContent).questions[0]!.id;

    const goodAi = {
      available: async () => true,
      activeLabel: () => 'stub/grader',
      chat: async () => ({ text: 'SCORE: 0.8\nFEEDBACK: Solid, mention the ATP yield.', model: 'g' }),
      generate: (async () => {
        throw new Error('unused');
      }) as never,
    };
    const { repos } = fakeRepos({ materials: [material] });
    const graded = await new QuizService({ repos, ai: goodAi, logger }).gradeShortAnswer(
      material.id,
      qid,
      'Glycolysis makes pyruvate.',
    );
    expect(graded.score).toBe(0.8);
    expect(graded.correct).toBe(true);
    expect(graded.feedback).toContain('ATP yield');

    // Malformed reply -> heuristic fallback still returns a real score.
    const badAi = { ...goodAi, chat: async () => ({ text: 'no score here', model: 'g' }) };
    const { repos: repos2 } = fakeRepos({ materials: [material] });
    const fallback = await new QuizService({ repos: repos2, ai: badAi, logger }).gradeShortAnswer(
      material.id,
      qid,
      'Glycolysis splits glucose into pyruvate.',
    );
    expect(fallback.score).toBe(1);
  });
});

describe('heuristicGrade + parseGradeResponse units', () => {
  it('parseGradeResponse extracts score + feedback and clamps range', () => {
    expect(parseGradeResponse('SCORE: 1.4\nFEEDBACK: Over the top.')).toEqual({
      score: 1,
      feedback: 'Over the top.',
    });
    expect(parseGradeResponse('nothing useful')).toBeNull();
  });

  it('heuristicGrade handles an empty rubric gracefully', () => {
    const grade = heuristicGrade(
      { id: 'q', kind: 'short-answer', prompt: 'p', modelAnswer: 'm', rubric: [] },
      'anything',
    );
    expect(grade.score).toBe(0);
  });
});

describe('QuizService.submitAttempt', () => {
  it('computes the mean score and missed concept ids', async () => {
    const a = analysis();
    const byId = conceptById(a);
    const q1 = buildShortAnswer(a, byId.get('c1')!, byId, 0);
    const q2 = buildShortAnswer(a, byId.get('c2')!, byId, 1);
    const material: StudyMaterial = {
      id: 'mat-quiz',
      lectureId: LECTURE_ID,
      courseId: 'course-bio',
      type: 'quiz-short-answer',
      title: 'Q',
      difficulty: 'medium',
      content: { questions: [q1, q2], difficulty: 'medium' } as QuizContent,
      generatedBy: 'heuristic',
      createdAt: 1_700_000_000_000,
    };
    const { repos, state } = fakeRepos({ materials: [material] });
    const service = new QuizService({ repos, ai: offlineAi, logger });

    const attempt = await service.submitAttempt({
      materialId: 'mat-quiz',
      answers: [
        { questionId: q1.id, response: 'good', correct: true, score: 1 },
        { questionId: q2.id, response: 'bad', correct: false, score: 0 },
      ],
    });

    expect(attempt.score).toBe(0.5);
    expect(attempt.missedConceptIds).toEqual(['c2']); // q2 scored below 0.5
    expect(attempt.lectureId).toBe(LECTURE_ID);
    expect(state.quizAttempts).toHaveLength(1);

    const listed = await service.attemptsForLecture(LECTURE_ID);
    expect(listed).toHaveLength(1);
  });

  it('throws NOT_FOUND for an unknown material', async () => {
    const { repos } = fakeRepos();
    const service = new QuizService({ repos, ai: offlineAi, logger });
    const err = await service.submitAttempt({ materialId: 'nope', answers: [] }).catch((e: unknown) => e);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });
});
