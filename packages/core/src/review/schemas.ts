import { z } from 'zod';

/**
 * Zod schema for the *raw* exam-prep plan an LLM is asked to emit.
 *
 * Like the analysis schemas, this is intentionally forgiving: every field has a
 * `.catch()` fallback so a slightly-malformed model response still yields a
 * usable (if smaller) plan instead of failing the whole generation. The exam
 * prep service then maps this raw shape onto the strict shared `ExamPrepPlan`,
 * resolving the model's 1-based `lectureNumber` references to real `lectureId`s
 * and stamping the deterministic weak-area analysis onto the result.
 */

/** Coerce to a number and clamp into 0..1, falling back when absent/garbage. */
const unit = (fallback: number) =>
  z.coerce
    .number()
    .catch(fallback)
    .transform((n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : fallback)));

/** Coerce to a non-negative integer lecture number (0 = "unspecified"). */
const lectureNumber = z.coerce
  .number()
  .catch(0)
  .transform((n) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

export const RawKeyConceptSchema = z.object({
  conceptName: z.string().catch(''),
  /** 1-based lecture number the concept belongs to; resolved to an id downstream. */
  lectureNumber,
  importance: unit(0.5),
});

export const RawStudyStepSchema = z.object({
  title: z.string().catch(''),
  /** Optional 1-based lecture number; resolved to a lectureId when it matches. */
  lectureNumber: lectureNumber.optional().catch(0),
  rationale: z.string().catch(''),
});

/**
 * The complete raw exam-prep plan. Collections default to empty so partial
 * model output still parses into a well-formed result.
 */
export const RawExamPrepSchema = z.object({
  cumulativeReview: z.string().catch(''),
  keyConcepts: z.array(RawKeyConceptSchema).catch([]),
  recurringTopics: z.array(z.string()).catch([]),
  likelyExamQuestions: z.array(z.string()).catch([]),
  studyOrder: z.array(RawStudyStepSchema).catch([]),
});

export type RawKeyConcept = z.infer<typeof RawKeyConceptSchema>;
export type RawStudyStep = z.infer<typeof RawStudyStepSchema>;
export type RawExamPrep = z.infer<typeof RawExamPrepSchema>;
