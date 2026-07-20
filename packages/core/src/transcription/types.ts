import type { TranscriptSegment } from '@studdybuddy/shared';

/**
 * Transcription pipeline contracts.
 *
 * Flow: the renderer captures mic audio and streams chunks to the
 * RecordingService, which feeds the active TranscriptionProvider and emits
 * segments through the pipeline's post-processing stages (punctuation,
 * paragraphs, headings, questions) before persisting.
 */

export interface AudioChunk {
  /** Raw container bytes (webm/opus from MediaRecorder). */
  data: Uint8Array;
  mimeType: string;
  /** Offset of the chunk start within the session. */
  atMs: number;
}

/** Partial segment emitted while a phrase is still being recognized. */
export interface LiveSegmentUpdate {
  segments: TranscriptSegment[];
  /** True when these segments are final (won't change). */
  final: boolean;
}

export interface TranscriptionSession {
  /** Feed the next audio chunk. */
  push(chunk: AudioChunk): Promise<void>;
  /** Flush and finish; resolves with any trailing segments. */
  finish(): Promise<TranscriptSegment[]>;
  /** Abort without finalizing. */
  abort(): Promise<void>;
}

export interface TranscriptionProviderInfo {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  /** True when transcription happens fully on-device. */
  local: boolean;
}

export interface TranscriptionProvider {
  readonly info: TranscriptionProviderInfo;
  isConfigured(): Promise<boolean>;
  /**
   * Open a live session. `onSegments` fires as speech is recognized;
   * segment ids/indexes are assigned by the caller-supplied allocator so the
   * pipeline stays the single source of truth for ordering.
   */
  startSession(options: {
    language: string;
    onSegments: (update: LiveSegmentUpdate) => void;
    onError: (error: Error) => void;
  }): Promise<TranscriptionSession>;
}

/**
 * A post-processing stage transforms the accumulating transcript
 * (punctuation restore, paragraph detection, heading/question tagging…).
 * Stages run in order after recording stops, and cheap ones also run live.
 */
export interface TranscriptStage {
  id: string;
  /** True when inexpensive enough to run on every live update. */
  live: boolean;
  process(segments: TranscriptSegment[]): Promise<TranscriptSegment[]>;
}
