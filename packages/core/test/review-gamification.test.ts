import { describe, expect, it } from 'vitest';
import type { GamificationState, StudyEventType } from '@studdybuddy/shared';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEventBus, CoreEvents } from '../src/infra/core-events';
import { LogManager } from '../src/infra/logger';
import type { Repositories } from '../src/storage/types';
import {
  GamificationService,
  levelForXp,
} from '../src/gamification/gamification-service';
import {
  ACHIEVEMENTS,
  type GamificationCounters,
} from '../src/gamification/achievements';

const logger = new LogManager().getLogger('test');

/* ————————————————————————— in-memory repositories ————————————————————————— */

function makeRepos(): { repos: Repositories; kv: Map<string, unknown> } {
  let state: GamificationState | null = null;
  const kv = new Map<string, unknown>();
  const repos = {
    gamification: {
      get: async () => state,
      put: async (s: GamificationState) => {
        state = s;
      },
    },
    kv: {
      get: async <T>(key: string) => (kv.has(key) ? (kv.get(key) as T) : null),
      put: async <T>(key: string, value: T) => {
        kv.set(key, value);
      },
    },
  };
  return { repos: repos as unknown as Repositories, kv };
}

/** A daytime local timestamp `dayOffset` days after a fixed anchor (avoids Night Owl). */
function at(dayOffset: number, hour = 14): number {
  return new Date(2026, 0, 5 + dayOffset, hour, 0, 0, 0).getTime();
}

function svc(repos: Repositories, bus: CoreEventBus, now = at(0)): GamificationService {
  return new GamificationService({ repos, bus, logger, now: () => now });
}

describe('levelForXp', () => {
  it('follows 1 + floor(sqrt(xp/60)) and is monotonic non-decreasing', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(59)).toBe(1);
    expect(levelForXp(60)).toBe(2);
    expect(levelForXp(240)).toBe(3);
    let prev = 0;
    for (let xp = 0; xp <= 5_000; xp += 25) {
      const lvl = levelForXp(xp);
      expect(lvl).toBeGreaterThanOrEqual(prev);
      prev = lvl;
    }
  });
});

describe('GamificationService.record — XP + level', () => {
  it('accrues XP and never lowers the level across a session', async () => {
    const { repos } = makeRepos();
    const svcInst = svc(repos, new EventBus<CoreEvents>());
    const types: StudyEventType[] = [
      'lecture-recorded',
      'notes-generated',
      'quiz-completed',
      'flashcard-reviewed',
      'exam-prep-generated',
      'search-asked',
    ];
    let prevXp = 0;
    let prevLevel = 1;
    for (const type of types) {
      const state = await svcInst.record({ type, at: at(0), courseId: 'c1', minutes: 5 });
      expect(state.xp).toBeGreaterThanOrEqual(prevXp);
      expect(state.level).toBeGreaterThanOrEqual(prevLevel);
      prevXp = state.xp;
      prevLevel = state.level;
    }
    expect(prevXp).toBeGreaterThan(0);
  });
});

describe('GamificationService.record — streaks', () => {
  it('holds same-day, increments next-day, and resets after a gap', async () => {
    const { repos } = makeRepos();
    const svcInst = svc(repos, new EventBus<CoreEvents>());

    let s = await svcInst.record({ type: 'concept-explained', at: at(0) });
    expect(s.streak.current).toBe(1);

    s = await svcInst.record({ type: 'concept-explained', at: at(1) });
    expect(s.streak.current).toBe(2);

    // Same day again — no change.
    s = await svcInst.record({ type: 'concept-explained', at: at(1) });
    expect(s.streak.current).toBe(2);

    // Two-day gap — resets to 1, but best is remembered.
    s = await svcInst.record({ type: 'concept-explained', at: at(3) });
    expect(s.streak.current).toBe(1);
    expect(s.streak.best).toBe(2);
  });
});

describe('GamificationService.record — achievements', () => {
  it('unlocks an achievement once and emits exactly one event for it', async () => {
    const { repos } = makeRepos();
    const bus = new EventBus<CoreEvents>();
    const unlocked: string[] = [];
    bus.on('achievement:unlocked', (p) => unlocked.push(p.achievementId));

    const svcInst = svc(repos, bus);
    await svcInst.record({ type: 'lecture-recorded', at: at(0), courseId: 'c1', minutes: 30 });
    expect(unlocked.filter((id) => id === 'first-lecture')).toHaveLength(1);

    // Recording another lecture must NOT re-unlock the first-lecture badge.
    await svcInst.record({ type: 'lecture-recorded', at: at(0), courseId: 'c1', minutes: 30 });
    expect(unlocked.filter((id) => id === 'first-lecture')).toHaveLength(1);
  });

  it('emits a gamification:updated event on every record', async () => {
    const { repos } = makeRepos();
    const bus = new EventBus<CoreEvents>();
    let updates = 0;
    bus.on('gamification:updated', () => updates++);
    const svcInst = svc(repos, bus);
    await svcInst.record({ type: 'flashcard-reviewed', at: at(0) });
    await svcInst.record({ type: 'flashcard-reviewed', at: at(0) });
    expect(updates).toBe(2);
  });

  it('unlocks streak and count achievements as thresholds are crossed', async () => {
    const { repos } = makeRepos();
    const bus = new EventBus<CoreEvents>();
    const unlocked: string[] = [];
    bus.on('achievement:unlocked', (p) => unlocked.push(p.achievementId));
    const svcInst = svc(repos, bus);

    // Three consecutive days of study → "On a Roll" (streak-3).
    await svcInst.record({ type: 'concept-explained', at: at(0) });
    await svcInst.record({ type: 'concept-explained', at: at(1) });
    const s = await svcInst.record({ type: 'concept-explained', at: at(2) });
    expect(s.streak.current).toBe(3);
    expect(unlocked).toContain('streak-3');
  });
});

describe('GamificationService — persistence & catalog', () => {
  it('persists counters across records', async () => {
    const { repos, kv } = makeRepos();
    const svcInst = svc(repos, new EventBus<CoreEvents>());
    await svcInst.record({ type: 'flashcard-reviewed', at: at(0) });
    await svcInst.record({ type: 'quiz-completed', at: at(0) });
    await svcInst.record({ type: 'lecture-recorded', at: at(0), courseId: 'c1' });

    const counters = kv.get('gamification:counters') as GamificationCounters;
    expect(counters.cardsReviewed).toBe(1);
    expect(counters.quizzes).toBe(1);
    expect(counters.lectures).toBe(1);
    expect(counters.coursesTouched).toContain('c1');
  });

  it('creates a default state on first getState and exposes the catalog', async () => {
    const { repos } = makeRepos();
    const svcInst = svc(repos, new EventBus<CoreEvents>());
    const state = await svcInst.getState();
    expect(state.level).toBe(1);
    expect(state.xp).toBe(0);
    expect(state.unlocked).toEqual([]);

    const catalog = svcInst.catalog();
    expect(catalog.length).toBeGreaterThanOrEqual(14);
    expect(catalog).toBe(ACHIEVEMENTS);
    // Every catalog id must be reachable by the UI as a stable string.
    for (const def of catalog) expect(typeof def.id).toBe('string');
  });
});
