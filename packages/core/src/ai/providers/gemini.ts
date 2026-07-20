import type { AIProvider, AIProviderInfo, ChatRequest, ChatResult } from '../types';
import { ErrorCodes, SbError } from '../../infra/errors';
import { type ProviderDeps, requestJson, requireApiKey, trimBaseUrl } from './http';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Google Gemini via the Generative Language API
 * (`POST /v1beta/models/<model>:generateContent?key=...`).
 *
 * The API key rides in the URL query string, so every error path runs through
 * a redactor that scrubs the key before it can reach messages or logs. The
 * system prompt maps to `systemInstruction` and assistant turns to the
 * `model` role.
 */
export class GeminiProvider implements AIProvider {
  readonly info: AIProviderInfo = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini models via the Google Generative Language API. Requires a Google AI API key.',
    requiresApiKey: true,
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
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

    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    if (contents.length === 0) {
      throw new SbError(ErrorCodes.VALIDATION, 'Chat request needs at least one user message.');
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.jsonMode) generationConfig.responseMimeType = 'application/json';

    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const json = await requestJson<GeminiResponse>({
      providerName: this.info.name,
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      logger: this.deps.logger,
      redact: (text) => text.split(key).join('***'),
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    });

    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const usage =
      json.usageMetadata?.promptTokenCount !== undefined &&
      json.usageMetadata.candidatesTokenCount !== undefined
        ? {
            inputTokens: json.usageMetadata.promptTokenCount,
            outputTokens: json.usageMetadata.candidatesTokenCount,
          }
        : undefined;
    return { text, model, ...(usage ? { usage } : {}) };
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
