import type { z } from 'zod';

/**
 * AI provider abstraction. Every LLM vendor (Anthropic, OpenAI, Gemini,
 * Ollama, mock) implements `AIProvider`; the registry handles selection,
 * retries, and failover. Nothing outside `src/ai` talks to a vendor SDK/API.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Override the provider's default model. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON output when it supports it. */
  jsonMode?: boolean;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProviderInfo {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultModel: string;
  models: string[];
}

export interface AIProvider {
  readonly info: AIProviderInfo;
  /** Cheap availability check: key present, host reachable (no network unless needed). */
  isConfigured(): Promise<boolean>;
  chat(request: ChatRequest): Promise<ChatResult>;
  /** Round-trip connectivity test used by Settings "Test" button. */
  test(): Promise<{ ok: boolean; message: string }>;
}

/** Embedding provider abstraction for the RAG memory layer. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  isConfigured(): Promise<boolean>;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Facade over the active AI provider that feature services depend on.
 * `available()` is false when the user selected the offline "mock" provider
 * or the active provider is missing credentials — features then fall back to
 * their deterministic heuristic paths so the app stays fully functional.
 */
export interface AIFacade {
  available(): Promise<boolean>;
  /** "provider/model" string for stamping generated documents. */
  activeLabel(): string;
  chat(request: ChatRequest): Promise<ChatResult>;
  generate: import('./structured').StructuredGenerator;
}

/**
 * Structured generation: prompt an LLM for JSON matching a zod schema, with
 * automatic extraction, validation, and bounded repair retries.
 */
export interface StructuredRequest<T> {
  schema: z.ZodType<T>;
  /** Name used in prompts + errors, e.g. "LectureAnalysis". */
  schemaName: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Repair attempts after a validation failure (default 2). */
  repairAttempts?: number;
}
