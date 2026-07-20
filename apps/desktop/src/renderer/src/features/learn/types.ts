import type { GameStat } from './GameShell';
import type { GameKind } from './lib';

/**
 * The payload a mini-game emits when a round finishes. The hub turns this into
 * a gamification event, an XP toast, and a persisted best score.
 */
export interface GameCompletion {
  /** 0..100 headline percentage used for the score ring and best-score tracking. */
  scorePct: number;
  /** Short human summary, e.g. "6 of 6 matched in 0:42". */
  headline: string;
  /** Per-game breakdown shown on the results screen. */
  stats: GameStat[];
  /** Structured payload persisted on the StudyEvent (game kind, score…). */
  data?: Record<string, unknown> & { game: GameKind };
}
