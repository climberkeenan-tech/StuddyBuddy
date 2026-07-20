import type { EntityId, Timestamp } from './common';
import type { Course, Lecture } from './entities';

/** Aggregated data for the home dashboard. */
export interface DashboardSummary {
  /** Courses ordered by most recent activity. */
  courses: Course[];
  recentLectures: (Lecture & { courseName: string; courseColor: string })[];
  /** Flashcards due for review right now, per course. */
  dueReviews: { courseId: EntityId; courseName: string; dueCards: number }[];
  /** Upcoming exams within 30 days. */
  upcomingExams: { courseId: EntityId; courseName: string; date: Timestamp }[];
  studyStreak: number;
  xp: number;
  level: number;
  studyMinutesToday: number;
  studyMinutesWeek: number;
  /** Short AI-generated (or heuristic) suggestions, e.g. "Review Lecture 3 weak areas". */
  recommendations: { title: string; detail: string; courseId?: EntityId; lectureId?: EntityId }[];
}
