import {
  newId,
  type EntityId,
  type QuizAnswer,
  type QuizAttempt,
  type QuizContent,
  type QuizQuestion,
  type ShortAnswerQuestion,
  type Timestamp,
} from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import type { AIFacade } from '../ai/types';

/**
 * Grading and attempt-recording for quizzes.
 *
 * Short-answer grading has both paths: with a provider it asks the model to
 * score against the rubric (parsing a strict `SCORE:` line defensively); offline
 * it measures rubric-keyword coverage in the response. Attempt submission
 * computes the overall score and the set of missed concept ids, which feeds
 * Smart Review's weak-area detection.
 */

/** Result of grading a single short-answer response. */
export interface ShortAnswerGrade {
  /** 0..1 partial credit. */
  score: number;
  /** Whether the answer cleared the pass threshold. */
  correct: boolean;
  /** Human-readable feedback (offline: lists the rubric points still missing). */
  feedback: string;
  /** Rubric points the response did not cover (empty on the AI path). */
  missing: string[];
}

/** Input to {@link QuizService.submitAttempt}. Answers arrive pre-scored. */
export interface SubmitAttemptInput {
  materialId: EntityId;
  answers: QuizAnswer[];
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
}

export interface QuizServiceDeps {
  repos: Repositories;
  ai: AIFacade;
  logger: Logger;
}

/** Coverage at or above this fraction of rubric points is full credit. */
const PASS_THRESHOLD = 0.6;

/** An answer scoring below this counts the question's concept as "missed". */
const MISS_THRESHOLD = 0.5;

export class QuizService {
  private readonly repos: Repositories;
  private readonly ai: AIFacade;
  private readonly logger: Logger;

  constructor(deps: QuizServiceDeps) {
    this.repos = deps.repos;
    this.ai = deps.ai;
    this.logger = deps.logger.child('quiz-service');
  }

  /**
   * Grade a free-text answer to a short-answer question.
   * @throws SbError NOT_FOUND if the material or question is missing.
   * @throws SbError VALIDATION if the question is not a short-answer question.
   */
  async gradeShortAnswer(
    materialId: string,
    questionId: string,
    response: string,
  ): Promise<ShortAnswerGrade> {
    const question = await this.loadShortAnswer(materialId, questionId);

    if (await this.ai.available()) {
      try {
        return await this.aiGrade(question, response);
      } catch (e) {
        this.logger.warn('AI grading failed; using heuristic', {
          materialId,
          questionId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return heuristicGrade(question, response);
  }

  /**
   * Record a completed quiz attempt: mean score, missed concept ids, persisted.
   * @throws SbError NOT_FOUND if the material is missing.
   * @throws SbError VALIDATION if the material is not a quiz.
   */
  async submitAttempt(input: SubmitAttemptInput): Promise<QuizAttempt> {
    const material = await this.repos.materials.get(input.materialId);
    if (!material) {
      throw new SbError(ErrorCodes.NOT_FOUND, `Material "${input.materialId}" not found.`);
    }
    const content = material.content as QuizContent;
    if (!Array.isArray(content.questions)) {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Material "${input.materialId}" is not a quiz and cannot receive an attempt.`,
      );
    }

    const conceptByQuestion = new Map<EntityId, EntityId | undefined>(
      content.questions.map((q) => [q.id, q.conceptId]),
    );

    const score =
      input.answers.length === 0
        ? 0
        : input.answers.reduce((sum, a) => sum + a.score, 0) / input.answers.length;

    const missed = new Set<EntityId>();
    for (const answer of input.answers) {
      if (answer.score < MISS_THRESHOLD) {
        const conceptId = conceptByQuestion.get(answer.questionId);
        if (conceptId) missed.add(conceptId);
      }
    }

    const now = Date.now();
    const attempt: QuizAttempt = {
      id: newId(),
      materialId: material.id,
      lectureId: material.lectureId,
      answers: input.answers,
      score,
      missedConceptIds: [...missed],
      startedAt: input.startedAt ?? now,
      finishedAt: input.finishedAt ?? now,
    };
    await this.repos.quizAttempts.put(attempt);
    this.logger.info('quiz attempt recorded', {
      materialId: material.id,
      score: Number(score.toFixed(2)),
      missed: attempt.missedConceptIds.length,
    });
    return attempt;
  }

  /** All recorded attempts for a lecture. */
  attemptsForLecture(lectureId: string): Promise<QuizAttempt[]> {
    return this.repos.quizAttempts.byLecture(lectureId);
  }

  private async loadShortAnswer(
    materialId: string,
    questionId: string,
  ): Promise<ShortAnswerQuestion> {
    const material = await this.repos.materials.get(materialId);
    if (!material) {
      throw new SbError(ErrorCodes.NOT_FOUND, `Material "${materialId}" not found.`);
    }
    const content = material.content as QuizContent;
    const question = Array.isArray(content.questions)
      ? content.questions.find((q: QuizQuestion) => q.id === questionId)
      : undefined;
    if (!question) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `Question "${questionId}" not found in material "${materialId}".`,
      );
    }
    if (question.kind !== 'short-answer') {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Question "${questionId}" is not a short-answer question.`,
      );
    }
    return question;
  }

  private async aiGrade(
    question: ShortAnswerQuestion,
    response: string,
  ): Promise<ShortAnswerGrade> {
    const result = await this.ai.chat({
      messages: [
        {
          role: 'system',
          content: [
            'You grade a student short-answer response against a model answer and rubric.',
            'Respond with exactly two lines and nothing else:',
            'SCORE: <a number from 0.0 to 1.0>',
            'FEEDBACK: <one or two sentences of specific, encouraging feedback>',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Question: ${question.prompt}`,
            `Model answer: ${question.modelAnswer}`,
            `Rubric (key points): ${question.rubric.join('; ')}`,
            `Student response: ${response}`,
          ].join('\n'),
        },
      ],
      temperature: 0,
      maxTokens: 400,
    });

    const parsed = parseGradeResponse(result.text);
    if (!parsed) {
      // Model did not follow the format — fall back to the deterministic grader.
      return heuristicGrade(question, response);
    }
    return {
      score: parsed.score,
      correct: parsed.score >= PASS_THRESHOLD,
      feedback: parsed.feedback,
      missing: [],
    };
  }
}

export function createQuizService(deps: QuizServiceDeps): QuizService {
  return new QuizService(deps);
}

/**
 * Deterministic grading: measure how many rubric points the response covers.
 * A rubric point is "covered" when every content token in it appears in the
 * response. Coverage at/above {@link PASS_THRESHOLD} is full credit; below that
 * the score scales linearly with coverage.
 */
export function heuristicGrade(question: ShortAnswerQuestion, response: string): ShortAnswerGrade {
  const rubric = question.rubric.filter((p) => p.trim().length > 0);
  if (rubric.length === 0) {
    return { score: 0, correct: false, feedback: 'No rubric was available to grade against.', missing: [] };
  }

  const responseTokens = tokenize(response);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const point of rubric) {
    const tokens = [...tokenize(point)];
    const isCovered = tokens.length > 0 && tokens.every((t) => responseTokens.has(t));
    (isCovered ? covered : missing).push(point);
  }

  const coverage = covered.length / rubric.length;
  const score = coverage >= PASS_THRESHOLD ? 1 : round2(coverage);
  const correct = coverage >= PASS_THRESHOLD;

  const feedback =
    missing.length === 0
      ? 'Strong answer — it covers all the key points.'
      : `You covered ${covered.length}/${rubric.length} key points. Still needed: ${missing.join('; ')}.`;

  return { score, correct, feedback, missing };
}

/** Pull "SCORE: x.x" + "FEEDBACK: ..." out of a model reply, defensively. */
export function parseGradeResponse(text: string): { score: number; feedback: string } | null {
  const scoreMatch = text.match(/score\s*[:=]\s*(-?\d*\.?\d+)/i);
  if (!scoreMatch || scoreMatch[1] === undefined) return null;
  const raw = Number.parseFloat(scoreMatch[1]);
  if (!Number.isFinite(raw)) return null;
  const score = round2(Math.min(1, Math.max(0, raw)));

  const feedbackMatch = text.match(/feedback\s*[:=]\s*([\s\S]+)/i);
  const feedback = feedbackMatch?.[1]?.trim() || 'Graded.';
  return { score, feedback };
}

const GRADING_STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'was', 'its', 'has', 'that', 'this', 'with',
  'from', 'they', 'have', 'them', 'then', 'than', 'when', 'what', 'which', 'their', 'there',
  'into', 'over', 'such', 'some', 'more', 'been', 'were', 'will', 'your', 'does', 'about',
]);

/** Content tokens (3+ chars, minus stopwords) used for coverage matching. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 3 && !GRADING_STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
