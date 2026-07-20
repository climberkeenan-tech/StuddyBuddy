import {
  newId,
  type Course,
  type EntityId,
  type ExamPrepPlan,
  type JobProgress,
  type Lecture,
  type LectureAnalysis,
  type WeakArea,
} from '@studdybuddy/shared';
import type { AppError } from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import { ErrorCodes, SbError, toAppError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import type { z } from 'zod';
import type { AIFacade } from '../ai/types';
import { RawExamPrepSchema, type RawExamPrep } from './schemas';

/**
 * The structured generator infers its result type from `schema: z.ZodType<T>`.
 * Our raw schema uses `.transform()`/`.catch()` fields, so its inferred output
 * type is re-asserted here (as the analyzer does) to give `ai.generate` a clean
 * `RawExamPrep` to resolve to.
 */
const RawExamPrepType = RawExamPrepSchema as unknown as z.ZodType<RawExamPrep>;

export interface ExamPrepServiceDeps {
  repos: Repositories;
  ai: AIFacade;
  bus: CoreEventBus;
  logger: Logger;
}

/** Resolved facts about one concept, indexed by concept id across a course. */
interface ConceptInfo {
  name: string;
  summary: string;
  importance: number;
  examLikelihood: number;
  difficulty: number;
  lectureId: EntityId;
  lectureNumber: number;
}

/** Per-lecture map: lecture id → its analysis (only analyzed lectures appear). */
type AnalysisByLecture = Map<EntityId, LectureAnalysis>;

/** Weight applied to a concept's difficulty when deriving struggle-based weakness. */
const STRUGGLE_WEIGHT = 0.7;
/** Weakness added per missed quiz question (capped at 1). */
const MISS_WEIGHT = 0.35;
/** Concepts kept per lecture when merging the course-wide key-concept list. */
const TOP_CONCEPTS_PER_LECTURE = 6;
/** Upper bound on the generated likely-exam-question list. */
const MAX_QUESTIONS = 12;

/**
 * Exam-prep coach for Smart Review.
 *
 * Two responsibilities:
 *  1. {@link weakAreas} — a deterministic weakness signal fusing quiz misses
 *     with the analyzer's difficulty watchlist, feeding both the study plan and
 *     the dashboard.
 *  2. {@link generate} — a whole-course study plan (cumulative review, key
 *     concepts, recurring topics, likely questions, study order). With an AI
 *     provider it prompts a model for a richer plan; offline it builds a real,
 *     specific plan from the lectures' analyses via heuristics. Either way the
 *     result is persisted and the weak-area analysis is embedded.
 */
export class ExamPrepService {
  private readonly repos: Repositories;
  private readonly ai: AIFacade;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;

  constructor(deps: ExamPrepServiceDeps) {
    this.repos = deps.repos;
    this.ai = deps.ai;
    this.bus = deps.bus;
    this.logger = deps.logger.child('exam-prep');
  }

  /**
   * Concepts the student is weakest on, strongest weakness first.
   *
   * Fuses two independent signals per concept:
   *  - **Quiz misses** — `min(1, misses * 0.35)`, so each missed question of a
   *    concept raises its weakness, saturating at 1.
   *  - **Struggle watchlist** — `max(existing, difficulty * 0.7)`, folding in
   *    the analyzer's estimate of how hard a topic typically is.
   *
   * @throws SbError NOT_FOUND if the course does not exist.
   */
  async weakAreas(courseId: EntityId): Promise<WeakArea[]> {
    const { lectures, analysisByLecture } = await this.gather(courseId);
    return this.computeWeakAreas(lectures, analysisByLecture);
  }

  /**
   * Build and persist a fresh exam-prep plan for the course.
   *
   * Emits `job:progress` (kind `exam-prep`) throughout. Prefers the AI path when
   * a provider is available, transparently falling back to heuristics if the
   * model errors — so a plan is always produced.
   *
   * @throws SbError NOT_FOUND if the course does not exist.
   */
  async generate(courseId: EntityId): Promise<ExamPrepPlan> {
    const jobId = newId();
    this.emit(jobId, 0, 'Queued exam prep', 'queued');
    try {
      const { course, lectures, analysisByLecture } = await this.gather(courseId);
      this.emit(jobId, 0.1, 'Reviewing your course material…', 'running');
      const weakAreas = await this.computeWeakAreas(lectures, analysisByLecture);

      let plan: ExamPrepPlan | null = null;
      if (await this.ai.available()) {
        try {
          this.emit(jobId, 0.4, 'Drafting your exam plan…', 'running');
          plan = await this.generateWithAI(course, lectures, analysisByLecture, weakAreas);
        } catch (e) {
          this.logger.warn('AI exam prep failed; falling back to heuristics', {
            courseId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!plan) {
        this.emit(jobId, 0.5, 'Building your exam plan…', 'running');
        plan = await this.generateHeuristic(course, lectures, analysisByLecture, weakAreas);
      }

      await this.repos.examPreps.put(plan);
      this.emit(jobId, 1, 'Exam prep ready', 'succeeded');
      this.logger.info('exam prep generated', {
        courseId,
        generatedBy: plan.generatedBy,
        keyConcepts: plan.keyConcepts.length,
        questions: plan.likelyExamQuestions.length,
      });
      return plan;
    } catch (e) {
      this.emit(jobId, -1, 'Exam prep failed', 'failed', toAppError(e));
      this.logger.error('exam prep failed', {
        courseId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /** The most recent persisted plan for a course, or null. */
  latest(courseId: EntityId): Promise<ExamPrepPlan | null> {
    return this.repos.examPreps.latest(courseId);
  }

  /* ————————————————————————— context loading ————————————————————————— */

  /** Load the course, its lectures (number-ordered), and each lecture's analysis. */
  private async gather(
    courseId: EntityId,
  ): Promise<{ course: Course; lectures: Lecture[]; analysisByLecture: AnalysisByLecture }> {
    const course = await this.repos.courses.get(courseId);
    if (!course) throw new SbError(ErrorCodes.NOT_FOUND, `Course "${courseId}" not found.`);
    const lectures = await this.repos.lectures.byCourse(courseId);
    const analysisByLecture: AnalysisByLecture = new Map();
    for (const lecture of lectures) {
      const analysis = await this.repos.analyses.getByLecture(lecture.id);
      if (analysis) analysisByLecture.set(lecture.id, analysis);
    }
    return { course, lectures, analysisByLecture };
  }

  /** Index every analyzed concept in the course by its id. */
  private conceptIndex(
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
  ): Map<EntityId, ConceptInfo> {
    const index = new Map<EntityId, ConceptInfo>();
    for (const lecture of lectures) {
      const analysis = analysisByLecture.get(lecture.id);
      if (!analysis) continue;
      for (const concept of analysis.concepts) {
        index.set(concept.id, {
          name: concept.name,
          summary: concept.summary,
          importance: concept.importance,
          examLikelihood: concept.examLikelihood,
          difficulty: concept.difficulty,
          lectureId: lecture.id,
          lectureNumber: lecture.number,
        });
      }
    }
    return index;
  }

  /* ————————————————————————— weak areas ————————————————————————— */

  private async computeWeakAreas(
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
  ): Promise<WeakArea[]> {
    const index = this.conceptIndex(lectures, analysisByLecture);
    const acc = new Map<
      EntityId,
      { conceptName: string; lectureId: EntityId; weakness: number; reasons: string[] }
    >();
    const ensure = (
      conceptId: EntityId,
    ): { conceptName: string; lectureId: EntityId; weakness: number; reasons: string[] } | null => {
      const info = index.get(conceptId);
      if (!info) return null;
      let entry = acc.get(conceptId);
      if (!entry) {
        entry = { conceptName: info.name, lectureId: info.lectureId, weakness: 0, reasons: [] };
        acc.set(conceptId, entry);
      }
      return entry;
    };

    // (a) Quiz misses across the whole course.
    const missCounts = new Map<EntityId, number>();
    for (const lecture of lectures) {
      const attempts = await this.repos.quizAttempts.byLecture(lecture.id);
      for (const attempt of attempts) {
        for (const conceptId of attempt.missedConceptIds) {
          missCounts.set(conceptId, (missCounts.get(conceptId) ?? 0) + 1);
        }
      }
    }
    for (const [conceptId, misses] of missCounts) {
      const entry = ensure(conceptId);
      if (!entry) continue;
      entry.weakness = Math.min(1, misses * MISS_WEIGHT);
      entry.reasons.push(`missed ${misses} quiz question${misses === 1 ? '' : 's'}`);
    }

    // (b) Analyzer's struggle watchlist.
    for (const lecture of lectures) {
      const analysis = analysisByLecture.get(lecture.id);
      if (!analysis) continue;
      for (const conceptId of analysis.struggleWatchlist) {
        const info = index.get(conceptId);
        if (!info) continue;
        const entry = ensure(conceptId);
        if (!entry) continue;
        entry.weakness = Math.max(entry.weakness, info.difficulty * STRUGGLE_WEIGHT);
        entry.reasons.push('typically a hard topic');
      }
    }

    const areas: WeakArea[] = [...acc.entries()].map(([conceptId, entry]) => ({
      conceptId,
      conceptName: entry.conceptName,
      lectureId: entry.lectureId,
      weakness: Math.round(entry.weakness * 100) / 100,
      reason: entry.reasons.join('; '),
    }));
    areas.sort((a, b) => b.weakness - a.weakness);
    return areas;
  }

  /* ————————————————————————— heuristic plan ————————————————————————— */

  private async generateHeuristic(
    course: Course,
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
    weakAreas: WeakArea[],
  ): Promise<ExamPrepPlan> {
    const index = this.conceptIndex(lectures, analysisByLecture);
    const { keyConcepts, recurringTopics } = this.mergeKeyConcepts(lectures, analysisByLecture);
    const cumulativeReview = this.cumulativeReview(course, lectures, analysisByLecture);
    const likelyExamQuestions = await this.likelyQuestions(
      lectures,
      analysisByLecture,
      index,
      keyConcepts,
    );
    const studyOrder = this.studyOrder(lectures, weakAreas);
    return {
      id: newId(),
      courseId: course.id,
      cumulativeReview,
      keyConcepts,
      recurringTopics,
      likelyExamQuestions,
      weakAreas,
      studyOrder,
      generatedBy: 'studdybuddy/heuristic',
      createdAt: Date.now(),
    };
  }

  /**
   * Merge each lecture's strongest concepts (by `importance * examLikelihood`)
   * into one course-wide list. Concepts recurring across lectures (matched by
   * normalized name) get an importance boost and become recurring topics.
   */
  private mergeKeyConcepts(
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
  ): { keyConcepts: ExamPrepPlan['keyConcepts']; recurringTopics: string[] } {
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const merged = new Map<
      string,
      { conceptName: string; lectureId: EntityId; importance: number; lectures: Set<EntityId> }
    >();

    for (const lecture of lectures) {
      const analysis = analysisByLecture.get(lecture.id);
      if (!analysis) continue;
      const ranked = analysis.concepts
        .map((c) => ({ c, score: c.importance * c.examLikelihood }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_CONCEPTS_PER_LECTURE);
      for (const { c, score } of ranked) {
        const key = norm(c.name);
        if (!key) continue;
        const existing = merged.get(key);
        if (existing) {
          // Recurring across lectures — boost and remember the extra lecture.
          existing.importance = Math.min(1, existing.importance + score * 0.5 + 0.1);
          existing.lectures.add(lecture.id);
        } else {
          merged.set(key, {
            conceptName: c.name,
            lectureId: lecture.id,
            importance: score,
            lectures: new Set([lecture.id]),
          });
        }
      }
    }

    const entries = [...merged.values()].sort((a, b) => b.importance - a.importance);
    const keyConcepts = entries.slice(0, 20).map((e) => ({
      conceptName: e.conceptName,
      lectureId: e.lectureId,
      importance: Math.round(e.importance * 100) / 100,
    }));
    const recurringTopics = entries.filter((e) => e.lectures.size >= 2).map((e) => e.conceptName);
    return { keyConcepts, recurringTopics };
  }

  /** Markdown walk of the course: each lecture's title, gist, top concepts, definitions. */
  private cumulativeReview(
    course: Course,
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
  ): string {
    const lines: string[] = [`# ${course.name} — Cumulative Review`, ''];
    const ordered = [...lectures].sort((a, b) => a.number - b.number);
    if (ordered.length === 0) {
      lines.push('_No lectures recorded for this course yet._');
      return lines.join('\n').trim();
    }
    for (const lecture of ordered) {
      lines.push(`## Lecture ${lecture.number}: ${lecture.title}`);
      const analysis = analysisByLecture.get(lecture.id);
      if (analysis?.gist) lines.push('', analysis.gist);
      if (analysis && analysis.concepts.length > 0) {
        const top = [...analysis.concepts].sort((a, b) => b.importance - a.importance).slice(0, 5);
        lines.push('', '**Key concepts**');
        for (const c of top) lines.push(`- **${c.name}** — ${c.summary}`);
      }
      if (analysis && analysis.definitions.length > 0) {
        lines.push('', '**Key definitions**');
        for (const d of analysis.definitions.slice(0, 5)) lines.push(`- *${d.term}*: ${d.definition}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  /**
   * Likely exam questions, drawn (in priority order) from the professor's
   * emphasis cues, the questions they actually asked in lecture, and templated
   * prompts over the strongest concepts — guaranteeing a substantial set even
   * with no AI and no explicit cues.
   */
  private async likelyQuestions(
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
    index: Map<EntityId, ConceptInfo>,
    keyConcepts: ExamPrepPlan['keyConcepts'],
  ): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string): void => {
      if (out.length >= MAX_QUESTIONS) return;
      const q = raw.trim();
      if (q.length < 8) return;
      const key = q.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(q);
    };

    // 1. Emphasis cues — the professor's explicit "this will be on the exam".
    for (const lecture of lectures) {
      const analysis = analysisByLecture.get(lecture.id);
      if (!analysis) continue;
      for (const cue of analysis.emphasisCues) {
        const name = cue.conceptId ? index.get(cue.conceptId)?.name : undefined;
        if (name) add(`Be ready to explain ${name} — the professor flagged it as exam material.`);
      }
    }

    // 2. Questions the teacher actually posed in lecture.
    for (const lecture of lectures) {
      const transcript = await this.repos.transcripts.getByLecture(lecture.id);
      if (!transcript) continue;
      for (const segment of transcript.segments) {
        if (segment.isTeacherQuestion || segment.kind === 'question') {
          const text = segment.text.trim();
          if (text) add(text.endsWith('?') ? text : `${text}?`);
        }
      }
    }

    // 3. Templated prompts over the strongest concepts.
    const names = keyConcepts.map((k) => k.conceptName);
    for (const name of names) add(`Explain ${name} in your own words and give an example.`);
    for (let i = 0; i + 1 < names.length; i += 2) {
      add(`Compare and contrast ${names[i]!} and ${names[i + 1]!}.`);
    }
    for (const name of names) add(`Where might ${name} appear on the exam, and how would you approach it?`);

    return out;
  }

  /**
   * Recommended study order: lectures ranked by the total weakness of their
   * concepts (weakest first), then by recency, each with a rationale. Every
   * lecture is represented.
   */
  private studyOrder(lectures: Lecture[], weakAreas: WeakArea[]): ExamPrepPlan['studyOrder'] {
    const byLecture = new Map<EntityId, { total: number; count: number }>();
    for (const area of weakAreas) {
      const entry = byLecture.get(area.lectureId) ?? { total: 0, count: 0 };
      entry.total += area.weakness;
      entry.count += 1;
      byLecture.set(area.lectureId, entry);
    }
    const ordered = [...lectures].sort((a, b) => {
      const diff = (byLecture.get(b.id)?.total ?? 0) - (byLecture.get(a.id)?.total ?? 0);
      if (Math.abs(diff) > 1e-9) return diff;
      return b.recordedAt - a.recordedAt;
    });
    return ordered.map((lecture) => {
      const weakness = byLecture.get(lecture.id);
      const rationale =
        weakness && weakness.total > 0
          ? `${weakness.count} weak ${weakness.count === 1 ? 'area' : 'areas'} flagged here — study this lecture first to close the biggest gaps.`
          : "No weak spots detected — a quick refresh keeps this lecture's material sharp.";
      return { title: `Lecture ${lecture.number}: ${lecture.title}`, lectureId: lecture.id, rationale };
    });
  }

  /* ————————————————————————— AI plan ————————————————————————— */

  private async generateWithAI(
    course: Course,
    lectures: Lecture[],
    analysisByLecture: AnalysisByLecture,
    weakAreas: WeakArea[],
  ): Promise<ExamPrepPlan> {
    const numberToId = new Map<number, EntityId>();
    for (const lecture of lectures) numberToId.set(lecture.number, lecture.id);
    const fallbackLectureId = lectures[0]?.id;

    const context = lectures
      .map((lecture) => {
        const analysis = analysisByLecture.get(lecture.id);
        const concepts = analysis
          ? analysis.concepts
              .slice(0, 10)
              .map(
                (c) =>
                  `${c.name} (importance ${c.importance.toFixed(2)}, exam ${c.examLikelihood.toFixed(2)})`,
              )
              .join(', ')
          : '(not analyzed)';
        return `Lecture ${lecture.number}: ${lecture.title}\nGist: ${analysis?.gist ?? ''}\nConcepts: ${concepts}`;
      })
      .join('\n\n');
    const weakSummary =
      weakAreas
        .slice(0, 10)
        .map((w) => `${w.conceptName} (${w.reason})`)
        .join('; ') || 'none detected';

    const system =
      'You are StuddyBuddy, an exam-prep coach. From a course\'s lectures, produce a cumulative ' +
      'review and a focused study plan. Ground everything strictly in the provided material; never ' +
      'invent lectures or concepts. Reference lectures by their number.';
    const user =
      `Course: ${course.name}\nInstructor: ${course.instructor}\n\nLectures:\n${context}\n\n` +
      `Known weak areas: ${weakSummary}\n\n` +
      'Produce an exam-prep plan with: cumulativeReview (markdown spanning all lectures), ' +
      'keyConcepts (each conceptName + lectureNumber + importance 0..1), recurringTopics ' +
      '(topics spanning multiple lectures), likelyExamQuestions (8-12 questions), and studyOrder ' +
      '(each step with title, lectureNumber, and a rationale).';

    const raw = await this.ai.generate({
      schema: RawExamPrepType,
      schemaName: 'ExamPrepPlan',
      system,
      user,
      maxTokens: 4096,
    });

    const keyConcepts: ExamPrepPlan['keyConcepts'] = raw.keyConcepts
      .filter((k) => k.conceptName.trim())
      .map((k) => ({
        conceptName: k.conceptName.trim(),
        lectureId: numberToId.get(k.lectureNumber) ?? fallbackLectureId ?? '',
        importance: k.importance,
      }))
      .filter((k) => k.lectureId);

    const studyOrder: ExamPrepPlan['studyOrder'] = raw.studyOrder
      .filter((s) => s.title.trim() || s.rationale.trim())
      .map((s) => {
        const lectureId = s.lectureNumber ? numberToId.get(s.lectureNumber) : undefined;
        const step: ExamPrepPlan['studyOrder'][number] = {
          title: s.title.trim() || 'Study step',
          rationale: s.rationale.trim(),
        };
        if (lectureId) step.lectureId = lectureId;
        return step;
      });

    const likelyExamQuestions = raw.likelyExamQuestions.map((q) => q.trim()).filter(Boolean);
    const recurringTopics = raw.recurringTopics.map((t) => t.trim()).filter(Boolean);
    const cumulativeReview =
      raw.cumulativeReview.trim() || this.cumulativeReview(course, lectures, analysisByLecture);

    return {
      id: newId(),
      courseId: course.id,
      cumulativeReview,
      keyConcepts,
      recurringTopics,
      likelyExamQuestions,
      weakAreas,
      // Guard against a model that skipped the study order entirely.
      studyOrder: studyOrder.length > 0 ? studyOrder : this.studyOrder(lectures, weakAreas),
      generatedBy: this.ai.activeLabel(),
      createdAt: Date.now(),
    };
  }

  private emit(
    jobId: string,
    progress: number,
    message: string,
    state: JobProgress['state'],
    error?: AppError,
  ): void {
    const payload: JobProgress = { jobId, kind: 'exam-prep', progress, message, state };
    if (error) payload.error = error;
    this.bus.emit('job:progress', payload);
  }
}

/** Factory mirroring the other core services; wiring happens at integration. */
export function createExamPrepService(deps: ExamPrepServiceDeps): ExamPrepService {
  return new ExamPrepService(deps);
}
