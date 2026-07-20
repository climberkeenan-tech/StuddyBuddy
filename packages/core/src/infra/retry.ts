export interface RetryOptions {
  attempts?: number;
  /** Base delay in ms; grows exponentially with jitter. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return false to stop retrying for non-transient errors. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Run `fn` with exponential backoff + full jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      if (isLast || (opts.shouldRetry && !opts.shouldRetry(error, attempt))) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1)) * Math.random();
      opts.onRetry?.(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
