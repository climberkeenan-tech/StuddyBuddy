import type { TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';

/** Sample rate Whisper expects (16 kHz mono). */
export const TARGET_SAMPLE_RATE = 16000;

/** Minimal structural view of a decoded audio buffer (satisfied by AudioBuffer). */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** One timestamped chunk as returned by the Whisper worker. */
export interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}

/** Worker transcription result: full text plus optional per-chunk timestamps. */
export interface WhisperResult {
  text: string;
  chunks: AsrChunk[];
}

/** Average every channel down to a single mono Float32 track. */
export function downmixToMono(buffer: AudioBufferLike): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / numberOfChannels;
  }
  return mono;
}

/** Cheap linear resample to 16 kHz (no-op when already at the target rate). */
export function resampleTo16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE || samples.length === 0) return samples;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIndex - lo;
    out[i] = (samples[lo] ?? 0) * (1 - frac) + (samples[hi] ?? 0) * frac;
  }
  return out;
}

/**
 * Map a Whisper worker result to transcript segments. Ids/indexes are
 * placeholders — the RecordingService re-assigns them on ingest — but the
 * text/timing must be faithful. Empty chunks are dropped; a chunkless result
 * falls back to a single segment carrying the whole text.
 */
export function toSegments(result: WhisperResult): TranscriptSegment[] {
  const chunks = result.chunks.filter((c) => c.text.trim().length > 0);
  if (chunks.length === 0) {
    const text = result.text.trim();
    return text ? [{ id: newId(), index: 0, startMs: 0, endMs: 0, text, kind: 'speech' }] : [];
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
