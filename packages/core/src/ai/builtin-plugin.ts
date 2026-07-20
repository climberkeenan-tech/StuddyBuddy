import type { AIProviderId, PluginManifest } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import type { PluginRegistry } from '../plugins/registry';
import type { SettingsService } from '../settings/settings-service';
import { apiKeyName, type SecretsVault } from '../settings/secrets-vault';
import type { ProviderDeps } from './providers/http';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';
import { MockProvider } from './providers/mock';
import { LocalHashEmbedding } from './embeddings/local-hash';
import { OpenAIEmbedding } from './embeddings/openai';
import { OllamaEmbedding } from './embeddings/ollama';

export interface BuiltinAIDeps {
  vault: SecretsVault;
  settings: SettingsService;
  logger: Logger;
}

const MANIFEST: PluginManifest = {
  id: 'builtin-ai',
  name: 'Built-in AI providers',
  version: '1.0.0',
  description:
    'Bundled AI chat providers (Anthropic, OpenAI, Gemini, Ollama, Offline) and embedding providers (OpenAI, Ollama, local hashing).',
  author: 'StuddyBuddy',
  contributes: ['ai-provider', 'embedding-provider'],
  builtIn: true,
};

/**
 * Register every bundled AI + embedding provider through the same extension
 * points a third-party plugin would use. Providers read keys/settings lazily
 * through closures, so key changes and settings edits apply on the next call
 * without re-registration.
 */
export function registerBuiltinAI(pluginRegistry: PluginRegistry, deps: BuiltinAIDeps): void {
  const providerDeps = (id: AIProviderId): ProviderDeps => ({
    getApiKey: () => deps.vault.getSecret(apiKeyName(id)),
    getSettings: () => deps.settings.get().aiProviderSettings[id] ?? {},
    logger: deps.logger.child(`ai:${id}`),
  });

  pluginRegistry.register(MANIFEST, (ctx) => {
    ctx.contribute('ai-provider', 'anthropic', new AnthropicProvider(providerDeps('anthropic')));
    ctx.contribute('ai-provider', 'openai', new OpenAIProvider(providerDeps('openai')));
    ctx.contribute('ai-provider', 'gemini', new GeminiProvider(providerDeps('gemini')));
    ctx.contribute('ai-provider', 'ollama', new OllamaProvider(providerDeps('ollama')));
    ctx.contribute('ai-provider', 'mock', new MockProvider());

    ctx.contribute('embedding-provider', 'local-hash', new LocalHashEmbedding());
    // Embedding providers reuse the matching chat provider's key + baseUrl
    // (one OpenAI key, one Ollama host) — their embed models are fixed.
    ctx.contribute('embedding-provider', 'openai', new OpenAIEmbedding(providerDeps('openai')));
    ctx.contribute('embedding-provider', 'ollama', new OllamaEmbedding(providerDeps('ollama')));
  });
}
