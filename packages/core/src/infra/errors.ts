import type { AppError } from '@studdybuddy/shared';

/** Error class carrying a stable code + IPC-safe serialization. */
export class SbError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts?: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = 'SbError';
    this.code = code;
    this.details = opts?.details;
    this.retryable = opts?.retryable ?? false;
  }

  toAppError(): AppError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  STORAGE_FAILURE: 'STORAGE_FAILURE',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',
  AI_BAD_OUTPUT: 'AI_BAD_OUTPUT',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  RECORDING_STATE: 'RECORDING_STATE',
  EXPORT_FAILED: 'EXPORT_FAILED',
  SECRETS_FAILURE: 'SECRETS_FAILURE',
  PLUGIN_FAILURE: 'PLUGIN_FAILURE',
  BACKUP_FAILED: 'BACKUP_FAILED',
} as const;

/** Convert any thrown value into an IPC-safe AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof SbError) return e.toAppError();
  if (e instanceof Error) {
    return { code: 'INTERNAL', message: e.message, retryable: false };
  }
  return { code: 'INTERNAL', message: String(e), retryable: false };
}
