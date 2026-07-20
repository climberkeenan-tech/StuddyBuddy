import type { TranscriptParagraph, TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';

/** Inter-segment silence beyond this (ms) becomes a virtual `pause` segment. */
export const PAUSE_GAP_MS = 2200;

/** Inter-segment silence beyond this (ms) forces a paragraph break. */
export const PARAGRAPH_GAP_MS = 1600;

/** Accumulated sentences beyond which a paragraph is closed even without a gap. */
export const MAX_SENTENCES_PER_PARAGRAPH = 5;

/** Count sentence-ending punctuation; a non-empty run with none counts as one. */
function countSentences(text: string): number {
  const matches = text.match(/[.!?…]+/g);
  const count = matches ? matches.length : 0;
  return count === 0 && text.trim().length > 0 ? 1 : count;
}

/**
 * Pure structural pass: insert virtual `pause` segments for long silences and
 * group the (non-pause) segments into paragraphs. Output segments are
 * re-indexed contiguously from zero, since inserting pauses shifts positions;
 * the returned paragraphs reference the re-indexed segment ids.
 *
 * Rules:
 * - A gap greater than {@link PAUSE_GAP_MS} inserts a `pause` segment spanning
 *   the silence and (being the longest kind of gap) also breaks the paragraph.
 * - A gap greater than {@link PARAGRAPH_GAP_MS} breaks the paragraph.
 * - A heading always sits alone in its own single-segment paragraph so section
 *   derivation can treat it as a clean boundary.
 * - Otherwise a paragraph closes once it has accumulated
 *   {@link MAX_SENTENCES_PER_PARAGRAPH} sentences.
 *
 * Pause segments belong to no paragraph — they are purely structural markers.
 */
export function paragraphsAndPauses(input: TranscriptSegment[]): {
  segments: TranscriptSegment[];
  paragraphs: TranscriptParagraph[];
} {
  const segments: TranscriptSegment[] = [];
  const paragraphs: TranscriptParagraph[] = [];

  let paraSegmentIds: string[] = [];
  let paraStartMs = 0;
  let paraEndMs = 0;
  let sentenceCount = 0;
  let nextIndex = 0;
  let previous: TranscriptSegment | undefined;

  const flushParagraph = (): void => {
    if (paraSegmentIds.length === 0) return;
    paragraphs.push({
      id: newId(),
      segmentIds: paraSegmentIds,
      startMs: paraStartMs,
      endMs: paraEndMs,
    });
    paraSegmentIds = [];
    sentenceCount = 0;
  };

  for (const segment of input) {
    if (previous) {
      const gap = segment.startMs - previous.endMs;
      if (gap > PAUSE_GAP_MS) {
        flushParagraph();
        segments.push({
          id: newId(),
          index: nextIndex++,
          startMs: previous.endMs,
          endMs: segment.startMs,
          text: '',
          kind: 'pause',
        });
      } else if (gap > PARAGRAPH_GAP_MS) {
        flushParagraph();
      }
    }

    // A heading opens its own paragraph.
    if (segment.kind === 'heading') flushParagraph();

    const placed: TranscriptSegment = { ...segment, index: nextIndex++ };
    segments.push(placed);

    if (paraSegmentIds.length === 0) paraStartMs = placed.startMs;
    paraSegmentIds.push(placed.id);
    paraEndMs = placed.endMs;
    sentenceCount += countSentences(placed.text);

    if (segment.kind === 'heading' || sentenceCount >= MAX_SENTENCES_PER_PARAGRAPH) {
      flushParagraph();
    }
    previous = segment;
  }
  flushParagraph();

  return { segments, paragraphs };
}
