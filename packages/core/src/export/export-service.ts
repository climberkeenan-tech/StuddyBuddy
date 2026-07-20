import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  slugify,
  type PluginManifest,
  type SlideExportFormat,
  type SlideExportResult,
} from '@studdybuddy/shared';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { PluginRegistry } from '../plugins/registry';
import type { Repositories } from '../storage/types';
import type { SlideExporter } from './types';
import { PptxExporter } from './pptx';
import { PdfExporter } from './pdf';
import { MarkdownExporter } from './markdown';
import { NotebookLMExporter } from './notebooklm';

/** File extension per export format. NotebookLM keeps a distinct `.notebooklm.md`
 * so it never collides with the plain Markdown export of the same deck. */
const EXTENSIONS: Record<SlideExportFormat, string> = {
  pptx: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  notebooklm: 'notebooklm.md',
};

export interface ExportServiceDeps {
  pluginRegistry: PluginRegistry;
  repos: Repositories;
  /** Root app data dir; exports are written under `<dataDir>/exports`. */
  dataDir: string;
  logger: Logger;
}

/**
 * Exports a persisted {@link import('@studdybuddy/shared').SlideDeck} to a file.
 *
 * Resolves the deck (and its course + lecture for a human-readable filename),
 * looks up the requested exporter from the plugin registry (so third-party
 * formats work identically to the built-ins), writes into `<dataDir>/exports`
 * with a stable slugged name — `<course>-lecture<NN>-<deck>.<ext>` — and
 * returns the absolute path.
 */
export class ExportService {
  private readonly registry: PluginRegistry;
  private readonly repos: Repositories;
  private readonly dataDir: string;
  private readonly logger: Logger;

  constructor(deps: ExportServiceDeps) {
    this.registry = deps.pluginRegistry;
    this.repos = deps.repos;
    this.dataDir = deps.dataDir;
    this.logger = deps.logger.child('export-service');
  }

  /**
   * Render `deckId` as `format` and return the written file path.
   * @throws SbError NOT_FOUND if the deck is missing or no exporter is registered
   *   for the format.
   * @throws SbError EXPORT_FAILED if the exporter fails to write the file.
   */
  async export(deckId: string, format: SlideExportFormat): Promise<SlideExportResult> {
    const deck = await this.repos.slideDecks.get(deckId);
    if (!deck) throw new SbError(ErrorCodes.NOT_FOUND, `Slide deck "${deckId}" not found.`);

    const exporter = this.registry.get('exporter', format) as SlideExporter | undefined;
    if (!exporter) {
      throw new SbError(ErrorCodes.NOT_FOUND, `No exporter registered for format "${format}".`);
    }

    const course = await this.repos.courses.get(deck.courseId);
    const courseName = course?.name ?? 'Course';
    const lecture = await this.repos.lectures.get(deck.lectureId);
    const lectureNo = String(lecture?.number ?? 1).padStart(2, '0');

    const outDir = path.join(this.dataDir, 'exports');
    await fs.mkdir(outDir, { recursive: true });

    const ext = EXTENSIONS[format];
    const filename = `${slugify(courseName)}-lecture${lectureNo}-${slugify(deck.title)}.${ext}`;
    const outPath = path.join(outDir, filename);

    let filePath: string;
    try {
      filePath = await exporter.export(deck, outPath, { courseName });
    } catch (e) {
      if (e instanceof SbError) throw e;
      throw new SbError(ErrorCodes.EXPORT_FAILED, `Export to ${format} failed.`, { cause: e });
    }

    this.logger.info('deck exported', { deckId, format, filePath });
    return { format, filePath };
  }
}

export function createExportService(deps: ExportServiceDeps): ExportService {
  return new ExportService(deps);
}

/** Manifest for the bundled deck exporters. */
export const BUILTIN_EXPORTERS_MANIFEST: PluginManifest = {
  id: 'builtin-exporters',
  name: 'Built-in Exporters',
  version: '1.0.0',
  description:
    'The default slide-deck exporters: PowerPoint (PPTX), PDF, Markdown, and a ' +
    'NotebookLM-ready Markdown bundle. Google Slides is served via PPTX import.',
  author: 'StuddyBuddy',
  contributes: ['exporter'],
  builtIn: true,
};

/** The four built-in exporters, one per {@link SlideExportFormat}. */
export const BUILTIN_EXPORTERS: SlideExporter[] = [
  new PptxExporter(),
  new PdfExporter(),
  new MarkdownExporter(),
  new NotebookLMExporter(),
];

/**
 * Register the built-in exporters into a {@link PluginRegistry} under the
 * `exporter` extension point, keyed by format — the same path a third-party
 * exporter plugin would use.
 */
export function registerBuiltinExporters(registry: PluginRegistry): void {
  registry.register(BUILTIN_EXPORTERS_MANIFEST, (ctx) => {
    for (const exporter of BUILTIN_EXPORTERS) {
      ctx.contribute('exporter', exporter.format, exporter);
    }
  });
}
