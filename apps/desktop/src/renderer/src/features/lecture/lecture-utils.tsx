import { Fragment, type ReactNode } from 'react';
import {
  AlertTriangle,
  BookA,
  BookMarked,
  BookOpen,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Layers,
  Library,
  Lightbulb,
  ListChecks,
  NotebookPen,
  PencilLine,
  ScrollText,
  Sigma,
  Sparkles,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { BadgeVariant } from '@renderer/components/ui';
import type { Difficulty, LectureStatus, MaterialType, NoteBlockType } from '@studdybuddy/shared';

/** Status pill metadata for a lecture. */
export function statusMeta(status: LectureStatus): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'recording':
      return { label: 'Recording', variant: 'rose' };
    case 'processing':
      return { label: 'Processing', variant: 'amber' };
    case 'ready':
      return { label: 'Ready', variant: 'success' };
    case 'failed':
      return { label: 'Needs attention', variant: 'rose' };
    default:
      return { label: status, variant: 'neutral' };
  }
}

/** Badge variant for a study-material difficulty. */
export function difficultyVariant(difficulty: Difficulty): BadgeVariant {
  return difficulty === 'easy' ? 'success' : difficulty === 'medium' ? 'amber' : 'rose';
}

/** Human label + lucide icon for each study-material type. */
export const MATERIAL_META: Record<MaterialType, { label: string; icon: LucideIcon }> = {
  notes: { label: 'Study notes', icon: NotebookPen },
  'summary-concise': { label: 'Concise summary', icon: FileText },
  'summary-detailed': { label: 'Detailed summary', icon: FileText },
  'study-guide': { label: 'Study guide', icon: BookOpen },
  flashcards: { label: 'Flashcards', icon: Layers },
  'quiz-mcq': { label: 'Multiple-choice quiz', icon: ListChecks },
  'quiz-short-answer': { label: 'Short-answer quiz', icon: PencilLine },
  'practice-test': { label: 'Practice test', icon: ClipboardCheck },
  'review-sheet': { label: 'Review sheet', icon: ScrollText },
  'cheat-sheet': { label: 'Cheat sheet', icon: Zap },
  vocabulary: { label: 'Vocabulary', icon: BookA },
  glossary: { label: 'Glossary', icon: Library },
};

/** Accent token classes for note callout blocks, keyed by NoteBlock.accent value. */
const ACCENTS: Record<string, { icon: string; ring: string; tint: string }> = {
  primary: { icon: 'text-primary', ring: 'border-primary/30', tint: 'bg-primary/8' },
  amber: { icon: 'text-amber', ring: 'border-amber/30', tint: 'bg-amber/8' },
  rose: { icon: 'text-rose', ring: 'border-rose/30', tint: 'bg-rose/8' },
  sky: { icon: 'text-sky', ring: 'border-sky/30', tint: 'bg-sky/8' },
  emerald: { icon: 'text-success', ring: 'border-success/30', tint: 'bg-success/8' },
  success: { icon: 'text-success', ring: 'border-success/30', tint: 'bg-success/8' },
};

/** Default accent + icon per callout block type, overridable by the block itself. */
const CALLOUT_DEFAULTS: Partial<Record<NoteBlockType, { icon: LucideIcon; accent: string; label: string }>> = {
  definition: { icon: BookMarked, accent: 'sky', label: 'Definition' },
  example: { icon: Lightbulb, accent: 'emerald', label: 'Example' },
  warning: { icon: AlertTriangle, accent: 'amber', label: 'Heads up' },
  mistake: { icon: TriangleAlert, accent: 'rose', label: 'Common mistake' },
  fact: { icon: Sparkles, accent: 'primary', label: 'Key fact' },
  formula: { icon: Sigma, accent: 'primary', label: 'Formula' },
};

const ICON_BY_NAME: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  'triangle-alert': TriangleAlert,
  'alert-triangle': AlertTriangle,
  'flask-conical': FlaskConical,
  lightbulb: Lightbulb,
  'book-marked': BookMarked,
  sigma: Sigma,
};

/** Resolve the icon/accent/label to render for a callout note block. */
export function calloutMeta(type: NoteBlockType, icon?: string, accent?: string) {
  const defaults = CALLOUT_DEFAULTS[type] ?? { icon: Sparkles, accent: 'primary', label: '' };
  const Icon = (icon && ICON_BY_NAME[icon]) || defaults.icon;
  const accentKey = accent && ACCENTS[accent] ? accent : defaults.accent;
  const accentClasses = ACCENTS[accentKey] ?? ACCENTS.primary!;
  return { Icon, label: defaults.label, ...accentClasses };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, keywords: string[], keyPrefix: string): ReactNode {
  const terms = keywords.filter(Boolean);
  if (terms.length === 0 || !text) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  const lower = new Set(terms.map((k) => k.toLowerCase()));
  return text.split(re).map((part, i) =>
    lower.has(part.toLowerCase()) ? (
      <mark key={`${keyPrefix}-${i}`} className="rounded bg-primary/15 px-1 font-medium text-primary">
        {part}
      </mark>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    ),
  );
}

export interface InlineTextProps {
  text: string;
  /** Terms to visually highlight (case-insensitive). */
  keywords?: string[];
  className?: string;
}

/**
 * Renders a single line of note text with `**bold**` support and optional
 * keyword highlighting. Dependency-free and safe (no raw HTML).
 */
export function InlineText({ text, keywords = [], className }: InlineTextProps) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i} className="font-semibold text-t1">
            {highlight(part.slice(2, -2), keywords, `b${i}`)}
          </strong>
        ) : (
          <Fragment key={i}>{highlight(part, keywords, `p${i}`)}</Fragment>
        ),
      )}
    </span>
  );
}

/** Copy text to the clipboard, degrading gracefully where the API is absent. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}
