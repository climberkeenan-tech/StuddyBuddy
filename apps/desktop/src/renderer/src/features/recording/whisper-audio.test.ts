import { describe, expect, it } from 'vitest';
import {
  downmixToMono,
  resampleTo16k,
  toSegments,
  type AudioBufferLike,
} from './whisper-audio';

/** Build a fake decoded buffer from raw channel arrays. */
function fakeBuffer(channels: number[][]): AudioBufferLike {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (ch: number) => Float32Array.from(channels[ch] ?? []),
  };
}

describe('downmixToMono', () => {
  it('passes a mono track through unchanged', () => {
    const mono = downmixToMono(fakeBuffer([[0.1, -0.2, 0.3]]));
    expect(mono.length).toBe(3);
    expect(mono[0]).toBeCloseTo(0.1, 5);
    expect(mono[1]).toBeCloseTo(-0.2, 5);
  });

  it('averages stereo channels (opposite phase cancels to silence)', () => {
    const mono = downmixToMono(
      fakeBuffer([
        [1, 1, 1, 1],
        [-1, -1, -1, -1],
      ]),
    );
    expect(Array.from(mono)).toEqual([0, 0, 0, 0]);
  });

  it('averages stereo channels to their midpoint', () => {
    const mono = downmixToMono(
      fakeBuffer([
        [1, 0],
        [0, 1],
      ]),
    );
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });
});

describe('resampleTo16k', () => {
  it('is a no-op at the target rate', () => {
    const samples = Float32Array.from([0, 0.5, 1]);
    expect(resampleTo16k(samples, 16000)).toBe(samples);
  });

  it('downsamples 48 kHz to exactly a third of the samples', () => {
    const samples = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
    const out = resampleTo16k(samples, 48000);
    expect(out.length).toBe(16000);
  });

  it('preserves the leading sample and stays in range', () => {
    const samples = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const out = resampleTo16k(samples, 44100);
    expect(out[0]).toBeCloseTo(0, 5);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(-1);
  });

  it('handles empty input', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });
});

describe('toSegments', () => {
  it('maps timestamped chunks to segments with millisecond timing', () => {
    const segments = toSegments({
      text: 'hello world',
      chunks: [
        { timestamp: [0, 1.5], text: ' hello' },
        { timestamp: [1.5, 3], text: ' world' },
      ],
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ index: 0, startMs: 0, endMs: 1500, text: 'hello', kind: 'speech' });
    expect(segments[1]).toMatchObject({ index: 1, startMs: 1500, endMs: 3000, text: 'world' });
    expect(segments[0]!.id).toBeTruthy();
    expect(segments[0]!.id).not.toBe(segments[1]!.id);
  });

  it('drops empty/whitespace chunks and re-indexes', () => {
    const segments = toSegments({
      text: 'real',
      chunks: [
        { timestamp: [0, 1], text: '   ' },
        { timestamp: [1, 2], text: 'real' },
      ],
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('real');
    expect(segments[0]!.index).toBe(0);
  });

  it('falls back to a single segment when there are no chunks', () => {
    const segments = toSegments({ text: '  the whole transcript  ', chunks: [] });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('the whole transcript');
  });

  it('returns nothing for a truly empty result', () => {
    expect(toSegments({ text: '   ', chunks: [] })).toEqual([]);
    expect(toSegments({ text: '', chunks: [{ timestamp: [0, 1], text: '  ' }] })).toEqual([]);
  });

  it('tolerates a null end timestamp (uses the start)', () => {
    const segments = toSegments({ text: 'x', chunks: [{ timestamp: [2, null], text: 'x' }] });
    expect(segments[0]).toMatchObject({ startMs: 2000, endMs: 2000, text: 'x' });
  });
});
