import type { TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';
import type {
  TranscriptionProvider,
  TranscriptionProviderInfo,
  TranscriptionSession,
} from '../types';
import { DEMO_LECTURE, type DemoUtterance } from '../../demo/demo-lecture';

export interface SimulatedProviderOptions {
  /**
   * Playback speed multiplier. Real wall-clock delay between emissions is the
   * utterance duration divided by this factor, so the default (5) plays the
   * ~6-minute demo in about a minute while segment timestamps stay true to the
   * lecture timeline.
   */
  speed?: number;
  /** Override the replayed script (defaults to the bundled demo lecture). */
  script?: DemoUtterance[];
}

/**
 * A microphone-free transcription provider that replays a scripted lecture.
 *
 * It powers demo mode and the test suite: segments carry timestamps derived
 * from the script's own timings (never wall-clock), and emissions are paced on
 * real timers scaled by `speed`. It is fully offline, deterministic, and safe
 * to `finish()` mid-playback — the pending timer is cleared and no further
 * segments are emitted.
 */
export class SimulatedTranscriptionProvider implements TranscriptionProvider {
  readonly info: TranscriptionProviderInfo = {
    id: 'simulated',
    name: 'Demo voice (no mic needed)',
    description:
      'Replays a bundled sample lecture so you can try StuddyBuddy end-to-end with no microphone, no account, and no API keys.',
    requiresApiKey: false,
    local: true,
  };

  private readonly speed: number;
  private readonly script: DemoUtterance[];

  constructor(options: SimulatedProviderOptions = {}) {
    this.speed = options.speed && options.speed > 0 ? options.speed : 5;
    this.script = options.script ?? DEMO_LECTURE.utterances;
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async startSession(options: {
    language: string;
    onSegments: (update: { segments: TranscriptSegment[]; final: boolean }) => void;
    onError: (error: Error) => void;
  }): Promise<TranscriptionSession> {
    const script = this.script;
    const speed = this.speed;

    // Pre-compute each utterance's true media timestamps from the script.
    const timeline: TranscriptSegment[] = [];
    let cursor = 0;
    script.forEach((utterance, index) => {
      const startMs = cursor;
      const endMs = cursor + utterance.durationMs;
      timeline.push({
        id: newId(),
        index,
        startMs,
        endMs,
        text: utterance.text,
        kind: 'speech',
        confidence: 1,
      });
      cursor = endMs + utterance.gapMs;
    });

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const emitNext = (i: number): void => {
      if (stopped || i >= timeline.length) return;
      const segment = timeline[i];
      if (segment) options.onSegments({ segments: [segment], final: true });
      const next = timeline[i + 1];
      if (!next) return;
      const delay = Math.max(1, Math.round((script[i]?.durationMs ?? 0) / speed));
      timer = setTimeout(() => emitNext(i + 1), delay);
    };

    const stop = (): void => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // Kick off the first emission after the first utterance's scaled duration.
    if (timeline.length > 0) {
      const firstDelay = Math.max(1, Math.round((script[0]?.durationMs ?? 0) / speed));
      timer = setTimeout(() => emitNext(0), firstDelay);
    }

    return {
      push: async () => {
        // Simulated playback ignores incoming audio entirely.
      },
      finish: async () => {
        stop();
        return [];
      },
      abort: async () => {
        stop();
      },
    };
  }
}
