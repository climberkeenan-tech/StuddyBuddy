import { describe, expect, it, vi } from 'vitest';
import type {
  FlashcardsContent,
  MarkdownContent,
  McqQuestion,
  NotesContent,
  QuizContent,
  ShortAnswerQuestion,
  StudyGuideContent,
  VocabularyContent,
} from '@studdybuddy/shared';
import type { StructuredRequest } from '../src/ai/types';
import { BUILTIN_GENERATORS } from '../src/materials/builtin-plugin';
import type { MaterialGenerator } from '../src/materials/types';
import {
  MarkdownContentSchema,
  NotesContentSchema,
  RawMcqSchema,
  RawShortAnswerSchema,
  StudyGuideContentSchema,
  VocabularyContentSchema,
} from '../src/materials/schemas';
import { notesGenerator } from '../src/materials/generators/notes';
import { makeContext, stubAi } from './materials-fixtures';

const byType = new Map<string, MaterialGenerator>(BUILTIN_GENERATORS.map((g) => [g.type, g]));
function gen(type: string): MaterialGenerator {
  const g = byType.get(type);
  if (!g) throw new Error(`no generator for ${type}`);
  return g;
}

/* ————————————————————————— heuristic paths, all 12 types ————————————————————————— */

describe('heuristic generators produce schema-valid content', () => {
  it('registers exactly the 12 material types', () => {
    expect(BUILTIN_GENERATORS).toHaveLength(12);
    for (const type of [
      'notes',
      'summary-concise',
      'summary-detailed',
      'study-guide',
      'flashcards',
      'quiz-mcq',
      'quiz-short-answer',
      'practice-test',
      'review-sheet',
      'cheat-sheet',
      'vocabulary',
      'glossary',
    ]) {
      expect(byType.has(type)).toBe(true);
    }
  });

  it('notes: valid, with >=1 definition and >=1 callout', async () => {
    const { content } = await gen('notes').generate(makeContext('medium'));
    const notes = content as NotesContent;
    expect(NotesContentSchema.safeParse(notes).success).toBe(true);
    expect(notes.blocks.every((b) => typeof b.id === 'string' && b.id.length > 0)).toBe(true);
    expect(notes.blocks.some((b) => b.type === 'definition')).toBe(true);
    expect(notes.blocks.some((b) => b.type === 'warning' || b.type === 'mistake' || b.type === 'fact')).toBe(true);
    // Heading hierarchy present.
    expect(notes.blocks.some((b) => b.type === 'heading' && b.level === 1)).toBe(true);
  });

  it('summaries + sheets: valid non-empty markdown', async () => {
    for (const type of ['summary-concise', 'summary-detailed', 'review-sheet', 'cheat-sheet']) {
      const { content } = await gen(type).generate(makeContext('medium'));
      const md = content as MarkdownContent;
      expect(MarkdownContentSchema.safeParse(md).success).toBe(true);
      expect(md.markdown.length).toBeGreaterThan(20);
    }
    // Review sheet is a checklist; cheat sheet has a definitions table.
    const review = (await gen('review-sheet').generate(makeContext('medium'))).content as MarkdownContent;
    expect(review.markdown).toContain('- [ ]');
    const cheat = (await gen('cheat-sheet').generate(makeContext('medium'))).content as MarkdownContent;
    expect(cheat.markdown).toContain('| Term | Definition |');
  });

  it('study-guide: valid, section per concept with conceptIds', async () => {
    const { content } = await gen('study-guide').generate(makeContext('medium'));
    const guide = content as StudyGuideContent;
    expect(StudyGuideContentSchema.safeParse(guide).success).toBe(true);
    expect(guide.sections.length).toBeGreaterThan(0);
    expect(guide.sections.every((s) => s.conceptIds.length >= 1)).toBe(true);
  });

  it('flashcards: cards carry SRS state and varied fronts', async () => {
    const { content } = await gen('flashcards').generate(makeContext('medium'));
    const deck = content as FlashcardsContent;
    expect(deck.cards.length).toBeGreaterThan(3);
    for (const card of deck.cards) {
      expect(card.front.length).toBeGreaterThan(0);
      expect(card.back.length).toBeGreaterThan(0);
      expect(card.srs).toMatchObject({ ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 });
      expect(typeof card.srs.dueAt).toBe('number');
    }
    const fronts = deck.cards.map((c) => c.front);
    expect(new Set(fronts).size).toBe(fronts.length); // no duplicates
    expect(fronts.some((f) => f.startsWith('Define '))).toBe(true);
    expect(fronts.some((f) => f.startsWith('Formula for '))).toBe(true);
  });

  it('quiz-mcq: four distinct choices with an in-range correct index', async () => {
    const { content } = await gen('quiz-mcq').generate(makeContext('medium'));
    const quiz = content as QuizContent;
    expect(quiz.questions.length).toBeGreaterThan(0);
    for (const q of quiz.questions as McqQuestion[]) {
      expect(q.kind).toBe('mcq');
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThanOrEqual(3);
      expect(typeof q.choices[q.correctIndex]).toBe('string');
      expect(RawMcqSchema.safeParse(q).success).toBe(true);
    }
  });

  it('quiz-short-answer: model answers + 2-5 rubric points', async () => {
    const { content } = await gen('quiz-short-answer').generate(makeContext('medium'));
    const quiz = content as QuizContent;
    for (const q of quiz.questions as ShortAnswerQuestion[]) {
      expect(q.kind).toBe('short-answer');
      expect(q.modelAnswer.length).toBeGreaterThan(0);
      expect(q.rubric.length).toBeGreaterThanOrEqual(2);
      expect(q.rubric.length).toBeLessThanOrEqual(5);
      expect(RawShortAnswerSchema.safeParse(q).success).toBe(true);
    }
  });

  it('practice-test: mixes MCQ and short-answer, ~60/40', async () => {
    const { content } = await gen('practice-test').generate(makeContext('medium'));
    const quiz = content as QuizContent;
    const mcq = quiz.questions.filter((q) => q.kind === 'mcq').length;
    const short = quiz.questions.filter((q) => q.kind === 'short-answer').length;
    expect(mcq).toBeGreaterThan(0);
    expect(short).toBeGreaterThan(0);
    expect(mcq).toBeGreaterThan(short); // majority MCQ
    for (const q of quiz.questions) {
      const schema = q.kind === 'mcq' ? RawMcqSchema : RawShortAnswerSchema;
      expect(schema.safeParse(q).success).toBe(true);
    }
  });

  it('vocabulary + glossary: valid entries, glossary alphabetized', async () => {
    const vocab = (await gen('vocabulary').generate(makeContext('medium'))).content as VocabularyContent;
    expect(VocabularyContentSchema.safeParse(vocab).success).toBe(true);
    expect(vocab.entries.length).toBeGreaterThan(0);

    const glossary = (await gen('glossary').generate(makeContext('medium'))).content as VocabularyContent;
    expect(VocabularyContentSchema.safeParse(glossary).success).toBe(true);
    const terms = glossary.entries.map((e) => e.term);
    const sorted = [...terms].sort((a, b) => a.localeCompare(b));
    expect(terms).toEqual(sorted);
  });
});

/* ————————————————————————— difficulty affects item counts ————————————————————————— */

describe('difficulty scales item counts', () => {
  it('hard yields more quiz questions than easy', async () => {
    const easy = (await gen('quiz-mcq').generate(makeContext('easy'))).content as QuizContent;
    const hard = (await gen('quiz-mcq').generate(makeContext('hard'))).content as QuizContent;
    expect(easy.questions.length).toBe(6); // easy cap
    expect(hard.questions.length).toBeGreaterThan(easy.questions.length);
  });

  it('hard folds in struggle-list concepts', async () => {
    const hard = (await gen('study-guide').generate(makeContext('hard'))).content as StudyGuideContent;
    const titles = hard.sections.map((s) => s.title);
    // Proton Gradient (c11) is low-importance but on the struggle watchlist.
    expect(titles).toContain('Proton Gradient');
  });
});

/* ————————————————————————— seeded shuffle determinism ————————————————————————— */

describe('seeded MCQ shuffling is deterministic per lecture', () => {
  it('same lecture id produces identical choice ordering', async () => {
    const a = (await gen('quiz-mcq').generate(makeContext('medium'))).content as QuizContent;
    const b = (await gen('quiz-mcq').generate(makeContext('medium'))).content as QuizContent;
    expect(a.questions.map((q) => (q as McqQuestion).choices)).toEqual(
      b.questions.map((q) => (q as McqQuestion).choices),
    );
    expect(a.questions.map((q) => (q as McqQuestion).correctIndex)).toEqual(
      b.questions.map((q) => (q as McqQuestion).correctIndex),
    );
  });
});

/* ————————————————————————— notes AI path ————————————————————————— */

describe('notes AI path', () => {
  it('prompts with difficulty + analysis and stamps block ids', async () => {
    let captured: StructuredRequest<unknown> | undefined;
    const generate = vi.fn(async (req: StructuredRequest<unknown>) => {
      captured = req;
      return {
        blocks: [
          { type: 'heading', level: 1, text: 'Cellular Respiration' },
          { type: 'definition', term: 'Glycolysis', text: 'splits glucose into pyruvate' },
          { type: 'fact', text: 'Focus on the proton gradient.', icon: 'sparkles', accent: 'sky' },
        ],
      } as unknown;
    });
    const ai = stubAi(generate as <T>(r: StructuredRequest<T>) => Promise<T>);
    const ctx = makeContext('hard', { aiAvailable: true, generate: ai.generate });

    const { content } = await notesGenerator.generate(ctx);
    const notes = content as NotesContent;

    expect(generate).toHaveBeenCalledTimes(1);
    expect(captured?.user).toContain('Difficulty: HARD');
    expect(captured?.user).toContain('Glycolysis'); // analysis serialized into the prompt
    expect(notes.blocks).toHaveLength(3);
    expect(notes.blocks.every((b) => typeof b.id === 'string' && b.id.length > 0)).toBe(true);
    expect(notes.blocks[0]?.text).toBe('Cellular Respiration');
  });
});
