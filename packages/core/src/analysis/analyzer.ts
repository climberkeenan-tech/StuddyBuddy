import {
  chunkText,
  formatOffset,
  newId,
  type Concept,
  type ConceptRef,
  type CrossLectureLink,
  type Definition,
  type EmphasisCue,
  type EntityId,
  type Formula,
  type KeyDate,
  type LectureAnalysis,
  type LectureExample,
  type Transcript,
  type VocabularyEntry,
} from '@studdybuddy/shared';
import type { z } from 'zod';
import { analyzeHeuristically, normalizeName } from './heuristics';
import { RawAnalysisSchema, type RawAnalysis, type RawConcept } from './schemas';
import type { AnalyzeInput, LectureAnalyzerDeps, PriorLectureRef } from './types';

/**
 * The raw-analysis schema retyped as `ZodType<RawAnalysis>`. Its `.catch()` /
 * `.transform()` steps make the parser's input type differ from its output
 * type, which would otherwise stop the structured generator's `z.ZodType<T>`
 * constraint from inferring `T = RawAnalysis`. The runtime object is unchanged.
 */
const RawAnalysisType = RawAnalysisSchema as unknown as z.ZodType<RawAnalysis>;

/** Above this rendered-transcript size the AI path extracts per chunk + merges. */
export const AI_CHUNK_THRESHOLD_CHARS = 24_000;
const AI_CHUNK_TARGET_CHARS = 18_000;
const AI_CHUNK_OVERLAP_CHARS = 400;

const EXTRACTION_SYSTEM = [
  'You are an expert study assistant that reads a timestamped lecture transcript',
  'and extracts a structured analysis for students. Identify the concepts the',
  'professor actually taught, define terms, capture formulas, examples, emphasis',
  'cues (what will be on the exam), key dates and vocabulary.',
  '',
  'Return JSON matching the RawAnalysis schema with these fields:',
  '- gist: a two-sentence plain-language summary of the whole transcript.',
  '- concepts: [{ name, summary, importance 0..1, examLikelihood 0..1,',
  '    difficulty 0..1, mentions (int), firstMentionMs (int ms from [m:ss]),',
  '    related: [{ name, relation }] referencing other concept names }].',
  '- definitions: [{ term, definition, conceptName?, atMs }].',
  '- formulas: [{ name, expression, explanation, atMs }].',
  '- examples: [{ description, kind: example|analogy|story|comparison, conceptName?, atMs }].',
  '- keyDates: [{ label, event, atMs }].',
  '- emphasisCues: [{ quote, conceptName?, atMs }] — phrases signalling exam relevance.',
  '- vocabulary: [{ term, meaning, partOfSpeech? }].',
  '- sections: [{ title, gist }] — one per topical section.',
  'Convert every [m:ss] marker to milliseconds for the atMs / firstMentionMs fields.',
  'Prefer concept names as short noun phrases. Do not invent facts not in the transcript.',
].join('\n');

/**
 * Turns a lecture transcript into a complete {@link LectureAnalysis}.
 *
 * With a real AI provider it prompts for structured extraction (chunking long
 * transcripts and merging the per-chunk results); with no provider it falls
 * back to the deterministic heuristic engine. Both paths flow through the same
 * mapping stage, which stamps `EntityId`s, resolves concept-name references to
 * ids, derives the exam/struggle watchlists and links to earlier lectures.
 */
export class LectureAnalyzer {
  private readonly ai: LectureAnalyzerDeps['ai'];
  private readonly logger: LectureAnalyzerDeps['logger'];

  constructor(deps: LectureAnalyzerDeps) {
    this.ai = deps.ai;
    this.logger = deps.logger.child('analyzer');
  }

  async analyze(input: AnalyzeInput): Promise<LectureAnalysis> {
    const { lecture, transcript, priorLectures } = input;
    let raw: RawAnalysis;
    let generatedBy: string;

    if (await this.ai.available()) {
      try {
        raw = await this.aiExtract(transcript);
        generatedBy = this.ai.activeLabel();
      } catch (e) {
        this.logger.warn('AI analysis failed; using heuristics', {
          error: e instanceof Error ? e.message : String(e),
        });
        raw = analyzeHeuristically(transcript);
        generatedBy = 'heuristic';
      }
    } else {
      raw = analyzeHeuristically(transcript);
      generatedBy = 'heuristic';
    }

    return assembleAnalysis(raw, lecture.id, generatedBy, priorLectures);
  }

  /** AI extraction, chunking + merging when the transcript is large. */
  private async aiExtract(transcript: Transcript): Promise<RawAnalysis> {
    const rendered = renderTranscript(transcript);
    if (rendered.length <= AI_CHUNK_THRESHOLD_CHARS) {
      return this.extractChunk(rendered);
    }
    const chunks = chunkText(rendered, AI_CHUNK_TARGET_CHARS, AI_CHUNK_OVERLAP_CHARS);
    this.logger.info('analyzing transcript in chunks', { chunks: chunks.length });
    const parts: RawAnalysis[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      parts.push(await this.extractChunk(chunk.text, i + 1, chunks.length));
    }
    if (parts.length === 0) return analyzeHeuristically(transcript);
    return mergeRawAnalyses(parts);
  }

  private extractChunk(text: string, part?: number, total?: number): Promise<RawAnalysis> {
    const header =
      part && total
        ? `This is part ${part} of ${total} of one lecture transcript. Extract only what appears here.\n\n`
        : '';
    return this.ai.generate({
      schema: RawAnalysisType,
      schemaName: 'RawAnalysis',
      system: EXTRACTION_SYSTEM,
      user: `${header}Transcript:\n\n${text}`,
      temperature: 0.3,
    });
  }
}

/** Factory mirroring the other core services' construction style. */
export function createLectureAnalyzer(deps: LectureAnalyzerDeps): LectureAnalyzer {
  return new LectureAnalyzer(deps);
}

/* ————————————————————————— transcript rendering ————————————————————————— */

/** Render a transcript as `[m:ss] text` lines, marking headings and questions. */
export function renderTranscript(transcript: Transcript): string {
  const lines: string[] = [];
  for (const seg of transcript.segments) {
    if (seg.kind === 'pause') continue;
    const ts = formatOffset(seg.startMs);
    if (seg.kind === 'heading') {
      lines.push(`\n[${ts}] ## ${seg.text}`);
    } else if (seg.kind === 'question' || seg.isTeacherQuestion === true) {
      lines.push(`[${ts}] (question) ${seg.text}`);
    } else {
      lines.push(`[${ts}] ${seg.text}`);
    }
  }
  return lines.join('\n').trim();
}

/* ————————————————————————————— chunk merge ————————————————————————————— */

/** Merge per-chunk raw analyses: union everything, combining duplicate concepts. */
export function mergeRawAnalyses(parts: RawAnalysis[]): RawAnalysis {
  const first = parts[0];
  if (parts.length === 1 && first) return first;

  const concepts = new Map<string, RawConcept>();
  for (const part of parts) {
    for (const c of part.concepts) {
      const norm = normalizeName(c.name);
      if (!norm) continue;
      const existing = concepts.get(norm);
      if (!existing) {
        concepts.set(norm, { ...c, related: [...c.related] });
        continue;
      }
      existing.mentions += c.mentions;
      existing.importance = Math.max(existing.importance, c.importance);
      existing.examLikelihood = Math.max(existing.examLikelihood, c.examLikelihood);
      existing.difficulty = Math.max(existing.difficulty, c.difficulty);
      existing.firstMentionMs = Math.min(existing.firstMentionMs, c.firstMentionMs);
      if (c.summary.length > existing.summary.length) existing.summary = c.summary;
      const seen = new Set(existing.related.map((r) => normalizeName(r.name)));
      for (const r of c.related) {
        const rn = normalizeName(r.name);
        if (rn && !seen.has(rn)) {
          seen.add(rn);
          existing.related.push(r);
        }
      }
    }
  }

  const gist = parts
    .map((p) => p.gist.trim())
    .filter((g) => g.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? '';

  return {
    gist,
    concepts: [...concepts.values()],
    definitions: dedupeBy(parts.flatMap((p) => p.definitions), (d) => normalizeName(d.term)),
    formulas: dedupeBy(parts.flatMap((p) => p.formulas), (f) => f.expression.trim().toLowerCase()),
    examples: dedupeBy(parts.flatMap((p) => p.examples), (e) => e.description.trim().toLowerCase()),
    keyDates: dedupeBy(
      parts.flatMap((p) => p.keyDates),
      (k) => `${k.label}|${k.event.trim().toLowerCase()}`,
    ),
    emphasisCues: dedupeBy(
      parts.flatMap((p) => p.emphasisCues),
      (c) => c.quote.trim().toLowerCase(),
    ),
    vocabulary: dedupeBy(parts.flatMap((p) => p.vocabulary), (v) => normalizeName(v.term)),
    sections: dedupeBy(parts.flatMap((p) => p.sections), (s) => normalizeName(s.title)),
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/* ———————————————————————— raw → LectureAnalysis ———————————————————————— */

/**
 * Map a raw analysis onto the strict shared `LectureAnalysis`: assign ids,
 * resolve name references to concept ids, derive watchlists, and compute
 * cross-lecture links against earlier lectures.
 */
export function assembleAnalysis(
  raw: RawAnalysis,
  lectureId: EntityId,
  generatedBy: string,
  priorLectures: PriorLectureRef[],
): LectureAnalysis {
  const byNorm = new Map<string, Concept>();
  const rawRelatedByNorm = new Map<string, RawConcept['related']>();
  const order: string[] = [];

  for (const c of raw.concepts) {
    const norm = normalizeName(c.name);
    if (!norm || byNorm.has(norm)) continue;
    const name = c.name.trim();
    byNorm.set(norm, {
      id: newId(),
      name,
      summary: c.summary.trim() || `${name} is discussed in this lecture.`,
      importance: c.importance,
      examLikelihood: c.examLikelihood,
      difficulty: c.difficulty,
      mentions: c.mentions,
      firstMentionMs: c.firstMentionMs,
      related: [],
    });
    rawRelatedByNorm.set(norm, c.related);
    order.push(norm);
  }

  const resolveId = (name?: string): EntityId | undefined => {
    if (!name) return undefined;
    return byNorm.get(normalizeName(name))?.id;
  };

  // Resolve concept-to-concept relations now that every concept has an id.
  for (const norm of order) {
    const concept = byNorm.get(norm);
    if (!concept) continue;
    const related: ConceptRef[] = [];
    const seen = new Set<EntityId>();
    for (const r of rawRelatedByNorm.get(norm) ?? []) {
      const rnorm = normalizeName(r.name);
      if (!rnorm || rnorm === norm) continue;
      const target = byNorm.get(rnorm);
      if (!target || seen.has(target.id)) continue;
      seen.add(target.id);
      related.push({ conceptId: target.id, relation: r.relation.trim() || 'related' });
    }
    concept.related = related;
  }

  const concepts = order.map((n) => byNorm.get(n)).filter((c): c is Concept => c !== undefined);

  const definitions: Definition[] = raw.definitions
    .filter((d) => d.term.trim() && d.definition.trim())
    .map((d) => ({
      id: newId(),
      term: d.term.trim(),
      definition: d.definition.trim(),
      conceptId: resolveId(d.conceptName) ?? resolveId(d.term),
      atMs: d.atMs,
    }));

  const formulas: Formula[] = raw.formulas
    .filter((f) => f.expression.trim())
    .map((f) => ({
      id: newId(),
      name: f.name.trim() || 'Formula',
      expression: f.expression.trim(),
      explanation: f.explanation.trim(),
      atMs: f.atMs,
    }));

  const examples: LectureExample[] = raw.examples
    .filter((e) => e.description.trim())
    .map((e) => ({
      id: newId(),
      conceptId: resolveId(e.conceptName),
      description: e.description.trim(),
      kind: e.kind,
      atMs: e.atMs,
    }));

  const keyDates: KeyDate[] = raw.keyDates
    .filter((k) => k.label.trim() && k.event.trim())
    .map((k) => ({ id: newId(), label: k.label.trim(), event: k.event.trim(), atMs: k.atMs }));

  const emphasisCues: EmphasisCue[] = raw.emphasisCues
    .filter((c) => c.quote.trim())
    .map((c) => ({
      id: newId(),
      quote: c.quote.trim(),
      conceptId: resolveId(c.conceptName) ?? conceptIdInText(c.quote, concepts),
      atMs: c.atMs,
    }));

  const vocabulary: VocabularyEntry[] = raw.vocabulary
    .filter((v) => v.term.trim() && v.meaning.trim())
    .map((v) => ({
      id: newId(),
      term: v.term.trim(),
      meaning: v.meaning.trim(),
      ...(v.partOfSpeech ? { partOfSpeech: v.partOfSpeech } : {}),
    }));

  const examWatchlist = concepts
    .filter((c) => c.examLikelihood >= 0.5)
    .sort((a, b) => b.examLikelihood - a.examLikelihood)
    .slice(0, 8)
    .map((c) => c.id);

  const struggleWatchlist = concepts
    .filter((c) => c.difficulty >= 0.6)
    .sort((a, b) => b.difficulty - a.difficulty)
    .slice(0, 8)
    .map((c) => c.id);

  const gist = raw.gist.trim() || fallbackGist(concepts);

  return {
    lectureId,
    gist,
    concepts,
    definitions,
    formulas,
    examples,
    keyDates,
    emphasisCues,
    vocabulary,
    examWatchlist,
    struggleWatchlist,
    crossLectureLinks: buildCrossLectureLinks(concepts, priorLectures),
    generatedBy,
    createdAt: Date.now(),
  };
}

/** First concept whose name occurs in `text`, used to attribute emphasis cues. */
function conceptIdInText(text: string, concepts: Concept[]): EntityId | undefined {
  const lower = text.toLowerCase();
  for (const c of concepts) {
    if (namesOverlap(normalizeName(c.name), normalizeName(lower))) return c.id;
    if (lower.includes(c.name.toLowerCase())) return c.id;
  }
  return undefined;
}

function fallbackGist(concepts: Concept[]): string {
  const names = concepts.slice(0, 3).map((c) => c.name);
  if (names.length === 0) return 'This lecture has been transcribed and analyzed.';
  return `This lecture focuses on ${names.join(', ')}. Review the concepts and definitions for detail.`;
}

/** Link current concepts to earlier lectures whose concept names overlap. */
function buildCrossLectureLinks(
  concepts: Concept[],
  priorLectures: PriorLectureRef[],
): CrossLectureLink[] {
  const links: CrossLectureLink[] = [];
  const seen = new Set<string>();
  for (const concept of concepts) {
    const cn = normalizeName(concept.name);
    if (!cn) continue;
    for (const prior of priorLectures) {
      for (const priorName of prior.conceptNames) {
        const pn = normalizeName(priorName);
        if (!pn || !namesOverlap(cn, pn)) continue;
        const key = `${concept.id}|${prior.lectureId}|${pn}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          conceptId: concept.id,
          earlierLectureId: prior.lectureId,
          earlierConceptName: priorName,
          note: `"${concept.name}" builds on "${priorName}" from Lecture ${prior.number}: ${prior.title}.`,
        });
      }
    }
  }
  return links.slice(0, 24);
}

/** Whole-name equality, or one name is a whole-word substring of the other. */
function namesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(short)}(?:\\s|$)`);
  return re.test(long);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
