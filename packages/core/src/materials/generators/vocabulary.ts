import type { LectureAnalysis, VocabularyContent } from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { VocabularyContentSchema, type RawVocabularyContent } from '../schemas';
import { buildContextBlock, conceptById, normalize } from '../common';

/**
 * Two term-list generators over the same content shape.
 *
 * `vocabulary` is a study list of terms drawn from the analysis' vocabulary and
 * definitions. `glossary` is the fuller, alphabetized reference: it folds in
 * concept summaries and worked examples, then sorts by term. Difficulty caps how
 * many entries appear so an easy list stays digestible.
 */

const VocabularySchemaType = VocabularyContentSchema as unknown as z.ZodType<RawVocabularyContent>;

type VocabEntry = { term: string; meaning: string; example?: string };

function entryCap(ctx: GenerationContext): number {
  return ctx.difficulty === 'easy' ? 12 : ctx.difficulty === 'hard' ? 30 : 20;
}

export const vocabularyGenerator: MaterialGenerator<'vocabulary'> = {
  type: 'vocabulary',
  name: 'Vocabulary',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiVocabulary(ctx, false)
      : { entries: heuristicVocabulary(ctx) };
    return { title: `${ctx.lecture.title} — Vocabulary`, content };
  },
};

export const glossaryGenerator: MaterialGenerator<'glossary'> = {
  type: 'glossary',
  name: 'Glossary',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiVocabulary(ctx, true)
      : { entries: heuristicGlossary(ctx) };
    return { title: `${ctx.lecture.title} — Glossary`, content };
  },
};

async function aiVocabulary(ctx: GenerationContext, glossary: boolean): Promise<VocabularyContent> {
  const system = glossary
    ? [
        'You compile an alphabetized glossary from a lecture analysis.',
        'Return JSON: { "entries": [{ term, meaning, example? }] }.',
        'Give a full, self-contained meaning for each term and a short example where useful.',
      ].join('\n')
    : [
        'You compile a vocabulary study list from a lecture analysis.',
        'Return JSON: { "entries": [{ term, meaning, example? }] }.',
        'Keep meanings concise. Include an example only when it clarifies usage.',
      ].join('\n');
  const raw = await ctx.generate({
    schema: VocabularySchemaType,
    schemaName: 'VocabularyContent',
    system,
    user: `${buildContextBlock(ctx, false)}\n\nCompile the ${glossary ? 'glossary' : 'vocabulary'} now.`,
    temperature: 0.3,
  });
  const entries = glossary
    ? [...raw.entries].sort((a, b) => a.term.localeCompare(b.term))
    : raw.entries;
  return { entries };
}

/** Vocabulary entries + definition terms, de-duplicated, capped by difficulty. */
function heuristicVocabulary(ctx: GenerationContext): VocabEntry[] {
  const { analysis } = ctx;
  const entries: VocabEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: VocabEntry) => {
    const key = normalize(entry.term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  for (const v of analysis.vocabulary) add({ term: v.term, meaning: v.meaning });
  for (const d of analysis.definitions) add({ term: d.term, meaning: d.definition });

  return entries.slice(0, entryCap(ctx));
}

/** Fuller, alphabetized glossary folding in concepts + examples. */
function heuristicGlossary(ctx: GenerationContext): VocabEntry[] {
  const { analysis } = ctx;
  const byId = conceptById(analysis);
  const entries: VocabEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: VocabEntry) => {
    const key = normalize(entry.term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  for (const d of analysis.definitions) {
    add({ term: d.term, meaning: d.definition, ...exampleFor(analysis, d.conceptId) });
  }
  for (const concept of analysis.concepts) {
    add({ term: concept.name, meaning: concept.summary, ...exampleFor(analysis, concept.id) });
  }
  for (const v of analysis.vocabulary) add({ term: v.term, meaning: v.meaning });

  return entries
    .slice(0, entryCap(ctx))
    .sort((a, b) => a.term.localeCompare(b.term));

  function exampleFor(a: LectureAnalysis, conceptId?: string): { example?: string } {
    if (!conceptId) return {};
    const example = a.examples.find((e) => e.conceptId === conceptId);
    const concept = byId.get(conceptId);
    if (example) return { example: example.description };
    if (concept && concept.related.length) {
      const related = concept.related
        .map((r) => byId.get(r.conceptId)?.name)
        .filter((n): n is string => Boolean(n));
      if (related.length) return { example: `Related to ${related.slice(0, 3).join(', ')}.` };
    }
    return {};
  }
}
