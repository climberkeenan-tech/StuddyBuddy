import type { Lecture, TranscriptSegment } from '@studdybuddy/shared';
import { newId } from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import type { Repositories } from '../storage/types';
import { runStages } from '../transcription/stages/run-stages';
import { headingsStage } from '../transcription/stages/headings';
import { questionsStage } from '../transcription/stages/questions';
import { buildTranscript } from '../transcription/build-transcript';
import { DEMO_LECTURE } from './demo-lecture';

export interface ImportDemoOptions {
  repos: Repositories;
  /** Course to attach the demo lecture to. */
  courseId: string;
  bus: CoreEventBus;
  /** Injectable timestamp for deterministic tests; defaults to Date.now(). */
  now?: number;
}

/**
 * Seed a fully-structured demo lecture with no microphone or AI required.
 *
 * Builds time-aligned segments from {@link DEMO_LECTURE}'s scripted timings,
 * runs the deterministic heuristic stages (heading + question tagging) and the
 * structural transcript build (pauses, paragraphs, sections), then persists
 * both the {@link Lecture} (status 'processing') and its {@link Transcript}.
 *
 * Analysis, study-material generation, and knowledge indexing are intentionally
 * NOT triggered here — the caller owns those and the 'processing' → 'ready'
 * transition, exactly as the live recording pipeline does after stop().
 */
export async function importDemoLecture(options: ImportDemoOptions): Promise<Lecture> {
  const { repos, courseId, bus } = options;
  const now = options.now ?? Date.now();

  // Build raw speech segments on the demo's own media timeline.
  const raw: TranscriptSegment[] = [];
  let cursor = 0;
  DEMO_LECTURE.utterances.forEach((utterance, index) => {
    const startMs = cursor;
    const endMs = cursor + utterance.durationMs;
    raw.push({
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

  const tagged = await runStages(raw, [headingsStage(), questionsStage()]);
  const durationMs = raw.reduce((max, s) => Math.max(max, s.endMs), 0);

  const lectureId = newId();
  const number = await repos.lectures.nextNumber(courseId);
  const lecture: Lecture = {
    id: lectureId,
    courseId,
    title: 'DNA Replication (Demo)',
    number,
    status: 'processing',
    recordedAt: now,
    durationMs,
    topics: [],
    tags: ['demo'],
    createdAt: now,
    updatedAt: now,
  };

  const transcript = buildTranscript({
    lectureId,
    segments: tagged,
    language: 'en',
    engine: 'simulated',
  });

  await repos.lectures.put(lecture);
  await repos.transcripts.put(transcript);
  bus.emit('transcript:updated', { lectureId });

  return lecture;
}
