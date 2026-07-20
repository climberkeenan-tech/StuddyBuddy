import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Slide, SlideDeck } from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { SlideExporter } from './types';
import { renderDeckMarkdown } from './markdown';

/** Target size of the condensed "Lecture context" appendix, in characters. */
const APPENDIX_CHAR_BUDGET = 4000;

/**
 * Exports a deck as a single Markdown source file tuned for Google NotebookLM.
 *
 * The user uploads the resulting `.md` at https://notebooklm.google.com as a
 * source; NotebookLM then grounds its chat, study guide and audio-overview on
 * it. (Users who instead want editable Google Slides should export PPTX and use
 * File → Import in Google Slides.)
 *
 * The file is the full deck rendered to Markdown followed by a condensed
 * "Lecture context" appendix. Because the exporter contract only receives the
 * deck, that appendix is reconstructed from the deck's own section headings,
 * bullets and speaker notes — all of which are derived from the lecture
 * transcript — flowed together and trimmed to {@link APPENDIX_CHAR_BUDGET}
 * characters so NotebookLM has continuous prose to reason over, not just terse
 * slide fragments.
 */
export class NotebookLMExporter implements SlideExporter {
  readonly format = 'notebooklm' as const;
  readonly name = 'NotebookLM source';

  async export(deck: SlideDeck, outPath: string, meta: { courseName: string }): Promise<string> {
    try {
      const body = renderDeckMarkdown(deck, meta.courseName);
      const bundle = [
        body.trimEnd(),
        '',
        '---',
        '',
        '## Lecture context',
        '',
        '_Condensed narration reconstructed from the slides for retrieval-augmented study._',
        '',
        condenseContext(deck),
        '',
      ].join('\n');
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, `${bundle}\n`, 'utf8');
      return outPath;
    } catch (e) {
      throw new SbError(ErrorCodes.EXPORT_FAILED, 'Failed to write NotebookLM export.', {
        cause: e,
      });
    }
  }
}

/**
 * Flow the deck's section headings, bullets and speaker notes into continuous
 * paragraphs, then trim to the character budget on a sentence boundary.
 */
function condenseContext(deck: SlideDeck): string {
  const paragraphs: string[] = [];
  for (const slide of deck.slides) {
    const para = slideToProse(slide);
    if (para) paragraphs.push(para);
  }
  let text = paragraphs.join('\n\n');
  if (text.length > APPENDIX_CHAR_BUDGET) {
    const clipped = text.slice(0, APPENDIX_CHAR_BUDGET);
    const lastStop = Math.max(
      clipped.lastIndexOf('. '),
      clipped.lastIndexOf('.\n'),
      clipped.lastIndexOf('\n\n'),
    );
    text = `${clipped.slice(0, lastStop > 0 ? lastStop + 1 : APPENDIX_CHAR_BUDGET).trimEnd()} …`;
  }
  return text.trim();
}

function slideToProse(slide: Slide): string {
  const parts: string[] = [`**${slide.title}.**`];
  if (slide.subtitle) parts.push(`${slide.subtitle}.`);
  parts.push(slide.speakerNotes.replace(/\s+/g, ' ').trim());
  if (slide.bullets && slide.bullets.length > 0) {
    parts.push(`Key points: ${slide.bullets.join('; ')}.`);
  }
  if (slide.columns) {
    for (const col of slide.columns) parts.push(`${col.heading}: ${col.bullets.join('; ')}.`);
  }
  if (slide.timeline) {
    parts.push(slide.timeline.map((ev) => `${ev.label} — ${ev.description}`).join('; ') + '.');
  }
  if (slide.quote) {
    parts.push(`Quote: "${slide.quote.text}"${slide.quote.attribution ? ` — ${slide.quote.attribution}` : ''}.`);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
