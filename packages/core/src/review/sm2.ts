import type { SrsState } from '@studdybuddy/shared';

/**
 * The SM-2 spaced-repetition algorithm — the scheduling core of Smart Review.
 *
 * This module is deliberately pure: {@link reviewCard} takes the card's current
 * {@link SrsState}, the grade the student gave, and the wall clock, and returns
 * the next state. No I/O, no side effects, no injected clock — which makes the
 * whole scheduling policy trivially testable and lets the review service (which
 * owns persistence + eventing) stay thin.
 */

/** A review grade, SuperMemo-2 style: 0 (total blackout) … 5 (perfect recall). */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Default ease factor a freshly-seeded card starts at (SM-2 canonical value). */
export const DEFAULT_EASE = 2.5;

/**
 * Floor for the ease factor. SM-2 never lets a card's ease drop below this, so
 * a chronically-hard card still gets *some* interval growth rather than being
 * shown forever at a fixed spacing.
 */
export const MIN_EASE = 1.3;

/**
 * Grades at or above this are "passing": the card graduates and its interval
 * grows. Below it the card lapses and is shown again shortly.
 */
export const PASS_THRESHOLD = 3;

/** Milliseconds in a day, used to project the next due timestamp. */
export const DAY_MS = 86_400_000;

/**
 * How soon a lapsed card comes back. A failed card is not pushed a full day
 * out — it re-enters the same session ~10 minutes later so the student can
 * re-cement it while it is still fresh.
 */
export const LAPSE_STEP_MS = 10 * 60 * 1000;

/** Human-readable meaning of each point on the 0..5 grading scale. */
export interface QualityMeaning {
  quality: ReviewQuality;
  /** Short label for a grading button. */
  label: string;
  /** One-line description of what the grade represents. */
  description: string;
  /** Whether this grade graduates the card (grade >= {@link PASS_THRESHOLD}). */
  passing: boolean;
}

/**
 * The canonical SM-2 quality scale. Exposed so the UI labels its grading
 * buttons from the same source of truth the algorithm branches on.
 */
export const QUALITY_SCALE: readonly QualityMeaning[] = [
  { quality: 0, label: 'Blackout', description: 'No memory of the answer at all.', passing: false },
  { quality: 1, label: 'Wrong', description: 'Incorrect; the answer felt unfamiliar.', passing: false },
  {
    quality: 2,
    label: 'Almost',
    description: 'Incorrect, but the answer felt familiar once seen.',
    passing: false,
  },
  {
    quality: 3,
    label: 'Hard',
    description: 'Correct, but recalled with serious difficulty.',
    passing: true,
  },
  {
    quality: 4,
    label: 'Good',
    description: 'Correct after a moment of hesitation.',
    passing: true,
  },
  { quality: 5, label: 'Easy', description: 'Perfect, immediate recall.', passing: true },
] as const;

/**
 * Grade a flashcard review and compute its next scheduling state.
 *
 * Behaviour:
 * - **Lapse** (`quality < 3`): reps reset to 0, `lapses` increments, the
 *   interval collapses to 0 days, and the card becomes due again ~10 minutes
 *   from `now`. The ease factor is left untouched on a lapse — SM-2 penalises
 *   hard-but-passing grades through the ease formula, not outright failures.
 * - **Pass** (`quality >= 3`): reps increments; the interval is 1 day on the
 *   first success, 6 days on the second, and `round(previousInterval * ease)`
 *   thereafter (using the ease *before* this review's adjustment, matching the
 *   classic SM-2 statement order). The ease factor is then nudged by
 *   `ease + 0.1 - (5-q)*(0.08 + (5-q)*0.02)` and clamped to {@link MIN_EASE}.
 *
 * @param srs Current scheduling state of the card.
 * @param quality Grade the student gave this review (0..5).
 * @param now Wall-clock timestamp (ms) of the review, used to stamp `dueAt`.
 * @returns A new {@link SrsState}; the input is never mutated.
 */
export function reviewCard(srs: SrsState, quality: ReviewQuality, now: number): SrsState {
  // Defensive normalisation: keep the algorithm well-defined even if a caller
  // slips a fractional or out-of-range grade past the type.
  const q = Math.max(0, Math.min(5, Math.round(quality)));

  if (q < PASS_THRESHOLD) {
    return {
      ease: srs.ease,
      intervalDays: 0,
      reps: 0,
      lapses: srs.lapses + 1,
      dueAt: now + LAPSE_STEP_MS,
    };
  }

  const reps = srs.reps + 1;
  const intervalDays =
    reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(srs.intervalDays * srs.ease));

  const easeDelta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const ease = Math.max(MIN_EASE, srs.ease + easeDelta);

  return {
    ease,
    intervalDays,
    reps,
    lapses: srs.lapses,
    dueAt: now + intervalDays * DAY_MS,
  };
}
