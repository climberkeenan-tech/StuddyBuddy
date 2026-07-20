import type { EmbeddingProvider } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, trimBaseUrl } from '../providers/http';

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const MODEL = 'nomic-embed-text';
const DIMENSIONS = 768;
const PROBE_TIMEOUT_MS = 1500;

/**
 * Local embeddings through Ollama's `POST /api/embed` (nomic-embed-text).
 * Keyless; "configured" means the daemon answers `GET /api/tags` quickly.
 */
export class OllamaEmbedding implements EmbeddingProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama embeddings (local)';
  readonly dimensions = DIMENSIONS;
  readonly requiresApiKey = false;

  constructor(private deps: ProviderDeps) {}

  private baseUrl(): string {
    return trimBaseUrl(this.deps.getSettings().baseUrl ?? DEFAULT_BASE_URL);
  }

  async isConfigured(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const json = await requestJson<OllamaEmbedResponse>({
      providerName: this.name,
      url: `${this.baseUrl()}/api/embed`,
      logger: this.deps.logger,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, input: texts }),
      },
    });

    const vectors = json.embeddings ?? [];
    if (vectors.length !== texts.length) {
      throw new SbError(
        ErrorCodes.AI_BAD_OUTPUT,
        `${this.name} returned ${vectors.length} vectors for ${texts.length} inputs.`,
        { retryable: true },
      );
    }
    return vectors;
  }
}
