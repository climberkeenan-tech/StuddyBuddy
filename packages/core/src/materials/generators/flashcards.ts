import type { FlashcardsContent } from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { RawFlashcardsSchema, type RawFlashcard, type RawFlashcards } from '../schemas';
import { buildContextBlock, selectConcepts, splitSentences, stampFlashcard } from '../common';

/**
 * Flashcards derived from definitions, concept summaries and formulas.
 *
 * The generator emits raw front/back pairs (varying the prompt phrasing so a
 * deck does not read monotonously), then stamps ids + initial SRS state +
 * concept ids via {@link stampFlashcard}. The MaterialsService re-stamps the SRS
 * `dueAt` against the material's canonical `createdAt` when it persists, so a
 * whole deck shares one due time.
 */

const FlashcardsSchemaType = RawFlashcardsSchema as unknown as z.ZodType<RawFlashcards>;

const FLASHCARDS_SYSTEM = [
  'You write study flashcards from a lecture analysis.',
  'Return JSON: { "cards": [{ "front", "back", "hint"? }] }.',
  'Front is a question or prompt; back is the concise answer. Cover definitions,',
  'core concepts and any formulas. Vary the phrasing of the fronts. Optionally add',
  'a short hint. Do not invent facts beyond the analysis.',
].join('\n');

export const flashcardsGenerator: MaterialGenerator<'flashcards'> = {
  type: 'flashcards',
  name: 'Flashcards',
  async generate(ctx) {
    const raw = ctx.aiAvailable ? await aiCards(ctx) : heuristicCards(ctx);
    const now = Date.now();
    const content: FlashcardsContent = {
      cards: raw.map((card) => stampFlashcard(card, ctx.analysis, now)),
    };
    return { title: `${ctx.lecture.title} — Flashcards`, content };
  },
};

async function aiCards(ctx: GenerationContext): Promise<RawFlashcard[]> {
  const result = await ctx.generate({
    schema: FlashcardsSchemaType,
    schemaName: 'RawFlashcards',
    system: FLASHCARDS_SYSTEM,
    user: `${buildContextBlock(ctx)}\n\nWrite the flashcards now.`,
    temperature: 0.5,
  });
  return result.cards;
}

/** Varied definition/concept/formula cards derived deterministically. */
function heuristicCards(ctx: GenerationContext): RawFlashcard[] {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const cards: RawFlashcard[] = [];
  const seenFronts = new Set<string>();

  const add = (card: RawFlashcard) => {
    const key = card.front.toLowerCase();
    if (seenFronts.has(key)) return;
    seenFronts.add(key);
    cards.push(card);
  };

  // Definition cards: "Define X".
  for (const def of analysis.definitions) {
    add({ front: `Define ${def.term}.`, back: def.definition });
  }

  // Concept cards: rotate the prompt phrasing for variety.
  const conceptPrompts = [
    (name: string) => `What does ${name} do?`,
    (name: string) => `Explain ${name}.`,
    (name: string) => `Why does ${name} matter?`,
  ];
  concepts.forEach((concept, index) => {
    const make = conceptPrompts[index % conceptPrompts.length] as (name: string) => string;
    const back = concept.summary.trim();
    const first = splitSentences(back)[0];
    add({
      front: make(concept.name),
      back,
      ...(first && first !== back ? { hint: first } : {}),
    });
  });

  // Formula cards.
  for (const formula of analysis.formulas) {
    add({
      front: `Formula for ${formula.name}?`,
      back: formula.explanation ? `${formula.expression} — ${formula.explanation}` : formula.expression,
    });
  }

  // Guarantee a non-empty deck even for a threadbare analysis.
  if (cards.length === 0) {
    const lead = concepts[0];
    add({
      front: lead ? `Explain ${lead.name}.` : `Summarize ${ctx.lecture.title}.`,
      back: lead?.summary || analysis.gist || 'Review the lecture material.',
    });
  }

  return cards;
}
