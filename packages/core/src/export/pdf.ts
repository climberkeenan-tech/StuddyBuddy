import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { Slide, SlideChartSpec, SlideDeck } from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { SlideExporter } from './types';
import {
  DECK_BG,
  DECK_SURFACE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  hexToRgb01,
  resolveAccent,
} from './theme';

/** 16:9 page in points (a compact slide canvas). */
const PAGE_W = 960;
const PAGE_H = 540;
const MARGIN = 64;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Rotating series colors for chart slides. */
const CHART_PALETTE = ['#8b7cff', '#38bdf8', '#34d399', '#f5b301', '#fb7185', '#c084fc'];

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

/**
 * Renders a deck to a self-contained PDF with pdf-lib — one 16:9 page per
 * slide, a dark premium canvas, and per-layout rendering (wrapped titles,
 * bulleted lists, centered quotes, timeline rows with a year pill, Mermaid
 * source in a monospaced box, and simple bar/line/pie charts drawn directly
 * from the spec data). Speaker notes appear as a small gray footer line on each
 * page, so the exported PDF is a complete, printable study artifact.
 */
export class PdfExporter implements SlideExporter {
  readonly format = 'pdf' as const;
  readonly name = 'PDF';

  async export(deck: SlideDeck, outPath: string, _meta: { courseName: string }): Promise<string> {
    try {
      const doc = await PDFDocument.create();
      const fonts: Fonts = {
        regular: await doc.embedFont(StandardFonts.Helvetica),
        bold: await doc.embedFont(StandardFonts.HelveticaBold),
        italic: await doc.embedFont(StandardFonts.HelveticaOblique),
        mono: await doc.embedFont(StandardFonts.Courier),
      };

      for (const slide of deck.slides) {
        const page = doc.addPage([PAGE_W, PAGE_H]);
        this.renderSlide(page, fonts, slide);
      }

      const bytes = await doc.save();
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, bytes);
      return outPath;
    } catch (e) {
      throw new SbError(ErrorCodes.EXPORT_FAILED, 'Failed to write PDF export.', { cause: e });
    }
  }

  private renderSlide(page: PDFPage, fonts: Fonts, slide: Slide): void {
    const accent = resolveAccent(slide.accent);
    // Canvas + top accent bar.
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: col(DECK_BG) });
    page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: col(accent) });

    switch (slide.layout) {
      case 'title':
        this.renderTitle(page, fonts, slide, accent);
        break;
      case 'section':
        this.renderSection(page, fonts, slide, accent);
        break;
      case 'quote':
        this.renderQuote(page, fonts, slide, accent);
        break;
      case 'timeline':
        this.renderTimeline(page, fonts, slide, accent);
        break;
      case 'diagram':
        this.renderDiagram(page, fonts, slide, accent);
        break;
      case 'chart':
        this.renderChart(page, fonts, slide, accent);
        break;
      case 'two-column':
        this.renderTwoColumn(page, fonts, slide, accent);
        break;
      default:
        this.renderBullets(page, fonts, slide, accent);
        break;
    }

    this.renderNotesFooter(page, fonts, slide);
  }

  private renderTitle(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const titleLines = wrapLines(slide.title, fonts.bold, 46, CONTENT_W);
    let y = 360;
    for (const line of titleLines) {
      page.drawText(line, { x: MARGIN, y, size: 46, font: fonts.bold, color: col(TEXT_PRIMARY) });
      y -= 56;
    }
    page.drawRectangle({ x: MARGIN, y: y + 24, width: 120, height: 5, color: col(accent) });
    if (slide.subtitle) {
      drawWrapped(page, slide.subtitle, {
        x: MARGIN,
        y: y - 12,
        size: 20,
        font: fonts.regular,
        color: col(TEXT_MUTED),
        maxWidth: CONTENT_W,
        lineGap: 28,
        maxLines: 3,
      });
    }
  }

  private renderSection(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    page.drawText('SECTION', {
      x: MARGIN,
      y: 340,
      size: 16,
      font: fonts.bold,
      color: col(accent),
    });
    const titleLines = wrapLines(slide.title, fonts.bold, 40, CONTENT_W);
    let y = 300;
    for (const line of titleLines) {
      page.drawText(line, { x: MARGIN, y, size: 40, font: fonts.bold, color: col(TEXT_PRIMARY) });
      y -= 48;
    }
    if (slide.subtitle) {
      drawWrapped(page, slide.subtitle, {
        x: MARGIN,
        y: y - 6,
        size: 18,
        font: fonts.regular,
        color: col(TEXT_MUTED),
        maxWidth: CONTENT_W,
        lineGap: 24,
        maxLines: 2,
      });
    }
  }

  private renderBullets(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const startY = this.renderHeader(page, fonts, slide, accent);
    let y = startY;
    const bullets = slide.bullets ?? [];
    for (const bullet of bullets) {
      if (y < 90) break;
      page.drawText('•', { x: MARGIN, y, size: 18, font: fonts.bold, color: col(accent) });
      const after = drawWrapped(page, bullet, {
        x: MARGIN + 24,
        y,
        size: 18,
        font: fonts.regular,
        color: col(TEXT_PRIMARY),
        maxWidth: CONTENT_W - 24,
        lineGap: 24,
        maxLines: 3,
      });
      y = after - 16;
    }
  }

  private renderTwoColumn(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const startY = this.renderHeader(page, fonts, slide, accent);
    const columns = slide.columns ?? [];
    const gap = 32;
    const colW = (CONTENT_W - gap) / 2;
    columns.slice(0, 2).forEach((column, idx) => {
      const x = MARGIN + idx * (colW + gap);
      let y = startY;
      page.drawText(column.heading, { x, y, size: 20, font: fonts.bold, color: col(accent) });
      y -= 34;
      for (const bullet of column.bullets) {
        if (y < 90) break;
        page.drawText('•', { x, y, size: 14, font: fonts.bold, color: col(accent) });
        const after = drawWrapped(page, bullet, {
          x: x + 18,
          y,
          size: 14,
          font: fonts.regular,
          color: col(TEXT_PRIMARY),
          maxWidth: colW - 18,
          lineGap: 19,
          maxLines: 3,
        });
        y = after - 12;
      }
    });
  }

  private renderQuote(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const quote = slide.quote;
    if (!quote) return this.renderBullets(page, fonts, slide, accent);
    page.drawText('“', { x: MARGIN, y: 400, size: 90, font: fonts.bold, color: col(accent) });
    const lines = wrapLines(quote.text, fonts.italic, 30, CONTENT_W - 40);
    const blockHeight = lines.length * 42;
    let y = 300 + blockHeight / 2;
    for (const line of lines) {
      const width = fonts.italic.widthOfTextAtSize(line, 30);
      page.drawText(line, {
        x: (PAGE_W - width) / 2,
        y,
        size: 30,
        font: fonts.italic,
        color: col(TEXT_PRIMARY),
      });
      y -= 42;
    }
    if (quote.attribution) {
      const attr = `— ${quote.attribution}`;
      const width = fonts.bold.widthOfTextAtSize(attr, 18);
      page.drawText(attr, {
        x: (PAGE_W - width) / 2,
        y: y - 10,
        size: 18,
        font: fonts.bold,
        color: col(accent),
      });
    }
  }

  private renderTimeline(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const startY = this.renderHeader(page, fonts, slide, accent);
    const events = slide.timeline ?? [];
    let y = startY;
    const pillW = 120;
    const rowGap = 18;
    for (const ev of events) {
      if (y < 96) break;
      const rowH = Math.max(38, wrapLines(ev.description, fonts.regular, 15, CONTENT_W - pillW - 24).length * 20 + 12);
      // Year pill.
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH + 8,
        width: pillW,
        height: 30,
        color: col(accent),
      });
      const label = truncateToWidth(ev.label, fonts.bold, 14, pillW - 16);
      page.drawText(label, {
        x: MARGIN + 12,
        y: y - rowH + 17,
        size: 14,
        font: fonts.bold,
        color: col(DECK_BG),
      });
      drawWrapped(page, ev.description, {
        x: MARGIN + pillW + 20,
        y,
        size: 15,
        font: fonts.regular,
        color: col(TEXT_PRIMARY),
        maxWidth: CONTENT_W - pillW - 20,
        lineGap: 20,
        maxLines: 3,
      });
      y -= rowH + rowGap;
    }
  }

  private renderDiagram(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const startY = this.renderHeader(page, fonts, slide, accent);
    const boxTop = startY + 6;
    const boxBottom = 96;
    const boxHeight = boxTop - boxBottom;
    page.drawRectangle({
      x: MARGIN,
      y: boxBottom,
      width: CONTENT_W,
      height: boxHeight,
      color: col(DECK_SURFACE),
      borderColor: col(accent),
      borderWidth: 1,
    });
    const source = (slide.mermaid ?? '').split('\n');
    const size = 11;
    const lineH = 15;
    let y = boxTop - 22;
    for (const raw of source) {
      if (y < boxBottom + 28) break;
      const line = truncateToWidth(raw, fonts.mono, size, CONTENT_W - 32);
      page.drawText(line, { x: MARGIN + 16, y, size, font: fonts.mono, color: col(TEXT_MUTED) });
      y -= lineH;
    }
    page.drawText('Diagram renders live in StuddyBuddy', {
      x: MARGIN,
      y: boxBottom - 20,
      size: 11,
      font: fonts.italic,
      color: col(TEXT_MUTED),
    });
  }

  private renderChart(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): void {
    const startY = this.renderHeader(page, fonts, slide, accent);
    const chart = slide.chart;
    if (!chart) return;
    const plot = { x: MARGIN, y: 110, w: CONTENT_W, h: Math.min(260, startY - 130) };
    if (chart.kind === 'pie' || chart.kind === 'doughnut') {
      this.renderPie(page, fonts, chart, plot);
    } else if (chart.kind === 'line') {
      this.renderLine(page, fonts, chart, plot, accent);
    } else {
      this.renderBar(page, fonts, chart, plot);
    }
  }

  private renderBar(page: PDFPage, fonts: Fonts, chart: SlideChartSpec, plot: Plot): void {
    const max = chartMax(chart) || 1;
    const groupW = plot.w / Math.max(1, chart.labels.length);
    const series = chart.series;
    const barW = Math.max(6, (groupW - 16) / Math.max(1, series.length));
    // Axis baseline.
    page.drawLine({
      start: { x: plot.x, y: plot.y },
      end: { x: plot.x + plot.w, y: plot.y },
      thickness: 1,
      color: col(TEXT_MUTED),
    });
    chart.labels.forEach((label, li) => {
      const gx = plot.x + li * groupW + 8;
      series.forEach((s, si) => {
        const value = s.data[li] ?? 0;
        const barH = Math.max(0, (value / max) * (plot.h - 10));
        page.drawRectangle({
          x: gx + si * barW,
          y: plot.y,
          width: barW - 2,
          height: barH,
          color: col(paletteAt(si)),
        });
      });
      const lab = truncateToWidth(label, fonts.regular, 11, groupW - 4);
      page.drawText(lab, {
        x: plot.x + li * groupW + 8,
        y: plot.y - 16,
        size: 11,
        font: fonts.regular,
        color: col(TEXT_MUTED),
      });
    });
    this.renderLegend(page, fonts, chart, plot);
  }

  private renderLine(
    page: PDFPage,
    fonts: Fonts,
    chart: SlideChartSpec,
    plot: Plot,
    _accent: string,
  ): void {
    const max = chartMax(chart) || 1;
    const n = chart.labels.length;
    const step = n > 1 ? plot.w / (n - 1) : 0;
    page.drawLine({
      start: { x: plot.x, y: plot.y },
      end: { x: plot.x + plot.w, y: plot.y },
      thickness: 1,
      color: col(TEXT_MUTED),
    });
    chart.series.forEach((s, si) => {
      const color = col(paletteAt(si));
      const points = chart.labels.map((_, i) => ({
        x: plot.x + i * step,
        y: plot.y + ((s.data[i] ?? 0) / max) * (plot.h - 10),
      }));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (a && b) page.drawLine({ start: a, end: b, thickness: 2, color });
      }
      for (const p of points) {
        page.drawEllipse({ x: p.x, y: p.y, xScale: 3, yScale: 3, color });
      }
    });
    chart.labels.forEach((label, i) => {
      const lab = truncateToWidth(label, fonts.regular, 11, step || plot.w);
      page.drawText(lab, {
        x: plot.x + i * step - 6,
        y: plot.y - 16,
        size: 11,
        font: fonts.regular,
        color: col(TEXT_MUTED),
      });
    });
    this.renderLegend(page, fonts, chart, plot);
  }

  private renderPie(page: PDFPage, fonts: Fonts, chart: SlideChartSpec, plot: Plot): void {
    const series = chart.series[0];
    const values = chart.labels.map((_, i) => Math.max(0, series?.data[i] ?? 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = plot.x + plot.h / 2 + 20;
    const cy = plot.y + plot.h / 2;
    const radius = plot.h / 2 - 6;
    // Base disc; a doughnut punches a canvas-colored hole in the middle.
    page.drawEllipse({ x: cx, y: cy, xScale: radius, yScale: radius, color: col(paletteAt(0)) });
    if (chart.kind === 'doughnut') {
      page.drawEllipse({
        x: cx,
        y: cy,
        xScale: radius * 0.55,
        yScale: radius * 0.55,
        color: col(DECK_BG),
      });
    }
    // Proportional legend with swatches (honest slice sizes without arc math).
    let ly = plot.y + plot.h - 8;
    const lx = cx + radius + 40;
    chart.labels.forEach((label, i) => {
      const pct = Math.round(((values[i] ?? 0) / total) * 100);
      page.drawRectangle({ x: lx, y: ly - 10, width: 14, height: 14, color: col(paletteAt(i)) });
      const text = truncateToWidth(`${label} — ${pct}%`, fonts.regular, 13, plot.w - (lx - plot.x) - 30);
      page.drawText(text, {
        x: lx + 22,
        y: ly - 8,
        size: 13,
        font: fonts.regular,
        color: col(TEXT_PRIMARY),
      });
      ly -= 26;
    });
  }

  private renderLegend(page: PDFPage, fonts: Fonts, chart: SlideChartSpec, plot: Plot): void {
    if (chart.series.length <= 1) return;
    let lx = plot.x;
    const ly = plot.y + plot.h + 12;
    chart.series.forEach((s, si) => {
      page.drawRectangle({ x: lx, y: ly, width: 12, height: 12, color: col(paletteAt(si)) });
      page.drawText(s.label, {
        x: lx + 18,
        y: ly + 1,
        size: 12,
        font: fonts.regular,
        color: col(TEXT_MUTED),
      });
      lx += 30 + fonts.regular.widthOfTextAtSize(s.label, 12);
    });
  }

  /** Draw the standard slide header (title + accent rule) and return the body's top y. */
  private renderHeader(page: PDFPage, fonts: Fonts, slide: Slide, accent: string): number {
    const title = truncateToWidth(slide.title, fonts.bold, 30, CONTENT_W);
    page.drawText(title, { x: MARGIN, y: 470, size: 30, font: fonts.bold, color: col(TEXT_PRIMARY) });
    page.drawRectangle({ x: MARGIN, y: 456, width: 60, height: 4, color: col(accent) });
    let y = 424;
    if (slide.subtitle) {
      page.drawText(truncateToWidth(slide.subtitle, fonts.regular, 16, CONTENT_W), {
        x: MARGIN,
        y,
        size: 16,
        font: fonts.regular,
        color: col(TEXT_MUTED),
      });
      y -= 30;
    }
    return y;
  }

  private renderNotesFooter(page: PDFPage, fonts: Fonts, slide: Slide): void {
    page.drawLine({
      start: { x: MARGIN, y: 46 },
      end: { x: PAGE_W - MARGIN, y: 46 },
      thickness: 0.75,
      color: col(TEXT_MUTED),
      opacity: 0.4,
    });
    const notes = `Notes: ${slide.speakerNotes.replace(/\s+/g, ' ').trim()}`;
    page.drawText(truncateToWidth(notes, fonts.regular, 9, CONTENT_W), {
      x: MARGIN,
      y: 30,
      size: 9,
      font: fonts.regular,
      color: col(TEXT_MUTED),
      opacity: 0.7,
    });
  }
}

interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WrapOpts {
  x: number;
  y: number;
  size: number;
  font: PDFFont;
  color: RGB;
  maxWidth: number;
  lineGap: number;
  maxLines?: number;
}

/** Draw wrapped text top-down from `y`; returns the y just below the last line. */
function drawWrapped(page: PDFPage, text: string, opts: WrapOpts): number {
  const lines = wrapLines(text, opts.font, opts.size, opts.maxWidth);
  const limited = opts.maxLines ? lines.slice(0, opts.maxLines) : lines;
  if (opts.maxLines && lines.length > opts.maxLines && limited.length > 0) {
    const lastIdx = limited.length - 1;
    limited[lastIdx] = truncateToWidth(`${limited[lastIdx]}…`, opts.font, opts.size, opts.maxWidth);
  }
  let y = opts.y;
  for (const line of limited) {
    page.drawText(line, { x: opts.x, y, size: opts.size, font: opts.font, color: opts.color });
    y -= opts.lineGap;
  }
  return y;
}

/** Greedy word-wrap, breaking any single word that is wider than `maxWidth`. */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) {
      if (font.widthOfTextAtSize(word, size) > maxWidth && !line) {
        // Hard-break an over-long token character by character.
        for (const chunk of breakLongWord(word, font, size, maxWidth)) lines.push(chunk);
        line = lines.pop() ?? '';
      } else {
        line = trial;
      }
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function breakLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ch of word) {
    if (font.widthOfTextAtSize(current + ch, size) > maxWidth && current) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Truncate to a single line that fits `maxWidth`, appending an ellipsis. */
function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${clean.slice(0, mid)}…`, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${clean.slice(0, lo).trimEnd()}…`;
}

function chartMax(chart: SlideChartSpec): number {
  let max = 0;
  for (const s of chart.series) for (const v of s.data) if (v > max) max = v;
  return max;
}

function paletteAt(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length] ?? '#8b7cff';
}

function col(hex: string): RGB {
  const { r, g, b } = hexToRgb01(hex);
  return rgb(r, g, b);
}
