import { truncate } from '@studdybuddy/shared';
import type { AIProvider, AIProviderInfo, ChatRequest, ChatResult } from '../types';

/**
 * The explicit "no AI" choice. Always configured, zero network, deterministic.
 *
 * Its chat() answers conversational fallbacks (explain/ask) with a short,
 * friendly note derived from the last user message, so the UI never dead-ends
 * when no provider is set up. Feature modules must NOT call it for structured
 * output — they use their own transcript-derived heuristics when the facade
 * reports `available() === false` (this provider intentionally returns prose,
 * not JSON, so a misuse fails fast as AI_BAD_OUTPUT).
 */
export class MockProvider implements AIProvider {
  readonly info: AIProviderInfo = {
    id: 'mock',
    name: 'Offline (no AI)',
    description:
      'No AI provider. StuddyBuddy stays fully functional using built-in offline study tools.',
    requiresApiKey: false,
    defaultModel: 'offline',
    models: ['offline'],
  };

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const question = truncate((lastUser?.content ?? '').replace(/\s+/g, ' ').trim(), 160);
    const lines = [
      "I'm in offline mode, so I can't generate an AI answer right now.",
      question
        ? `You asked: "${question}" — your notes, transcript search, and flashcards are the best place to dig into that.`
        : 'Your notes, transcript search, and flashcards all keep working offline.',
      'To get AI answers, pick a provider and add its API key in Settings (or start Ollama for a local model).',
    ];
    return { text: lines.join('\n\n'), model: this.info.defaultModel };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Offline mode is always available — no setup needed.' };
  }
}
