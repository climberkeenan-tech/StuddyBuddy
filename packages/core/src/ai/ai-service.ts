import type { Logger } from '../infra/logger';
import type { AIProviderRegistry } from './registry';
import { createStructuredGenerator } from './structured';
import type { AIFacade, ChatRequest, ChatResult } from './types';

export interface AIFacadeDeps {
  registry: AIProviderRegistry;
  logger: Logger;
}

/**
 * The single AI seam feature services depend on.
 *
 * - `available()` is false when the user chose Offline mode or the selected
 *   provider is unconfigured — features then take their deterministic
 *   heuristic paths instead of prompting a model.
 * - `chat()` always works: an unconfigured selection degrades to the mock
 *   provider (friendly offline text) rather than throwing.
 * - `generate` (structured JSON) resolves the selected provider synchronously;
 *   callers are expected to gate on `available()` first, exactly because the
 *   mock provider returns prose and would fail schema validation.
 */
export function createAIFacade(deps: AIFacadeDeps): AIFacade {
  const { registry, logger } = deps;
  return {
    available: async (): Promise<boolean> => (await registry.getActive()).info.id !== 'mock',
    activeLabel: (): string => registry.activeLabel(),
    chat: async (request: ChatRequest): Promise<ChatResult> =>
      (await registry.getActive()).chat(request),
    generate: createStructuredGenerator(() => registry.current(), logger.child('structured')),
  };
}
