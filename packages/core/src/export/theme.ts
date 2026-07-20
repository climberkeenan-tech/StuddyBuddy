import type { SlideDeck } from '@studdybuddy/shared';

/**
 * Shared visual language for the file exporters (PPTX + PDF).
 *
 * Slides carry an `accent` that is either one of the five accent *tokens* the
 * app uses (`primary`, `amber`, …) or a raw `#rrggbb` course color. Exporters
 * are headless and never see the course object, so this module owns the
 * token→hex mapping and the fallback, keeping the two renderers visually
 * consistent. The palette is a dark "premium" theme: a deep indigo canvas with
 * bright, legible accents.
 */

/** Dark canvas background shared by every exported slide. */
export const DECK_BG = '#0F1222';
/** Panel/card surface one step lighter than the canvas. */
export const DECK_SURFACE = '#1A1E36';
/** Primary body text on the dark canvas. */
export const TEXT_PRIMARY = '#F2F3FB';
/** Muted secondary text (subtitles, notes, captions). */
export const TEXT_MUTED = '#A6ABC8';

/** Accent token → hex. Mirrors the tokens in the slides schema. */
export const ACCENT_HEX: Record<string, string> = {
  primary: '#8b7cff',
  amber: '#f5b301',
  rose: '#fb7185',
  emerald: '#34d399',
  sky: '#38bdf8',
};

/** Fallback accent when a slide has neither a known token nor a hex color. */
export const DEFAULT_ACCENT = '#8b7cff';

/**
 * Resolve a slide's `accent` to a concrete `#rrggbb` string: a known token maps
 * through {@link ACCENT_HEX}, a hex value is normalized and passed through, and
 * anything else falls back to the deck's own default accent.
 */
export function resolveAccent(accent: string | undefined, fallback = DEFAULT_ACCENT): string {
  if (!accent) return fallback;
  const token = ACCENT_HEX[accent];
  if (token) return token;
  const hex = accent.trim().match(/^#?([0-9a-fA-F]{6})$/);
  const group = hex?.[1];
  return group ? `#${group.toLowerCase()}` : fallback;
}

/** A stable fallback accent for a whole deck, derived from its first accented slide. */
export function deckAccent(deck: SlideDeck): string {
  for (const slide of deck.slides) {
    if (slide.accent) return resolveAccent(slide.accent);
  }
  return DEFAULT_ACCENT;
}

/** Strip a leading `#` — pptxgenjs wants bare 6-digit hex. */
export function bareHex(color: string): string {
  return color.replace(/^#/, '').toLowerCase();
}

/** Convert `#rrggbb` (or bare hex) to a 0..1 RGB triple for pdf-lib's `rgb()`. */
export function hexToRgb01(color: string): { r: number; g: number; b: number } {
  const hex = color.replace(/^#/, '');
  const int = parseInt(hex.length === 6 ? hex : '8b7cff', 16);
  return {
    r: ((int >> 16) & 0xff) / 255,
    g: ((int >> 8) & 0xff) / 255,
    b: (int & 0xff) / 255,
  };
}
