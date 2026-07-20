import type {
  Difficulty,
  LectureAnalysis,
  Lecture,
  MaterialType,
  StudyMaterial,
  Transcript,
} from '@studdybuddy/shared';
import type { StructuredGenerator } from '../ai/structured';

/**
 * Material generators are the `material-generator` extension point: each
 * knows how to produce one material type from a lecture's transcript+analysis.
 * Built-ins live in src/materials/generators; plugins can add more.
 */

export interface GenerationContext {
  lecture: Lecture;
  transcript: Transcript;
  analysis: LectureAnalysis;
  difficulty: Difficulty;
  /** Structured-output helper bound to the active AI provider. */
  generate: StructuredGenerator;
  /**
   * False when no real LLM is configured — generators must then produce
   * content deterministically from the transcript+analysis (heuristic path)
   * instead of calling `generate`.
   */
  aiAvailable: boolean;
  courseName: string;
}

export interface MaterialGenerator<T extends MaterialType = MaterialType> {
  readonly type: T;
  readonly name: string;
  /** Produce the material content + title. Ids/timestamps are stamped by the service. */
  generate(ctx: GenerationContext): Promise<Pick<StudyMaterial<T>, 'title' | 'content'>>;
}
