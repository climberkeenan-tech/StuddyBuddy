import {
  dayKey,
  dayKeyDiff,
  type AchievementDef,
  type GamificationState,
  type StudyEvent,
  type StudyEventType,
} from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_PREDICATES,
  defaultCounters,
  type GamificationCounters,
} from './achievements';

export interface GamificationServiceDeps {
  repos: Repositories;
  bus: CoreEventBus;
  logger: Logger;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

/** kv key under which the rolling achievement counters are persisted. */
const COUNTERS_KEY = 'gamification:counters';

/** XP awarded per study-event type. `quiz-aced` is a bonus stacked on `quiz-completed`. */
const XP_BY_TYPE: Record<StudyEventType, number> = {
  'lecture-recorded': 50,
  'notes-generated': 10,
  'flashcard-reviewed': 2,
  'quiz-completed': 25,
  'quiz-aced': 40,
  'concept-explained': 5,
  'game-completed': 15,
  'exam-prep-generated': 30,
  'search-asked': 3,
};

/** Divisor in the level curve: `level = 1 + floor(sqrt(xp / 60))`. */
const LEVEL_DIVISOR = 60;
/** Keep at most this many days of per-day minute history. */
const DAILY_HISTORY_DAYS = 30;

/**
 * The gamification engine: turns study events into XP, levels, streaks, daily
 * activity stats, and achievement unlocks.
 *
 * Everything is local and deterministic — no AI, no network. Each
 * {@link record} call loads the current state + counters, applies one event,
 * re-evaluates the whole achievement catalog (looping so an XP-driven level-up
 * can cascade into a level achievement in the same call), persists, and emits
 * `achievement:unlocked` for each new badge followed by a single
 * `gamification:updated`. Unlocked achievements are recorded in state, so
 * re-recording an equivalent event never re-awards a badge.
 */
export class GamificationService {
  private readonly repos: Repositories;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;
  private readonly clock: () => number;

  constructor(deps: GamificationServiceDeps) {
    this.repos = deps.repos;
    this.bus = deps.bus;
    this.logger = deps.logger.child('gamification');
    this.clock = deps.now ?? Date.now;
  }

  /** Current gamification state, creating and persisting the default on first read. */
  async getState(): Promise<GamificationState> {
    const existing = await this.repos.gamification.get();
    if (existing) return existing;
    const fresh = this.defaultState();
    await this.repos.gamification.put(fresh);
    return fresh;
  }

  /** The full achievement catalog (for the UI's badge wall). */
  catalog(): readonly AchievementDef[] {
    return ACHIEVEMENTS;
  }

  /**
   * Apply one study event and return the updated state.
   *
   * Adds the event's XP, updates counters, advances the daily streak, folds the
   * event's minutes into all-time and per-day totals (pruning old days),
   * recomputes level, and unlocks any newly-earned achievements (which award
   * their own XP and can chain into further unlocks).
   */
  async record(event: StudyEvent): Promise<GamificationState> {
    const now = this.clock();
    const state = { ...this.defaultState(), ...((await this.repos.gamification.get()) ?? {}) };
    const stored = await this.repos.kv.get<GamificationCounters>(COUNTERS_KEY);
    const counters: GamificationCounters = { ...defaultCounters(), ...(stored ?? {}) };
    // Guard fields that must stay arrays even if a partial doc was persisted.
    counters.coursesTouched = [...(counters.coursesTouched ?? [])];

    const day = dayKey(event.at);

    // 1. Base XP + counters for this event.
    state.xp += XP_BY_TYPE[event.type] ?? 0;
    this.applyCounters(counters, event);

    // 2. Streak.
    this.advanceStreak(state, day);

    // 3. Study minutes (all-time + per-day, with old days pruned).
    const minutes = event.minutes ?? 0;
    state.studyMinutes += minutes;
    state.dailyMinutes[day] = (state.dailyMinutes[day] ?? 0) + minutes;
    for (const existingDay of Object.keys(state.dailyMinutes)) {
      if (dayKeyDiff(existingDay, day) > DAILY_HISTORY_DAYS) delete state.dailyMinutes[existingDay];
    }

    // 4. Level + achievements (cascade until stable).
    const newlyUnlocked = this.evaluateAchievements(state, counters, now);
    state.updatedAt = now;

    // 5. Emit, then persist.
    for (const def of newlyUnlocked) {
      this.bus.emit('achievement:unlocked', {
        achievementId: def.id,
        name: def.name,
        icon: def.icon,
        xp: def.xp,
      });
    }
    this.bus.emit('gamification:updated', state);

    await this.repos.gamification.put(state);
    await this.repos.kv.put(COUNTERS_KEY, counters);

    if (newlyUnlocked.length > 0) {
      this.logger.info('achievements unlocked', {
        ids: newlyUnlocked.map((a) => a.id),
        xp: state.xp,
        level: state.level,
      });
    }
    return state;
  }

  /* ————————————————————————— internals ————————————————————————— */

  private applyCounters(counters: GamificationCounters, event: StudyEvent): void {
    switch (event.type) {
      case 'lecture-recorded':
        counters.lectures += 1;
        break;
      case 'quiz-completed':
        counters.quizzes += 1;
        break;
      case 'quiz-aced':
        counters.quizAces += 1;
        break;
      case 'flashcard-reviewed':
        counters.cardsReviewed += 1;
        break;
      case 'exam-prep-generated':
        counters.examPreps += 1;
        break;
      case 'search-asked':
        counters.asks += 1;
        break;
      case 'game-completed':
        counters.gamesCompleted += 1;
        break;
      default:
        // notes-generated / concept-explained earn XP but track no counter.
        break;
    }
    if (event.courseId && !counters.coursesTouched.includes(event.courseId)) {
      counters.coursesTouched.push(event.courseId);
    }
    if (isNightHour(event.at)) counters.nightSessions += 1;
  }

  /** Advance the daily streak given the day key of the current event. */
  private advanceStreak(state: GamificationState, day: string): void {
    const streak = state.streak;
    if (!streak.lastStudyDay) {
      streak.current = 1;
      streak.best = Math.max(streak.best, 1);
      streak.lastStudyDay = day;
      return;
    }
    const diff = dayKeyDiff(streak.lastStudyDay, day);
    if (diff === 1) {
      streak.current += 1;
      streak.lastStudyDay = day;
    } else if (diff > 1) {
      streak.current = 1;
      streak.lastStudyDay = day;
    } else {
      // Same day (diff === 0) or an out-of-order older event (diff < 0):
      // the streak neither advances nor breaks, and we never rewind the anchor.
      if (streak.current < 1) streak.current = 1;
    }
    streak.best = Math.max(streak.best, streak.current);
  }

  /**
   * Recompute level from XP and unlock any achievements whose predicate now
   * holds, looping so a badge's XP reward can raise the level and unlock a
   * level-gated badge within the same call. Returns the newly-unlocked defs in
   * unlock order.
   */
  private evaluateAchievements(
    state: GamificationState,
    counters: GamificationCounters,
    now: number,
  ): AchievementDef[] {
    const unlockedIds = new Set(state.unlocked.map((u) => u.achievementId));
    const newlyUnlocked: AchievementDef[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      state.level = levelForXp(state.xp);
      for (const def of ACHIEVEMENTS) {
        if (unlockedIds.has(def.id)) continue;
        const predicate = ACHIEVEMENT_PREDICATES[def.id];
        if (predicate && predicate(counters, state)) {
          unlockedIds.add(def.id);
          state.unlocked.push({ achievementId: def.id, unlockedAt: now });
          state.xp += def.xp;
          newlyUnlocked.push(def);
          changed = true;
        }
      }
    }
    state.level = levelForXp(state.xp);
    return newlyUnlocked;
  }

  private defaultState(): GamificationState {
    return {
      xp: 0,
      level: 1,
      streak: { current: 0, best: 0, lastStudyDay: '' },
      unlocked: [],
      studyMinutes: 0,
      dailyMinutes: {},
      updatedAt: this.clock(),
    };
  }
}

/** `level = 1 + floor(sqrt(xp / 60))` — gentle, ever-slowing progression. */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_DIVISOR));
}

/** True for study logged late at night (before 5am or from 10pm), local time. */
function isNightHour(at: number): boolean {
  const hour = new Date(at).getHours();
  return hour < 5 || hour >= 22;
}

/** Factory mirroring the other core services; wiring happens at integration. */
export function createGamificationService(deps: GamificationServiceDeps): GamificationService {
  return new GamificationService(deps);
}
