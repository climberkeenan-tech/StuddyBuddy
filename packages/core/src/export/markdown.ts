import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Slide, SlideDeck } from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { SlideExporter } from './types';

/**
 * Renders a deck to a single GitHub-Flavored Markdown document.
 *
 * Every slide becomes a `##` heading; Mermaid diagrams are emitted in
 * ```mermaid fenced blocks (so they render on GitHub, in Obsidian, and in the
 * app), quotes use blockquotes, timelines and columns become lists, and charts
 * become a small table. Speaker notes are appended consistently as a
 * `> **Speaker notes:** …` blockquote.
 */
export class MarkdownExporter implements SlideExporter {
  readonly format = 'markdown' as const;
  readonly name = 'Markdown';

  async export(deck: SlideDeck, outPath: string, meta: { courseName: string }): Promise<string> {
    try {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, renderDeckMarkdown(deck, meta.courseName), 'utf8');
      return outPath;
    } catch (e) {
      throw new SbError(ErrorCodes.EXPORT_FAILED, 'Failed to write Markdown export.', { cause: e });
    }
  }
}

/**
 * Render a deck to Markdown. Exported so the NotebookLM bundle can reuse the
 * exact same slide rendering and only add its own appendix.
 */
export function renderDeckMarkdown(deck: SlideDeck, courseName: string): string {
  const out: string[] = [`# ${deck.title}`, '', `*${courseName}*`, ''];
  for (const slide of deck.slides) {
    out.push(...renderSlide(slide));
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function renderSlide(slide: Slide): string[] {
  const lines: string[] = [`## ${slide.title}`, ''];
  if (slide.subtitle) lines.push(`*${slide.subtitle}*`, '');

  switch (slide.layout) {
    case 'diagram':
      if (slide.mermaid) lines.push('```mermaid', slide.mermaid, '```', '');
      break;
    case 'quote':
      if (slide.quote) {
        lines.push(`> ${slide.quote.text}`);
        if (slide.quote.attribution) lines.push('>', `> — ${slide.quote.attribution}`);
        lines.push('');
      }
      break;
    case 'timeline':
      if (slide.timeline) {
        for (const ev of slide.timeline) lines.push(`- **${ev.label}** — ${ev.description}`);
        lines.push('');
      }
      break;
    case 'two-column':
      if (slide.columns) {
        for (const col of slide.columns) {
          lines.push(`### ${col.heading}`, '');
          for (const b of col.bullets) lines.push(`- ${b}`);
          lines.push('');
        }
      }
      break;
    case 'chart':
      if (slide.chart) lines.push(...renderChartTable(slide.chart));
      break;
    default:
      break;
  }

  // Bullets can accompany any layout (and are the body of `bullets` slides).
  if (slide.bullets && slide.bullets.length > 0) {
    for (const b of slide.bullets) lines.push(`- ${b}`);
    lines.push('');
  }

  lines.push(`> **Speaker notes:** ${slide.speakerNotes.replace(/\n+/g, ' ').trim()}`, '');
  return lines;
}

function renderChartTable(chart: NonNullable<Slide['chart']>): string[] {
  const header = ['Series', ...chart.labels];
  const sep = header.map(() => '---');
  const rows = chart.series.map((s) => [
    s.label,
    ...chart.labels.map((_, i) => String(s.data[i] ?? '')),
  ]);
  const toRow = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [
    `**Chart (${chart.kind}):**`,
    '',
    toRow(header),
    toRow(sep),
    ...rows.map(toRow),
    '',
  ];
}
