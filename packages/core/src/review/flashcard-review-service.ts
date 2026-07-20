import {
  type EntityId,
  type Flashcard,
  type FlashcardsContent,
  type StudyEvent,
  type StudyMaterial,
} from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import { reviewCard as gradeCard, type ReviewQuality } from './sm2';

/**
 * A flashcard that is due for review right now, flattened out of its owning
 * material and tagged with the identifiers the UI needs to route a grade back
 * to the right card via {@link FlashcardReviewService.reviewCard}.
 */
export interface DueFlashcard extends Flashcard {
  materialId: EntityId;
  lectureId: EntityId;
  courseId: EntityId;
}

/**
 * Minimal surface of the gamification engine this service depends on. Kept as a
 * structural type (rather than importing the concrete service) so the two
 * modules stay decoupled and either can be tested in isolation.
 */
export interface GamificationRecorder {
  record(event: StudyEvent): Promise<unknown>;
}

export interface FlashcardReviewServiceDeps {
  repos: Repositories;
  /** Optional bus, reserved for future review-progress events; wired at integration. */
  bus?: CoreEventBus;
  /** Optional engine that turns a review into XP/streak progress. */
  gamification?: GamificationRecorder;
  logger: Logger;
}

/** Minutes of active study a single card review is worth (feeds daily-minute stats). */
const REVIEW_MINUTES = 0.4;

/**
 * Smart Review's flashcard scheduler.
 *
 * Flashcards live inside `flashcards`-type {@link StudyMaterial} documents; this
 * service scans those materials, surfaces the cards whose SM-2 `dueAt` has
 * passed, applies grades through the pure {@link gradeCard} (SM-2) function,
 * persists the mutated deck, and records a study event so reviewing counts
 * toward XP and streaks. It is fully functional with zero API keys — spaced
 * repetition is entirely local and deterministic.
 */
export class FlashcardReviewService {
  private readonly repos: Repositories;
  private readonly bus?: CoreEventBus;
  private readonly gamification?: GamificationRecorder;
  private readonly logger: Logger;

  constructor(deps: FlashcardReviewServiceDeps) {
    this.repos = deps.repos;
    this.bus = deps.bus;
    this.gamification = deps.gamification;
    this.logger = deps.logger.child('flashcard-review');
  }

  /**
   * Cards due for review, oldest-due first. Scans every `flashcards` material in
   * the given course, or across all courses when `courseId` is omitted (the
   * dashboard's "review everything" mode).
   */
  async dueCards(courseId?: EntityId): Promise<DueFlashcard[]> {
    const now = Date.now();
    const materials = courseId
      ? await this.repos.materials.byCourseAndType(courseId, 'flashcards')
      : await this.allFlashcardMaterials();

    const due: DueFlashcard[] = [];
    for (const material of materials) {
      const content = material.content as FlashcardsContent;
      for (const card of content.cards) {
        if (card.srs.dueAt <= now) {
          due.push({
            ...card,
            materialId: material.id,
            lectureId: material.lectureId,
            courseId: material.courseId,
          });
        }
      }
    }
    due.sort((a, b) => a.srs.dueAt - b.srs.dueAt);
    return due;
  }

  /**
   * Grade a single card and persist the result.
   *
   * Loads the owning material, advances the target card's SM-2 state via the
   * grade, writes the deck back, and records a `flashcard-reviewed` study event
   * (worth {@link REVIEW_MINUTES} minutes) with the gamification engine when one
   * is wired. Returns the updated card so the UI can show the next due date.
   *
   * @throws SbError NOT_FOUND if the material or card does not exist.
   * @throws SbError VALIDATION if the material is not a flashcards deck.
   */
  async reviewCard(
    materialId: EntityId,
    cardId: EntityId,
    quality: ReviewQuality,
  ): Promise<Flashcard> {
    const material = await this.repos.materials.get(materialId);
    if (!material) {
      throw new SbError(ErrorCodes.NOT_FOUND, `Flashcard material "${materialId}" not found.`);
    }
    if (material.type !== 'flashcards') {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Material "${materialId}" is a "${material.type}", not a flashcards deck.`,
      );
    }

    const content = material.content as FlashcardsContent;
    const index = content.cards.findIndex((c) => c.id === cardId);
    if (index < 0) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `Card "${cardId}" not found in material "${materialId}".`,
      );
    }

    const existing = content.cards[index]!;
    const now = Date.now();
    const updated: Flashcard = { ...existing, srs: gradeCard(existing.srs, quality, now) };
    content.cards[index] = updated;

    await this.repos.materials.put(material);

    const event: StudyEvent = {
      type: 'flashcard-reviewed',
      at: now,
      courseId: material.courseId,
      lectureId: material.lectureId,
      minutes: REVIEW_MINUTES,
      data: { materialId, cardId, quality },
    };
    if (this.gamification) {
      try {
        await this.gamification.record(event);
      } catch (e) {
        // A gamification hiccup must never lose a review; the SRS state is
        // already persisted above.
        this.logger.warn('gamification record failed for flashcard review', {
          materialId,
          cardId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.logger.debug('card reviewed', {
      materialId,
      cardId,
      quality,
      nextDueAt: updated.srs.dueAt,
      intervalDays: updated.srs.intervalDays,
    });
    return updated;
  }

  /**
   * Count of due cards per course, keyed by course id — the numbers the home
   * dashboard shows on each course tile. Every non-archived course is included
   * (value 0 when nothing is due) so the UI can render a stable row set.
   */
  async dueCountByCourse(): Promise<Map<EntityId, number>> {
    const now = Date.now();
    const counts = new Map<EntityId, number>();
    const courses = await this.repos.courses.list();
    for (const course of courses) {
      const materials = await this.repos.materials.byCourseAndType(course.id, 'flashcards');
      let count = 0;
      for (const material of materials) {
        const content = material.content as FlashcardsContent;
        for (const card of content.cards) if (card.srs.dueAt <= now) count++;
      }
      counts.set(course.id, count);
    }
    return counts;
  }

  /** Every flashcards material across all courses (used by the all-courses due scan). */
  private async allFlashcardMaterials(): Promise<StudyMaterial[]> {
    const courses = await this.repos.courses.list();
    const all: StudyMaterial[] = [];
    for (const course of courses) {
      all.push(...(await this.repos.materials.byCourseAndType(course.id, 'flashcards')));
    }
    return all;
  }
}

/** Factory mirroring the other core services; wiring happens at integration. */
export function createFlashcardReviewService(
  deps: FlashcardReviewServiceDeps,
): FlashcardReviewService {
  return new FlashcardReviewService(deps);
}
