import type { Logger } from '../../infra/logger';
import { ErrorCodes, SbError } from '../../infra/errors';
import { withRetry } from '../../infra/retry';

/**
 * Shared plumbing for the HTTP-based AI providers: constructor dependency
 * shape, error mapping, and a retrying JSON request helper. Every vendor call
 * funnels through {@link requestJson} so timeout, retry, and error-to-SbError
 * mapping behave identically across providers.
 */
export interface ProviderDeps {
  /** Resolve the provider's API key from the secrets vault (null when unset). */
  getApiKey: () => Promise<string | null>;
  /** Live per-provider settings (model override, base URL override). */
  getSettings: () => { model?: string; baseUrl?: string };
  logger: Logger;
}

/** Hard per-request timeout; providers must never hang the UI indefinitely. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Retry attempts for transient failures (429/5xx/network). */
export const RETRY_ATTEMPTS = 3;

/** Strip a trailing slash so URL joins are predictable. */
export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Throw when a provider that needs an API key has none stored. The message is
 * user-facing (surfaces in the Settings "Test" button and error toasts).
 */
export async function requireApiKey(deps: ProviderDeps, providerName: string): Promise<string> {
  const key = await deps.getApiKey();
  if (!key || !key.trim()) {
    throw new SbError(
      ErrorCodes.AI_PROVIDER_UNAVAILABLE,
      `${providerName} has no API key — add one in Settings to enable AI features.`,
    );
  }
  return key.trim();
}

/**
 * Map a non-2xx HTTP status to an SbError. 401/403 mean a bad key (actionable
 * user message, not retryable); 429 and 5xx are transient (retryable).
 */
export function mapHttpError(providerName: string, status: number, body: string): SbError {
  if (status === 401 || status === 403) {
    return new SbError(
      ErrorCodes.AI_REQUEST_FAILED,
      `${providerName} rejected the request (HTTP ${status}) — check your API key in Settings.`,
      { details: { status }, retryable: false },
    );
  }
  const retryable = status === 429 || status >= 500;
  const reason = status === 429 ? 'rate limited' : retryable ? 'service error' : 'request rejected';
  return new SbError(
    ErrorCodes.AI_REQUEST_FAILED,
    `${providerName} request failed (HTTP ${status}, ${reason}).`,
    { details: { status, body: body.slice(0, 300) }, retryable },
  );
}

export interface JsonRequestOptions {
  providerName: string;
  url: string;
  init: Omit<RequestInit, 'signal'>;
  logger: Logger;
  /**
   * Applied to any text that could end up in error messages/details. Used to
   * scrub secrets (e.g. Gemini carries the key in the URL, which fetch echoes
   * into network-error messages).
   */
  redact?: (text: string) => string;
  timeoutMs?: number;
}

/**
 * POST/GET JSON with a hard timeout, exponential-backoff retry on transient
 * failures, and uniform SbError mapping. Never logs request bodies or keys.
 */
export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const { providerName, url, init, logger } = options;
  const redact = options.redact ?? ((text: string) => text);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return withRetry(
    async () => {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const isTimeout = e instanceof Error && e.name === 'TimeoutError';
        const message = isTimeout
          ? `${providerName} request timed out after ${Math.round(timeoutMs / 1000)}s.`
          : `Could not reach ${providerName}: ${redact(e instanceof Error ? e.message : String(e))}`;
        throw new SbError(ErrorCodes.AI_REQUEST_FAILED, message, { retryable: true, cause: e });
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw mapHttpError(providerName, response.status, redact(body));
      }
      try {
        return (await response.json()) as T;
      } catch (e) {
        throw new SbError(
          ErrorCodes.AI_REQUEST_FAILED,
          `${providerName} returned an unreadable response.`,
          { retryable: false, cause: e },
        );
      }
    },
    {
      attempts: RETRY_ATTEMPTS,
      shouldRetry: (error) => error instanceof SbError && error.retryable,
      onRetry: (_error, attempt, delayMs) =>
        logger.warn('retrying provider request', {
          provider: providerName,
          attempt,
          delayMs: Math.round(delayMs),
        }),
    },
  );
}
