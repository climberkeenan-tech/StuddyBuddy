/**
 * XP → level math shared by the sidebar widget, dashboard, and mock data.
 * Levels are a flat curve: every LEVEL_XP points advances one level.
 */
export const LEVEL_XP = 500;

/** 1-based level for a total XP amount. */
export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / LEVEL_XP) + 1;
}

/** Progress within the current level, 0..1. */
export function levelProgress(xp: number): number {
  return (Math.max(0, xp) % LEVEL_XP) / LEVEL_XP;
}

/** XP still needed to reach the next level. */
export function xpToNextLevel(xp: number): number {
  return LEVEL_XP - (Math.max(0, xp) % LEVEL_XP);
}
