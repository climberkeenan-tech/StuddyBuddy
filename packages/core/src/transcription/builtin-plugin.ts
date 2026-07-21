import type { PluginManifest } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import type { PluginRegistry } from '../plugins/registry';
import type { SettingsService } from '../settings/settings-service';
import { apiKeyName, type SecretsVault } from '../settings/secrets-vault';
import { BrowserWhisperTranscription } from './providers/browser-whisper';
import { SimulatedTranscriptionProvider } from './providers/simulated';
import { OpenAIWhisperTranscription } from './providers/openai-whisper';
import { WhisperCppTranscription } from './providers/whisper-cpp';

export interface BuiltinTranscriptionDeps {
  vault: SecretsVault;
  settings: SettingsService;
  logger: Logger;
}

const MANIFEST: PluginManifest = {
  id: 'builtin-transcription',
  name: 'Built-in transcription engines',
  version: '1.0.0',
  description:
    'Bundled transcription providers: on-device Whisper (real, no setup), OpenAI Whisper (cloud), whisper.cpp (fully local), and a microphone-free demo voice.',
  author: 'StuddyBuddy',
  contributes: ['transcription-provider'],
  builtIn: true,
};

/**
 * Register the three bundled transcription providers through the same
 * extension point a third-party engine would use. Providers read keys/config
 * lazily through closures, so key changes and settings edits take effect on the
 * next session without re-registration. The simulated provider is always
 * present as the offline-first fallback.
 */
export function registerBuiltinTranscription(
  pluginRegistry: PluginRegistry,
  deps: BuiltinTranscriptionDeps,
): void {
  pluginRegistry.register(MANIFEST, (ctx) => {
    ctx.contribute('transcription-provider', 'browser-whisper', new BrowserWhisperTranscription());
    ctx.contribute('transcription-provider', 'simulated', new SimulatedTranscriptionProvider());
    ctx.contribute(
      'transcription-provider',
      'openai-whisper',
      new OpenAIWhisperTranscription({
        getApiKey: () => deps.vault.getSecret(apiKeyName('openai')),
        logger: deps.logger.child('transcription:openai-whisper'),
      }),
    );
    ctx.contribute(
      'transcription-provider',
      'whisper-cpp',
      new WhisperCppTranscription({
        getConfig: () => deps.settings.get().whisperCpp,
        logger: deps.logger.child('transcription:whisper-cpp'),
      }),
    );
  });
}
