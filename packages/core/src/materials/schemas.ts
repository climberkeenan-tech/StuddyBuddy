import { z } from 'zod';

/**
 * Zod schemas for the *raw* study-material payloads an LLM is asked to emit.
 *
 * These validate what the model returns before the generator/service stamps the
 * bits an LLM cannot know: entity ids, SRS state, discriminator `kind`s, and
 * concept-id references. Keeping the raw shapes here (one per
 * {@link MaterialContentMap} family) means the AI path and the heuristic path
 * can be validated against the same contract, and any drift is caught in one
 * place instead of scattered through the generators.
 */

/** Accent tokens the notes renderer understands. */
export const ACCENT_TOKENS = ['primary', 'amber', 'rose', 'emerald', 'sky'] as const;

const AccentSchema = z.enum(ACCENT_TOKENS);

/* ————————————————————————————————— notes ————————————————————————————————— */

/**
 * One note block without its stamped `id`. The per-type invariants the renderer
 * relies on (a heading needs a level + text, bullets need items, a definition /
 * formula needs a term + text) are enforced with a `superRefine` so a malformed
 * block fails validation instead of rendering blank.
 */
export const RawNoteBlockSchema = z
  .object({
    type: z.enum([
      'heading',
      'paragraph',
      'bullets',
      'definition',
      'example',
      'warning',
      'mistake',
      'fact',
      'formula',
    ]),
    level: z.number().int().min(1).max(3).optional(),
    text: z.string().optional(),
    items: z.array(z.string().min(1)).optional(),
    term: z.string().optional(),
    keywords: z.array(z.string().min(1)).optional(),
    icon: z.string().optional(),
    accent: AccentSchema.optional(),
  })
  .superRefine((block, ctx) => {
    const hasText = typeof block.text === 'string' && block.text.trim().length > 0;
    const hasTerm = typeof block.term === 'string' && block.term.trim().length > 0;
    if (block.type === 'heading') {
      if (block.level == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'heading needs level 1-3' });
      }
      if (!hasText) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'heading needs text' });
      }
    }
    if (block.type === 'bullets' && (!block.items || block.items.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bullets need at least one item' });
    }
    if ((block.type === 'definition' || block.type === 'formula') && !(hasTerm && hasText)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${block.type} needs term and text`,
      });
    }
  });

export const NotesContentSchema = z.object({
  blocks: z.array(RawNoteBlockSchema).min(1),
});

/* —————————————————————————— markdown-based families —————————————————————————— */

export const MarkdownContentSchema = z.object({
  markdown: z.string().min(1),
});

export const RawStudyGuideSectionSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  /** Concept names the section covers; mapped to ids by the generator. */
  conceptNames: z.array(z.string().min(1)).optional(),
});

export const StudyGuideContentSchema = z.object({
  sections: z.array(RawStudyGuideSectionSchema).min(1),
});

/* ————————————————————————————— flashcards ————————————————————————————— */

/**
 * Raw flashcards carry only the human-authored fields; the service stamps each
 * card's `id`, `srs` and `conceptId` (see MaterialsService).
 */
export const RawFlashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().optional(),
});

export const RawFlashcardsSchema = z.object({
  cards: z.array(RawFlashcardSchema).min(1),
});

/* ————————————————————————————————— quizzes ————————————————————————————————— */

/**
 * Raw MCQ: exactly four distinct choices with a correct index in range. `kind`
 * and `id` are stamped by the generator. An optional `conceptName` lets the
 * model attribute the question to a concept, resolved to a `conceptId` later.
 */
export const RawMcqSchema = z
  .object({
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
    conceptName: z.string().optional(),
  })
  .refine((q) => new Set(q.choices.map((c) => c.trim().toLowerCase())).size === q.choices.length, {
    message: 'MCQ choices must be distinct',
    path: ['choices'],
  });

export const RawShortAnswerSchema = z.object({
  prompt: z.string().min(1),
  modelAnswer: z.string().min(1),
  rubric: z.array(z.string().min(1)).min(2).max(5),
  conceptName: z.string().optional(),
});

/**
 * A raw quiz question is either an MCQ or a short-answer item. There is no
 * `kind` discriminator in the raw form, so the union disambiguates structurally
 * (MCQ requires `choices`; short-answer requires `modelAnswer`).
 */
export const RawQuizQuestionSchema = z.union([RawMcqSchema, RawShortAnswerSchema]);

export const RawMcqQuizSchema = z.object({
  questions: z.array(RawMcqSchema).min(1),
});

export const RawShortAnswerQuizSchema = z.object({
  questions: z.array(RawShortAnswerSchema).min(1),
});

export const RawMixedQuizSchema = z.object({
  questions: z.array(RawQuizQuestionSchema).min(1),
});

/* ———————————————————————————— vocabulary / glossary ———————————————————————————— */

export const RawVocabularyEntrySchema = z.object({
  term: z.string().min(1),
  meaning: z.string().min(1),
  example: z.string().optional(),
});

export const VocabularyContentSchema = z.object({
  entries: z.array(RawVocabularyEntrySchema).min(1),
});

export type RawNoteBlock = z.infer<typeof RawNoteBlockSchema>;
export type RawNotesContent = z.infer<typeof NotesContentSchema>;
export type RawStudyGuideSection = z.infer<typeof RawStudyGuideSectionSchema>;
export type RawStudyGuideContent = z.infer<typeof StudyGuideContentSchema>;
export type RawFlashcard = z.infer<typeof RawFlashcardSchema>;
export type RawFlashcards = z.infer<typeof RawFlashcardsSchema>;
export type RawMcq = z.infer<typeof RawMcqSchema>;
export type RawShortAnswer = z.infer<typeof RawShortAnswerSchema>;
export type RawQuizQuestion = z.infer<typeof RawQuizQuestionSchema>;
export type RawMcqQuiz = z.infer<typeof RawMcqQuizSchema>;
export type RawShortAnswerQuiz = z.infer<typeof RawShortAnswerQuizSchema>;
export type RawMixedQuiz = z.infer<typeof RawMixedQuizSchema>;
export type RawVocabularyContent = z.infer<typeof VocabularyContentSchema>;
