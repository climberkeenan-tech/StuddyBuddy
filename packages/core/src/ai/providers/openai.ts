import type { AIProvider, AIProviderInfo, ChatMessage, ChatRequest, ChatResult } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, requireApiKey, trimBaseUrl } from './http';

interface OpenAIChatResponse {
  choices?: { message?: { content?: string | null } }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const DEFAULT_BASE_URL = 'https://api.openai.com';

/**
 * OpenAI via the Chat Completions API (`POST /v1/chat/completions`).
 *
 * When `jsonMode` is requested we send `response_format: {type: "json_object"}`;
 * the OpenAI API rejects that unless the literal word "JSON" appears somewhere
 * in the prompt, so a clarifying system message is appended when missing.
 */
export class OpenAIProvider implements AIProvider {
  readonly info: AIProviderInfo = {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models via the OpenAI API. Requires an OpenAI API key.',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
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

    if (request.messages.length === 0) {
      throw new SbError(ErrorCodes.VALIDATION, 'Chat request needs at least one message.');
    }
    const messages: ChatMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // API requirement: json_object mode demands the word "JSON" in the prompt.
    if (request.jsonMode && !messages.some((m) => /json/i.test(m.content))) {
      messages.push({ role: 'system', content: 'Respond with a valid JSON object.' });
    }

    const body: Record<string, unknown> = { model, messages };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.jsonMode) body.response_format = { type: 'json_object' };

    const json = await requestJson<OpenAIChatResponse>({
      providerName: this.info.name,
      url: `${baseUrl}/v1/chat/completions`,
      logger: this.deps.logger,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      },
    });

    const text = json.choices?.[0]?.message?.content ?? '';
    const usage =
      json.usage?.prompt_tokens !== undefined && json.usage.completion_tokens !== undefined
        ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
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
