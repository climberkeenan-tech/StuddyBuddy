import type { EntityId, MediaOffsetMs, Timestamp } from './common';

/**
 * Long-term memory: the growing knowledge base across all lectures,
 * powering semantic search, AI Q&A, and cross-lecture understanding.
 */

export type KnowledgeSource = 'transcript' | 'notes' | 'analysis' | 'material';

/** A chunk of lecture content indexed for retrieval. */
export interface KnowledgeChunk {
  id: EntityId;
  courseId: EntityId;
  lectureId: EntityId;
  source: KnowledgeSource;
  text: string;
  /** Offset into the lecture audio, when known, for deep-linking citations. */
  atMs?: MediaOffsetMs;
  createdAt: Timestamp;
}

export interface SearchScope {
  courseId?: EntityId;
  lectureId?: EntityId;
}

export interface SearchHit {
  chunk: KnowledgeChunk;
  /** 0..1 relevance. */
  score: number;
  /** Display metadata resolved for the UI. */
  courseName: string;
  lectureTitle: string;
  lectureNumber: number;
}

export interface Citation {
  lectureId: EntityId;
  lectureTitle: string;
  courseName: string;
  atMs?: MediaOffsetMs;
  /** Short quoted excerpt supporting the answer. */
  excerpt: string;
}

/** Answer from "Ask your lectures" RAG Q&A. */
export interface AskAnswer {
  question: string;
  /** Markdown answer grounded in retrieved lecture content. */
  markdown: string;
  citations: Citation[];
  /** True when nothing relevant was found and the answer says so. */
  noSources: boolean;
  generatedBy: string;
}

/** ——— Smart Review ——— */

export interface WeakArea {
  conceptId: EntityId;
  conceptName: string;
  lectureId: EntityId;
  /** 0..1 — higher means weaker (missed quiz questions, flagged difficulty). */
  weakness: number;
  reason: string;
}

export interface ExamPrepPlan {
  id: EntityId;
  courseId: EntityId;
  /** Markdown cumulative review of the whole course so far. */
  cumulativeReview: string;
  /** Most important concepts across lectures, ordered. */
  keyConcepts: { conceptName: string; lectureId: EntityId; importance: number }[];
  /** Topics the professor kept returning to. */
  recurringTopics: string[];
  likelyExamQuestions: string[];
  weakAreas: WeakArea[];
  /** Recommended study order with rationale. */
  studyOrder: { title: string; lectureId?: EntityId; rationale: string }[];
  generatedBy: string;
  createdAt: Timestamp;
}
