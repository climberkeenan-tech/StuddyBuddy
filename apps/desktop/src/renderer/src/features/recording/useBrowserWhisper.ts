import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';

/** Target sample rate Whisper expects. */
const TARGET_SAMPLE_RATE = 16000;

export type WhisperPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface BrowserWhisperState {
  phase: WhisperPhase;
  /** Model download progress, 0..1 (only meaningful while `loading`). */
  progress: number;
  error: string | null;
}

interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}
interface WorkerResult {
  text: string;
  chunks: AsrChunk[];
}

interface AudioContextCtor {
  new (options?: { sampleRate?: number }): AudioContext;
}

/** Average all channels down to a single mono Float32 track. */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / numberOfChannels;
  }
  return mono;
}

/** Cheap linear resample to 16 kHz (used only if decode didn't already). */
function resampleTo16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return samples;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIndex - lo;
    out[i] = samples[lo]! * (1 - frac) + samples[hi]! * frac;
  }
  return out;
}

/** Decode a recorded audio Blob into 16 kHz mono Float32 samples for Whisper. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctor: AudioContextCtor | undefined =
    (window.AudioContext as unknown as AudioContextCtor | undefined) ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is unavailable in this environment.');
  // Asking for a 16 kHz context makes decodeAudioData resample for us; the
  // manual resample below is a safety net if the rate isn't honored.
  const audioCtx = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const mono = downmixToMono(decoded);
    return resampleTo16k(mono, decoded.sampleRate);
  } finally {
    void audioCtx.close().catch(() => {});
  }
}

/** Map worker output to transcript segments (ids/indexes are re-assigned server-side). */
function toSegments(result: WorkerResult): TranscriptSegment[] {
  const chunks = result.chunks.filter((c) => c.text.trim().length > 0);
  if (chunks.length === 0) {
    const text = result.text.trim();
    return text
      ? [{ id: newId(), index: 0, startMs: 0, endMs: 0, text, kind: 'speech' }]
      : [];
  }
  return chunks.map((chunk, index) => {
    const start = chunk.timestamp[0] ?? 0;
    const end = chunk.timestamp[1] ?? start;
    return {
      id: newId(),
      index,
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text: chunk.text.trim(),
      kind: 'speech' as const,
    };
  });
}

/**
 * Drives the on-device Whisper worker: lazy model load with progress, and a
 * `transcribe(blob)` that decodes recorded audio and returns transcript
 * segments. All heavy lifting (model + inference) happens in the worker; this
 * hook owns its lifecycle and surfaces a friendly status for the UI.
 *
 * `enabled` gates worker creation so the browser preview / other engines never
 * spin up an ML worker they won't use.
 */
export function useBrowserWhisper(enabled: boolean) {
  const [state, setState] = useState<BrowserWhisperState>({
    phase: 'idle',
    progress: 0,
    error: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const jobId = useRef(0);
  const pending = useRef(new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>());
  const loadWaiters = useRef<{ resolve: () => void; reject: (e: Error) => void }[]>([]);
  const phaseRef = useRef<WhisperPhase>('idle');

  const setPhase = useCallback((updater: (prev: BrowserWhisperState) => BrowserWhisperState) => {
    setState((prev) => {
      const next = updater(prev);
      phaseRef.current = next.phase;
      return next;
    });
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as
        | { type: 'progress'; data: { status?: string; progress?: number } }
        | { type: 'ready' }
        | { type: 'result'; id: number; text: string; chunks: AsrChunk[] }
        | { type: 'error'; id?: number; message: string };

      if (msg.type === 'progress') {
        const pct = typeof msg.data?.progress === 'number' ? msg.data.progress / 100 : undefined;
        setPhase((prev) => ({
          ...prev,
          phase: prev.phase === 'ready' ? 'ready' : 'loading',
          progress: pct ?? prev.progress,
        }));
      } else if (msg.type === 'ready') {
        setPhase((prev) => ({ ...prev, phase: 'ready', progress: 1, error: null }));
        loadWaiters.current.forEach((w) => w.resolve());
        loadWaiters.current = [];
      } else if (msg.type === 'result') {
        const job = pending.current.get(msg.id);
        if (job) {
          pending.current.delete(msg.id);
          job.resolve({ text: msg.text, chunks: msg.chunks });
        }
      } else if (msg.type === 'error') {
        if (typeof msg.id === 'number') {
          const job = pending.current.get(msg.id);
          if (job) {
            pending.current.delete(msg.id);
            job.reject(new Error(msg.message));
          }
        } else {
          setPhase((prev) => ({ ...prev, phase: 'error', error: msg.message }));
          loadWaiters.current.forEach((w) => w.reject(new Error(msg.message)));
          loadWaiters.current = [];
        }
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'On-device transcription worker crashed.';
      setPhase((prev) => ({ ...prev, phase: 'error', error: message }));
      loadWaiters.current.forEach((w) => w.reject(new Error(message)));
      loadWaiters.current = [];
    };
    workerRef.current = worker;
    return worker;
  }, [setPhase]);

  /** Begin loading the model (idempotent). Resolves when it's ready to use. */
  const ensureLoaded = useCallback((): Promise<void> => {
    if (!enabled) return Promise.reject(new Error('On-device Whisper is disabled here.'));
    if (phaseRef.current === 'ready') return Promise.resolve();
    const worker = ensureWorker();
    return new Promise<void>((resolve, reject) => {
      loadWaiters.current.push({ resolve, reject });
      if (phaseRef.current !== 'loading') {
        setPhase((prev) => ({ ...prev, phase: 'loading', error: null }));
        worker.postMessage({ type: 'load' });
      }
    });
  }, [enabled, ensureWorker, setPhase]);

  /** Decode a recorded blob and transcribe it to segments. */
  const transcribe = useCallback(
    async (blob: Blob): Promise<TranscriptSegment[]> => {
      await ensureLoaded();
      const audio = await decodeToMono16k(blob);
      if (audio.length === 0) return [];
      const worker = ensureWorker();
      const id = (jobId.current += 1);
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
      });
      return toSegments(result);
    },
    [ensureLoaded, ensureWorker],
  );

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.current.clear();
      loadWaiters.current = [];
    };
  }, []);

  return { state, ensureLoaded, transcribe };
}
