import type { TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';
import type { Logger } from '../../infra/logger';
import { ErrorCodes, SbError } from '../../infra/errors';
import type {
  AudioChunk,
  LiveSegmentUpdate,
  TranscriptionProvider,
  TranscriptionProviderInfo,
  TranscriptionSession,
} from '../types';

export interface OpenAIWhisperDeps {
  /** Resolve the OpenAI API key from the secrets vault (null when unset). */
  getApiKey: () => Promise<string | null>;
  logger: Logger;
  /** Base URL override for the OpenAI-compatible endpoint. */
  baseUrl?: string;
}

interface VerboseJsonResponse {
  language?: string;
  segments?: { start?: number; end?: number; text?: string }[];
  text?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com';

/** Re-transcribe roughly every 20 seconds of accumulated audio. */
const TRANSCRIBE_INTERVAL_MS = 20_000;

/**
 * Cloud transcription via OpenAI's `whisper-1` model.
 *
 * Whisper transcribes whole files, not streams, so this provider accumulates
 * every webm chunk and periodically re-POSTs the *entire* accumulated audio,
 * replacing all previously-emitted segments with the fresh result. Because of
 * that, **every `onSegments` emission for this provider carries the full,
 * authoritative segment list** (`final: true`) — the RecordingService detects
 * this provider by id and replaces its in-memory list wholesale rather than
 * appending. Errors are reported to `onError` (and raised as
 * TRANSCRIPTION_FAILED internally) without tearing down the session, so a
 * transient failure just means the next interval retries.
 */
export class OpenAIWhisperTranscription implements TranscriptionProvider {
  readonly info: TranscriptionProviderInfo = {
    id: 'openai-whisper',
    name: 'OpenAI Whisper (cloud)',
    description:
      'High-accuracy cloud transcription using OpenAI Whisper. Requires an OpenAI API key; audio is sent to OpenAI.',
    requiresApiKey: true,
    local: false,
  };

  constructor(private deps: OpenAIWhisperDeps) {}

  async isConfigured(): Promise<boolean> {
    const key = await this.deps.getApiKey();
    return !!key && key.trim().length > 0;
  }

  async startSession(options: {
    language: string;
    onSegments: (update: LiveSegmentUpdate) => void;
    onError: (error: Error) => void;
  }): Promise<TranscriptionSession> {
    const chunks: Uint8Array[] = [];
    let mimeType = 'audio/webm';
    let lastTranscribeAtMs = 0;
    let latestAtMs = 0;

    const transcribe = async (): Promise<void> => {
      if (chunks.length === 0) return;
      const key = await this.deps.getApiKey();
      if (!key || !key.trim()) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          'OpenAI Whisper has no API key — add one in Settings to enable cloud transcription.',
        );
      }

      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const form = new FormData();
      form.append('file', new Blob([merged], { type: mimeType }), 'audio.webm');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      if (options.language) form.append('language', options.language);

      const baseUrl = (this.deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          `Could not reach OpenAI Whisper: ${e instanceof Error ? e.message : String(e)}`,
          { retryable: true, cause: e },
        );
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          `OpenAI Whisper request failed (HTTP ${response.status}).`,
          { details: { status: response.status, body: body.slice(0, 300) }, retryable: response.status >= 500 },
        );
      }

      const json = (await response.json()) as VerboseJsonResponse;
      const segments: TranscriptSegment[] = (json.segments ?? []).map((s, index) => ({
        id: newId(),
        index,
        startMs: Math.round((s.start ?? 0) * 1000),
        endMs: Math.round((s.end ?? 0) * 1000),
        text: (s.text ?? '').trim(),
        kind: 'speech' as const,
      }));
      options.onSegments({ segments, final: true });
    };

    /** Run a transcription pass, reporting failures without killing the session. */
    const safeTranscribe = async (): Promise<void> => {
      try {
        await transcribe();
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.deps.logger.error('whisper transcription failed', { error: error.message });
        options.onError(error);
      }
    };

    return {
      push: async (chunk: AudioChunk) => {
        chunks.push(chunk.data);
        mimeType = chunk.mimeType || mimeType;
        latestAtMs = Math.max(latestAtMs, chunk.atMs);
        if (latestAtMs - lastTranscribeAtMs >= TRANSCRIBE_INTERVAL_MS) {
          lastTranscribeAtMs = latestAtMs;
          await safeTranscribe();
        }
      },
      finish: async () => {
        await safeTranscribe();
        // Segments are delivered through onSegments (full-replacement contract).
        return [];
      },
      abort: async () => {
        chunks.length = 0;
      },
    };
  }
}
