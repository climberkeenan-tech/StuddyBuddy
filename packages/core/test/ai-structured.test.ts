import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Logger } from '../src/infra/logger';
import { SbError } from '../src/infra/errors';
import { createStructuredGenerator, extractJson } from '../src/ai/structured';
import type { AIProvider, ChatRequest } from '../src/ai/types';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

function fakeProvider(responses: string[]): { provider: AIProvider; chat: ReturnType<typeof vi.fn> } {
  let call = 0;
  const chat = vi.fn(async (_request: ChatRequest) => {
    const text = responses[Math.min(call, responses.length - 1)]!;
    call++;
    return { text, model: 'fake-model' };
  });
  const provider: AIProvider = {
    info: {
      id: 'fake',
      name: 'Fake',
      description: 'test double',
      requiresApiKey: false,
      defaultModel: 'fake-model',
      models: ['fake-model'],
    },
    isConfigured: async () => true,
    chat,
    test: async () => ({ ok: true, message: 'ok' }),
  };
  return { provider, chat };
}

const schema = z.object({ title: z.string(), count: z.number() });

describe('createStructuredGenerator', () => {
  it('repairs after invalid JSON: retries with a correction prompt and succeeds', async () => {
    const { provider, chat } = fakeProvider([
      'sorry, here you go: definitely not json',
      '```json\n{"title": "Mitosis", "count": 4}\n```',
    ]);
    const generate = createStructuredGenerator(() => provider, noopLogger);

    const result = await generate({
      schema,
      schemaName: 'TestDoc',
      system: 'You produce test docs.',
      user: 'Make one.',
    });

    expect(result).toEqual({ title: 'Mitosis', count: 4 });
    expect(chat).toHaveBeenCalledTimes(2);

    const firstRequest = chat.mock.calls[0]![0] as ChatRequest;
    expect(firstRequest.jsonMode).toBe(true);
    expect(firstRequest.messages[0]!.content).toContain('TestDoc');

    // The repair turn must feed the failure back to the model.
    const secondRequest = chat.mock.calls[1]![0] as ChatRequest;
    const userMessage = secondRequest.messages.find((m) => m.role === 'user')!;
    expect(userMessage.content).toContain('previous response was invalid JSON');
  });

  it('repairs after schema-validation failure (valid JSON, wrong shape)', async () => {
    const { provider, chat } = fakeProvider([
      '{"title": "Mitosis", "count": "four"}',
      '{"title": "Mitosis", "count": 4}',
    ]);
    const generate = createStructuredGenerator(() => provider, noopLogger);
    const result = await generate({
      schema,
      schemaName: 'TestDoc',
      system: 'sys',
      user: 'go',
    });
    expect(result.count).toBe(4);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('throws AI_BAD_OUTPUT after exhausting repair attempts', async () => {
    const { provider, chat } = fakeProvider(['still not json']);
    const generate = createStructuredGenerator(() => provider, noopLogger);
    const error = await generate({
      schema,
      schemaName: 'TestDoc',
      system: 'sys',
      user: 'go',
      repairAttempts: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SbError);
    expect((error as SbError).code).toBe('AI_BAD_OUTPUT');
    expect(chat).toHaveBeenCalledTimes(2); // 1 initial + 1 repair
  });
});

describe('extractJson', () => {
  it('unwraps fenced blocks and surrounding chatter', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nHope that helps')).toBe('{"a": 1}');
    expect(extractJson('The answer is {"a": [1, 2]} — done.')).toBe('{"a": [1, 2]}');
    expect(extractJson('[1, 2, 3]')).toBe('[1, 2, 3]');
  });
});
