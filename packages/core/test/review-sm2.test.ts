import { describe, expect, it } from 'vitest';
import type { SrsState } from '@studdybuddy/shared';
import {
  DAY_MS,
  DEFAULT_EASE,
  LAPSE_STEP_MS,
  MIN_EASE,
  QUALITY_SCALE,
  reviewCard,
  type ReviewQuality,
} from '../src/review/sm2';

const T0 = 1_700_000_000_000;

/** A freshly-seeded, never-reviewed card. */
function freshCard(): SrsState {
  return { ease: DEFAULT_EASE, intervalDays: 0, reps: 0, lapses: 0, dueAt: T0 };
}

describe('SM-2 reviewCard', () => {
  it('grows intervals 1 → 6 → 16 with rising ease on a q=5,5,5 streak', () => {
    let srs = freshCard();
    const eases: number[] = [];
    const intervals: number[] = [];
    for (let i = 0; i < 3; i++) {
      srs = reviewCard(srs, 5, T0);
      intervals.push(srs.intervalDays);
      eases.push(srs.ease);
    }

    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(6);
    // round(6 * 2.7) = 16 — the spec's "~15+".
    expect(intervals[2]).toBeGreaterThanOrEqual(15);
    expect(intervals[2]).toBe(16);

    // Ease rises monotonically on perfect recalls.
    expect(eases[0]).toBeCloseTo(2.6, 10);
    expect(eases[1]).toBeCloseTo(2.7, 10);
    expect(eases[2]).toBeCloseTo(2.8, 10);
    expect(eases[0]!).toBeLessThan(eases[1]!);
    expect(eases[1]!).toBeLessThan(eases[2]!);
  });

  it('projects dueAt by the interval in days for passing grades', () => {
    const first = reviewCard(freshCard(), 5, T0);
    expect(first.dueAt).toBe(T0 + 1 * DAY_MS);
    expect(first.reps).toBe(1);
    expect(first.lapses).toBe(0);
  });

  it('resets reps and increments lapses on a failing grade, without touching ease', () => {
    const mature: SrsState = { ease: 2.8, intervalDays: 16, reps: 3, lapses: 0, dueAt: T0 };
    const lapsed = reviewCard(mature, 2, T0);

    expect(lapsed.reps).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.intervalDays).toBe(0);
    // Lapsed cards return in ~10 minutes, not a full day.
    expect(lapsed.dueAt).toBe(T0 + LAPSE_STEP_MS);
    // A lapse leaves ease untouched (SM-2 penalises via the pass formula only).
    expect(lapsed.ease).toBe(2.8);
  });

  it('never lets ease fall below the 1.3 floor on repeated hard passes', () => {
    // q=3 applies an ease delta of -0.14 each time.
    let srs: SrsState = { ease: 1.35, intervalDays: 4, reps: 2, lapses: 0, dueAt: T0 };
    srs = reviewCard(srs, 3, T0);
    expect(srs.ease).toBe(MIN_EASE);
    // Stays clamped no matter how many more hard passes land.
    for (let i = 0; i < 5; i++) srs = reviewCard(srs, 3, T0);
    expect(srs.ease).toBe(MIN_EASE);
    expect(srs.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it('treats a passing grade after a lapse as a first rep (interval 1)', () => {
    const afterLapse: SrsState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 1, dueAt: T0 };
    const recovered = reviewCard(afterLapse, 4, T0);
    expect(recovered.reps).toBe(1);
    expect(recovered.intervalDays).toBe(1);
    expect(recovered.lapses).toBe(1);
  });

  it('exposes a full 0..5 quality scale with correct passing flags', () => {
    expect(QUALITY_SCALE).toHaveLength(6);
    for (const q of [0, 1, 2, 3, 4, 5] as ReviewQuality[]) {
      const meaning = QUALITY_SCALE.find((m) => m.quality === q);
      expect(meaning).toBeDefined();
      expect(meaning!.passing).toBe(q >= 3);
    }
  });
});
