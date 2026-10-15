import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_X,
  HERO_MIN_X,
  HERO_SPEED,
  HERO_START_X,
  MAX_HEARTS,
  MAX_STEP_MS,
  STRIDE_PX,
  VIEW_W,
  WORLD_W,
  applyAnswer,
  battleOutcome,
  cameraX,
  hasReachedMonster,
  initialBattle,
  initialHero,
  monsterHpFor,
  pulse,
  questScore,
  ramp,
  stepHero,
  walkPose,
  walkProgress,
} from './quest';

describe('stepHero', () => {
  it('walks right at HERO_SPEED and advances the walk cycle with distance', () => {
    const next = stepHero(initialHero(), 1, 40);
    expect(next.x).toBeCloseTo(HERO_START_X + HERO_SPEED * 0.04);
    expect(next.walking).toBe(true);
    expect(next.facing).toBe(1);
    expect(next.walkPhase).toBeCloseTo(((HERO_SPEED * 0.04) / STRIDE_PX) * Math.PI * 2);
  });

  it('turns around when walking left', () => {
    const next = stepHero({ ...initialHero(), x: 500 }, -1, 20);
    expect(next.x).toBeLessThan(500);
    expect(next.facing).toBe(-1);
  });

  it('stops walking (and keeps its identity when already still) with no input', () => {
    const still = initialHero();
    expect(stepHero(still, 0, 16)).toBe(still);
    const moving = stepHero(still, 1, 16);
    expect(stepHero(moving, 0, 16)).toEqual({ ...moving, walking: false });
  });

  it('caps a long frame so a stalled tab cannot teleport the hero', () => {
    const next = stepHero(initialHero(), 1, 5_000);
    expect(next.x).toBeCloseTo(HERO_START_X + (HERO_SPEED * MAX_STEP_MS) / 1000);
  });

  it('is fenced between the left edge and the encounter point, and stops the legs there', () => {
    const atEdge = stepHero({ ...initialHero(), x: HERO_MIN_X }, -1, 16);
    expect(atEdge.x).toBe(HERO_MIN_X);
    expect(atEdge.walking).toBe(false);

    const atMonster = stepHero({ ...initialHero(), x: ENCOUNTER_X - 1 }, 1, 50);
    expect(atMonster.x).toBe(ENCOUNTER_X);
    expect(hasReachedMonster(atMonster.x)).toBe(true);
    expect(stepHero(atMonster, 1, 16).walking).toBe(false);
  });

  it('reaches the monster after a few seconds of walking', () => {
    let hero = initialHero();
    let ms = 0;
    while (!hasReachedMonster(hero.x) && ms < 20_000) {
      hero = stepHero(hero, 1, 16);
      ms += 16;
    }
    expect(hasReachedMonster(hero.x)).toBe(true);
    expect(ms).toBeGreaterThan(3_000);
    expect(ms).toBeLessThan(6_000);
  });
});

describe('walk geometry', () => {
  it('keeps the camera inside the world', () => {
    expect(cameraX(HERO_START_X)).toBe(0);
    expect(cameraX(ENCOUNTER_X)).toBe(WORLD_W - VIEW_W);
    const mid = cameraX(700);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(WORLD_W - VIEW_W);
  });

  it('reports walk progress from start to encounter', () => {
    expect(walkProgress(HERO_START_X)).toBe(0);
    expect(walkProgress(HERO_MIN_X)).toBe(0);
    expect(walkProgress(ENCOUNTER_X)).toBe(1);
  });

  it('stands still when not walking', () => {
    expect(walkPose(1.2, false)).toEqual({ frontLeg: 0, backLeg: 0, frontArm: 0, backArm: 0, bob: 0 });
  });

  it('swings legs in opposition, counter-swings the arms, and bobs the body', () => {
    const stride = walkPose(Math.PI / 2, true);
    expect(stride.frontLeg).toBeCloseTo(30);
    expect(stride.backLeg).toBeCloseTo(-30);
    expect(stride.frontArm).toBeCloseTo(-24);
    expect(stride.backArm).toBeCloseTo(24);
    // Full stride sits lowest; legs passing (phase 0) rides highest.
    expect(stride.bob).toBeCloseTo(0);
    expect(walkPose(0, true).bob).toBeCloseTo(-3);
  });
});

describe('battle', () => {
  it('scales monster HP with the question pool, within 2..5', () => {
    expect(monsterHpFor(0)).toBe(2);
    expect(monsterHpFor(3)).toBe(3);
    expect(monsterHpFor(12)).toBe(5);
    expect(initialBattle(3)).toEqual({ monsterHp: 3, monsterMaxHp: 3, hearts: MAX_HEARTS, asked: 0, correct: 0 });
  });

  it('wins when the monster runs out of HP', () => {
    let b = initialBattle(2);
    b = applyAnswer(b, true);
    expect(battleOutcome(b)).toBeNull();
    b = applyAnswer(b, false);
    b = applyAnswer(b, true);
    expect(battleOutcome(b)).toBe('won');
    expect(b).toMatchObject({ monsterHp: 0, hearts: MAX_HEARTS - 1, asked: 3, correct: 2 });
    expect(questScore(b)).toBe(67);
  });

  it('loses when the hero runs out of hearts, and ignores answers after the end', () => {
    let b = initialBattle(5);
    for (let i = 0; i < MAX_HEARTS; i++) b = applyAnswer(b, false);
    expect(battleOutcome(b)).toBe('lost');
    expect(applyAnswer(b, true)).toBe(b);
    expect(questScore(b)).toBe(0);
  });

  it('scores 0 before any question is asked', () => {
    expect(questScore(initialBattle(3))).toBe(0);
  });
});

describe('animation curves', () => {
  it('pulse arcs 0 → 1 → 0 and is 0 outside its window', () => {
    expect(pulse(100, null, 400)).toBe(0);
    expect(pulse(100, 200, 400)).toBe(0);
    expect(pulse(400, 200, 400)).toBeCloseTo(1);
    expect(pulse(600, 200, 400)).toBe(0);
  });

  it('ramp climbs to 1 and holds', () => {
    expect(ramp(100, null, 400)).toBe(0);
    expect(ramp(300, 200, 400)).toBeCloseTo(0.25);
    expect(ramp(9_000, 200, 400)).toBe(1);
  });
});
