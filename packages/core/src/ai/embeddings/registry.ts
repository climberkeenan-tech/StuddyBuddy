import type { ProviderDescriptor } from '@studdybuddy/shared';
import type { Logger } from '../../infra/logger';
import { ErrorCodes, SbError } from '../../infra/errors';
import type { PluginRegistry } from '../../plugins/registry';
import type { SettingsService } from '../../settings/settings-service';
import { apiKeyName, type SecretsVault } from '../../settings/secrets-vault';
import type { EmbeddingProvider } from '../types';

export interface EmbeddingRegistryDeps {
  pluginRegistry: PluginRegistry;
  settings: SettingsService;
  vault: SecretsVault;
  logger: Logger;
}

const FALLBACK_ID = 'local-hash';

/**
 * Selects the embedding provider for the RAG memory layer. The invariant here
 * is stronger than for chat: memory indexing/search must NEVER break, so any
 * missing or unconfigured selection silently degrades to the always-available
 * local-hash provider (with a warning).
 */
export class EmbeddingRegistry {
  constructor(private deps: EmbeddingRegistryDeps) {}

  /** The provider that should serve embed() calls right now. */
  async getActive(): Promise<EmbeddingProvider> {
    const id = this.deps.settings.get().embeddingProvider;
    const selected = this.deps.pluginRegistry.get('embedding-provider', id);
    if (selected) {
      if (id === FALLBACK_ID || (await selected.isConfigured())) return selected;
      this.deps.logger.warn('embedding provider not configured; falling back to local-hash', {
        id,
      });
    } else {
      this.deps.logger.warn('selected embedding provider not registered; falling back', { id });
    }
    return this.fallback();
  }

  /** Setup-UI descriptors for every registered embedding provider. */
  async descriptors(): Promise<ProviderDescriptor[]> {
    const contributions = this.deps.pluginRegistry.getAll('embedding-provider');
    return Promise.all(
      contributions.map(async ({ impl }) => {
        // EmbeddingProvider deliberately has no requiresApiKey field; concrete
        // providers expose it as an optional extra property for this UI.
        const requiresApiKey =
          (impl as EmbeddingProvider & { requiresApiKey?: boolean }).requiresApiKey ?? false;
        return {
          id: impl.id,
          kind: 'embedding' as const,
          name: impl.name,
          description: `${impl.name} — ${impl.dimensions}-dimensional vectors.`,
          requiresApiKey,
          hasApiKey: await this.deps.vault.hasSecret(apiKeyName(impl.id)),
          available: await impl.isConfigured(),
        };
      }),
    );
  }

  private fallback(): EmbeddingProvider {
    const provider = this.deps.pluginRegistry.get('embedding-provider', FALLBACK_ID);
    if (!provider) {
      throw new SbError(
        ErrorCodes.AI_PROVIDER_UNAVAILABLE,
        'The local-hash embedding fallback is not registered. Was registerBuiltinAI called?',
      );
    }
    return provider;
  }
}
