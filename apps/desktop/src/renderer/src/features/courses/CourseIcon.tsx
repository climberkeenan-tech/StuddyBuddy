import {
  Atom,
  BookOpen,
  Brain,
  Calculator,
  Code2,
  Dna,
  FlaskConical,
  Globe2,
  Landmark,
  Leaf,
  Music2,
  Palette,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@renderer/lib/cn';

/**
 * The canonical set of course icons. Keys are the `icon` string stored on a
 * {@link Course}; values are lucide components. Feature code should look icons
 * up here (falling back to `book-open`) rather than importing lucide directly,
 * so the course icon set stays consistent everywhere.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  dna: Dna,
  'flask-conical': FlaskConical,
  atom: Atom,
  landmark: Landmark,
  calculator: Calculator,
  'code-2': Code2,
  'book-open': BookOpen,
  'globe-2': Globe2,
  brain: Brain,
  'music-2': Music2,
  palette: Palette,
  leaf: Leaf,
};

/** Ordered icon keys for pickers. */
export const ICON_KEYS = Object.keys(ICON_MAP);

/** Eight curated course accent colors (hex), used by the color picker + seeds. */
export const COURSE_COLORS = [
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#d97706', // amber
  '#e11d48', // rose
  '#059669', // emerald
  '#2563eb', // blue
  '#db2777', // pink
  '#65a30d', // lime
] as const;

export type CourseColor = (typeof COURSE_COLORS)[number];

export interface CourseIconProps {
  /** Icon key (falls back to `book-open` when unknown). */
  icon: string;
  /** Course accent color (hex). Tints the tile background + icon. */
  color: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TILE = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-xl', lg: 'h-14 w-14 rounded-2xl' } as const;
const GLYPH = { sm: 16, md: 20, lg: 26 } as const;

/**
 * Renders a course's icon in a color-tinted rounded tile. The background uses
 * the course color at low opacity with the glyph in the full color, so it reads
 * clearly in both light and dark themes.
 */
export function CourseIcon({ icon, color, size = 'md', className }: CourseIconProps) {
  const Icon = ICON_MAP[icon] ?? BookOpen;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', TILE[size], className)}
      style={{ backgroundColor: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <Icon size={GLYPH[size]} strokeWidth={2.1} />
    </span>
  );
}
