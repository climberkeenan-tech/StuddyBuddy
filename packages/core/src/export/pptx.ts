import { promises as fs } from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import type { Slide, SlideChartSpec, SlideDeck } from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { SlideExporter } from './types';
import {
  DECK_BG,
  DECK_SURFACE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  bareHex,
  resolveAccent,
} from './theme';

/** Wide 16:9 layout (13.33" × 7.5"). */
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const MARGIN = 0.7;
const BODY_W = SLIDE_W - MARGIN * 2;

/** Bold display font for titles; Arial is the guaranteed fallback everywhere. */
const TITLE_FONT = 'Sora';
const BODY_FONT = 'Arial';
const MONO_FONT = 'Consolas';

/** Rotating chart series colors (bare hex for pptxgenjs). */
const CHART_PALETTE = ['8b7cff', '38bdf8', '34d399', 'f5b301', 'fb7185', 'c084fc'];

/**
 * Renders a deck to a native PowerPoint file with pptxgenjs — 16:9, a dark
 * "premium" theme (deep-indigo canvas, per-slide accent, bold Sora-ish titles),
 * with each layout mapped to real PowerPoint objects: title/section/bullets/
 * two-column/quote as text, charts via `addChart`, timelines as a styled table,
 * and speaker notes via `addNotes`.
 *
 * Diagram slides are a deliberate, documented limitation: rendering Mermaid to
 * an image requires a browser/headless Chromium, which core must not depend on.
 * The exporter therefore places the Mermaid **source** in a monospaced rounded
 * box with the caption "Diagram renders live in StuddyBuddy", where the app's
 * slideshow view renders it for real.
 */
export class PptxExporter implements SlideExporter {
  readonly format = 'pptx' as const;
  readonly name = 'PowerPoint';

  async export(deck: SlideDeck, outPath: string, _meta: { courseName: string }): Promise<string> {
    try {
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = 'StuddyBuddy';
      pptx.title = deck.title;

      for (const slide of deck.slides) {
        this.renderSlide(pptx, slide);
      }

      const data = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, data);
      return outPath;
    } catch (e) {
      throw new SbError(ErrorCodes.EXPORT_FAILED, 'Failed to write PowerPoint export.', {
        cause: e,
      });
    }
  }

  private renderSlide(pptx: PptxGenJS, slide: Slide): void {
    const accent = bareHex(resolveAccent(slide.accent));
    const s = pptx.addSlide();
    s.background = { color: bareHex(DECK_BG) };
    // Top accent bar.
    s.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.09, fill: { color: accent } });

    switch (slide.layout) {
      case 'title':
        this.renderTitle(s, slide, accent);
        break;
      case 'section':
        this.renderSection(s, slide, accent);
        break;
      case 'quote':
        this.renderQuote(s, slide, accent);
        break;
      case 'timeline':
        this.renderTimeline(s, slide, accent);
        break;
      case 'diagram':
        this.renderDiagram(s, slide, accent);
        break;
      case 'chart':
        this.renderChart(s, slide, accent);
        break;
      case 'two-column':
        this.renderTwoColumn(s, slide, accent);
        break;
      default:
        this.renderBullets(s, slide, accent);
        break;
    }

    s.addNotes(slide.speakerNotes);
  }

  private renderTitle(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    s.addText(slide.title, {
      x: MARGIN,
      y: 2.5,
      w: BODY_W,
      h: 1.8,
      fontSize: 40,
      bold: true,
      color: bareHex(TEXT_PRIMARY),
      fontFace: TITLE_FONT,
      align: 'left',
      valign: 'bottom',
    });
    s.addShape('rect', { x: MARGIN, y: 4.45, w: 1.4, h: 0.06, fill: { color: accent } });
    if (slide.subtitle) {
      s.addText(slide.subtitle, {
        x: MARGIN,
        y: 4.7,
        w: BODY_W,
        h: 1.4,
        fontSize: 18,
        color: bareHex(TEXT_MUTED),
        fontFace: BODY_FONT,
        align: 'left',
        valign: 'top',
      });
    }
  }

  private renderSection(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    s.addText('SECTION', {
      x: MARGIN,
      y: 2.4,
      w: BODY_W,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: accent,
      fontFace: BODY_FONT,
      charSpacing: 3,
    });
    s.addText(slide.title, {
      x: MARGIN,
      y: 2.9,
      w: BODY_W,
      h: 1.5,
      fontSize: 36,
      bold: true,
      color: bareHex(TEXT_PRIMARY),
      fontFace: TITLE_FONT,
      valign: 'top',
    });
    if (slide.subtitle) {
      s.addText(slide.subtitle, {
        x: MARGIN,
        y: 4.4,
        w: BODY_W,
        h: 1,
        fontSize: 18,
        color: bareHex(TEXT_MUTED),
        fontFace: BODY_FONT,
      });
    }
  }

  private renderBullets(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    this.header(s, slide, accent);
    const bullets = slide.bullets ?? [];
    s.addText(
      bullets.map((text) => ({ text, options: { bullet: { indent: 18 }, breakLine: true } })),
      {
        x: MARGIN,
        y: 1.9,
        w: BODY_W,
        h: 4.9,
        fontSize: 18,
        color: bareHex(TEXT_PRIMARY),
        fontFace: BODY_FONT,
        valign: 'top',
        lineSpacingMultiple: 1.3,
        paraSpaceAfter: 8,
      },
    );
  }

  private renderTwoColumn(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    this.header(s, slide, accent);
    const columns = (slide.columns ?? []).slice(0, 2);
    const gap = 0.5;
    const colW = (BODY_W - gap) / 2;
    columns.forEach((column, idx) => {
      const x = MARGIN + idx * (colW + gap);
      s.addText(column.heading, {
        x,
        y: 1.9,
        w: colW,
        h: 0.5,
        fontSize: 20,
        bold: true,
        color: accent,
        fontFace: TITLE_FONT,
      });
      s.addText(
        column.bullets.map((text) => ({ text, options: { bullet: { indent: 16 }, breakLine: true } })),
        {
          x,
          y: 2.45,
          w: colW,
          h: 4.3,
          fontSize: 15,
          color: bareHex(TEXT_PRIMARY),
          fontFace: BODY_FONT,
          valign: 'top',
          lineSpacingMultiple: 1.25,
          paraSpaceAfter: 6,
        },
      );
    });
  }

  private renderQuote(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    const quote = slide.quote;
    if (!quote) return this.renderBullets(s, slide, accent);
    s.addText('“', {
      x: MARGIN,
      y: 1.2,
      w: 2,
      h: 1.4,
      fontSize: 96,
      bold: true,
      color: accent,
      fontFace: TITLE_FONT,
    });
    s.addText(quote.text, {
      x: 1.4,
      y: 2.6,
      w: SLIDE_W - 2.8,
      h: 2.6,
      fontSize: 28,
      italic: true,
      color: bareHex(TEXT_PRIMARY),
      fontFace: BODY_FONT,
      align: 'center',
      valign: 'middle',
    });
    if (quote.attribution) {
      s.addText(`— ${quote.attribution}`, {
        x: 1.4,
        y: 5.4,
        w: SLIDE_W - 2.8,
        h: 0.6,
        fontSize: 18,
        bold: true,
        color: accent,
        fontFace: BODY_FONT,
        align: 'center',
      });
    }
  }

  private renderTimeline(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    this.header(s, slide, accent);
    const events = (slide.timeline ?? []).slice(0, 7);
    const rows: PptxGenJS.TableRow[] = events.map((ev) => [
      {
        text: ev.label,
        options: {
          fill: { color: accent },
          color: bareHex(DECK_BG),
          bold: true,
          fontSize: 14,
          fontFace: TITLE_FONT,
          align: 'center',
          valign: 'middle',
          margin: 4,
        },
      },
      {
        text: ev.description,
        options: {
          fill: { color: bareHex(DECK_SURFACE) },
          color: bareHex(TEXT_PRIMARY),
          fontSize: 13,
          fontFace: BODY_FONT,
          valign: 'middle',
          margin: 6,
        },
      },
    ]);
    if (rows.length === 0) return;
    s.addTable(rows, {
      x: MARGIN,
      y: 1.9,
      w: BODY_W,
      colW: [2, BODY_W - 2],
      border: { type: 'solid', color: bareHex(DECK_BG), pt: 3 },
      autoPage: false,
    });
  }

  private renderDiagram(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    this.header(s, slide, accent);
    s.addShape('roundRect', {
      x: MARGIN,
      y: 1.9,
      w: BODY_W,
      h: 4.4,
      fill: { color: bareHex(DECK_SURFACE) },
      line: { color: accent, width: 1 },
      rectRadius: 0.1,
    });
    s.addText(slide.mermaid ?? '', {
      x: MARGIN + 0.25,
      y: 2.1,
      w: BODY_W - 0.5,
      h: 4,
      fontSize: 11,
      color: bareHex(TEXT_MUTED),
      fontFace: MONO_FONT,
      valign: 'top',
      align: 'left',
    });
    s.addText('Diagram renders live in StuddyBuddy', {
      x: MARGIN,
      y: 6.4,
      w: BODY_W,
      h: 0.4,
      fontSize: 11,
      italic: true,
      color: bareHex(TEXT_MUTED),
      fontFace: BODY_FONT,
    });
  }

  private renderChart(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    this.header(s, slide, accent);
    const chart = slide.chart;
    if (!chart) return;
    const single = chart.kind === 'pie' || chart.kind === 'doughnut';
    const series = single ? chart.series.slice(0, 1) : chart.series;
    const data = series.map((serie) => ({
      name: serie.label,
      labels: chart.labels,
      values: chart.labels.map((_, i) => serie.data[i] ?? 0),
    }));
    s.addChart(chart.kind, data, {
      x: MARGIN,
      y: 1.9,
      w: BODY_W,
      h: 4.7,
      chartColors: single ? chartPalette(chart.labels.length) : chartPalette(series.length),
      showLegend: !single,
      legendPos: 'b',
      legendColor: bareHex(TEXT_MUTED),
      legendFontFace: BODY_FONT,
      showTitle: false,
      showValue: false,
      showPercent: single,
      dataLabelColor: bareHex(TEXT_PRIMARY),
      catAxisLabelColor: bareHex(TEXT_MUTED),
      valAxisLabelColor: bareHex(TEXT_MUTED),
      catGridLine: { style: 'none' },
      valGridLine: { style: 'none', color: bareHex(TEXT_MUTED), size: 1 },
      ...(chart.kind === 'doughnut' ? { holeSize: 55 } : {}),
    });
  }

  /** Standard slide header: accented title + rule. */
  private header(s: PptxGenJS.Slide, slide: Slide, accent: string): void {
    s.addText(slide.title, {
      x: MARGIN,
      y: 0.55,
      w: BODY_W,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: bareHex(TEXT_PRIMARY),
      fontFace: TITLE_FONT,
      valign: 'middle',
    });
    s.addShape('rect', { x: MARGIN, y: 1.4, w: 0.9, h: 0.05, fill: { color: accent } });
    if (slide.subtitle) {
      s.addText(slide.subtitle, {
        x: MARGIN,
        y: 1.42,
        w: BODY_W,
        h: 0.4,
        fontSize: 13,
        color: bareHex(TEXT_MUTED),
        fontFace: BODY_FONT,
        align: 'right',
      });
    }
  }
}

function chartPalette(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, n); i++) {
    out.push(CHART_PALETTE[i % CHART_PALETTE.length] ?? '8b7cff');
  }
  return out;
}
