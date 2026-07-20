import type { EntityId, MediaOffsetMs, Timestamp } from './common';

/** A course/class the student is enrolled in. Top level of the organization hierarchy. */
export interface Course {
  id: EntityId;
  name: string;
  instructor: string;
  semester: string;
  /** Accent color used throughout the UI, as a hex string, e.g. "#7c3aed". */
  color: string;
  /** Icon name from the app icon set (lucide), e.g. "dna", "flask-conical". */
  icon: string;
  description?: string;
  /** Optional upcoming exam dates used by Smart Review. */
  examDates?: Timestamp[];
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type CourseInput = Pick<Course, 'name' | 'instructor' | 'semester' | 'color' | 'icon'> &
  Partial<Pick<Course, 'description' | 'examDates'>>;

export type LectureStatus =
  | 'recording' // live capture in progress
  | 'processing' // transcription/analysis pipeline running
  | 'ready' // transcript available, analysis complete
  | 'failed'; // pipeline error; transcript may be partial

/** A single lecture session inside a course. */
export interface Lecture {
  id: EntityId;
  courseId: EntityId;
  title: string;
  /** Lecture number within the course (1-based), used for cross-lecture references. */
  number: number;
  status: LectureStatus;
  recordedAt: Timestamp;
  durationMs: number;
  /** Relative path (within the app data dir) of the saved audio file, if kept. */
  audioPath?: string;
  /** Auto-detected topics, most prominent first. */
  topics: string[];
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SegmentKind = 'speech' | 'pause' | 'heading' | 'question';

/** One time-aligned unit of the transcript. */
export interface TranscriptSegment {
  id: EntityId;
  /** Position within the transcript (0-based, contiguous). */
  index: number;
  startMs: MediaOffsetMs;
  endMs: MediaOffsetMs;
  text: string;
  kind: SegmentKind;
  /** 0..1 recognizer confidence, when the engine reports one. */
  confidence?: number;
  /** True when the analyzer flagged this as a question the teacher asked. */
  isTeacherQuestion?: boolean;
}

/** A paragraph groups consecutive segments; sections group paragraphs under a heading. */
export interface TranscriptParagraph {
  id: EntityId;
  segmentIds: EntityId[];
  startMs: MediaOffsetMs;
  endMs: MediaOffsetMs;
}

export interface TranscriptSection {
  id: EntityId;
  title: string;
  startMs: MediaOffsetMs;
  endMs: MediaOffsetMs;
  paragraphIds: EntityId[];
}

/** Full transcript document for a lecture. Stored separately from the Lecture row. */
export interface Transcript {
  lectureId: EntityId;
  segments: TranscriptSegment[];
  paragraphs: TranscriptParagraph[];
  sections: TranscriptSection[];
  /** Detected language code, e.g. "en". */
  language: string;
  /** Engine that produced it, e.g. "openai-whisper", "simulated". */
  engine: string;
  updatedAt: Timestamp;
}

/** Live status of the recording pipeline, streamed to the renderer. */
export interface RecordingStatus {
  lectureId: EntityId | null;
  state: 'idle' | 'recording' | 'paused' | 'stopping' | 'error';
  elapsedMs: number;
  /** Rolling RMS level 0..1 for the level meter. */
  audioLevel: number;
  segmentCount: number;
  error?: string;
}
