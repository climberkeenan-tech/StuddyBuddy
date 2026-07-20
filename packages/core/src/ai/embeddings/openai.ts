import type { EmbeddingProvider } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, requireApiKey, trimBaseUrl } from '../providers/http';

interface OpenAIEmbeddingResponse {
  data?: { index?: number; embedding?: number[] }[];
}

const DEFAULT_BASE_URL = 'https://api.openai.com';
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

/**
 * OpenAI `text-embedding-3-small` via `POST /v1/embeddings`. Higher-quality
 * semantic vectors than the local-hash fallback when a key is present.
 */
export class OpenAIEmbedding implements EmbeddingProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI embeddings';
  readonly dimensions = DIMENSIONS;
  /** Read by the embedding registry for Settings descriptors. */
  readonly requiresApiKey = true;

  constructor(private deps: ProviderDeps) {}

  async isConfigured(): Promise<boolean> {
    const key = await this.deps.getApiKey();
    return !!key && key.trim().length > 0;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const key = await requireApiKey(this.deps, this.name);
    const baseUrl = trimBaseUrl(this.deps.getSettings().baseUrl ?? DEFAULT_BASE_URL);

    const json = await requestJson<OpenAIEmbeddingResponse>({
      providerName: this.name,
      url: `${baseUrl}/v1/embeddings`,
      logger: this.deps.logger,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: MODEL, input: texts }),
      },
    });

    const rows = json.data ?? [];
    if (rows.length !== texts.length) {
      throw new SbError(
        ErrorCodes.AI_BAD_OUTPUT,
        `${this.name} returned ${rows.length} vectors for ${texts.length} inputs.`,
        { retryable: true },
      );
    }
    // The API documents order-by-index; sort defensively before mapping.
    return [...rows]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => row.embedding ?? []);
  }
}
