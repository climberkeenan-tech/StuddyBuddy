import type { EntityId, Timestamp } from './common';

/**
 * AI-generated slide decks. Slides are structured data rendered by the app's
 * slideshow view and exportable to PPTX/PDF/Markdown.
 */

export type SlideLayout =
  | 'title' // deck opener
  | 'section' // section divider
  | 'bullets' // title + bullet list
  | 'diagram' // Mermaid diagram focus
  | 'chart' // data chart focus
  | 'timeline' // ordered events
  | 'quote' // emphasized quote/definition
  | 'two-column';

export interface SlideChartSpec {
  kind: 'bar' | 'line' | 'pie' | 'doughnut';
  labels: string[];
  series: { label: string; data: number[] }[];
}

export interface SlideTimelineEvent {
  label: string;
  description: string;
}

export interface Slide {
  id: EntityId;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  /** Mermaid source for diagram slides. */
  mermaid?: string;
  chart?: SlideChartSpec;
  timeline?: SlideTimelineEvent[];
  quote?: { text: string; attribution?: string };
  columns?: { heading: string; bullets: string[] }[];
  /** Icon name (lucide) shown as slide accent. */
  icon?: string;
  /** Accent color token, defaults to course color. */
  accent?: string;
  speakerNotes: string;
}

export interface SlideDeck {
  id: EntityId;
  lectureId: EntityId;
  courseId: EntityId;
  title: string;
  slides: Slide[];
  theme: 'auto' | 'light' | 'dark';
  generatedBy: string;
  createdAt: Timestamp;
}

export type SlideExportFormat = 'pptx' | 'pdf' | 'markdown' | 'notebooklm';

export interface SlideExportResult {
  format: SlideExportFormat;
  /** Absolute path of the exported file on disk. */
  filePath: string;
}
