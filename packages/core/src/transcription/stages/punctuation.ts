import type { TranscriptSegment } from '@studdybuddy/shared';
import type { TranscriptStage } from '../types';
import type { ChatRequest, ChatResult } from '../../ai/types';

/**
 * The slice of the AI facade the punctuation stage needs. Kept narrow so a
 * caller can pass either the real {@link import('../../ai/types').AIFacade} or
 * a tiny offline stub without pulling in structured generation.
 */
export interface PunctuationAI {
  available(): Promise<boolean>;
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** Fraction of unpunctuated segments above which AI restoration is worthwhile. */
const RESTORE_THRESHOLD = 0.3;

/** Target characters per AI batch, to keep prompts small and reliable. */
const BATCH_CHARS = 3000;

/** True when the text already ends with sentence-terminal punctuation. */
function hasTerminalPunctuation(text: string): boolean {
  return /[.!?…]$/.test(text.trim());
}

/** Cheap, offline normalization: capitalize the first letter, ensure a period. */
function normalize(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  let out = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (!hasTerminalPunctuation(out)) out += '.';
  return out;
}

/**
 * Indices of segments carrying restorable prose. Pauses have no text, and
 * headings are already cleaned, title-cased labels — neither should be
 * punctuation-restored.
 */
function restorableIndices(segments: TranscriptSegment[]): number[] {
  const indices: number[] = [];
  segments.forEach((segment, i) => {
    if (segment.kind !== 'pause' && segment.kind !== 'heading' && segment.text.trim().length > 0) {
      indices.push(i);
    }
  });
  return indices;
}

/** Group restorable indices into batches of roughly {@link BATCH_CHARS} chars. */
function batchIndices(segments: TranscriptSegment[], indices: number[]): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let size = 0;
  for (const i of indices) {
    const len = (segments[i]?.text.length ?? 0) + 4;
    if (current.length > 0 && size + len > BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Ask the model to restore punctuation/capitalization for one batch, returning
 * a map of batch-position → corrected text. Returns null on any protocol
 * violation (wrong line count, unparsable lines) so the caller can fall back to
 * the original text for the whole batch rather than trust a garbled response.
 */
async function restoreBatch(
  ai: PunctuationAI,
  texts: string[],
): Promise<Map<number, string> | null> {
  const numbered = texts.map((t, i) => `${i + 1}|${t}`).join('\n');
  const result = await ai.chat({
    messages: [
      {
        role: 'system',
        content:
          'You restore punctuation and capitalization in raw speech-to-text transcripts. ' +
          'Do NOT add, remove, reorder, or reword anything — only fix capitalization and add ' +
          'sentence-ending punctuation. Preserve the numbering exactly.',
      },
      {
        role: 'user',
        content:
          'Each line below is "number|text". Return every line back in the exact same ' +
          '"number|corrected text" format, one per line, same numbers in the same order, ' +
          'with nothing else before or after.\n\n' +
          numbered,
      },
    ],
    temperature: 0,
  });

  const map = new Map<number, string>();
  for (const line of result.text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s*\|(.*)$/);
    if (!match) continue;
    const n = Number(match[1]);
    const corrected = (match[2] ?? '').trim();
    if (n >= 1 && n <= texts.length && corrected.length > 0) map.set(n - 1, corrected);
  }
  // Defensive: only trust a fully-aligned response.
  if (map.size !== texts.length) return null;
  return map;
}

/**
 * Restore punctuation and capitalization across the transcript.
 *
 * Offline-first: when more than {@link RESTORE_THRESHOLD} of the text segments
 * lack terminal punctuation AND the AI facade reports availability, the raw
 * text is batched (~{@link BATCH_CHARS} chars) and sent to the model with a
 * strict numbered protocol; responses are applied defensively, falling back to
 * the original text whenever a batch fails to round-trip. When AI is
 * unavailable (or the transcript is already mostly punctuated) it performs
 * cheap deterministic normalization instead — never a hard failure.
 *
 * This is a finalize-only stage (`live: false`); it never runs on live updates.
 */
export function punctuationStage(ai: PunctuationAI): TranscriptStage {
  return {
    id: 'punctuation',
    live: false,
    process: async (segments) => {
      const restorable = restorableIndices(segments);
      if (restorable.length === 0) return segments;

      const unpunctuated = restorable.filter(
        (i) => !hasTerminalPunctuation(segments[i]?.text ?? ''),
      ).length;
      const needsRestore = unpunctuated / restorable.length > RESTORE_THRESHOLD;

      if (!needsRestore || !(await ai.available())) {
        // Cheap path: normalize prose segments in place; leave pauses and
        // already-cleaned heading labels untouched.
        return segments.map((segment) =>
          segment.kind === 'pause' ||
          segment.kind === 'heading' ||
          segment.text.trim().length === 0
            ? segment
            : { ...segment, text: normalize(segment.text) },
        );
      }

      // AI path: correct each batch, falling back to originals on any mismatch.
      const corrected = new Map<number, string>();
      for (const batch of batchIndices(segments, restorable)) {
        const texts = batch.map((i) => segments[i]?.text ?? '');
        let mapping: Map<number, string> | null = null;
        try {
          mapping = await restoreBatch(ai, texts);
        } catch {
          mapping = null;
        }
        if (!mapping) continue; // keep originals for this batch
        batch.forEach((segmentIndex, positionInBatch) => {
          const value = mapping.get(positionInBatch);
          if (value) corrected.set(segmentIndex, value);
        });
      }

      return segments.map((segment, i) => {
        const value = corrected.get(i);
        return value ? { ...segment, text: value } : segment;
      });
    },
  };
}
