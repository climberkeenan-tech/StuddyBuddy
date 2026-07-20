import { newId, type JobProgress, type LectureAnalysis } from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import { ErrorCodes, SbError, toAppError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import type { Analyzer, PriorLectureRef } from './types';

export interface AnalysisServiceDeps {
  repos: Repositories;
  analyzer: Analyzer;
  bus: CoreEventBus;
  logger: Logger;
}

/**
 * Orchestrates lecture analysis: loads the lecture + transcript, gathers the
 * course's earlier lectures for cross-lecture linking, runs the analyzer,
 * persists the result, refreshes the lecture's auto-detected topics, and emits
 * job-progress events for the UI. The heavy lifting (AI vs. heuristic) lives in
 * the injected {@link Analyzer}; this service is the persistence/eventing seam.
 */
export class AnalysisService {
  private readonly repos: Repositories;
  private readonly analyzer: Analyzer;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;

  constructor(deps: AnalysisServiceDeps) {
    this.repos = deps.repos;
    this.analyzer = deps.analyzer;
    this.bus = deps.bus;
    this.logger = deps.logger.child('analysis-service');
  }

  /**
   * Analyze a lecture end-to-end and persist the result.
   *
   * @param jobId Progress events are emitted under this id. Pass the same id the
   *   caller surfaces (e.g. the one returned from the `analysis.run` IPC method)
   *   so the renderer can track this job; defaults to a fresh id otherwise.
   * @throws SbError NOT_FOUND when the lecture or its transcript is missing.
   */
  async run(lectureId: string, jobId: string = newId()): Promise<LectureAnalysis> {
    this.emit({ jobId, progress: 0, message: 'Queued analysis', state: 'queued' });
    try {
      const lecture = await this.repos.lectures.get(lectureId);
      if (!lecture) {
        throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${lectureId}" not found.`);
      }
      const transcript = await this.repos.transcripts.getByLecture(lectureId);
      if (!transcript) {
        throw new SbError(
          ErrorCodes.NOT_FOUND,
          `Transcript for lecture "${lectureId}" not found; record or transcribe it first.`,
        );
      }

      this.emit({ jobId, progress: 0.1, message: 'Analyzing lecture…', state: 'running' });

      const priorLectures = await this.gatherPriorLectures(lecture.courseId, lecture.number);
      const analysis = await this.analyzer.analyze({ lecture, transcript, priorLectures });

      await this.repos.analyses.put(analysis);

      // Refresh the lecture's topic chips from section titles + strongest concepts.
      const topics = deriveTopics(
        transcript.sections.map((s) => s.title),
        analysis.concepts.map((c) => ({ name: c.name, importance: c.importance })),
      );
      await this.repos.lectures.put({ ...lecture, topics, updatedAt: Date.now() });

      this.emit({ jobId, progress: 1, message: 'Analysis complete', state: 'succeeded' });
      this.logger.info('analysis complete', {
        lectureId,
        concepts: analysis.concepts.length,
        generatedBy: analysis.generatedBy,
      });
      return analysis;
    } catch (e) {
      this.emit({
        jobId,
        progress: -1,
        message: 'Analysis failed',
        state: 'failed',
        error: toAppError(e),
      });
      this.logger.error('analysis failed', {
        lectureId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /** The persisted analysis for a lecture, or null if it has not been analyzed. */
  get(lectureId: string): Promise<LectureAnalysis | null> {
    return this.repos.analyses.getByLecture(lectureId);
  }

  /** Earlier lectures of the same course (number < current) with their concept names. */
  private async gatherPriorLectures(
    courseId: string,
    currentNumber: number,
  ): Promise<PriorLectureRef[]> {
    const lectures = await this.repos.lectures.byCourse(courseId);
    const priors = lectures.filter((l) => l.number < currentNumber);
    const refs: PriorLectureRef[] = [];
    for (const prior of priors) {
      const analysis = await this.repos.analyses.getByLecture(prior.id);
      refs.push({
        lectureId: prior.id,
        number: prior.number,
        title: prior.title,
        conceptNames: analysis ? analysis.concepts.map((c) => c.name) : [],
      });
    }
    return refs;
  }

  private emit(progress: Omit<JobProgress, 'kind'>): void {
    this.bus.emit('job:progress', { ...progress, kind: 'analysis' });
  }
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return new AnalysisService(deps);
}

/** Section titles first, then top concepts by importance; deduped, capped at 8. */
export function deriveTopics(
  sectionTitles: string[],
  concepts: { name: string; importance: number }[],
): string[] {
  const ordered = [...concepts].sort((a, b) => b.importance - a.importance).map((c) => c.name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...sectionTitles, ...ordered]) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 8) break;
  }
  return out;
}
