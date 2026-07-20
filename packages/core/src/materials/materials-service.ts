import {
  newId,
  type Difficulty,
  type Flashcard,
  type FlashcardsContent,
  type JobProgress,
  type LectureAnalysis,
  type MaterialType,
  type StudyMaterial,
  type StudyMaterialMeta,
} from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { PluginRegistry } from '../plugins/registry';
import type { Repositories } from '../storage/types';
import type { AIFacade } from '../ai/types';
import type { GenerationContext, MaterialGenerator } from './types';
import { matchConceptIdByText, MATERIAL_LABELS } from './common';
import { initialSrs } from './srs';

/** Material types included in a one-click "study kit" batch, in run order. */
export const STUDY_KIT_TYPES: MaterialType[] = [
  'notes',
  'summary-concise',
  'summary-detailed',
  'study-guide',
  'flashcards',
  'quiz-mcq',
  'quiz-short-answer',
  'vocabulary',
  'cheat-sheet',
];

export interface MaterialsServiceDeps {
  repos: Repositories;
  ai: AIFacade;
  pluginRegistry: PluginRegistry;
  bus: CoreEventBus;
  logger: Logger;
}

export interface GenerateOptions {
  difficulty?: Difficulty;
}

/**
 * Orchestrates study-material generation.
 *
 * Loads a lecture's transcript + analysis, resolves the requested generator from
 * the plugin registry, builds a {@link GenerationContext} (deciding AI vs.
 * heuristic from the AI facade), stamps the persisted {@link StudyMaterial}
 * envelope, and persists. If an AI generation attempt fails, the service falls
 * back to the generator's heuristic path so a material is always produced when
 * one can be — the generators themselves stay pure, branching only on
 * `ctx.aiAvailable`.
 */
export class MaterialsService {
  private readonly repos: Repositories;
  private readonly ai: AIFacade;
  private readonly registry: PluginRegistry;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;

  constructor(deps: MaterialsServiceDeps) {
    this.repos = deps.repos;
    this.ai = deps.ai;
    this.registry = deps.pluginRegistry;
    this.bus = deps.bus;
    this.logger = deps.logger.child('materials-service');
  }

  /**
   * Generate and persist one study material.
   * @throws SbError NOT_FOUND if the lecture, transcript or generator is missing.
   * @throws SbError VALIDATION if the lecture has not been analyzed yet.
   */
  async generate(
    lectureId: string,
    type: MaterialType,
    options: GenerateOptions = {},
  ): Promise<StudyMaterial> {
    const difficulty = options.difficulty ?? 'medium';

    const lecture = await this.repos.lectures.get(lectureId);
    if (!lecture) throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${lectureId}" not found.`);

    const transcript = await this.repos.transcripts.getByLecture(lectureId);
    if (!transcript) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `Transcript for lecture "${lectureId}" not found; record or transcribe it first.`,
      );
    }

    const analysis = await this.repos.analyses.getByLecture(lectureId);
    if (!analysis) {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Lecture "${lectureId}" has not been analyzed yet; run analysis before generating materials.`,
      );
    }

    const generator = this.registry.get('material-generator', type) as
      | MaterialGenerator
      | undefined;
    if (!generator) {
      throw new SbError(ErrorCodes.NOT_FOUND, `No generator registered for material type "${type}".`);
    }

    const course = await this.repos.courses.get(lecture.courseId);
    const courseName = course?.name ?? 'Course';

    const aiAvailable = await this.ai.available();
    const ctx: GenerationContext = {
      lecture,
      transcript,
      analysis,
      difficulty,
      generate: this.ai.generate,
      aiAvailable,
      courseName,
    };

    let produced: Awaited<ReturnType<MaterialGenerator['generate']>>;
    let usedAi = aiAvailable;
    try {
      produced = await generator.generate(ctx);
    } catch (e) {
      if (aiAvailable) {
        this.logger.warn('AI generation failed; falling back to heuristics', {
          type,
          lectureId,
          error: e instanceof Error ? e.message : String(e),
        });
        usedAi = false;
        produced = await generator.generate({ ...ctx, aiAvailable: false });
      } else {
        throw e;
      }
    }

    const createdAt = Date.now();
    const material: StudyMaterial = {
      id: newId(),
      lectureId,
      courseId: lecture.courseId,
      type,
      title: produced.title,
      difficulty,
      content: produced.content,
      generatedBy: usedAi ? this.ai.activeLabel() : 'heuristic',
      createdAt,
    };

    if (material.type === 'flashcards') {
      stampFlashcards(material.content as FlashcardsContent, analysis, createdAt);
    }

    await this.repos.materials.put(material);
    this.logger.info('material generated', {
      type,
      lectureId,
      generatedBy: material.generatedBy,
      difficulty,
    });
    return material;
  }

  /**
   * Kick off a full study kit for a lecture. Returns immediately with a job id;
   * the individual materials are generated sequentially in the background,
   * emitting `job:progress` events. Individual failures are logged and skipped —
   * the job succeeds when at least half the materials are produced.
   * @throws SbError NOT_FOUND if the lecture does not exist.
   */
  async generateKit(
    lectureId: string,
    difficulty: Difficulty = 'medium',
  ): Promise<{ jobId: string }> {
    const lecture = await this.repos.lectures.get(lectureId);
    if (!lecture) throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${lectureId}" not found.`);

    const jobId = newId();
    // Fire-and-forget: the caller gets the job id immediately and follows the
    // rest of the run through job:progress events.
    void this.runKit(jobId, lectureId, difficulty);
    return { jobId };
  }

  private async runKit(jobId: string, lectureId: string, difficulty: Difficulty): Promise<void> {
    const types = STUDY_KIT_TYPES;
    const total = types.length;
    this.emitKit(jobId, 0, 'Starting study kit…', 'running');

    let succeeded = 0;
    for (let i = 0; i < total; i++) {
      const type = types[i];
      if (!type) continue;
      this.emitKit(jobId, i / total, `Generating ${MATERIAL_LABELS[type]}…`, 'running');
      try {
        await this.generate(lectureId, type, { difficulty });
        succeeded++;
      } catch (e) {
        this.logger.warn('study kit item failed; skipping', {
          type,
          lectureId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const ok = succeeded >= Math.ceil(total / 2);
    this.emitKit(
      jobId,
      1,
      `Study kit ${ok ? 'ready' : 'incomplete'} (${succeeded}/${total} materials)`,
      ok ? 'succeeded' : 'failed',
    );
    this.logger.info('study kit finished', { lectureId, succeeded, total, ok });
  }

  /** Listing rows (content stripped) for a lecture, newest first. */
  list(lectureId: string): Promise<StudyMaterialMeta[]> {
    return this.repos.materials.listMeta(lectureId);
  }

  /** A single material by id, or null if it does not exist. */
  get(id: string): Promise<StudyMaterial | null> {
    return this.repos.materials.get(id);
  }

  /** Delete a material by id. */
  remove(id: string): Promise<void> {
    return this.repos.materials.delete(id);
  }

  private emitKit(
    jobId: string,
    progress: number,
    message: string,
    state: JobProgress['state'],
  ): void {
    this.bus.emit('job:progress', { jobId, kind: 'study-kit', progress, message, state });
  }
}

export function createMaterialsService(deps: MaterialsServiceDeps): MaterialsService {
  return new MaterialsService(deps);
}

/**
 * Authoritative flashcard stamping done by the service on persist: assign fresh
 * ids, seed SRS state due at the material's `createdAt` (so a whole deck shares
 * one due time), and resolve each card's `conceptId` by matching its text
 * against the analysis' concept names.
 */
function stampFlashcards(content: FlashcardsContent, analysis: LectureAnalysis, now: number): void {
  content.cards = content.cards.map((card): Flashcard => {
    const conceptId = matchConceptIdByText(`${card.front} ${card.back}`, analysis) ?? card.conceptId;
    const stamped: Flashcard = {
      id: newId(),
      front: card.front,
      back: card.back,
      srs: initialSrs(now),
    };
    if (card.hint) stamped.hint = card.hint;
    if (conceptId) stamped.conceptId = conceptId;
    return stamped;
  });
}
