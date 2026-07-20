import {
  Award,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Flame,
  GraduationCap,
  Layers,
  Lightbulb,
  Mic,
  NotebookPen,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

/**
 * Lucide lookup for the achievement `icon` strings shipped by the backend.
 * Falls back to a generic award glyph so an unknown icon never breaks the strip.
 */
const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  mic: Mic,
  'notebook-pen': NotebookPen,
  flame: Flame,
  target: Target,
  layers: Layers,
  sparkles: Sparkles,
  'graduation-cap': GraduationCap,
  'clipboard-check': ClipboardCheck,
};

/** Resolve an achievement icon key to its lucide component (defaults to Award). */
export function achievementIcon(key: string): LucideIcon {
  return ACHIEVEMENT_ICONS[key] ?? Award;
}

/**
 * Choose a glyph for an AI recommendation based on how deeply it links: a
 * specific lecture gets a book, a course-wide tip an exam clock, and a plain
 * nudge a lightbulb.
 */
export function recommendationIcon(rec: { lectureId?: string; courseId?: string }): LucideIcon {
  if (rec.lectureId) return BookOpen;
  if (rec.courseId) return CalendarClock;
  return Lightbulb;
}
