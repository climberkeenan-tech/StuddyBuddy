/**
 * On-device speech-to-text worker.
 *
 * Runs OpenAI's Whisper locally via Transformers.js (ONNX Runtime, WebAssembly)
 * — no API key, no cloud. The model (~80 MB, English) streams from the Hugging
 * Face hub the first time and is cached by the browser afterwards, so later
 * recordings work fully offline. Inference lives in this worker to keep the UI
 * responsive while audio is transcribed.
 *
 * Protocol (main → worker):
 *   { type: 'load' }                       → warm up / download the model
 *   { type: 'transcribe', id, audio }      → audio = 16 kHz mono Float32
 * Protocol (worker → main):
 *   { type: 'progress', data }             → model download / init progress
 *   { type: 'ready' }                      → model loaded, ready to transcribe
 *   { type: 'result', id, text, chunks }   → transcription for a given id
 *   { type: 'error', id?, message }        → load error (no id) or job error
 */
import { pipeline, env } from '@huggingface/transformers';

// There are no bundled model files — always fetch from the hub, then cache.
env.allowLocalModels = false;
// Single-threaded WASM: universally supported with no SharedArrayBuffer /
// cross-origin-isolation requirement. Slightly slower, but it just works.
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

/** English Whisper "base" — a solid accuracy/size balance for lectures. */
const MODEL_ID = 'Xenova/whisper-base.en';

interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}
interface AsrOutput {
  text?: string;
  chunks?: AsrChunk[];
}
type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<AsrOutput>;

type LoadMessage = { type: 'load' };
type TranscribeMessage = { type: 'transcribe'; id: number; audio: Float32Array };
type IncomingMessage = LoadMessage | TranscribeMessage;

// Minimal typed view of the worker global (the web tsconfig has no WebWorker lib).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<IncomingMessage>) => void): void;
};

let transcriberPromise: Promise<Transcriber> | null = null;

/** Lazily build (and cache) the ASR pipeline; forwards download progress. */
function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (data: unknown) => ctx.postMessage({ type: 'progress', data }),
    }) as unknown as Promise<Transcriber>;
  }
  return transcriberPromise;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

ctx.addEventListener('message', (event) => {
  const message = event.data;
  void (async () => {
    if (message.type === 'load') {
      try {
        await getTranscriber();
        ctx.postMessage({ type: 'ready' });
      } catch (error) {
        transcriberPromise = null; // allow a later retry
        ctx.postMessage({ type: 'error', message: toMessage(error) });
      }
      return;
    }

    if (message.type === 'transcribe') {
      try {
        const transcriber = await getTranscriber();
        const output = await transcriber(message.audio, {
          // Long-form: 30 s windows with 5 s overlap, plus per-chunk timestamps.
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: true,
        });
        ctx.postMessage({
          type: 'result',
          id: message.id,
          text: output.text ?? '',
          chunks: output.chunks ?? [],
        });
      } catch (error) {
        ctx.postMessage({ type: 'error', id: message.id, message: toMessage(error) });
      }
    }
  })();
});
