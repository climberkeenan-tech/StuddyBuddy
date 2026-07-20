import type { Concept, LectureAnalysis, MarkdownContent, Transcript } from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { MarkdownContentSchema } from '../schemas';
import {
  buildContextBlock,
  conceptById,
  definitionForConcept,
  firstSentence,
  selectConcepts,
} from '../common';

/**
 * Two summary generators sharing one markdown contract.
 *
 * `summary-concise` produces a tight ~120-word gist plus the top concepts;
 * `summary-detailed` walks the lecture section by section. Offline, both derive
 * entirely from the analysis (and the transcript's section structure for the
 * detailed variant).
 */

const MarkdownSchemaType = MarkdownContentSchema as unknown as z.ZodType<MarkdownContent>;

const CONCISE_SYSTEM = [
  'You write a crisp, exam-focused summary of a lecture in Markdown.',
  'Return JSON: { "markdown": string }.',
  'Keep it to roughly 120 words: a two-to-three sentence overview, then a short',
  'bulleted list of the most important concepts. No preamble, just the summary.',
].join('\n');

const DETAILED_SYSTEM = [
  'You write a thorough, well-organized summary of a lecture in Markdown.',
  'Return JSON: { "markdown": string }.',
  'Open with a short overview, then one "##" section per topic with a full',
  'paragraph explaining it, weaving in definitions, examples and why it matters.',
].join('\n');

export const summaryConciseGenerator: MaterialGenerator<'summary-concise'> = {
  type: 'summary-concise',
  name: 'Concise Summary',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiMarkdown(ctx, CONCISE_SYSTEM, 'Write the concise summary now.')
      : { markdown: heuristicConcise(ctx) };
    return { title: `${ctx.lecture.title} — Summary`, content };
  },
};

export const summaryDetailedGenerator: MaterialGenerator<'summary-detailed'> = {
  type: 'summary-detailed',
  name: 'Detailed Summary',
  async generate(ctx) {
    const content = ctx.aiAvailable
      ? await aiMarkdown(ctx, DETAILED_SYSTEM, 'Write the detailed summary now.')
      : { markdown: heuristicDetailed(ctx) };
    return { title: `${ctx.lecture.title} — Detailed Summary`, content };
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

/** ~120-word gist plus the top handful of concepts as bullets. */
function heuristicConcise(ctx: GenerationContext): string {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, 'easy').slice(0, 5);
  const lines: string[] = [`# ${ctx.lecture.title} — Summary`, '', analysis.gist];
  if (concepts.length) {
    lines.push('', '**Key concepts:**');
    for (const c of concepts) {
      lines.push(`- **${c.name}** — ${firstSentence(c.summary)}`);
    }
  }
  return lines.join('\n');
}

/** Section-by-section walkthrough, one paragraph per topical section. */
function heuristicDetailed(ctx: GenerationContext): string {
  const { analysis, transcript } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const byId = conceptById(analysis);
  const lines: string[] = [`# ${ctx.lecture.title} — Detailed Summary`, '', analysis.gist];

  const grouped = groupConceptsBySection(transcript, concepts);
  if (grouped.length > 0) {
    for (const { title, sectionConcepts } of grouped) {
      lines.push('', `## ${title}`);
      lines.push(paragraphForConcepts(analysis, sectionConcepts, byId));
    }
  } else {
    // No section structure — fall back to a paragraph per concept.
    for (const concept of concepts) {
      lines.push('', `## ${concept.name}`);
      lines.push(paragraphForConcepts(analysis, [concept], byId));
    }
  }
  return lines.join('\n');
}

interface SectionGroup {
  title: string;
  sectionConcepts: Concept[];
}

/** Bucket concepts into transcript sections by first-mention timestamp. */
function groupConceptsBySection(transcript: Transcript, concepts: Concept[]): SectionGroup[] {
  if (transcript.sections.length === 0) return [];
  const groups: SectionGroup[] = transcript.sections.map((s) => ({
    title: s.title,
    sectionConcepts: [],
  }));
  const remaining: Concept[] = [];
  for (const concept of concepts) {
    const idx = transcript.sections.findIndex(
      (s) => concept.firstMentionMs >= s.startMs && concept.firstMentionMs < s.endMs,
    );
    const group = idx >= 0 ? groups[idx] : undefined;
    if (group) group.sectionConcepts.push(concept);
    else remaining.push(concept);
  }
  // Attach any unplaced concepts to the first section so nothing is dropped.
  const firstGroup = groups[0];
  if (firstGroup) firstGroup.sectionConcepts.push(...remaining);
  return groups.filter((g) => g.sectionConcepts.length > 0);
}

/** Compose a prose paragraph covering the concepts in one section. */
function paragraphForConcepts(
  analysis: LectureAnalysis,
  concepts: Concept[],
  byId: Map<string, Concept>,
): string {
  const sentences: string[] = [];
  for (const concept of concepts) {
    sentences.push(concept.summary.trim());
    const def = definitionForConcept(analysis, concept);
    if (def) sentences.push(`${def.term} is ${lowerFirst(def.definition)}`);
    const related = concept.related
      .map((r) => byId.get(r.conceptId)?.name)
      .filter((n): n is string => Boolean(n));
    if (related.length) {
      sentences.push(`It connects to ${related.slice(0, 3).join(', ')}.`);
    }
  }
  return sentences
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(' ')
    .trim();
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
