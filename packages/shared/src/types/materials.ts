import type { Difficulty, EntityId, Timestamp } from './common';

/**
 * Study materials generated from a lecture. Each material type has a structured
 * content payload so the UI can render it richly (not just a wall of markdown).
 */

export type MaterialType =
  | 'notes'
  | 'summary-concise'
  | 'summary-detailed'
  | 'study-guide'
  | 'flashcards'
  | 'quiz-mcq'
  | 'quiz-short-answer'
  | 'practice-test'
  | 'review-sheet'
  | 'cheat-sheet'
  | 'vocabulary'
  | 'glossary';

/** ——— Notes ——— */

export type NoteBlockType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'definition'
  | 'example'
  | 'warning'
  | 'mistake' // common mistake callout
  | 'fact' // important fact callout
  | 'formula';

export interface NoteBlock {
  id: EntityId;
  type: NoteBlockType;
  /** Heading level 1-3 for heading blocks. */
  level?: number;
  /** Markdown text (inline formatting allowed). For bullets, one item per entry. */
  text?: string;
  items?: string[];
  /** Term for definition blocks, formula name for formula blocks. */
  term?: string;
  /** Keywords to visually highlight within this block. */
  keywords?: string[];
  /** Icon name (lucide) for callout blocks. */
  icon?: string;
  /** Accent color token: "primary" | "amber" | "rose" | "emerald" | "sky". */
  accent?: string;
}

export interface NotesContent {
  blocks: NoteBlock[];
}

/** ——— Summaries / guides / sheets (markdown-based) ——— */

export interface MarkdownContent {
  markdown: string;
}

export interface StudyGuideSection {
  title: string;
  markdown: string;
  conceptIds: EntityId[];
}

export interface StudyGuideContent {
  sections: StudyGuideSection[];
}

/** ——— Flashcards ——— */

export interface SrsState {
  /** SM-2 ease factor, starts at 2.5. */
  ease: number;
  /** Current interval in days. */
  intervalDays: number;
  /** Consecutive successful reviews. */
  reps: number;
  lapses: number;
  /** When the card is next due. */
  dueAt: Timestamp;
}

export interface Flashcard {
  id: EntityId;
  front: string;
  back: string;
  hint?: string;
  conceptId?: EntityId;
  srs: SrsState;
}

export interface FlashcardsContent {
  cards: Flashcard[];
}

/** ——— Quizzes ——— */

export interface McqQuestion {
  id: EntityId;
  kind: 'mcq';
  prompt: string;
  choices: string[];
  /** Index into choices. */
  correctIndex: number;
  explanation: string;
  conceptId?: EntityId;
}

export interface ShortAnswerQuestion {
  id: EntityId;
  kind: 'short-answer';
  prompt: string;
  /** Model answer used for AI grading and reveal. */
  modelAnswer: string;
  /** Key points an answer should include. */
  rubric: string[];
  conceptId?: EntityId;
}

export type QuizQuestion = McqQuestion | ShortAnswerQuestion;

export interface QuizContent {
  questions: QuizQuestion[];
  difficulty: Difficulty;
}

export interface QuizAnswer {
  questionId: EntityId;
  /** Choice index for MCQ; free text for short answer. */
  response: number | string;
  correct: boolean;
  /** 0..1 partial credit for short answers. */
  score: number;
}

export interface QuizAttempt {
  id: EntityId;
  materialId: EntityId;
  lectureId: EntityId;
  answers: QuizAnswer[];
  /** 0..1 overall. */
  score: number;
  /** Concept ids the student missed, feeding Smart Review weak areas. */
  missedConceptIds: EntityId[];
  startedAt: Timestamp;
  finishedAt: Timestamp;
}

/** ——— Vocabulary / glossary ——— */

export interface VocabularyContent {
  entries: { term: string; meaning: string; example?: string }[];
}

/** Map from material type to its content payload. */
export interface MaterialContentMap {
  notes: NotesContent;
  'summary-concise': MarkdownContent;
  'summary-detailed': MarkdownContent;
  'study-guide': StudyGuideContent;
  flashcards: FlashcardsContent;
  'quiz-mcq': QuizContent;
  'quiz-short-answer': QuizContent;
  'practice-test': QuizContent;
  'review-sheet': MarkdownContent;
  'cheat-sheet': MarkdownContent;
  vocabulary: VocabularyContent;
  glossary: VocabularyContent;
}

export interface StudyMaterial<T extends MaterialType = MaterialType> {
  id: EntityId;
  lectureId: EntityId;
  courseId: EntityId;
  type: T;
  title: string;
  difficulty: Difficulty;
  content: MaterialContentMap[T];
  generatedBy: string;
  createdAt: Timestamp;
}

/** Lightweight listing row (content omitted). */
export type StudyMaterialMeta = Omit<StudyMaterial, 'content'>;
