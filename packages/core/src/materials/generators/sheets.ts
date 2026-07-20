import type { Concept, LectureAnalysis, MarkdownContent, Transcript } from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { MarkdownContentSchema } from '../schemas';
import {
  buildContextBlock,
  conceptById,
  definitionForConcept,
  escapePipe,
  firstSentence,
  selectConcepts,
  truncateForCell,
} from '../common';

/**
 * Two single-page study sheets.
 *
 * `review-sheet` is an actionable checklist organized by lecture section;
 * `cheat-sheet` is an ultra-compact reference (a definitions table, formulas and
 * key dates). Both render as Markdown.
 */

const MarkdownSchemaType = MarkdownContentSchema as unknown as z.ZodType<MarkdownContent>;

const REVIEW_SYSTEM = [
  'You write a pre-exam review checklist from a lecture analysis, in Markdown.',
  'Return JSON: { "markdown": string }.',
  'Organize it by topic/section with "##" headings and GitHub-style task list',
  'items ("- [ ] ..."). End with a few self-check questions.',
].join('\n');

const CHEAT_SYSTEM = [
  'You write an ultra-compact one-page cheat sheet from a lecture analysis, in Markdown.',
  'Return JSON: { "markdown": string }.',
  'Include a definitions table, a formulas list and any key dates. Be terse.',
].join('\n');

export const reviewSheetGenerator: MaterialGenerator<'review-sheet'> = {
  type: 'review-sheet',
  name: 'Review Sheet',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiMarkdown(ctx, REVIEW_SYSTEM, 'Write the review checklist now.')
      : { markdown: heuristicReviewSheet(ctx) };
    return { title: `${ctx.lecture.title} — Review Sheet`, content };
  },
};

export const cheatSheetGenerator: MaterialGenerator<'cheat-sheet'> = {
  type: 'cheat-sheet',
  name: 'Cheat Sheet',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiMarkdown(ctx, CHEAT_SYSTEM, 'Write the cheat sheet now.')
      : { markdown: heuristicCheatSheet(ctx) };
    return { title: `${ctx.lecture.title} — Cheat Sheet`, content };
  },
};

async function aiMarkdown(
  ctx: GenerationContext,
  system: string,
  task: string,
): Promise<MarkdownContent> {
  return ctx.generate({
    schema: MarkdownSchemaType,
    schemaName: 'MarkdownContent',
    system,
    user: `${buildContextBlock(ctx)}\n\n${task}`,
    temperature: 0.4,
  });
}

/** A checklist grouped by transcript section (or concept when no sections). */
function heuristicReviewSheet(ctx: GenerationContext): string {
  const { analysis, transcript } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const lines: string[] = [`# ${ctx.lecture.title} — Review Sheet`, ''];

  const groups = groupBySection(transcript, concepts);
  if (groups.length > 0) {
    for (const group of groups) {
      lines.push(`## ${group.title}`);
      for (const concept of group.concepts) {
        lines.push(`- [ ] Understand **${concept.name}** — ${firstSentence(concept.summary)}`);
      }
      lines.push('');
    }
  } else {
    lines.push('## Concepts to master', '');
    for (const concept of concepts) {
      lines.push(`- [ ] Understand **${concept.name}** — ${firstSentence(concept.summary)}`);
    }
    lines.push('');
  }

  if (analysis.formulas.length) {
    lines.push('## Formulas to memorize', '');
    for (const f of analysis.formulas) lines.push(`- [ ] ${f.name}: \`${f.expression}\``);
    lines.push('');
  }

  const questions = selfCheckQuestions(analysis, concepts);
  if (questions.length) {
    lines.push('## Self-check questions', '');
    for (const q of questions) lines.push(`- ${q}`);
  }

  return lines.join('\n').trimEnd();
}

/** A terse reference: definitions table, formulas, key dates, key concepts. */
function heuristicCheatSheet(ctx: GenerationContext): string {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const lines: string[] = [`# ${ctx.lecture.title} — Cheat Sheet`, ''];

  if (analysis.definitions.length) {
    lines.push('## Definitions', '', '| Term | Definition |', '| --- | --- |');
    for (const d of analysis.definitions) {
      lines.push(`| **${escapePipe(d.term)}** | ${escapePipe(truncateForCell(d.definition))} |`);
    }
    lines.push('');
  }

  if (analysis.formulas.length) {
    lines.push('## Formulas', '');
    for (const f of analysis.formulas) {
      lines.push(`- **${f.name}:** \`${f.expression}\`${f.explanation ? ` — ${f.explanation}` : ''}`);
    }
    lines.push('');
  }

  if (analysis.keyDates.length) {
    lines.push('## Key dates', '');
    for (const k of analysis.keyDates) lines.push(`- **${k.label}** — ${k.event}`);
    lines.push('');
  }

  lines.push('## Key concepts', '');
  for (const concept of concepts) {
    lines.push(`- **${concept.name}** — ${firstSentence(concept.summary)}`);
  }

  return lines.join('\n').trimEnd();
}

interface SectionGroup {
  title: string;
  concepts: Concept[];
}

function groupBySection(transcript: Transcript, concepts: Concept[]): SectionGroup[] {
  if (transcript.sections.length === 0) return [];
  const groups: SectionGroup[] = transcript.sections.map((s) => ({ title: s.title, concepts: [] }));
  const remaining: Concept[] = [];
  for (const concept of concepts) {
    const idx = transcript.sections.findIndex(
      (s) => concept.firstMentionMs >= s.startMs && concept.firstMentionMs < s.endMs,
    );
    const group = idx >= 0 ? groups[idx] : undefined;
    if (group) group.concepts.push(concept);
    else remaining.push(concept);
  }
  const firstGroup = groups[0];
  if (firstGroup) firstGroup.concepts.push(...remaining);
  return groups.filter((g) => g.concepts.length > 0);
}

/** A couple of recall prompts derived from definitions + emphasis cues. */
function selfCheckQuestions(analysis: LectureAnalysis, concepts: Concept[]): string[] {
  const byId = conceptById(analysis);
  const questions: string[] = [];
  for (const concept of concepts.slice(0, 5)) {
    const def = definitionForConcept(analysis, concept);
    questions.push(def ? `What is ${def.term}?` : `Can you explain ${concept.name}?`);
  }
  for (const cue of analysis.emphasisCues.slice(0, 2)) {
    const concept = cue.conceptId ? byId.get(cue.conceptId) : undefined;
    if (concept) questions.push(`Why did the lecturer emphasize ${concept.name}?`);
  }
  return questions;
}
