import {
  formatOffset,
  type Concept,
  type EntityId,
  type Explanation,
  type ExplanationStyle,
  type LectureAnalysis,
  type Transcript,
} from '@studdybuddy/shared';
import type { AIFacade } from '../ai/types';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import { ExplanationSchema } from './schemas';
import { normalizeName } from './heuristics';

/**
 * Ordered rotation of explanation styles cycled by the "I still don't
 * understand" button: each successive attempt re-explains the same concept a
 * different way. Attempt N (1-based) uses `STYLE_ROTATION[(N-1) % 5]`.
 */
export const STYLE_ROTATION: readonly ExplanationStyle[] = [
  'simple',
  'analogy',
  'step-by-step',
  'visual',
  'example',
];

export interface ExplainRequest {
  lectureId: string;
  conceptName: string;
  /** 1-based attempt; drives style rotation when `style` is not pinned. */
  attempt?: number;
  /** Force a specific style, overriding rotation. */
  style?: ExplanationStyle;
}

export interface ExplainServiceDeps {
  repos: Repositories;
  ai: AIFacade;
  logger: Logger;
}

const STYLE_INSTRUCTIONS: Record<ExplanationStyle, string> = {
  simple:
    'Explain in plain 8th-grade language using short sentences and no jargon. Keep it under 150 words.',
  analogy:
    'Explain with one vivid analogy grounded in everyday life, and make the mapping between the analogy and the concept explicit.',
  'step-by-step':
    'Explain as a numbered, ordered walkthrough (1., 2., 3., …) with exactly one idea per step.',
  visual:
    'Put a Mermaid diagram (a `mindmap` or `flowchart TD`) in the `mermaid` field, and a short caption in `markdown` describing what the diagram shows.',
  example:
    'Explain by working through a single concrete, realistic example from start to finish.',
};

const STYLE_TEMPERATURE: Record<ExplanationStyle, number> = {
  simple: 0.3,
  analogy: 0.7,
  'step-by-step': 0.4,
  visual: 0.4,
  example: 0.6,
};

/** Assembled context about the concept, used by both AI and heuristic paths. */
interface ExplainContext {
  displayName: string;
  summary: string;
  definition?: string;
  examples: string[];
  relatedNames: string[];
  sentences: string[];
  facts: string[];
}

/**
 * The interactive "explain this concept" service.
 *
 * Works with or without an AI provider: online it prompts a model with a
 * style-tailored instruction; offline it composes a genuinely different
 * explanation per style from the stored analysis + transcript, always emitting
 * a Mermaid mindmap for the visual style (and for other styles when the concept
 * has related concepts). Successive attempts rotate styles so repeated "I still
 * don't understand" clicks visibly change the explanation.
 */
export class ExplainService {
  private readonly repos: Repositories;
  private readonly ai: AIFacade;
  private readonly logger: Logger;

  constructor(deps: ExplainServiceDeps) {
    this.repos = deps.repos;
    this.ai = deps.ai;
    this.logger = deps.logger.child('explain-service');
  }

  /**
   * Explain a concept from a lecture in a chosen (or rotation-selected) style.
   * @throws SbError NOT_FOUND when the lecture has no analysis, or the concept
   *   is neither in the analysis nor mentioned in the transcript.
   */
  async concept(req: ExplainRequest): Promise<Explanation> {
    const attempt = req.attempt && req.attempt > 0 ? req.attempt : 1;
    const style = req.style ?? rotationStyle(attempt);

    const analysis = await this.repos.analyses.getByLecture(req.lectureId);
    if (!analysis) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `No analysis for lecture "${req.lectureId}"; analyze it before requesting explanations.`,
      );
    }
    const transcript = await this.repos.transcripts.getByLecture(req.lectureId);
    const ctx = buildContext(req.conceptName, analysis, transcript);
    if (!ctx) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `Concept "${req.conceptName}" was not found in lecture "${req.lectureId}".`,
      );
    }

    if (await this.ai.available()) {
      try {
        return await this.explainWithAi(ctx, style, attempt);
      } catch (e) {
        this.logger.warn('AI explanation failed; using heuristic explanation', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return heuristicExplanation(ctx, style, attempt, 'heuristic');
  }

  private async explainWithAi(
    ctx: ExplainContext,
    style: ExplanationStyle,
    attempt: number,
  ): Promise<Explanation> {
    const out = await this.ai.generate({
      schema: ExplanationSchema,
      schemaName: 'Explanation',
      system: [
        'You re-explain a single lecture concept to a student who did not understand it.',
        `Style requirement: ${STYLE_INSTRUCTIONS[style]}`,
        'Ground the explanation in the provided context; do not invent facts.',
      ].join('\n'),
      user: buildAiUserPrompt(ctx, style),
      temperature: STYLE_TEMPERATURE[style],
    });

    const mermaid =
      out.mermaid?.trim() ||
      (style === 'visual' ? buildMindmap(ctx) : undefined);

    return {
      conceptName: ctx.displayName,
      style,
      markdown: out.markdown.trim(),
      ...(mermaid ? { mermaid } : {}),
      attempt,
      generatedBy: this.ai.activeLabel(),
    };
  }
}

export function createExplainService(deps: ExplainServiceDeps): ExplainService {
  return new ExplainService(deps);
}

/** Style for a 1-based attempt via the rotation. */
export function rotationStyle(attempt: number): ExplanationStyle {
  const idx = ((attempt - 1) % STYLE_ROTATION.length + STYLE_ROTATION.length) % STYLE_ROTATION.length;
  return STYLE_ROTATION[idx] ?? 'simple';
}

/* ————————————————————————————— context ————————————————————————————— */

function buildContext(
  conceptName: string,
  analysis: LectureAnalysis,
  transcript: Transcript | null,
): ExplainContext | null {
  const norm = normalizeName(conceptName);
  const idToName = new Map<EntityId, string>();
  for (const c of analysis.concepts) idToName.set(c.id, c.name);

  const concept =
    analysis.concepts.find((c) => normalizeName(c.name) === norm) ??
    analysis.concepts.find((c) => wholeWordOverlap(norm, normalizeName(c.name)));

  const sentences = transcript ? mentioningSentences(transcript, concept?.name ?? conceptName) : [];

  if (!concept && sentences.length === 0) return null;

  const displayName = concept?.name ?? conceptName;

  const definition = analysis.definitions.find(
    (d) => (concept && d.conceptId === concept.id) || normalizeName(d.term) === normalizeName(displayName),
  )?.definition;

  const examples = analysis.examples
    .filter((e) => concept && e.conceptId === concept.id)
    .map((e) => e.description)
    .slice(0, 3);

  const relatedNames = concept
    ? concept.related
        .map((r) => idToName.get(r.conceptId))
        .filter((n): n is string => Boolean(n))
    : [];

  const summary =
    concept?.summary?.trim() ||
    definition ||
    sentences[0] ||
    `${displayName} is a concept from this lecture.`;

  return {
    displayName,
    summary,
    definition,
    examples,
    relatedNames,
    sentences,
    facts: conceptFacts(concept),
  };
}

/** Short factual bullets used to enrich diagrams/explanations. */
function conceptFacts(concept: Concept | undefined): string[] {
  if (!concept) return [];
  const facts: string[] = [];
  facts.push(`${concept.mentions} mention${concept.mentions === 1 ? '' : 's'}`);
  facts.push(`first at ${formatOffset(concept.firstMentionMs)}`);
  if (concept.examLikelihood >= 0.5) facts.push('likely on the exam');
  return facts;
}

/** Up to 6 transcript sentences mentioning the term (whole-word match). */
function mentioningSentences(transcript: Transcript, term: string): string[] {
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term.toLowerCase())}(?:$|[^a-z0-9])`, 'i');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const seg of transcript.segments) {
    if (seg.kind === 'pause' || seg.kind === 'heading') continue;
    for (const raw of seg.text.match(/[^.!?]+[.!?]*/g) ?? [seg.text]) {
      const sentence = raw.trim();
      if (!sentence || seen.has(sentence)) continue;
      if (re.test(sentence)) {
        seen.add(sentence);
        out.push(sentence);
        if (out.length >= 6) return out;
      }
    }
  }
  return out;
}

/* ———————————————————————— heuristic composition ———————————————————————— */

/**
 * Compose a style-specific explanation with no LLM. Structure varies markedly
 * by style so consecutive attempts (which rotate styles) look clearly different.
 */
export function heuristicExplanation(
  ctx: ExplainContext,
  style: ExplanationStyle,
  attempt: number,
  generatedBy: string,
): Explanation {
  const title = titleCase(ctx.displayName);
  let markdown: string;
  let mermaid: string | undefined;

  switch (style) {
    case 'simple':
      markdown = simpleMarkdown(title, ctx);
      break;
    case 'analogy':
      markdown = analogyMarkdown(title, ctx);
      break;
    case 'step-by-step':
      markdown = stepByStepMarkdown(title, ctx);
      break;
    case 'visual':
      markdown = visualCaption(title, ctx);
      mermaid = buildMindmap(ctx);
      break;
    case 'example':
      markdown = exampleMarkdown(title, ctx);
      break;
  }

  // Attach a mindmap to non-visual styles too when there is structure to show.
  if (!mermaid && ctx.relatedNames.length > 0) mermaid = buildMindmap(ctx);

  return {
    conceptName: ctx.displayName,
    style,
    markdown,
    ...(mermaid ? { mermaid } : {}),
    attempt,
    generatedBy,
  };
}

function simpleMarkdown(title: string, ctx: ExplainContext): string {
  const parts = [`## ${title} — in simple terms`, '', shorten(ctx.summary)];
  if (ctx.definition) parts.push('', `Put simply: ${shorten(ctx.definition)}`);
  if (ctx.relatedNames.length > 0) {
    parts.push('', `It connects to ${joinList(ctx.relatedNames.slice(0, 3))}.`);
  }
  parts.push('', `**In one line:** ${title} is one of the key ideas in this lecture.`);
  return parts.join('\n');
}

function analogyMarkdown(title: string, ctx: ExplainContext): string {
  const partner = ctx.relatedNames[0];
  const analogy = partner
    ? `Think of ${title} and ${titleCase(partner)} like parts of an everyday machine: each has a job, and they only work because they cooperate.`
    : `Think of ${title} like a tool in a well-run kitchen — it exists to do one job well, at just the right moment.`;
  const parts = [`## ${title} — an everyday analogy`, '', analogy, '', `In the lecture: ${shorten(ctx.summary)}`];
  if (ctx.definition) parts.push('', `More precisely: ${shorten(ctx.definition)}`);
  parts.push('', `The analogy holds because, like the everyday version, ${title} plays a specific, repeatable role.`);
  return parts.join('\n');
}

function stepByStepMarkdown(title: string, ctx: ExplainContext): string {
  const steps: string[] = [];
  steps.push(`1. **Start with what it is.** ${shorten(ctx.definition ?? ctx.summary)}`);
  steps.push(`2. **See where it shows up.** ${ctx.sentences[0] ?? `${title} appears throughout this lecture.`}`);
  if (ctx.relatedNames.length > 0) {
    steps.push(`3. **Connect it.** ${title} relates to ${joinList(ctx.relatedNames.slice(0, 3))}.`);
  } else {
    steps.push(`3. **Connect it.** Tie ${title} back to the lecture's main theme.`);
  }
  steps.push(
    ctx.examples[0]
      ? `4. **Ground it in an example.** ${shorten(ctx.examples[0])}`
      : `4. **Ground it.** Try to recall where the professor used ${title}.`,
  );
  steps.push(`5. **Check yourself.** Explain ${title} out loud in a single sentence without notes.`);
  return [`## Understanding ${title}, step by step`, '', ...steps].join('\n');
}

function visualCaption(title: string, ctx: ExplainContext): string {
  const rel =
    ctx.relatedNames.length > 0
      ? `Its branches show the related ideas (${joinList(ctx.relatedNames.slice(0, 4))}) and quick facts.`
      : 'Its branches show quick facts about the concept.';
  return [
    `## ${title} at a glance`,
    '',
    `The mind map below puts ${title} at the center. ${rel}`,
    '',
    shorten(ctx.summary),
  ].join('\n');
}

function exampleMarkdown(title: string, ctx: ExplainContext): string {
  const example =
    ctx.examples[0] ??
    ctx.sentences[0] ??
    `Suppose you had to point to ${title} in the middle of the lecture — here is how it plays out.`;
  const parts = [`## ${title} — a worked example`, '', `**Example:** ${shorten(example)}`, '', '**Walkthrough:**'];
  parts.push(`- What is happening: ${shorten(ctx.summary)}`);
  if (ctx.definition) parts.push(`- The precise idea: ${shorten(ctx.definition)}`);
  if (ctx.relatedNames.length > 0) {
    parts.push(`- Why it matters: it links ${joinList(ctx.relatedNames.slice(0, 3))} together.`);
  }
  return parts.join('\n');
}

/** Build a Mermaid mindmap rooted at the concept with related ideas + facts. */
export function buildMindmap(ctx: ExplainContext): string {
  const lines = ['mindmap', `  root((${sanitizeNode(ctx.displayName)}))`];
  for (const r of ctx.relatedNames.slice(0, 5)) lines.push(`    ${sanitizeNode(r)}`);
  for (const f of ctx.facts.slice(0, 3)) lines.push(`    ${sanitizeNode(f)}`);
  if (ctx.relatedNames.length === 0 && ctx.facts.length === 0) lines.push('    key idea');
  return lines.join('\n');
}

/* ————————————————————————————— prompt/text ————————————————————————————— */

function buildAiUserPrompt(ctx: ExplainContext, style: ExplanationStyle): string {
  const lines = [`Concept: ${ctx.displayName}`, `Summary: ${ctx.summary}`];
  if (ctx.definition) lines.push(`Definition: ${ctx.definition}`);
  if (ctx.relatedNames.length > 0) lines.push(`Related concepts: ${ctx.relatedNames.join(', ')}`);
  if (ctx.examples.length > 0) lines.push(`Examples from the lecture: ${ctx.examples.join(' | ')}`);
  if (ctx.sentences.length > 0) {
    lines.push('Transcript excerpts:');
    for (const s of ctx.sentences) lines.push(`- ${s}`);
  }
  lines.push('', `Now re-explain "${ctx.displayName}" for a confused student. ${STYLE_INSTRUCTIONS[style]}`);
  return lines.join('\n');
}

function sanitizeNode(text: string): string {
  const clean = text.replace(/[()[\]{}]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean || 'idea';
}

function shorten(text: string): string {
  const t = text.trim();
  return t.length > 400 ? `${t.slice(0, 399).trimEnd()}…` : t;
}

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function wholeWordOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(short)}(?:\\s|$)`).test(long);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
