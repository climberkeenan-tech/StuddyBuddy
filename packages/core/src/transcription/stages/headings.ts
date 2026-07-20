import type { TranscriptSegment } from '@studdybuddy/shared';
import type { TranscriptStage } from '../types';

/**
 * Discourse markers that, at the very start of a short utterance, signal the
 * professor is opening a new topic. Matched case-insensitively against the
 * trimmed segment text.
 */
const HEADING_MARKERS = [
  'now let\'s',
  'moving on',
  'today we',
  "let's talk about",
  'okay',
  'alright',
  'next',
  'chapter',
  'section',
];

/** Longest heading utterance (chars) — real headings are short topic labels. */
const MAX_HEADING_CHARS = 90;

/** Short words kept lowercase inside a title (unless they lead it). */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'and',
  'or',
  'for',
  'with',
  'but',
  'nor',
  'as',
  'at',
  'by',
  'vs',
  'per',
  'from',
]);

/** Lead-in phrases stripped from a heading before it becomes a section title. */
const LEAD_INS: RegExp[] = [
  /^okay[,!.]?\s+/i,
  /^ok[,!.]?\s+/i,
  /^alright[,!.]?\s+/i,
  /^all right[,!.]?\s+/i,
  /^so[,]?\s+/i,
  /^well[,]?\s+/i,
  /^now[,]?\s+/i,
  /^next[,]?\s+/i,
  /^today[,]?\s+/i,
  /^let's talk about\s+/i,
  /^let's discuss\s+/i,
  /^let's look at\s+/i,
  /^let's meet\s+/i,
  /^let's\s+/i,
  /^moving on to\s+/i,
  /^moving on[,]?\s+/i,
  /^we're going to talk about\s+/i,
  /^we're going to\s+/i,
  /^we'll\s+/i,
  /^we\s+/i,
  /^turning to\s+/i,
];

/** Title-case a phrase, preserving existing acronyms/mixed-case (DNA, PCR). */
function titleCase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((word, i) => {
      // Keep tokens that already carry internal/all uppercase (acronyms).
      if (/[A-Z]/.test(word.slice(1)) || /^[A-Z]+$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (i !== 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Turn a raw heading utterance into a clean section title: drop the trailing
 * punctuation, strip leading discourse fillers ("okay, let's talk about …"),
 * then title-case what remains. "Chapter"/"Section" openings are kept intact.
 */
export function cleanHeadingTitle(text: string): string {
  const stripped = text.trim().replace(/[.?!…]+$/, '');
  if (/^(chapter|section)\b/i.test(stripped)) return titleCase(stripped);

  let body = stripped;
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of LEAD_INS) {
      const next = body.replace(re, '');
      if (next !== body && next.trim().length > 0) {
        body = next.trim();
        changed = true;
        break;
      }
    }
  }
  const title = titleCase(body);
  return title.length > 0 ? title : titleCase(stripped);
}

/** True when a short speech segment opens with a topic-shift discourse marker. */
function looksLikeHeading(segment: TranscriptSegment): boolean {
  if (segment.kind !== 'speech') return false;
  if (segment.text.trim().length >= MAX_HEADING_CHARS) return false;
  const lower = segment.text.trim().toLowerCase();
  return HEADING_MARKERS.some((marker) => lower.startsWith(marker));
}

/**
 * Cheap, deterministic heading detector (safe to run live on each update).
 * A short utterance beginning with a discourse marker becomes a `heading`
 * segment whose `.text` is the cleaned, title-cased topic label used for
 * section titles. All other segments pass through untouched.
 */
export function headingsStage(): TranscriptStage {
  return {
    id: 'headings',
    live: true,
    process: async (segments) =>
      segments.map((segment) =>
        looksLikeHeading(segment)
          ? { ...segment, kind: 'heading' as const, text: cleanHeadingTitle(segment.text) }
          : segment,
      ),
  };
}
