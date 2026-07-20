import {
  newId,
  type Concept,
  type LectureAnalysis,
  type NoteBlock,
  type NotesContent,
} from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { NotesContentSchema, type RawNoteBlock, type RawNotesContent } from '../schemas';
import {
  buildContextBlock,
  conceptById,
  definitionForConcept,
  exampleForConcept,
  firstSentence,
  selectConcepts,
  splitSentences,
} from '../common';

/**
 * Structured, richly-formatted lecture notes.
 *
 * AI path: prompts for a hierarchy of note blocks with callouts, keywords, icons
 * and accents, then stamps ids. Heuristic path: assembles the same block shapes
 * directly from the analysis (headings per concept, definitions, bulleted
 * summaries, examples, emphasis-cue facts, struggle warnings and formulas). Both
 * paths guarantee at least one definition and at least one callout so the notes
 * always render with visual structure.
 */

const NOTES_SYSTEM = [
  'You write beautiful, well-structured study notes from a lecture analysis.',
  'Return JSON: { "blocks": NoteBlock[] }.',
  'Each block is { type, level?, text?, items?, term?, keywords?, icon?, accent? }.',
  'Block types and their required fields:',
  '- heading: level (1-3) + text',
  '- paragraph: text',
  '- bullets: items (string[])',
  '- definition: term + text',
  '- example: text',
  '- warning | mistake | fact: text (these are callouts)',
  '- formula: term (name) + text (expression + meaning)',
  'Requirements:',
  '- Use a clear heading hierarchy: one level-1 title, a level-2 heading per topic.',
  '- Add callout blocks (warning for pitfalls, mistake for frequent errors, fact for',
  '  must-know points) wherever the material warrants — include at least one.',
  '- Fill keywords[] on content blocks with the salient terms to highlight.',
  '- Set icon to a lucide icon name and accent to one of: primary, amber, rose,',
  '  emerald, sky — especially on callouts, definitions and formulas.',
  '- Include at least one definition block.',
  'Do not invent facts beyond the provided analysis and transcript.',
].join('\n');

// Refinements make the schema a ZodEffects; its output type still equals
// RawNotesContent, so this cast only satisfies the StructuredGenerator's
// ZodType<T> constraint. The runtime object is unchanged.
const NotesSchemaType = NotesContentSchema as unknown as z.ZodType<RawNotesContent>;

export const notesGenerator: MaterialGenerator<'notes'> = {
  type: 'notes',
  name: 'Structured Notes',
  async generate(ctx) {
    const content = ctx.aiAvailable ? await aiNotes(ctx) : heuristicNotes(ctx);
    return { title: `${ctx.lecture.title} — Notes`, content };
  },
};

async function aiNotes(ctx: GenerationContext): Promise<NotesContent> {
  const raw = await ctx.generate({
    schema: NotesSchemaType,
    schemaName: 'NotesContent',
    system: NOTES_SYSTEM,
    user: `${buildContextBlock(ctx)}\n\nWrite the notes now.`,
    temperature: 0.4,
  });
  return { blocks: raw.blocks.map(toNoteBlock) };
}

/** Stamp a fresh id onto a raw block and drop absent optional fields. */
function toNoteBlock(raw: RawNoteBlock): NoteBlock {
  const block: NoteBlock = { id: newId(), type: raw.type };
  if (raw.level != null) block.level = raw.level;
  if (raw.text != null && raw.text.trim()) block.text = raw.text.trim();
  if (raw.items && raw.items.length) block.items = raw.items.map((i) => i.trim());
  if (raw.term != null && raw.term.trim()) block.term = raw.term.trim();
  if (raw.keywords && raw.keywords.length) block.keywords = raw.keywords;
  if (raw.icon) block.icon = raw.icon;
  if (raw.accent) block.accent = raw.accent;
  return block;
}

function heuristicNotes(ctx: GenerationContext): NotesContent {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const byId = conceptById(analysis);
  const blocks: NoteBlock[] = [];
  const topNames = concepts.slice(0, 6).map((c) => c.name);

  blocks.push(heading(1, ctx.lecture.title));
  blocks.push({
    id: newId(),
    type: 'paragraph',
    text: analysis.gist || `An overview of ${topNames.join(', ') || 'the lecture'}.`,
    ...(topNames.length ? { keywords: topNames } : {}),
  });

  // Emphasis cues become "fact" callouts up front.
  const cueFacts = analysis.emphasisCues.slice(0, 3);
  for (const cue of cueFacts) {
    blocks.push(callout('fact', 'sparkles', 'sky', `Emphasized in lecture: "${cue.quote}"`));
  }

  let definitionCount = 0;
  for (const concept of concepts) {
    blocks.push({ ...heading(2, concept.name), keywords: [concept.name] });

    const points = summaryPoints(concept);
    if (points.length) blocks.push({ id: newId(), type: 'bullets', items: points });

    const def = definitionForConcept(analysis, concept);
    if (def) {
      blocks.push(definitionBlock(def.term, def.definition));
      definitionCount++;
    }

    const example = exampleForConcept(analysis, concept);
    if (example) {
      blocks.push({
        id: newId(),
        type: 'example',
        text: example.description,
        icon: 'lightbulb',
        accent: 'emerald',
      });
    }
  }

  // Definitions not already attached to a shown concept.
  const shownTerms = new Set(concepts.map((c) => c.name.toLowerCase()));
  const looseDefs = analysis.definitions.filter(
    (d) => !shownTerms.has(d.term.toLowerCase()) && !concepts.some((c) => c.id === d.conceptId),
  );
  if (looseDefs.length) {
    blocks.push(heading(2, 'Key Definitions'));
    for (const def of looseDefs.slice(0, 8)) {
      blocks.push(definitionBlock(def.term, def.definition));
      definitionCount++;
    }
  }

  // Formulas.
  if (analysis.formulas.length) {
    blocks.push(heading(2, 'Formulas'));
    for (const f of analysis.formulas) {
      blocks.push({
        id: newId(),
        type: 'formula',
        term: f.name,
        text: f.explanation ? `${f.expression} — ${f.explanation}` : f.expression,
        icon: 'function-square',
        accent: 'primary',
      });
    }
  }

  // Struggle watchlist becomes warning callouts.
  const struggleConcepts = analysis.struggleWatchlist
    .map((id) => byId.get(id))
    .filter((c): c is Concept => c !== undefined)
    .slice(0, 3);
  for (const concept of struggleConcepts) {
    blocks.push(
      callout(
        'warning',
        'alert-triangle',
        'amber',
        `Students often struggle with ${concept.name}. ${firstSentence(concept.summary)}`,
      ),
    );
  }

  // Guarantee at least one definition even for a sparse analysis.
  if (definitionCount === 0) {
    const lead = concepts[0];
    if (lead) {
      blocks.push(heading(2, 'Key Definition'));
      blocks.push(definitionBlock(lead.name, lead.summary || `${lead.name} is a core idea here.`));
    }
  }

  // Guarantee at least one callout.
  if (cueFacts.length === 0 && struggleConcepts.length === 0) {
    const lead = concepts[0];
    blocks.push(
      callout(
        'fact',
        'sparkles',
        'sky',
        lead
          ? `Focus on ${lead.name} — it is central to this lecture.`
          : 'Review the concepts above before the exam.',
      ),
    );
  }

  return { blocks };
}

function heading(level: number, text: string): NoteBlock {
  return { id: newId(), type: 'heading', level, text };
}

function callout(
  type: 'warning' | 'mistake' | 'fact',
  icon: string,
  accent: string,
  text: string,
): NoteBlock {
  return { id: newId(), type, text, icon, accent };
}

function definitionBlock(term: string, text: string): NoteBlock {
  return { id: newId(), type: 'definition', term, text, icon: 'book-marked', accent: 'primary' };
}

/** Up to four bullet points derived from a concept's summary. */
function summaryPoints(concept: Concept): string[] {
  const sentences = splitSentences(concept.summary);
  if (sentences.length <= 1) return sentences;
  return sentences.slice(0, 4);
}
