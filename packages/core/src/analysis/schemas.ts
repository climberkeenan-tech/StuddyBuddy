import { z } from 'zod';

/**
 * Zod schemas for the *raw* lecture-analysis payload an LLM is asked to emit.
 *
 * These are deliberately forgiving: real models drift (numbers out of range,
 * a missing array, a `related` list that is plain strings instead of objects).
 * Every field therefore uses `.catch()` so a slightly-sloppy response still
 * parses into a usable value instead of failing the whole extraction. The
 * analyzer then maps this raw shape onto the strict shared `LectureAnalysis`,
 * stamping `EntityId`s and resolving concept-name references to ids.
 */

/** Coerce to a number and clamp into 0..1, falling back when absent/garbage. */
const unit = (fallback: number) =>
  z.coerce
    .number()
    .catch(fallback)
    .transform((n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : fallback)));

/** Coerce to a non-negative integer (used for millisecond offsets). */
const nonNegInt = (fallback: number) =>
  z.coerce
    .number()
    .catch(fallback)
    .transform((n) => Math.max(0, Math.round(Number.isFinite(n) ? n : fallback)));

/** Mention counts are at least 1 — a concept the model surfaced was said once. */
const mentionCount = z.coerce
  .number()
  .catch(1)
  .transform((n) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

const optionalStr = z.string().optional().catch(undefined);

/**
 * A relation from one concept to another. Accepts either the clean object shape
 * `{ name, relation }` or a bare string (treated as an un-labelled relation),
 * so both common model output styles survive parsing.
 */
export const RawRelationSchema = z
  .union([
    z.string().transform((name) => ({ name, relation: 'related' })),
    z.object({
      name: z.string().catch(''),
      relation: z.string().catch('related'),
    }),
  ])
  .catch({ name: '', relation: 'related' });

export const RawConceptSchema = z.object({
  name: z.string().catch(''),
  summary: z.string().catch(''),
  importance: unit(0.5),
  examLikelihood: unit(0.3),
  difficulty: unit(0.4),
  mentions: mentionCount,
  firstMentionMs: nonNegInt(0),
  /** Names of other concepts this one relates to; resolved to ids downstream. */
  related: z.array(RawRelationSchema).catch([]),
});

export const RawDefinitionSchema = z.object({
  term: z.string().catch(''),
  definition: z.string().catch(''),
  /** Optional owning-concept name; mapped to a conceptId when it matches. */
  conceptName: optionalStr,
  atMs: nonNegInt(0),
});

export const RawFormulaSchema = z.object({
  name: z.string().catch('Formula'),
  expression: z.string().catch(''),
  explanation: z.string().catch(''),
  atMs: nonNegInt(0),
});

export const RawExampleSchema = z.object({
  description: z.string().catch(''),
  kind: z.enum(['example', 'analogy', 'story', 'comparison']).catch('example'),
  conceptName: optionalStr,
  atMs: nonNegInt(0),
});

export const RawKeyDateSchema = z.object({
  label: z.string().catch(''),
  event: z.string().catch(''),
  atMs: nonNegInt(0),
});

export const RawEmphasisCueSchema = z.object({
  quote: z.string().catch(''),
  conceptName: optionalStr,
  atMs: nonNegInt(0),
});

export const RawVocabularySchema = z.object({
  term: z.string().catch(''),
  meaning: z.string().catch(''),
  partOfSpeech: optionalStr,
});

export const RawSectionGistSchema = z.object({
  title: z.string().catch(''),
  gist: z.string().catch(''),
});

/**
 * The complete raw analysis. Every collection defaults to empty on bad/missing
 * data so partial model output still yields a well-formed (if smaller) result.
 */
export const RawAnalysisSchema = z.object({
  gist: z.string().catch(''),
  concepts: z.array(RawConceptSchema).catch([]),
  definitions: z.array(RawDefinitionSchema).catch([]),
  formulas: z.array(RawFormulaSchema).catch([]),
  examples: z.array(RawExampleSchema).catch([]),
  keyDates: z.array(RawKeyDateSchema).catch([]),
  emphasisCues: z.array(RawEmphasisCueSchema).catch([]),
  vocabulary: z.array(RawVocabularySchema).catch([]),
  sections: z.array(RawSectionGistSchema).catch([]),
});

export type RawRelation = z.infer<typeof RawRelationSchema>;
export type RawConcept = z.infer<typeof RawConceptSchema>;
export type RawDefinition = z.infer<typeof RawDefinitionSchema>;
export type RawFormula = z.infer<typeof RawFormulaSchema>;
export type RawExample = z.infer<typeof RawExampleSchema>;
export type RawKeyDate = z.infer<typeof RawKeyDateSchema>;
export type RawEmphasisCue = z.infer<typeof RawEmphasisCueSchema>;
export type RawVocabulary = z.infer<typeof RawVocabularySchema>;
export type RawSectionGist = z.infer<typeof RawSectionGistSchema>;
export type RawAnalysis = z.infer<typeof RawAnalysisSchema>;

/**
 * Schema for an interactive explanation the "I still don't understand" flow
 * asks a model to produce. `mermaid` is optional except for the visual style,
 * where the explain service guarantees a diagram (adding a heuristic one if the
 * model omitted it).
 */
export const ExplanationSchema = z.object({
  markdown: z.string().min(1),
  mermaid: z.string().optional(),
});

export type ExplanationOutput = z.infer<typeof ExplanationSchema>;
