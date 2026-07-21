import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Lecture, RecordingStatus, TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Repositories } from '../storage/types';
import type { SettingsService } from '../settings/settings-service';
import type { AIFacade } from '../ai/types';
import type { LiveSegmentUpdate, TranscriptionSession, TranscriptStage } from './types';
import type { RecordingProviderRegistry } from './registry';
import { buildTranscript } from './build-transcript';
import { runStages } from './stages/run-stages';
import { headingsStage } from './stages/headings';
import { questionsStage } from './stages/questions';
import { punctuationStage, type PunctuationAI } from './stages/punctuation';

/** Injectable monotonic-ish clock; defaults to Date. Kept for test determinism. */
export interface Clock {
  now(): number;
}

export interface RecordingServiceDeps {
  repos: Repositories;
  /** Source of the active transcription provider (the TranscriptionRegistry). */
  registry: RecordingProviderRegistry;
  settings: SettingsService;
  bus: CoreEventBus;
  logger: Logger;
  /** App data dir; recordings land under `<dataDir>/recordings/`. */
  dataDir: string;
  /**
   * Optional AI facade used by the finalize-time punctuation stage. When absent
   * (or unavailable), punctuation falls back to deterministic normalization —
   * recording stays fully offline-capable.
   */
  ai?: AIFacade;
  /**
   * Called after the transcript is persisted and the lecture is marked
   * 'processing'. Integration wires this to analysis + material generation +
   * indexing, which set the lecture to 'ready' on success. If it throws, the
   * lecture is marked 'failed'. Awaited so failures are observable.
   */
  onLectureFinalized?: (lectureId: string) => Promise<void>;
  /** Injectable clock for tests; defaults to Date. */
  clock?: Clock;
}

/** Draft transcripts are autosaved at most this often while recording. */
const DRAFT_INTERVAL_MS = 5000;

/** Status ticker cadence. */
const STATUS_TICK_MS = 500;

/** Offline stand-in so the punctuation stage never requires an AI facade. */
const OFFLINE_AI: PunctuationAI = {
  available: async () => false,
  chat: async () => ({ text: '', model: 'offline' }),
};

/**
 * The heart of live capture. Opens the active transcription provider, threads
 * its segments through the live heuristic stages (headings/questions), keeps an
 * in-memory transcript, autosaves drafts, and — on stop — runs the full stage
 * pipeline (including punctuation), persists the final transcript, marks the
 * lecture 'processing', and hands off to the finalize callback.
 *
 * Only cheap deterministic stages run live; the punctuation and structural
 * paragraph/section passes run once at stop. Provider segment emissions are
 * serialized through an internal promise chain so out-of-order updates can't
 * corrupt indices, which also makes the whole thing deterministic under fake
 * timers.
 */
export class RecordingService {
  private readonly repos: Repositories;
  private readonly registry: RecordingProviderRegistry;
  private readonly settings: SettingsService;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;
  private readonly dataDir: string;
  private readonly ai: AIFacade | undefined;
  private readonly onLectureFinalized: ((lectureId: string) => Promise<void>) | undefined;
  private readonly clock: Clock;
  private readonly liveStages: TranscriptStage[];

  private state: RecordingStatus['state'] = 'idle';
  private lectureId: string | null = null;
  private session: TranscriptionSession | null = null;
  private segments: TranscriptSegment[] = [];
  private engineId = '';
  private language = 'en';

  private startedAt: number | null = null;
  private pausedAccumMs = 0;
  private pauseStartedAt: number | null = null;
  private audioLevel = 0;
  private lastError: string | undefined;
  private lastDraftAt = 0;

  private fileStream: WriteStream | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Serializes async segment handling so indices stay consistent. */
  private processing: Promise<void> = Promise.resolve();

  constructor(deps: RecordingServiceDeps) {
    this.repos = deps.repos;
    this.registry = deps.registry;
    this.settings = deps.settings;
    this.bus = deps.bus;
    this.logger = deps.logger.child('recording');
    this.dataDir = deps.dataDir;
    this.ai = deps.ai;
    this.onLectureFinalized = deps.onLectureFinalized;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.liveStages = [headingsStage(), questionsStage()];
  }

  /**
   * Begin recording into a new lecture. Throws RECORDING_STATE if a session is
   * already active. The lecture row is created immediately (status 'recording')
   * so the UI has something to navigate to while capture runs.
   */
  async start(courseId: string, title?: string): Promise<{ lectureId: string }> {
    if (this.state !== 'idle') {
      throw new SbError(ErrorCodes.RECORDING_STATE, 'A recording is already in progress.');
    }
    const provider = await this.registry.getActive();
    const number = await this.repos.lectures.nextNumber(courseId);
    const now = this.clock.now();
    const id = newId();
    const keepAudio = this.settings.get().keepAudio;
    const audioPath = keepAudio ? `recordings/${id}.webm` : undefined;

    const lecture: Lecture = {
      id,
      courseId,
      title: title?.trim() || `Lecture ${number}`,
      number,
      status: 'recording',
      recordedAt: now,
      durationMs: 0,
      topics: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
      ...(audioPath ? { audioPath } : {}),
    };
    await this.repos.lectures.put(lecture);

    // Reset all per-session state.
    this.lectureId = id;
    this.segments = [];
    this.engineId = provider.info.id;
    this.language = this.settings.get().language;
    this.startedAt = now;
    this.pausedAccumMs = 0;
    this.pauseStartedAt = null;
    this.audioLevel = 0;
    this.lastError = undefined;
    this.lastDraftAt = now;
    this.processing = Promise.resolve();

    if (keepAudio) {
      const dir = path.join(this.dataDir, 'recordings');
      await mkdir(dir, { recursive: true });
      this.fileStream = createWriteStream(path.join(dir, `${id}.webm`));
    }

    this.session = await provider.startSession({
      language: this.language,
      onSegments: (update) => this.enqueue(update),
      onError: (error) => this.handleProviderError(error),
    });

    this.state = 'recording';
    this.startTicker();
    this.emitStatus();
    this.logger.info('recording started', { lectureId: id, engine: this.engineId, number });
    return { lectureId: id };
  }

  /**
   * Feed one captured audio chunk: it is appended to the on-disk recording (if
   * kept) and pushed to the provider with its media offset. Ignored unless
   * actively recording.
   */
  async pushAudioChunk(bytes: Uint8Array, mimeType: string): Promise<void> {
    if (this.state !== 'recording') return;
    if (this.fileStream) this.fileStream.write(Buffer.from(bytes));
    const atMs = this.elapsed();
    if (this.session) await this.session.push({ data: bytes, mimeType, atMs });
  }

  /**
   * Inject a full transcript recognized in the renderer (on-device Whisper).
   * The list is authoritative and replaces any prior segments (same contract as
   * the cloud Whisper provider). Ignored unless a session is live so late pushes
   * after stop can't resurrect state.
   */
  ingestSegments(segments: TranscriptSegment[]): void {
    if (this.state !== 'recording' && this.state !== 'paused') return;
    this.enqueue({ segments, final: true });
  }

  /** Update the rolling input level (0..1) shown on the meter. */
  pushAudioLevel(level: number): void {
    this.audioLevel = Math.max(0, Math.min(1, level));
  }

  /** Pause capture; paused time is excluded from elapsed and the ticker. */
  pause(): void {
    if (this.state !== 'recording') {
      throw new SbError(ErrorCodes.RECORDING_STATE, 'Nothing is recording to pause.');
    }
    this.state = 'paused';
    this.pauseStartedAt = this.clock.now();
    this.emitStatus();
  }

  /** Resume a paused capture. */
  resume(): void {
    if (this.state !== 'paused') {
      throw new SbError(ErrorCodes.RECORDING_STATE, 'Recording is not paused.');
    }
    if (this.pauseStartedAt != null) {
      this.pausedAccumMs += this.clock.now() - this.pauseStartedAt;
    }
    this.pauseStartedAt = null;
    this.state = 'recording';
    this.emitStatus();
  }

  /**
   * Stop recording: finalize the session, run the full stage pipeline, persist
   * the final transcript, mark the lecture 'processing', then hand off to the
   * finalize callback (which owns the transition to 'ready'). Resets to idle and
   * returns the lecture id.
   */
  async stop(): Promise<{ lectureId: string }> {
    if (this.state === 'idle' || this.state === 'stopping') {
      throw new SbError(ErrorCodes.RECORDING_STATE, 'No active recording to stop.');
    }
    const lectureId = this.lectureId;
    const session = this.session;
    if (!lectureId || !session) {
      throw new SbError(ErrorCodes.RECORDING_STATE, 'Recording state is inconsistent.');
    }

    this.state = 'stopping';
    this.stopTicker();
    this.emitStatus();

    const stream = this.fileStream;
    if (stream) {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
      this.fileStream = null;
    }

    let trailing: TranscriptSegment[] = [];
    try {
      trailing = await session.finish();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error('session finish failed', { lectureId, error: message });
      this.lastError = message;
    }
    // Drain any in-flight live handlers (including finish-time emissions).
    await this.processing;

    if (trailing.length > 0) {
      const base = this.segments.length;
      this.segments.push(...trailing.map((s, i) => ({ ...s, id: newId(), index: base + i })));
    }

    const engine = this.engineId;
    const language = this.language;
    const durationMs = this.segments.reduce((max, s) => Math.max(max, s.endMs), 0) || this.elapsed();

    const processed = await runStages([...this.segments], this.finalStages());
    const transcript = buildTranscript({ lectureId, segments: processed, language, engine });
    await this.repos.transcripts.put(transcript);

    const lecture = await this.repos.lectures.get(lectureId);
    if (lecture) {
      await this.repos.lectures.put({
        ...lecture,
        status: 'processing',
        durationMs,
        updatedAt: this.clock.now(),
      });
    }
    this.bus.emit('transcript:updated', { lectureId });
    this.logger.info('recording stopped', {
      lectureId,
      segments: transcript.segments.length,
      sections: transcript.sections.length,
      durationMs,
    });

    try {
      if (this.onLectureFinalized) await this.onLectureFinalized(lectureId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error('lecture finalization failed', { lectureId, error: message });
      const failed = await this.repos.lectures.get(lectureId);
      if (failed) {
        await this.repos.lectures.put({ ...failed, status: 'failed', updatedAt: this.clock.now() });
      }
    }

    this.resetToIdle();
    return { lectureId };
  }

  /** Snapshot of the current recording status. */
  getStatus(): RecordingStatus {
    return {
      lectureId: this.lectureId,
      state: this.state,
      elapsedMs: this.elapsed(),
      audioLevel: this.audioLevel,
      segmentCount: this.segments.length,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /** Finalize-time stages: punctuation restore, then heading/question tagging. */
  private finalStages(): TranscriptStage[] {
    return [punctuationStage(this.ai ?? OFFLINE_AI), headingsStage(), questionsStage()];
  }

  /** Chain each provider emission so handling is serialized and never overlaps. */
  private enqueue(update: LiveSegmentUpdate): void {
    this.processing = this.processing
      .then(() => this.handleSegments(update))
      .catch((e) =>
        this.logger.error('segment handling failed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  }

  private async handleSegments(update: LiveSegmentUpdate): Promise<void> {
    if (this.state === 'idle' || !this.lectureId) return;
    if (update.segments.length === 0) return;

    if (this.engineId === 'openai-whisper' || this.engineId === 'browser-whisper') {
      // Whisper re-emits the full authoritative list every round: replace.
      const assigned = update.segments.map((s, i) => ({ ...s, id: newId(), index: i }));
      const processed = await runStages(assigned, this.liveStages);
      this.segments = processed.map((s, i) => ({ ...s, index: i }));
      this.bus.emit('transcript:segments', {
        lectureId: this.lectureId,
        segments: this.segments,
        replace: true,
      });
    } else {
      const base = this.segments.length;
      const assigned = update.segments.map((s, i) => ({ ...s, id: newId(), index: base + i }));
      const processed = await runStages(assigned, this.liveStages);
      const reindexed = processed.map((s, i) => ({ ...s, index: base + i }));
      this.segments.push(...reindexed);
      this.bus.emit('transcript:segments', { lectureId: this.lectureId, segments: reindexed });
    }

    await this.maybeSaveDraft();
  }

  /** Persist a structural draft transcript, throttled to {@link DRAFT_INTERVAL_MS}. */
  private async maybeSaveDraft(): Promise<void> {
    if (!this.lectureId) return;
    const now = this.clock.now();
    if (now - this.lastDraftAt < DRAFT_INTERVAL_MS) return;
    this.lastDraftAt = now;
    const transcript = buildTranscript({
      lectureId: this.lectureId,
      segments: [...this.segments],
      language: this.language,
      engine: this.engineId,
    });
    await this.repos.transcripts.put(transcript);
  }

  private handleProviderError(error: Error): void {
    this.logger.error('transcription provider error', { error: error.message });
    this.lastError = error.message;
    this.emitStatus();
  }

  private elapsed(): number {
    if (this.startedAt == null) return 0;
    let e = this.clock.now() - this.startedAt - this.pausedAccumMs;
    if (this.state === 'paused' && this.pauseStartedAt != null) {
      e -= this.clock.now() - this.pauseStartedAt;
    }
    return Math.max(0, e);
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.emitStatus(), STATUS_TICK_MS);
    // Never keep the process alive just for the status ticker.
    (this.ticker as unknown as { unref?: () => void }).unref?.();
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private emitStatus(): void {
    this.bus.emit('recording:status', this.getStatus());
  }

  private resetToIdle(): void {
    this.stopTicker();
    this.state = 'idle';
    this.lectureId = null;
    this.session = null;
    this.segments = [];
    this.engineId = '';
    this.startedAt = null;
    this.pausedAccumMs = 0;
    this.pauseStartedAt = null;
    this.audioLevel = 0;
    this.lastError = undefined;
    this.emitStatus();
  }
}
