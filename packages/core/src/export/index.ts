/**
 * Deck exporters.
 *
 * The `exporter` extension point plus the four built-ins — PowerPoint (PPTX),
 * PDF, Markdown, and a NotebookLM-ready Markdown bundle — and the
 * {@link ExportService} that resolves an exporter from the plugin registry and
 * writes the file under `<dataDir>/exports`. Google Slides is served by
 * importing the PPTX. All exporters are headless and dependency-injected.
 */
export * from './types';
export * from './theme';
export * from './markdown';
export * from './notebooklm';
export * from './pdf';
export * from './pptx';
export * from './export-service';
