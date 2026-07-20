import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

export interface WhisperCppConfig {
  /** Absolute path to the whisper.cpp `main`/`whisper-cli` binary. */
  binaryPath: string;
  /** Absolute path to a ggml model file, e.g. ggml-base.en.bin. */
  modelPath: string;
}

export interface WhisperCppDeps {
  /** Live config from settings; undefined when the user hasn't set paths. */
  getConfig: () => WhisperCppConfig | undefined;
  logger: Logger;
}

/** whisper.cpp `-oj` output shape (the fields we consume). */
interface WhisperCppJson {
  transcription?: {
    text?: string;
    offsets?: { from?: number; to?: number };
  }[];
}

/** Run a process to completion, capturing stdout/stderr. */
function run(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** True when a runnable `ffmpeg` is on PATH. */
async function ffmpegAvailable(): Promise<boolean> {
  try {
    const { code } = await run('ffmpeg', ['-version']);
    return code === 0;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fully-local transcription via a whisper.cpp binary.
 *
 * There is no streaming: audio accumulates during recording and is transcribed
 * once on `finish()`. The webm buffer is written to a temp file, converted to
 * 16 kHz mono WAV with `ffmpeg`, and run through the configured binary with
 * `-oj` (JSON output); the JSON is mapped to segments. Any missing piece
 * (unconfigured paths, absent binary/model, no ffmpeg, non-zero exit) raises a
 * TRANSCRIPTION_FAILED error whose message names exactly what to fix.
 */
export class WhisperCppTranscription implements TranscriptionProvider {
  readonly info: TranscriptionProviderInfo = {
    id: 'whisper-cpp',
    name: 'whisper.cpp (local)',
    description:
      'Fully offline transcription using a local whisper.cpp build. Requires a binary + model path and ffmpeg on PATH. Transcribes when recording stops.',
    requiresApiKey: false,
    local: true,
  };

  constructor(private deps: WhisperCppDeps) {}

  async isConfigured(): Promise<boolean> {
    const config = this.deps.getConfig();
    if (!config) return false;
    const [binary, model] = await Promise.all([
      pathExists(config.binaryPath),
      pathExists(config.modelPath),
    ]);
    return binary && model;
  }

  async startSession(options: {
    language: string;
    onSegments: (update: LiveSegmentUpdate) => void;
    onError: (error: Error) => void;
  }): Promise<TranscriptionSession> {
    const chunks: Uint8Array[] = [];

    const transcribe = async (): Promise<TranscriptSegment[]> => {
      const config = this.deps.getConfig();
      if (!config) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          'whisper.cpp is not configured — set the binary and model paths in Settings.',
        );
      }
      if (!(await pathExists(config.binaryPath))) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          `whisper.cpp binary not found at "${config.binaryPath}".`,
        );
      }
      if (!(await pathExists(config.modelPath))) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          `whisper.cpp model not found at "${config.modelPath}".`,
        );
      }
      if (!(await ffmpegAvailable())) {
        throw new SbError(
          ErrorCodes.TRANSCRIPTION_FAILED,
          'ffmpeg was not found on PATH — it is required to convert audio for whisper.cpp.',
        );
      }
      if (chunks.length === 0) return [];

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-whisper-'));
      const webmPath = path.join(tmpDir, 'audio.webm');
      const wavPath = path.join(tmpDir, 'audio.wav');
      const outBase = path.join(tmpDir, 'out');

      try {
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        await fs.writeFile(webmPath, merged);

        const convert = await run('ffmpeg', [
          '-y',
          '-i',
          webmPath,
          '-ar',
          '16000',
          '-ac',
          '1',
          wavPath,
        ]);
        if (convert.code !== 0) {
          throw new SbError(
            ErrorCodes.TRANSCRIPTION_FAILED,
            'ffmpeg failed to convert the recording to 16 kHz mono WAV.',
            { details: { stderr: convert.stderr.slice(-400) } },
          );
        }

        const args = ['-m', config.modelPath, '-f', wavPath, '-oj', '-of', outBase];
        if (options.language) args.push('-l', options.language);
        const result = await run(config.binaryPath, args);
        if (result.code !== 0) {
          throw new SbError(
            ErrorCodes.TRANSCRIPTION_FAILED,
            'The whisper.cpp binary exited with an error while transcribing.',
            { details: { stderr: result.stderr.slice(-400) } },
          );
        }

        const raw = await fs.readFile(`${outBase}.json`, 'utf8');
        const parsed = JSON.parse(raw) as WhisperCppJson;
        return (parsed.transcription ?? []).map((entry, index) => ({
          id: newId(),
          index,
          startMs: Math.round(entry.offsets?.from ?? 0),
          endMs: Math.round(entry.offsets?.to ?? 0),
          text: (entry.text ?? '').trim(),
          kind: 'speech' as const,
        }));
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    };

    return {
      push: async (chunk: AudioChunk) => {
        chunks.push(chunk.data);
      },
      finish: async () => {
        try {
          return await transcribe();
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          this.deps.logger.error('whisper.cpp transcription failed', { error: error.message });
          options.onError(error);
          throw error instanceof SbError
            ? error
            : new SbError(ErrorCodes.TRANSCRIPTION_FAILED, error.message, { cause: error });
        }
      },
      abort: async () => {
        chunks.length = 0;
      },
    };
  }
}
