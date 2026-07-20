import type { AIProvider, AIProviderInfo, ChatRequest, ChatResult } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, trimBaseUrl } from './http';

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Short probe timeout: a local daemon answers instantly or not at all. */
const PROBE_TIMEOUT_MS = 1500;

/**
 * Local models via the Ollama daemon (`POST /api/chat`, `stream: false`).
 *
 * No API key — "configured" means the daemon answers `GET /api/tags` on the
 * configured host within 1.5s. jsonMode maps to Ollama's `format: "json"`.
 */
export class OllamaProvider implements AIProvider {
  readonly info: AIProviderInfo = {
    id: 'ollama',
    name: 'Ollama (local)',
    description: 'Run models locally through an Ollama daemon. No API key required.',
    requiresApiKey: false,
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5', 'phi3'],
  };

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

  async chat(request: ChatRequest): Promise<ChatResult> {
    const settings = this.deps.getSettings();
    const model = request.model ?? settings.model ?? this.info.defaultModel;

    if (request.messages.length === 0) {
      throw new SbError(ErrorCodes.VALIDATION, 'Chat request needs at least one message.');
    }

    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.maxTokens !== undefined) options.num_predict = request.maxTokens;

    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };
    if (request.jsonMode) body.format = 'json';
    if (Object.keys(options).length > 0) body.options = options;

    const json = await requestJson<OllamaChatResponse>({
      providerName: this.info.name,
      url: `${this.baseUrl()}/api/chat`,
      logger: this.deps.logger,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    });

    const usage =
      json.prompt_eval_count !== undefined && json.eval_count !== undefined
        ? { inputTokens: json.prompt_eval_count, outputTokens: json.eval_count }
        : undefined;
    return { text: json.message?.content ?? '', model: json.model ?? model, ...(usage ? { usage } : {}) };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const base = this.baseUrl();
    try {
      const response = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, message: `Ollama answered HTTP ${response.status} at ${base}.` };
      }
      const json = (await response.json()) as OllamaTagsResponse;
      const names = (json.models ?? []).map((m) => m.name ?? '').filter(Boolean);
      const model = this.deps.getSettings().model ?? this.info.defaultModel;
      const hasModel = names.some((n) => n === model || n.startsWith(`${model}:`));
      return {
        ok: true,
        message: hasModel
          ? `Ollama is running at ${base} with "${model}" available (${names.length} model(s) installed).`
          : `Ollama is running at ${base} (${names.length} model(s) installed), but "${model}" is not pulled yet — run \`ollama pull ${model}\`.`,
      };
    } catch {
      return {
        ok: false,
        message: `Ollama is not reachable at ${base}. Start it with \`ollama serve\` or fix the base URL in Settings.`,
      };
    }
  }
}
