import type { AchievementDef, GamificationState } from '@studdybuddy/shared';

/**
 * The achievement catalog and its unlock conditions.
 *
 * {@link AchievementDef} is a serializable descriptor (it crosses IPC to the
 * renderer), so it deliberately carries no predicate. The *conditions* live in
 * a parallel {@link ACHIEVEMENT_PREDICATES} table keyed by achievement id —
 * functions can't serialize, so this table stays in core and is evaluated by
 * the gamification engine. The two tables are kept exhaustively in sync: every
 * catalog id has a predicate, and vice-versa.
 */

/**
 * Rolling counters the engine maintains to evaluate achievements. Persisted in
 * the kv store under `gamification:counters`. `coursesTouched` is the set of
 * distinct course ids the student has studied in; `nightSessions` counts study
 * events logged late at night (for the Night Owl badge).
 */
export interface GamificationCounters {
  lectures: number;
  quizzes: number;
  quizAces: number;
  cardsReviewed: number;
  examPreps: number;
  asks: number;
  gamesCompleted: number;
  coursesTouched: string[];
  nightSessions: number;
}

/** A fresh, all-zero counter set for a brand-new profile. */
export function defaultCounters(): GamificationCounters {
  return {
    lectures: 0,
    quizzes: 0,
    quizAces: 0,
    cardsReviewed: 0,
    examPreps: 0,
    asks: 0,
    gamesCompleted: 0,
    coursesTouched: [],
    nightSessions: 0,
  };
}

/**
 * The achievement catalog. Ordered roughly by the journey a student takes, so
 * a UI that renders them in array order reads as a natural progression.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-lecture',
    name: 'First Day of School',
    description: 'Record your very first lecture.',
    icon: 'graduation-cap',
    xp: 20,
    tier: 'bronze',
  },
  {
    id: 'lectures-5',
    name: 'Getting the Hang of It',
    description: 'Record 5 lectures.',
    icon: 'notebook-pen',
    xp: 40,
    tier: 'silver',
  },
  {
    id: 'lectures-15',
    name: 'Lecture Veteran',
    description: 'Record 15 lectures.',
    icon: 'library',
    xp: 100,
    tier: 'gold',
  },
  {
    id: 'first-quiz',
    name: 'Pop Quiz',
    description: 'Complete your first quiz.',
    icon: 'list-checks',
    xp: 20,
    tier: 'bronze',
  },
  {
    id: 'quiz-aced',
    name: 'Top of the Class',
    description: 'Ace a quiz with 90% or higher.',
    icon: 'award',
    xp: 60,
    tier: 'silver',
  },
  {
    id: 'first-exam-prep',
    name: 'Exam Ready',
    description: 'Generate your first exam-prep plan.',
    icon: 'clipboard-check',
    xp: 50,
    tier: 'silver',
  },
  {
    id: 'streak-3',
    name: 'On a Roll',
    description: 'Study 3 days in a row.',
    icon: 'flame',
    xp: 30,
    tier: 'bronze',
  },
  {
    id: 'streak-7',
    name: 'Week Warrior',
    description: 'Keep a 7-day study streak.',
    icon: 'calendar-check',
    xp: 70,
    tier: 'silver',
  },
  {
    id: 'streak-30',
    name: 'Unstoppable',
    description: 'Maintain a 30-day study streak.',
    icon: 'trophy',
    xp: 150,
    tier: 'gold',
  },
  {
    id: 'cards-25',
    name: 'Flashcard Fledgling',
    description: 'Review 25 flashcards.',
    icon: 'layers',
    xp: 25,
    tier: 'bronze',
  },
  {
    id: 'cards-100',
    name: 'Memory Machine',
    description: 'Review 100 flashcards.',
    icon: 'brain',
    xp: 60,
    tier: 'silver',
  },
  {
    id: 'cards-500',
    name: 'Total Recall',
    description: 'Review 500 flashcards.',
    icon: 'brain-circuit',
    xp: 150,
    tier: 'gold',
  },
  {
    id: 'three-courses',
    name: 'Renaissance Student',
    description: 'Study across 3 different courses.',
    icon: 'shapes',
    xp: 60,
    tier: 'silver',
  },
  {
    id: 'first-search',
    name: 'Curious Mind',
    description: 'Ask your lectures a question for the first time.',
    icon: 'search',
    xp: 20,
    tier: 'bronze',
  },
  {
    id: 'first-game',
    name: 'Game On',
    description: 'Finish your first study game.',
    icon: 'gamepad-2',
    xp: 25,
    tier: 'bronze',
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Study during the small hours of the night.',
    icon: 'moon-star',
    xp: 30,
    tier: 'bronze',
  },
  {
    id: 'level-5',
    name: 'Rising Scholar',
    description: 'Reach level 5.',
    icon: 'star',
    xp: 50,
    tier: 'silver',
  },
  {
    id: 'level-10',
    name: "Dean's List",
    description: 'Reach level 10.',
    icon: 'crown',
    xp: 120,
    tier: 'gold',
  },
] as const;

/**
 * Unlock condition for each catalog entry, evaluated against the live counters
 * and the current gamification state (for streak- and level-based badges).
 */
export const ACHIEVEMENT_PREDICATES: Record<
  string,
  (counters: GamificationCounters, state: GamificationState) => boolean
> = {
  'first-lecture': (c) => c.lectures >= 1,
  'lectures-5': (c) => c.lectures >= 5,
  'lectures-15': (c) => c.lectures >= 15,
  'first-quiz': (c) => c.quizzes >= 1,
  'quiz-aced': (c) => c.quizAces >= 1,
  'first-exam-prep': (c) => c.examPreps >= 1,
  'streak-3': (_c, s) => s.streak.current >= 3 || s.streak.best >= 3,
  'streak-7': (_c, s) => s.streak.current >= 7 || s.streak.best >= 7,
  'streak-30': (_c, s) => s.streak.current >= 30 || s.streak.best >= 30,
  'cards-25': (c) => c.cardsReviewed >= 25,
  'cards-100': (c) => c.cardsReviewed >= 100,
  'cards-500': (c) => c.cardsReviewed >= 500,
  'three-courses': (c) => c.coursesTouched.length >= 3,
  'first-search': (c) => c.asks >= 1,
  'first-game': (c) => c.gamesCompleted >= 1,
  'night-owl': (c) => c.nightSessions >= 1,
  'level-5': (_c, s) => s.level >= 5,
  'level-10': (_c, s) => s.level >= 10,
};

/** Look up a catalog entry by id. */
export function findAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
