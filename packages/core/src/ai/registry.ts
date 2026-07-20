import type { AIProviderSettings, ProviderDescriptor } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { PluginRegistry } from '../plugins/registry';
import type { SettingsService } from '../settings/settings-service';
import { apiKeyName, type SecretsVault } from '../settings/secrets-vault';
import type { AIProvider } from './types';

export interface AIProviderRegistryDeps {
  pluginRegistry: PluginRegistry;
  settings: SettingsService;
  vault: SecretsVault;
  logger: Logger;
}

/**
 * Selects the active AI provider from settings and guarantees the app never
 * loses its AI seam: anything missing or unconfigured degrades to the mock
 * ("Offline") provider with a warning instead of failing. Also backs the
 * Settings screen (descriptors, connectivity test, key management).
 */
export class AIProviderRegistry {
  constructor(private deps: AIProviderRegistryDeps) {}

  /**
   * Synchronous resolution of the selected provider (mock when the selection
   * is not registered). Does NOT verify configuration — use {@link getActive}
   * where an async check is possible. Kept sync so the structured generator
   * and label stamping can resolve without awaiting.
   */
  current(): AIProvider {
    const id = this.deps.settings.get().aiProvider;
    const provider = this.deps.pluginRegistry.get('ai-provider', id);
    if (provider) return provider;
    this.deps.logger.warn('selected AI provider is not registered; using offline mode', { id });
    return this.mock();
  }

  /**
   * The provider that should actually serve requests: the selected one when
   * configured, otherwise the mock fallback (with a warning). Never throws
   * for a missing key — offline-first means degraded, not broken.
   */
  async getActive(): Promise<AIProvider> {
    const provider = this.current();
    if (provider.info.id === 'mock') return provider;
    if (await provider.isConfigured()) return provider;
    this.deps.logger.warn('active AI provider is not configured; falling back to offline mode', {
      id: provider.info.id,
    });
    return this.mock();
  }

  /** "<id>/<model>" of the selected provider, for stamping generated docs. */
  activeLabel(): string {
    const provider = this.current();
    const perProvider = this.deps.settings.get().aiProviderSettings as Partial<
      Record<string, AIProviderSettings>
    >;
    const model = perProvider[provider.info.id]?.model ?? provider.info.defaultModel;
    return `${provider.info.id}/${model}`;
  }

  /** Setup-UI descriptors for every registered AI provider. */
  async descriptors(): Promise<ProviderDescriptor[]> {
    const contributions = this.deps.pluginRegistry.getAll('ai-provider');
    return Promise.all(
      contributions.map(async ({ impl }) => ({
        id: impl.info.id,
        kind: 'ai' as const,
        name: impl.info.name,
        description: impl.info.description,
        requiresApiKey: impl.info.requiresApiKey,
        hasApiKey: await this.deps.vault.hasSecret(apiKeyName(impl.info.id)),
        available: await impl.isConfigured(),
        models: impl.info.models,
      })),
    );
  }

  /** Round-trip connectivity test for the Settings "Test" button. */
  async test(providerId: string): Promise<{ ok: boolean; message: string }> {
    const provider = this.deps.pluginRegistry.get('ai-provider', providerId);
    if (!provider) {
      throw new SbError(ErrorCodes.NOT_FOUND, `Unknown AI provider "${providerId}"`);
    }
    return provider.test();
  }

  /** Store a provider's API key in the encrypted vault (never in settings). */
  async setApiKey(providerId: string, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new SbError(ErrorCodes.VALIDATION, 'API key must not be empty.');
    }
    await this.deps.vault.setSecret(apiKeyName(providerId), trimmed);
    this.deps.logger.info('api key stored', { provider: providerId });
  }

  async clearApiKey(providerId: string): Promise<void> {
    await this.deps.vault.deleteSecret(apiKeyName(providerId));
    this.deps.logger.info('api key cleared', { provider: providerId });
  }

  private mock(): AIProvider {
    const mock = this.deps.pluginRegistry.get('ai-provider', 'mock');
    if (!mock) {
      throw new SbError(
        ErrorCodes.AI_PROVIDER_UNAVAILABLE,
        'No AI providers are registered — not even the offline fallback. Was registerBuiltinAI called?',
      );
    }
    return mock;
  }
}
