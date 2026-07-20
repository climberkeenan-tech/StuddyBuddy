import type { EntityId, Lecture, LectureAnalysis, Transcript } from '@studdybuddy/shared';
import type { AIFacade } from '../ai/types';
import type { Logger } from '../infra/logger';

/**
 * Lightweight reference to an earlier lecture in the same course, used to find
 * cross-lecture concept overlaps. The caller resolves each prior lecture's
 * stored analysis into a flat list of concept names.
 */
export interface PriorLectureRef {
  lectureId: EntityId;
  /** Lecture number within the course (1-based). */
  number: number;
  title: string;
  /** Concept names from that lecture's persisted analysis. */
  conceptNames: string[];
}

/** Input to {@link LectureAnalyzer.analyze}. */
export interface AnalyzeInput {
  lecture: Lecture;
  transcript: Transcript;
  /** Earlier lectures of the same course, for cross-lecture linking. */
  priorLectures: PriorLectureRef[];
}

/** Dependencies for {@link LectureAnalyzer}. */
export interface LectureAnalyzerDeps {
  ai: AIFacade;
  logger: Logger;
}

/**
 * Contract the analysis service depends on. Produces a complete
 * {@link LectureAnalysis} whether or not a real LLM is configured.
 */
export interface Analyzer {
  analyze(input: AnalyzeInput): Promise<LectureAnalysis>;
}
