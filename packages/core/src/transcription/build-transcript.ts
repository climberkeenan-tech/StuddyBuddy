import type {
  Transcript,
  TranscriptSection,
  TranscriptSegment,
} from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';
import { paragraphsAndPauses } from './stages/paragraphs';

export interface BuildTranscriptOptions {
  lectureId: string;
  /**
   * Segments with their kinds already assigned by the heuristic stages
   * (headings/questions). This function adds only structure (pauses,
   * paragraphs, sections) — it does not re-tag segments.
   */
  segments: TranscriptSegment[];
  language: string;
  engine: string;
}

/** Title used for the leading section when a lecture doesn't open with a heading. */
const DEFAULT_SECTION_TITLE = 'Introduction';

/**
 * Assemble a complete {@link Transcript} from tagged segments.
 *
 * Runs the structural {@link paragraphsAndPauses} pass, then derives sections
 * by walking the paragraphs: a heading paragraph opens a new section titled by
 * the heading text, and every following paragraph accumulates into it until the
 * next heading. Content before the first heading falls under "Introduction".
 */
export function buildTranscript(options: BuildTranscriptOptions): Transcript {
  const { lectureId, language, engine } = options;
  const { segments, paragraphs } = paragraphsAndPauses(options.segments);

  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const sections: TranscriptSection[] = [];
  let current: TranscriptSection | undefined;

  for (const paragraph of paragraphs) {
    const firstId = paragraph.segmentIds[0];
    const first = firstId ? segmentById.get(firstId) : undefined;

    if (first && first.kind === 'heading') {
      current = {
        id: newId(),
        title: first.text || DEFAULT_SECTION_TITLE,
        startMs: paragraph.startMs,
        endMs: paragraph.endMs,
        paragraphIds: [paragraph.id],
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: newId(),
        title: DEFAULT_SECTION_TITLE,
        startMs: paragraph.startMs,
        endMs: paragraph.endMs,
        paragraphIds: [],
      };
      sections.push(current);
    }
    current.paragraphIds.push(paragraph.id);
    current.endMs = paragraph.endMs;
  }

  return {
    lectureId,
    segments,
    paragraphs,
    sections,
    language,
    engine,
    updatedAt: Date.now(),
  };
}
