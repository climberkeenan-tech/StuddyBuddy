/**
 * Live transcription: the recording pipeline, post-processing stages, provider
 * implementations, the provider registry, and the built-in plugin registration.
 */
export * from './types';
export * from './stages/index';
export { buildTranscript, type BuildTranscriptOptions } from './build-transcript';
export { BrowserWhisperTranscription } from './providers/browser-whisper';
export {
  SimulatedTranscriptionProvider,
  type SimulatedProviderOptions,
} from './providers/simulated';
export {
  OpenAIWhisperTranscription,
  type OpenAIWhisperDeps,
} from './providers/openai-whisper';
export {
  WhisperCppTranscription,
  type WhisperCppDeps,
  type WhisperCppConfig,
} from './providers/whisper-cpp';
export {
  TranscriptionRegistry,
  type TranscriptionRegistryDeps,
  type RecordingProviderRegistry,
} from './registry';
export {
  RecordingService,
  type RecordingServiceDeps,
  type Clock,
} from './recording-service';
export {
  registerBuiltinTranscription,
  type BuiltinTranscriptionDeps,
} from './builtin-plugin';
