import type { ProviderDescriptor } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { PluginRegistry } from '../plugins/registry';
import type { SettingsService } from '../settings/settings-service';
import { apiKeyName, type SecretsVault } from '../settings/secrets-vault';
import type { TranscriptionProvider } from './types';

export interface TranscriptionRegistryDeps {
  pluginRegistry: PluginRegistry;
  settings: SettingsService;
  vault: SecretsVault;
  logger: Logger;
}

/** The single capability the RecordingService needs from a provider source. */
export interface RecordingProviderRegistry {
  /** The provider that should serve the next recording (never throws). */
  getActive(): Promise<TranscriptionProvider>;
}

/** Fallback provider id — always registered, always usable, no setup. */
const FALLBACK_ID = 'simulated';

/**
 * Selects the active transcription provider from settings and guarantees the
 * app always has a usable engine: an unregistered or unconfigured selection
 * degrades to the offline "simulated" provider with a warning instead of
 * failing. Mirrors {@link import('../ai/registry').AIProviderRegistry} and
 * backs the Settings screen via {@link descriptors}.
 */
export class TranscriptionRegistry implements RecordingProviderRegistry {
  constructor(private deps: TranscriptionRegistryDeps) {}

  /** Synchronous resolution of the selected provider (simulated when missing). */
  current(): TranscriptionProvider {
    const id = this.deps.settings.get().transcriptionProvider;
    const provider = this.deps.pluginRegistry.get('transcription-provider', id);
    if (provider) return provider;
    this.deps.logger.warn('selected transcription provider is not registered; using demo voice', {
      id,
    });
    return this.fallback();
  }

  /**
   * The provider that should actually record: the selected one when configured,
   * otherwise the simulated fallback (with a warning). Never throws for a
   * missing key/binary — offline-first means degraded, not broken.
   */
  async getActive(): Promise<TranscriptionProvider> {
    const provider = this.current();
    if (provider.info.id === FALLBACK_ID) return provider;
    if (await provider.isConfigured()) return provider;
    this.deps.logger.warn(
      'active transcription provider is not configured; falling back to demo voice',
      { id: provider.info.id },
    );
    return this.fallback();
  }

  /** Setup-UI descriptors for every registered transcription provider. */
  async descriptors(): Promise<ProviderDescriptor[]> {
    const contributions = this.deps.pluginRegistry.getAll('transcription-provider');
    return Promise.all(
      contributions.map(async ({ impl }) => ({
        id: impl.info.id,
        kind: 'transcription' as const,
        name: impl.info.name,
        description: impl.info.description,
        requiresApiKey: impl.info.requiresApiKey,
        hasApiKey: impl.info.requiresApiKey
          ? await this.deps.vault.hasSecret(apiKeyName(impl.info.id))
          : false,
        available: await impl.isConfigured(),
      })),
    );
  }

  private fallback(): TranscriptionProvider {
    const provider = this.deps.pluginRegistry.get('transcription-provider', FALLBACK_ID);
    if (!provider) {
      throw new SbError(
        ErrorCodes.TRANSCRIPTION_FAILED,
        'No transcription providers are registered — not even the offline fallback. Was registerBuiltinTranscription called?',
      );
    }
    return provider;
  }
}
