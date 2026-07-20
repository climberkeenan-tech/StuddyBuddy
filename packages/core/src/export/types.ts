import type { SlideDeck, SlideExportFormat } from '@studdybuddy/shared';

/**
 * Exporter extension point. Built-ins: PPTX (pptxgenjs), PDF (pdf-lib),
 * Markdown, and a NotebookLM-ready bundle (markdown + metadata) — Google
 * Slides is served via PPTX import. Plugins can register more formats.
 */
export interface SlideExporter {
  readonly format: SlideExportFormat;
  readonly name: string;
  /** Render the deck and write it to `outPath`. Returns the final path. */
  export(deck: SlideDeck, outPath: string, meta: { courseName: string }): Promise<string>;
}
