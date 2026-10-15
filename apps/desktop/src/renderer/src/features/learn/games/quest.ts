/**
 * Pure state + geometry for Monster Quest: the hero's walk physics, the
 * camera, the limb poses that drive the walking animation, and the battle
 * rules. Framework-free so the game component stays thin and all of it is
 * unit-testable.
 *
 * Coordinates are SVG user units. The world is a side-scrolling strip
 * `WORLD_W` wide; the scene shows a `VIEW_W` × `VIEW_H` window onto it.
 */

export const VIEW_W = 800;
export const VIEW_H = 320;
/** World y of the walkable ground line (the hero's and monster's feet). */
export const GROUND_Y = 262;
export const WORLD_W = 1400;

/** Far enough from the left edge that the sword stays in view when the hero faces left. */
export const HERO_MIN_X = 52;
export const HERO_START_X = 90;
export const MONSTER_X = 1230;
/** How close (world px) the hero gets before the monster blocks the path. */
export const ENCOUNTER_GAP = 125;
export const ENCOUNTER_X = MONSTER_X - ENCOUNTER_GAP;

/** Walking speed in world px per second. */
export const HERO_SPEED = 220;
/** World px covered by one full walk cycle (two steps). */
export const STRIDE_PX = 96;
/** Longest frame step honored, so a stalled tab can't teleport the hero. */
export const MAX_STEP_MS = 100;

export const MAX_HEARTS = 3;

export type Facing = 1 | -1;
export type WalkDir = -1 | 0 | 1;

export interface HeroState {
  /** World x of the hero's feet. */
  x: number;
  facing: Facing;
  /** Radians through the current walk cycle; drives the limb swing. */
  walkPhase: number;
  walking: boolean;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function initialHero(): HeroState {
  return { x: HERO_START_X, facing: 1, walkPhase: 0, walking: false };
}

/**
 * Advance the hero one frame in `dir`. The walk phase advances with distance
 * actually covered, so the legs stop the moment the hero is blocked.
 */
export function stepHero(hero: HeroState, dir: WalkDir, dtMs: number): HeroState {
  if (dir === 0) return hero.walking ? { ...hero, walking: false } : hero;
  const dt = clamp(dtMs, 0, MAX_STEP_MS) / 1000;
  const x = clamp(hero.x + dir * HERO_SPEED * dt, HERO_MIN_X, ENCOUNTER_X);
  const moved = Math.abs(x - hero.x);
  return {
    x,
    facing: dir,
    walking: moved > 0,
    walkPhase: (hero.walkPhase + (moved / STRIDE_PX) * Math.PI * 2) % (Math.PI * 2),
  };
}

export function hasReachedMonster(x: number): boolean {
  return x >= ENCOUNTER_X - 0.5;
}

/** 0..1 progress of the walk from the start to the encounter point. */
export function walkProgress(x: number): number {
  return clamp((x - HERO_START_X) / (ENCOUNTER_X - HERO_START_X), 0, 1);
}

/** Left edge of the visible window: follows the hero, clamped to the world. */
export function cameraX(heroX: number): number {
  return clamp(heroX - VIEW_W * 0.33, 0, WORLD_W - VIEW_W);
}

/**
 * Limb angles for one frame of the walk cycle, in degrees where positive means
 * swung forward (toward the facing direction), plus the vertical body bob in
 * px (negative is up).
 */
export interface WalkPose {
  frontLeg: number;
  backLeg: number;
  frontArm: number;
  backArm: number;
  bob: number;
}

export function walkPose(phase: number, walking: boolean): WalkPose {
  if (!walking) return { frontLeg: 0, backLeg: 0, frontArm: 0, backArm: 0, bob: 0 };
  const s = Math.sin(phase);
  return {
    frontLeg: s * 30,
    backLeg: -s * 30,
    // Each arm counter-swings against the leg on its side.
    frontArm: -s * 24,
    backArm: s * 24,
    // The body rises as the legs pass under it and dips at full stride.
    bob: -Math.abs(Math.cos(phase)) * 3,
  };
}

export interface BattleState {
  monsterHp: number;
  monsterMaxHp: number;
  hearts: number;
  asked: number;
  correct: number;
}

export type BattleOutcome = 'won' | 'lost' | null;

/** One hit per available question, kept between 2 and 5 so a fight stays short. */
export function monsterHpFor(questionCount: number): number {
  return clamp(Math.round(questionCount), 2, 5);
}

export function initialBattle(questionCount: number): BattleState {
  const hp = monsterHpFor(questionCount);
  return { monsterHp: hp, monsterMaxHp: hp, hearts: MAX_HEARTS, asked: 0, correct: 0 };
}

export function battleOutcome(b: BattleState): BattleOutcome {
  if (b.monsterHp <= 0) return 'won';
  if (b.hearts <= 0) return 'lost';
  return null;
}

/** A correct answer lands a hit on the monster; a wrong one costs the hero a heart. */
export function applyAnswer(b: BattleState, correct: boolean): BattleState {
  if (battleOutcome(b)) return b;
  return correct
    ? { ...b, asked: b.asked + 1, correct: b.correct + 1, monsterHp: b.monsterHp - 1 }
    : { ...b, asked: b.asked + 1, hearts: b.hearts - 1 };
}

/** Accuracy over every question asked, as a 0..100 score. */
export function questScore(b: BattleState): number {
  return b.asked > 0 ? Math.round((b.correct / b.asked) * 100) : 0;
}

/** 0 → 1 → 0 arc over `durationMs` after `start`; 0 outside it. Drives lunges and flashes. */
export function pulse(now: number, start: number | null, durationMs: number): number {
  if (start === null) return 0;
  const p = (now - start) / durationMs;
  return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);
}

/** 0 → 1 ramp over `durationMs` after `start`, held at 1 afterwards. */
export function ramp(now: number, start: number | null, durationMs: number): number {
  if (start === null) return 0;
  return clamp((now - start) / durationMs, 0, 1);
}
