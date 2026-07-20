import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/infra/logger';
import { SbError } from '../src/infra/errors';
import { AnthropicProvider } from '../src/ai/providers/anthropic';
import { OpenAIProvider } from '../src/ai/providers/openai';
import { GeminiProvider } from '../src/ai/providers/gemini';
import { OllamaProvider } from '../src/ai/providers/ollama';
import { MockProvider } from '../src/ai/providers/mock';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const deps = (settings: { model?: string; baseUrl?: string } = {}) => ({
  getApiKey: async () => 'test-key',
  getSettings: () => settings,
  logger: noopLogger,
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const args = fetchMock.mock.calls[call]!;
  const url = args[0] as string;
  const init = args[1] as RequestInit;
  return { url, init, body: init.body ? (JSON.parse(init.body as string) as any) : undefined };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Zero out retry backoff delays so retry tests run instantly.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AnthropicProvider', () => {
  it('maps request: url, headers, top-level system, messages, max_tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        model: 'claude-sonnet-5',
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
    );
    const provider = new AnthropicProvider(deps());
    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      maxTokens: 128,
    });

    const { url, init, body } = lastRequest(fetchMock);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('You are helpful.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body.max_tokens).toBe(128);
    // Sampling params are rejected by current Claude models — never sent.
    expect(body.temperature).toBeUndefined();

    expect(result.text).toBe('Hello world');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it('appends a JSON instruction to system when jsonMode is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '{}' }] }));
    await new AnthropicProvider(deps()).chat({
      messages: [{ role: 'user', content: 'Give me data' }],
      jsonMode: true,
    });
    const { body } = lastRequest(fetchMock);
    expect(String(body.system)).toMatch(/JSON/i);
  });

  it('honors settings model + baseUrl overrides', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }));
    await new AnthropicProvider(deps({ model: 'claude-opus-4-8', baseUrl: 'https://proxy.local/' })).chat({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const { url, body } = lastRequest(fetchMock);
    expect(url).toBe('https://proxy.local/v1/messages');
    expect(body.model).toBe('claude-opus-4-8');
  });

  it('maps 401 to a non-retryable "check your API key" error without retrying', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'nope' }, 401));
    const provider = new AnthropicProvider(deps());
    const error = await provider
      .chat({ messages: [{ role: 'user', content: 'Hi' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SbError);
    expect((error as SbError).code).toBe('AI_REQUEST_FAILED');
    expect((error as SbError).retryable).toBe(false);
    expect((error as SbError).message).toContain('check your API key in Settings');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 500 to a retryable error and retries 3 times', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'boom' }, 500));
    const provider = new AnthropicProvider(deps());
    const error = await provider
      .chat({ messages: [{ role: 'user', content: 'Hi' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SbError);
    expect((error as SbError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps 429 to a retryable error', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'slow down' }, 429));
    const error = await new AnthropicProvider(deps())
      .chat({ messages: [{ role: 'user', content: 'Hi' }] })
      .catch((e: unknown) => e);
    expect((error as SbError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('is unconfigured without a key and chat() explains the fix', async () => {
    const provider = new AnthropicProvider({ ...deps(), getApiKey: async () => null });
    expect(await provider.isConfigured()).toBe(false);
    const error = await provider
      .chat({ messages: [{ role: 'user', content: 'Hi' }] })
      .catch((e: unknown) => e);
    expect((error as SbError).code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAIProvider', () => {
  it('maps request: url, bearer auth, messages, response_format in jsonMode', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: '{"a":1}' } }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      }),
    );
    const result = await new OpenAIProvider(deps()).chat({
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Extract the data' },
      ],
      temperature: 0.2,
      maxTokens: 256,
      jsonMode: true,
    });

    const { url, init, body } = lastRequest(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
    expect(body.response_format).toEqual({ type: 'json_object' });
    // The API requires the word JSON in the prompt for json_object mode.
    expect(
      (body.messages as { content: string }[]).some((m) => /json/i.test(m.content)),
    ).toBe(true);

    expect(result.text).toBe('{"a":1}');
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
  });

  it('does not append an extra JSON message when the prompt already mentions JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    await new OpenAIProvider(deps()).chat({
      messages: [{ role: 'user', content: 'Return JSON describing a cat' }],
      jsonMode: true,
    });
    const { body } = lastRequest(fetchMock);
    expect((body.messages as unknown[]).length).toBe(1);
  });

  it('maps 401 to check-your-key and 500 to retryable', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 401));
    const e401 = await new OpenAIProvider(deps())
      .chat({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect((e401 as SbError).message).toContain('check your API key in Settings');
    expect((e401 as SbError).retryable).toBe(false);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse({}, 500));
    const e500 = await new OpenAIProvider(deps())
      .chat({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect((e500 as SbError).retryable).toBe(true);
  });
});

describe('GeminiProvider', () => {
  it('maps request: url with model+key, systemInstruction, roles, jsonMode mime type', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'answer' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      }),
    );
    const result = await new GeminiProvider(deps()).chat({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Question?' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Follow-up' },
      ],
      maxTokens: 64,
      jsonMode: true,
    });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-key',
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Question?' }] },
      { role: 'model', parts: [{ text: 'Earlier answer' }] },
      { role: 'user', parts: [{ text: 'Follow-up' }] },
    ]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 64,
      responseMimeType: 'application/json',
    });

    expect(result.text).toBe('answer');
    expect(result.model).toBe('gemini-2.0-flash');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
  });

  it('redacts the API key from error details', async () => {
    fetchMock.mockImplementation(async () => new Response('bad key: test-key', { status: 400 }));
    const error = await new GeminiProvider(deps())
      .chat({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect(JSON.stringify((error as SbError).details ?? {})).not.toContain('test-key');
  });
});

describe('OllamaProvider', () => {
  it('maps request: /api/chat, stream false, format json, model from settings', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        message: { content: 'local answer' },
        model: 'llama3.2',
        prompt_eval_count: 11,
        eval_count: 6,
      }),
    );
    const result = await new OllamaProvider(deps({ model: 'llama3.2' })).chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hey' },
      ],
      jsonMode: true,
      maxTokens: 200,
      temperature: 0.1,
    });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.model).toBe('llama3.2');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hey' },
    ]);
    expect(body.options).toEqual({ temperature: 0.1, num_predict: 200 });

    expect(result.text).toBe('local answer');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 6 });
  });

  it('isConfigured() probes GET /api/tags and survives a down daemon', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }));
    const provider = new OllamaProvider(deps());
    expect(await provider.isConfigured()).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await provider.isConfigured()).toBe(false);
  });

  it('test() reports a missing model as ok-with-hint and a dead daemon as failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ name: 'mistral:latest' }] }));
    const up = await new OllamaProvider(deps()).test();
    expect(up.ok).toBe(true);
    expect(up.message).toContain('ollama pull llama3.2');

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const down = await new OllamaProvider(deps()).test();
    expect(down.ok).toBe(false);
    expect(down.message).toContain('not reachable');
  });
});

describe('MockProvider', () => {
  it('is always configured and needs no key', async () => {
    const provider = new MockProvider();
    expect(provider.info.id).toBe('mock');
    expect(provider.info.requiresApiKey).toBe(false);
    expect(await provider.isConfigured()).toBe(true);
    expect((await provider.test()).ok).toBe(true);
  });

  it('returns deterministic friendly text derived from the last user message', async () => {
    const provider = new MockProvider();
    const request = {
      messages: [
        { role: 'system' as const, content: 'sys' },
        { role: 'user' as const, content: 'What is DNA replication?' },
      ],
    };
    const first = await provider.chat(request);
    const second = await provider.chat(request);
    expect(first.text).toBe(second.text);
    expect(first.text).toContain('What is DNA replication?');
    expect(first.text).toContain('Settings');
    expect(first.model).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
