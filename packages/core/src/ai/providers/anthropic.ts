import type { AIProvider, AIProviderInfo, ChatRequest, ChatResult } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, requireApiKey, trimBaseUrl } from './http';

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Anthropic Claude via the Messages API (`POST /v1/messages`).
 *
 * Wire-shape notes: the API key travels in `x-api-key` (plus the pinned
 * `anthropic-version` header), the system prompt is a top-level `system`
 * field (not a message), and `max_tokens` is mandatory. `temperature` is
 * deliberately never sent — current Claude models (Sonnet 5 / Opus 4.7+)
 * reject sampling parameters with a 400, and prompting is the supported way
 * to steer style.
 */
export class AnthropicProvider implements AIProvider {
  readonly info: AIProviderInfo = {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude models via the Anthropic API. Requires an Anthropic API key.',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  };

  constructor(private deps: ProviderDeps) {}

  async isConfigured(): Promise<boolean> {
    const key = await this.deps.getApiKey();
    return !!key && key.trim().length > 0;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const key = await requireApiKey(this.deps, this.info.name);
    const settings = this.deps.getSettings();
    const model = request.model ?? settings.model ?? this.info.defaultModel;
    const baseUrl = trimBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL);

    const systemParts = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content);
    // Claude has no native JSON mode; a system-level instruction is the
    // supported equivalent and keeps structured generation reliable.
    if (request.jsonMode) systemParts.push('Respond with a single valid JSON value and nothing else.');
    const system = systemParts.join('\n\n');

    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    if (messages.length === 0) {
      throw new SbError(ErrorCodes.VALIDATION, 'Chat request needs at least one user message.');
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
    };
    if (system) body.system = system;

    const json = await requestJson<AnthropicResponse>({
      providerName: this.info.name,
      url: `${baseUrl}/v1/messages`,
      logger: this.deps.logger,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
    });

    const text = (json.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    const usage =
      json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined
        ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
        : undefined;
    return { text, model: json.model ?? model, ...(usage ? { usage } : {}) };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.chat({
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 16,
      });
      return { ok: true, message: `Connected — ${result.model} responded.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
