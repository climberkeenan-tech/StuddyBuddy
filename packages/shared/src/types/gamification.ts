import type { EntityId, Timestamp } from './common';

/**
 * Progress tracking, achievements, badges, and streaks that make studying
 * feel like a game instead of a chore.
 */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Icon name (lucide). */
  icon: string;
  /** XP awarded when unlocked. */
  xp: number;
  /** Rarity tier controls badge styling. */
  tier: 'bronze' | 'silver' | 'gold';
}

export interface UnlockedAchievement {
  achievementId: string;
  unlockedAt: Timestamp;
}

export interface StudyStreak {
  /** Consecutive days with at least one study action. */
  current: number;
  best: number;
  /** Day key "YYYY-MM-DD" of the last counted study day (local time). */
  lastStudyDay: string;
}

export interface GamificationState {
  xp: number;
  level: number;
  streak: StudyStreak;
  unlocked: UnlockedAchievement[];
  /** Total minutes spent in study activities, all time. */
  studyMinutes: number;
  /** Minutes per day for the last 14 days, keyed "YYYY-MM-DD". */
  dailyMinutes: Record<string, number>;
  updatedAt: Timestamp;
}

/** Events that earn XP / advance streaks. Emitted by features, consumed by the engine. */
export type StudyEventType =
  | 'lecture-recorded'
  | 'notes-generated'
  | 'flashcard-reviewed'
  | 'quiz-completed'
  | 'quiz-aced' // score >= 90%
  | 'concept-explained'
  | 'game-completed'
  | 'exam-prep-generated'
  | 'search-asked';

export interface StudyEvent {
  type: StudyEventType;
  at: Timestamp;
  courseId?: EntityId;
  lectureId?: EntityId;
  /** Minutes of active study this event represents. */
  minutes?: number;
  /** Extra payload, e.g. quiz score. */
  data?: Record<string, unknown>;
}
