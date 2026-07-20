import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lecture, Transcript, TranscriptSegment } from '@studdybuddy/shared';
import { LogManager } from '../src/infra/logger';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEvents, CoreEventBus } from '../src/infra/core-events';
import { SettingsService } from '../src/settings/settings-service';
import type { Repositories } from '../src/storage/types';
import { paragraphsAndPauses } from '../src/transcription/stages/paragraphs';
import { headingsStage } from '../src/transcription/stages/headings';
import { questionsStage } from '../src/transcription/stages/questions';
import { runStages } from '../src/transcription/stages/run-stages';
import { buildTranscript } from '../src/transcription/build-transcript';
import { SimulatedTranscriptionProvider } from '../src/transcription/providers/simulated';
import type { RecordingProviderRegistry } from '../src/transcription/registry';
import { RecordingService } from '../src/transcription/recording-service';
import { importDemoLecture } from '../src/demo/import-demo';
import { DEMO_LECTURE } from '../src/demo/demo-lecture';

let seq = 0;
function mkSeg(
  startMs: number,
  endMs: number,
  text: string,
  kind: TranscriptSegment['kind'] = 'speech',
): TranscriptSegment {
  return { id: `seg-${seq++}`, index: 0, startMs, endMs, text, kind };
}

/** Minimal in-memory Repositories fake covering only lectures + transcripts. */
function createFakeRepos(): Repositories {
  const lectures = new Map<string, Lecture>();
  const transcripts = new Map<string, Transcript>();
  const repos = {
    lectures: {
      byCourse: async (courseId: string) =>
        [...lectures.values()].filter((l) => l.courseId === courseId).sort((a, b) => a.number - b.number),
      recent: async (limit: number) => [...lectures.values()].slice(0, limit),
      get: async (id: string) => lectures.get(id) ?? null,
      put: async (l: Lecture) => {
        lectures.set(l.id, l);
      },
      delete: async (id: string) => {
        lectures.delete(id);
      },
      nextNumber: async (courseId: string) =>
        [...lectures.values()]
          .filter((l) => l.courseId === courseId)
          .reduce((max, l) => Math.max(max, l.number), 0) + 1,
    },
    transcripts: {
      getByLecture: async (id: string) => transcripts.get(id) ?? null,
      put: async (t: Transcript) => {
        transcripts.set(t.lectureId, t);
      },
      deleteByLecture: async (id: string) => {
        transcripts.delete(id);
      },
    },
  };
  return repos as unknown as Repositories;
}

describe('transcription stages', () => {
  describe('paragraphsAndPauses', () => {
    it('inserts a pause segment for gaps over the pause threshold', () => {
      const input = [
        mkSeg(0, 1000, 'One.'),
        mkSeg(1200, 2000, 'Two.'),
        mkSeg(5000, 6000, 'Three.'), // 3000ms gap > 2200 → pause
      ];
      const { segments, paragraphs } = paragraphsAndPauses(input);

      const pauses = segments.filter((s) => s.kind === 'pause');
      expect(pauses).toHaveLength(1);
      expect(pauses[0]).toMatchObject({ startMs: 2000, endMs: 5000, kind: 'pause' });

      // Output is contiguously re-indexed including the inserted pause.
      expect(segments.map((s) => s.index)).toEqual([0, 1, 2, 3]);

      // The long gap also breaks the paragraph.
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]?.segmentIds).toHaveLength(2);
      expect(paragraphs[1]?.segmentIds).toHaveLength(1);
      // Pause segments belong to no paragraph.
      const allParaIds = paragraphs.flatMap((p) => p.segmentIds);
      expect(allParaIds).not.toContain(pauses[0]?.id);
    });

    it('breaks a paragraph after five accumulated sentences', () => {
      const input = Array.from({ length: 6 }, (_, i) =>
        mkSeg(i * 1000, i * 1000 + 800, `Sentence ${i}.`),
      );
      const { paragraphs } = paragraphsAndPauses(input);
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]?.segmentIds).toHaveLength(5);
      expect(paragraphs[1]?.segmentIds).toHaveLength(1);
    });
  });

  describe('headingsStage', () => {
    it('tags short discourse-marker openings as cleaned, title-cased headings', async () => {
      const input = [
        mkSeg(0, 2000, "Okay, let's talk about photosynthesis."),
        mkSeg(2500, 5000, "Now let's meet the electron transport chain."),
        mkSeg(5500, 8000, 'The chloroplast is where photosynthesis happens.'),
        mkSeg(
          8500,
          12000,
          "Okay, so there is honestly a great deal more nuance to unpack here than one short sentence could ever fairly hope to capture.",
        ),
      ];
      const out = await headingsStage().process(input);

      expect(out[0]).toMatchObject({ kind: 'heading', text: 'Photosynthesis' });
      expect(out[1]).toMatchObject({ kind: 'heading', text: 'The Electron Transport Chain' });
      expect(out[2]?.kind).toBe('speech'); // no marker
      expect(out[3]?.kind).toBe('speech'); // marker but > 90 chars
    });
  });

  describe('questionsStage', () => {
    it('detects question marks, interrogative cues, and classroom prompts', async () => {
      const input = [
        mkSeg(0, 2000, 'What is a ribosome?'),
        mkSeg(2500, 4000, 'Can someone explain osmosis to the class'),
        mkSeg(4500, 6000, 'The mitochondria is the powerhouse of the cell.'),
        mkSeg(6500, 8000, 'anyone know the answer'),
      ];
      const out = await questionsStage().process(input);

      expect(out[0]).toMatchObject({ kind: 'question', isTeacherQuestion: true });
      expect(out[1]?.kind).toBe('question');
      expect(out[2]?.kind).toBe('speech');
      expect(out[3]?.kind).toBe('question');
    });
  });
});

describe('buildTranscript', () => {
  it('derives sections from headings with an Introduction fallback', () => {
    const segments = [
      mkSeg(0, 2000, 'Welcome to biology.'),
      mkSeg(2200, 3000, 'Cell Structure', 'heading'),
      mkSeg(3200, 5000, 'Cells are the basic unit of life.'),
      mkSeg(5200, 6000, 'Cell Division', 'heading'),
      mkSeg(6200, 8000, 'Mitosis splits one cell into two.'),
    ];
    const transcript = buildTranscript({ lectureId: 'lec-1', segments, language: 'en', engine: 'test' });

    expect(transcript.sections.map((s) => s.title)).toEqual([
      'Introduction',
      'Cell Structure',
      'Cell Division',
    ]);
    expect(transcript.sections[0]?.paragraphIds).toHaveLength(1);
    expect(transcript.lectureId).toBe('lec-1');
    expect(transcript.engine).toBe('test');
  });
});

describe('SimulatedTranscriptionProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits progressive segments with script timings and stops cleanly on finish', async () => {
    const script = [
      { text: 'First utterance here.', durationMs: 100, gapMs: 50 },
      { text: 'Second utterance here.', durationMs: 120, gapMs: 50 },
      { text: 'Third utterance here.', durationMs: 140, gapMs: 50 },
      { text: 'Fourth utterance here.', durationMs: 100, gapMs: 50 },
    ];
    const provider = new SimulatedTranscriptionProvider({ speed: 1, script });
    const got: TranscriptSegment[] = [];
    const session = await provider.startSession({
      language: 'en',
      onSegments: (u) => got.push(...u.segments),
      onError: () => {},
    });

    expect(got).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);
    expect(got).toHaveLength(0); // first emission scheduled at t=100

    await vi.advanceTimersByTimeAsync(100); // t≈150 → seg0 fired at 100
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ startMs: 0, endMs: 100 });

    await vi.advanceTimersByTimeAsync(200); // → seg1 (t=200), seg2 (t=320)
    expect(got).toHaveLength(3);
    expect(got[1]?.startMs).toBe(150); // 100 duration + 50 gap

    // finish() mid-playback must stop the timer with no further emissions.
    const trailing = await session.finish();
    expect(trailing).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toHaveLength(3);
  });
});

describe('RecordingService', () => {
  let dir: string;
  let settings: SettingsService;
  let repos: Repositories;
  let bus: CoreEventBus;

  beforeEach(async () => {
    vi.useFakeTimers();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-rec-'));
    const logger = new LogManager().getLogger('test');
    settings = new SettingsService(dir, logger);
    await settings.init();
    await settings.update({ keepAudio: false });
    repos = createFakeRepos();
    bus = new EventBus<CoreEvents>();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function makeService(onLectureFinalized?: (id: string) => Promise<void>): RecordingService {
    const script = [
      { text: "Welcome to today's short demo lecture on cells.", durationMs: 3000, gapMs: 500 },
      { text: "Okay, let's talk about the cell membrane.", durationMs: 2500, gapMs: 500 },
      { text: 'The membrane is a phospholipid bilayer that controls what enters.', durationMs: 4000, gapMs: 500 },
      { text: 'So what actually crosses the membrane?', durationMs: 2500, gapMs: 500 },
      { text: 'Small nonpolar molecules diffuse straight through with ease.', durationMs: 3500, gapMs: 2600 },
      { text: "And that's the big idea for today, everyone.", durationMs: 3000, gapMs: 0 },
    ];
    const registry: RecordingProviderRegistry = {
      getActive: async () => new SimulatedTranscriptionProvider({ speed: 1000, script }),
    };
    return new RecordingService({
      repos,
      registry,
      settings,
      bus,
      logger: new LogManager().getLogger('rec'),
      dataDir: dir,
      ...(onLectureFinalized ? { onLectureFinalized } : {}),
    });
  }

  it('records a full session and finalizes into a processing lecture', async () => {
    const finalized = vi.fn(async () => {});
    const service = makeService(finalized);
    const segmentEvents: TranscriptSegment[] = [];
    bus.on('transcript:segments', (e) => segmentEvents.push(...e.segments));

    const { lectureId } = await service.start('course-1', 'Cells 101');
    expect(service.getStatus().state).toBe('recording');

    await vi.advanceTimersByTimeAsync(1000); // drain all 6 scripted emissions
    expect(segmentEvents.length).toBeGreaterThanOrEqual(6);

    const result = await service.stop();
    expect(result.lectureId).toBe(lectureId);

    const transcript = await repos.transcripts.getByLecture(lectureId);
    expect(transcript).not.toBeNull();
    expect(transcript?.segments.filter((s) => s.kind === 'speech').length).toBeGreaterThanOrEqual(4);
    expect(transcript?.sections.map((s) => s.title)).toContain('The Cell Membrane');
    expect(transcript?.sections.length).toBeGreaterThanOrEqual(2);
    // The 2.6s scripted gap should have produced a pause segment.
    expect(transcript?.segments.some((s) => s.kind === 'pause')).toBe(true);

    const lecture = await repos.lectures.get(lectureId);
    expect(lecture?.status).toBe('processing');
    expect(lecture?.title).toBe('Cells 101');
    expect(lecture?.durationMs).toBeGreaterThan(0);

    expect(finalized).toHaveBeenCalledWith(lectureId);
    expect(service.getStatus().state).toBe('idle');
  });

  it('rejects a second concurrent start', async () => {
    const service = makeService();
    await service.start('course-1');
    await expect(service.start('course-1')).rejects.toMatchObject({ code: 'RECORDING_STATE' });
    await service.stop();
  });

  it('marks the lecture failed when finalization throws', async () => {
    const service = makeService(async () => {
      throw new Error('analysis blew up');
    });
    const { lectureId } = await service.start('course-1');
    await vi.advanceTimersByTimeAsync(1000);
    await service.stop();
    const lecture = await repos.lectures.get(lectureId);
    expect(lecture?.status).toBe('failed');
  });
});

describe('importDemoLecture', () => {
  it('produces a rich transcript from the bundled demo lecture', async () => {
    const repos = createFakeRepos();
    const bus = new EventBus<CoreEvents>();
    const lecture = await importDemoLecture({ repos, courseId: 'course-1', bus, now: 1000 });

    expect(lecture.status).toBe('processing');
    expect(lecture.durationMs).toBeGreaterThan(5 * 60_000); // > 5 minutes

    const transcript = await repos.transcripts.getByLecture(lecture.id);
    expect(transcript).not.toBeNull();

    const speech = transcript!.segments.filter((s) => s.kind === 'speech');
    expect(speech.length).toBeGreaterThanOrEqual(50);

    const beyondIntro = transcript!.sections.filter((s) => s.title !== 'Introduction');
    expect(beyondIntro.length).toBeGreaterThanOrEqual(1);

    const questions = transcript!.segments.filter((s) => s.kind === 'question');
    expect(questions.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the demo lecture within a realistic runtime', () => {
    const total = DEMO_LECTURE.utterances.reduce((sum, u) => sum + u.durationMs + u.gapMs, 0);
    expect(total).toBeGreaterThan(6 * 60_000);
    expect(total).toBeLessThan(8 * 60_000);
  });
});
