import type { EntityId, MediaOffsetMs, Timestamp } from './common';

/**
 * Output of the AI lecture-understanding pass. This is the semantic backbone
 * the rest of the app (notes, study materials, review, search) builds on.
 */

export interface ConceptRef {
  conceptId: EntityId;
  /** Why the two concepts relate, e.g. "prerequisite", "contrast", "example-of". */
  relation: string;
}

export interface Concept {
  id: EntityId;
  name: string;
  /** One-paragraph plain-language explanation. */
  summary: string;
  /** 0..1 — how central the concept is to this lecture. */
  importance: number;
  /** 0..1 — analyzer's estimate that this appears on an exam. */
  examLikelihood: number;
  /** 0..1 — how much students typically struggle with it. */
  difficulty: number;
  /** Times the professor emphasized or repeated it. */
  mentions: number;
  firstMentionMs: MediaOffsetMs;
  related: ConceptRef[];
}

export interface Definition {
  id: EntityId;
  term: string;
  definition: string;
  conceptId?: EntityId;
  atMs: MediaOffsetMs;
}

export interface Formula {
  id: EntityId;
  name: string;
  /** LaTeX-ish or plain-text representation. */
  expression: string;
  explanation: string;
  atMs: MediaOffsetMs;
}

export interface LectureExample {
  id: EntityId;
  conceptId?: EntityId;
  description: string;
  kind: 'example' | 'analogy' | 'story' | 'comparison';
  atMs: MediaOffsetMs;
}

export interface KeyDate {
  id: EntityId;
  /** Human-readable date/era label, e.g. "1953" or "Late Cretaceous". */
  label: string;
  event: string;
  atMs: MediaOffsetMs;
}

export interface EmphasisCue {
  id: EntityId;
  /** Quoted teacher phrasing, e.g. "this will be on the exam". */
  quote: string;
  conceptId?: EntityId;
  atMs: MediaOffsetMs;
}

export interface VocabularyEntry {
  id: EntityId;
  term: string;
  meaning: string;
  partOfSpeech?: string;
}

/** A link from a concept in this lecture to a concept taught in an earlier lecture. */
export interface CrossLectureLink {
  conceptId: EntityId;
  earlierLectureId: EntityId;
  earlierConceptName: string;
  note: string;
}

export interface LectureAnalysis {
  lectureId: EntityId;
  /** Two-sentence gist shown on lecture cards. */
  gist: string;
  concepts: Concept[];
  definitions: Definition[];
  formulas: Formula[];
  examples: LectureExample[];
  keyDates: KeyDate[];
  emphasisCues: EmphasisCue[];
  vocabulary: VocabularyEntry[];
  /** Concepts likely to be exam material, ordered by likelihood. */
  examWatchlist: EntityId[];
  /** Concepts students usually struggle with, ordered by difficulty. */
  struggleWatchlist: EntityId[];
  crossLectureLinks: CrossLectureLink[];
  /** Provider/model that produced the analysis, e.g. "anthropic/claude-sonnet-5". */
  generatedBy: string;
  createdAt: Timestamp;
}

/** Explanation styles cycled by "I still don't understand". */
export type ExplanationStyle =
  | 'simple' // plain language, short sentences
  | 'analogy' // real-world analogy driven
  | 'step-by-step' // numbered walkthrough
  | 'visual' // diagram-first (Mermaid) with caption
  | 'example'; // worked real-world example

export interface Explanation {
  conceptName: string;
  style: ExplanationStyle;
  /** Markdown body of the explanation. */
  markdown: string;
  /** Optional Mermaid diagram source illustrating the idea. */
  mermaid?: string;
  /** Which attempt this is (1-based); increments on "I still don't understand". */
  attempt: number;
  generatedBy: string;
}
