import type {
  AudioChunk,
  LiveSegmentUpdate,
  TranscriptionProvider,
  TranscriptionProviderInfo,
  TranscriptionSession,
} from '../types';

/**
 * On-device Whisper that runs in the *renderer* (WebAssembly / WebGPU via
 * Transformers.js), not the main process. Real speech-to-text with no API key
 * and no cloud — the model is fetched once and then works offline.
 *
 * Because recognition happens in the browser layer, this main-process provider
 * is intentionally passive: it opens a session but does no work with the audio
 * chunks. The renderer decodes the microphone audio, runs Whisper, and pushes
 * the recognized transcript back through `recording.pushSegments`, which the
 * {@link import('../recording-service').RecordingService} injects via
 * `ingestSegments` as a full-replacement update (same contract as the cloud
 * Whisper provider). Keeping a real provider registered means the engine shows
 * up in Settings, is selectable, and is reported as always-available.
 */
export class BrowserWhisperTranscription implements TranscriptionProvider {
  readonly info: TranscriptionProviderInfo = {
    id: 'browser-whisper',
    name: 'On-device Whisper (no setup)',
    description:
      'Real speech-to-text that runs on your device — transcribes your microphone with no API key and no cloud. Downloads a small model once, then works offline.',
    requiresApiKey: false,
    local: true,
  };

  /** Always usable: the model streams in on first use, no configuration needed. */
  async isConfigured(): Promise<boolean> {
    return true;
  }

  async startSession(_options: {
    language: string;
    onSegments: (update: LiveSegmentUpdate) => void;
    onError: (error: Error) => void;
  }): Promise<TranscriptionSession> {
    // The renderer owns recognition; the main-process session is a no-op sink.
    return {
      push: async (_chunk: AudioChunk) => {},
      finish: async () => [],
      abort: async () => {},
    };
  }
}
