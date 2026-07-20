/**
 * User-facing settings. Persisted locally; API keys live in the encrypted
 * secrets vault, never in this document.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export type AIProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'mock';

export type TranscriptionProviderId = 'openai-whisper' | 'whisper-cpp' | 'simulated';

export type EmbeddingProviderId = 'openai' | 'ollama' | 'local-hash';

export interface AIProviderSettings {
  /** Model id to use for chat/analysis, e.g. "claude-sonnet-5". */
  model?: string;
  /** Base URL override (Ollama host, corporate proxy, etc.). */
  baseUrl?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  /** Reduce motion for accessibility; also follows the OS setting when "system". */
  reduceMotion: 'system' | 'on' | 'off';
  /** Active AI provider for analysis/generation. */
  aiProvider: AIProviderId;
  /** Per-provider options keyed by provider id. */
  aiProviderSettings: Partial<Record<AIProviderId, AIProviderSettings>>;
  transcriptionProvider: TranscriptionProviderId;
  embeddingProvider: EmbeddingProviderId;
  /** Path to a local whisper.cpp binary + model, when using whisper-cpp. */
  whisperCpp?: { binaryPath: string; modelPath: string };
  /** Keep raw audio recordings on disk after transcription. */
  keepAudio: boolean;
  /** Auto-generate the study kit (notes, summary, flashcards, quiz) after each lecture. */
  autoGenerateStudyKit: boolean;
  /** Default difficulty for generated materials. */
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  /** Language hint for transcription, e.g. "en". */
  language: string;
  onboardingComplete: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  reduceMotion: 'system',
  aiProvider: 'mock',
  aiProviderSettings: {},
  transcriptionProvider: 'simulated',
  embeddingProvider: 'local-hash',
  keepAudio: true,
  autoGenerateStudyKit: true,
  defaultDifficulty: 'medium',
  language: 'en',
  onboardingComplete: false,
};

/** Descriptor for provider setup UI (which keys are needed, status). */
export interface ProviderDescriptor {
  id: string;
  kind: 'ai' | 'transcription' | 'embedding';
  name: string;
  description: string;
  requiresApiKey: boolean;
  /** Whether a key is currently stored in the vault. */
  hasApiKey: boolean;
  /** Whether the provider is usable right now (key present / binary found / built-in). */
  available: boolean;
  models?: string[];
}
