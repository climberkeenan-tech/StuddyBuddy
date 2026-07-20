/**
 * Common primitives shared across the entire application.
 */

/** Milliseconds since Unix epoch. */
export type Timestamp = number;

/** Milliseconds offset from the start of a recording. */
export type MediaOffsetMs = number;

/** Opaque entity identifier (UUID v4). */
export type EntityId = string;

/** Discriminated result type used at service boundaries instead of thrown errors. */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Serializable application error that can safely cross the IPC boundary. */
export interface AppError {
  /** Stable machine-readable code, e.g. "AI_PROVIDER_UNAVAILABLE". */
  code: string;
  /** Human-readable message safe to show in the UI. */
  message: string;
  /** Optional structured details for logging/debugging (never secrets). */
  details?: Record<string, unknown>;
  /** Whether retrying the same operation may succeed. */
  retryable?: boolean;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Progress event emitted by long-running jobs (generation, analysis, export). */
export interface JobProgress {
  jobId: string;
  kind: string;
  /** 0..1 fraction, or -1 when indeterminate. */
  progress: number;
  /** Short human-readable status line, e.g. "Extracting concepts…". */
  message: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  error?: AppError;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
