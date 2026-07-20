import type { SrsState, Timestamp } from '@studdybuddy/shared';

/**
 * Fresh spaced-repetition state for a newly generated flashcard.
 *
 * A new card starts un-reviewed: SM-2 default ease 2.5, no interval, zero reps
 * and lapses, and immediately due (`dueAt = now`) so it enters the first review
 * session. The *updates* to this state — grading a review, growing the interval,
 * handling lapses — are the responsibility of the Smart Review module
 * (`src/review`), which owns the SM-2 algorithm. This module only ever seeds the
 * initial state; it never advances it. Keeping that boundary sharp means the
 * scheduling policy can evolve in one place without touching material
 * generation.
 *
 * @param now Wall-clock timestamp to stamp as the card's initial due time,
 *   typically the owning material's `createdAt` so all cards in a batch share it.
 */
export function initialSrs(now: Timestamp): SrsState {
  return {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now,
  };
}
