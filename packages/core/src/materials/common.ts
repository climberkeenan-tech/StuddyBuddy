import {
  truncate,
  type Concept,
  type Difficulty,
  type EntityId,
  type Flashcard,
  type LectureAnalysis,
  type MaterialType,
  type Transcript,
} from '@studdybuddy/shared';
import type { GenerationContext } from './types';
import type { RawFlashcard } from './schemas';
import { initialSrs } from './srs';

/**
 * Shared, deterministic building blocks for every material generator.
 *
 * The heuristic (offline) paths and the AI-prompt builders both draw from here
 * so that concept selection, seeded shuffling, analysis serialization and
 * concept-name resolution behave identically across material types. Everything
 * in this file is pure and side-effect free.
 */

/** Number of concepts a heuristic generator draws on at each difficulty. */
export function conceptLimit(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 6 : difficulty === 'hard' ? 14 : 10;
}

/**
 * Concepts a generator should build from, in a deterministic order.
 *
 * Ordered by importance (then mentions, then name for stable tie-breaks) and
 * capped by {@link conceptLimit}. On `hard` the struggle watchlist is folded in
 * so the notoriously tricky concepts are always exercised.
 */
export function selectConcepts(analysis: LectureAnalysis, difficulty: Difficulty): Concept[] {
  const sorted = [...analysis.concepts].sort(
    (a, b) =>
      b.importance - a.importance || b.mentions - a.mentions || a.name.localeCompare(b.name),
  );
  const chosen = sorted.slice(0, conceptLimit(difficulty));
  if (difficulty === 'hard') {
    const have = new Set(chosen.map((c) => c.id));
    const byId = conceptById(analysis);
    for (const id of analysis.struggleWatchlist) {
      const concept = byId.get(id);
      if (concept && !have.has(concept.id)) {
        chosen.push(concept);
        have.add(concept.id);
      }
    }
  }
  return chosen;
}

/** Index the analysis' concepts by id for O(1) lookup. */
export function conceptById(analysis: LectureAnalysis): Map<EntityId, Concept> {
  return new Map(analysis.concepts.map((c) => [c.id, c]));
}

/** The definition tied to a concept (by id, then by matching term), if any. */
export function definitionForConcept(analysis: LectureAnalysis, concept: Concept) {
  return (
    analysis.definitions.find((d) => d.conceptId === concept.id) ??
    analysis.definitions.find((d) => normalize(d.term) === normalize(concept.name))
  );
}

/** The first worked example attached to a concept, if any. */
export function exampleForConcept(analysis: LectureAnalysis, concept: Concept) {
  return analysis.examples.find((e) => e.conceptId === concept.id);
}

/** Names of the concepts a concept relates to, resolved through the id map. */
export function relatedConceptNames(concept: Concept, byId: Map<EntityId, Concept>): string[] {
  const names: string[] = [];
  for (const ref of concept.related) {
    const target = byId.get(ref.conceptId);
    if (target) names.push(target.name);
  }
  return names;
}

/**
 * Resolve the concept a free-text string refers to (e.g. a flashcard front or
 * an LLM-supplied concept name) by whole-word phrase match against every
 * concept name. Longer names win so "DNA polymerase" beats "DNA".
 */
export function matchConceptIdByText(
  text: string,
  analysis: LectureAnalysis,
): EntityId | undefined {
  const hay = normalize(text);
  let best: { id: EntityId; len: number } | undefined;
  for (const concept of analysis.concepts) {
    const needle = normalize(concept.name);
    if (!needle) continue;
    if (containsPhrase(hay, needle) && (!best || needle.length > best.len)) {
      best = { id: concept.id, len: needle.length };
    }
  }
  return best?.id;
}

/* ————————————————————————————— text utilities ————————————————————————————— */

/** Lowercase, strip punctuation, collapse whitespace — the canonical match form. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `needle` occurs in `haystack` on whole-word boundaries. */
export function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Split prose into trimmed, non-empty sentences. */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The first sentence of a passage (or the whole thing if it has just one). */
export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? text.trim();
}

/** Hard character cap used to keep prompts within budget. */
export function capText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Escape a value so it is safe inside a Markdown table cell. */
export function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/** Shorten a value for a compact table cell without breaking mid-word. */
export function truncateForCell(text: string, max = 160): string {
  return truncate(text.trim(), max);
}

const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our',
  'out', 'has', 'had', 'his', 'how', 'its', 'who', 'get', 'use', 'each', 'that', 'this', 'with',
  'from', 'they', 'have', 'them', 'then', 'than', 'when', 'what', 'which', 'their', 'there',
  'these', 'those', 'into', 'over', 'such', 'some', 'more', 'most', 'other', 'been', 'being',
  'were', 'will', 'would', 'could', 'should', 'about', 'because', 'while', 'where', 'here',
  'also', 'very', 'just', 'like', 'only', 'your', 'does', 'done', 'both', 'many', 'much',
]);

/**
 * Extract up to `max` key noun-phrase-ish tokens for a rubric, seeding with the
 * caller-supplied phrases (concept + related names) then filling from the text
 * by frequency. Always returns at least two entries so the quiz schema's
 * `rubric` (2-5) is satisfiable.
 */
export function keyNounPhrases(text: string, seeds: string[], max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const key = normalize(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const seed of seeds) push(seed);

  const freq = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
  for (const word of ranked) {
    if (out.length >= max) break;
    push(word);
  }

  // Guarantee the schema minimum even for very short inputs.
  const filler = ['key idea', 'supporting detail'];
  for (let i = 0; out.length < 2 && i < filler.length; i++) push(filler[i] as string);

  return out.slice(0, max);
}

/* ————————————————————————————— flashcard stamping ————————————————————————————— */

/**
 * Turn a raw card into a full {@link Flashcard}, stamping a fresh id, initial
 * SRS state due at `now`, and a `conceptId` resolved from the card text. This is
 * the single stamping path used by both the flashcards generator and the
 * MaterialsService so the two never drift.
 */
export function stampFlashcard(
  raw: RawFlashcard,
  analysis: LectureAnalysis,
  now: number,
): Flashcard {
  const conceptId = matchConceptIdByText(`${raw.front} ${raw.back}`, analysis);
  const card: Flashcard = {
    id: newCardId(),
    front: raw.front.trim(),
    back: raw.back.trim(),
    srs: initialSrs(now),
  };
  if (raw.hint && raw.hint.trim()) card.hint = raw.hint.trim();
  if (conceptId) card.conceptId = conceptId;
  return card;
}

// Local id factory kept separate from the shared newId import path so the
// stamping helper has no other dependencies.
function newCardId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/* ————————————————————————————— seeded randomness ————————————————————————————— */

/** xmur3 string hash → 32-bit seed, feeding {@link mulberry32}. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 PRNG — small, fast, and fully deterministic from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic 0..1 generator seeded from an arbitrary string. */
export function seededRng(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

/**
 * Fisher-Yates shuffle driven by a seeded RNG. The same seed + input always
 * yields the same ordering, which is what makes quiz choice ordering stable
 * across regenerations of the same lecture.
 */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/* ————————————————————————————— AI prompt context ————————————————————————————— */

/** Human-readable label per material type, used in job messages + prompts. */
export const MATERIAL_LABELS: Record<MaterialType, string> = {
  notes: 'Notes',
  'summary-concise': 'Concise Summary',
  'summary-detailed': 'Detailed Summary',
  'study-guide': 'Study Guide',
  flashcards: 'Flashcards',
  'quiz-mcq': 'Multiple-Choice Quiz',
  'quiz-short-answer': 'Short-Answer Quiz',
  'practice-test': 'Practice Test',
  'review-sheet': 'Review Sheet',
  'cheat-sheet': 'Cheat Sheet',
  vocabulary: 'Vocabulary',
  glossary: 'Glossary',
};

/** Difficulty guidance woven into every AI prompt (mentions the level by name). */
export function difficultyInstructions(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'easy':
      return (
        'Difficulty: EASY. Assume the student is meeting this material for the first ' +
        'time. Emphasize fundamentals and plain-language explanations. For any questions, ' +
        'use gentle, clearly-distinguishable distractors and straightforward recall prompts.'
      );
    case 'hard':
      return (
        'Difficulty: HARD. Push toward application, synthesis and edge cases. Questions ' +
        'should require reasoning across multiple concepts; distractors must be subtle and ' +
        'share surface features with the correct answer.'
      );
    default:
      return (
        'Difficulty: MEDIUM. Assume the fundamentals are known. Mix recall with light ' +
        'application. Distractors should be plausible but resolvable with real understanding.'
      );
  }
}

/** Compactly serialize the analysis for a prompt, each list bounded. */
export function serializeAnalysis(analysis: LectureAnalysis, maxChars = 8000): string {
  const lines: string[] = [];
  lines.push(`Gist: ${analysis.gist}`);

  if (analysis.concepts.length) {
    lines.push('', 'Concepts:');
    for (const c of analysis.concepts.slice(0, 24)) {
      lines.push(`- ${c.name} (importance ${c.importance.toFixed(2)}): ${firstSentence(c.summary)}`);
    }
  }
  if (analysis.definitions.length) {
    lines.push('', 'Definitions:');
    for (const d of analysis.definitions.slice(0, 24)) {
      lines.push(`- ${d.term}: ${d.definition}`);
    }
  }
  if (analysis.formulas.length) {
    lines.push('', 'Formulas:');
    for (const f of analysis.formulas.slice(0, 16)) {
      lines.push(`- ${f.name}: ${f.expression}${f.explanation ? ` — ${f.explanation}` : ''}`);
    }
  }
  if (analysis.examples.length) {
    lines.push('', 'Examples:');
    for (const e of analysis.examples.slice(0, 16)) {
      lines.push(`- [${e.kind}] ${e.description}`);
    }
  }
  if (analysis.keyDates.length) {
    lines.push('', 'Key dates:');
    for (const k of analysis.keyDates.slice(0, 12)) lines.push(`- ${k.label}: ${k.event}`);
  }
  if (analysis.emphasisCues.length) {
    lines.push('', 'Emphasis cues (likely exam material):');
    for (const cue of analysis.emphasisCues.slice(0, 12)) lines.push(`- "${cue.quote}"`);
  }
  if (analysis.vocabulary.length) {
    lines.push('', 'Vocabulary:');
    for (const v of analysis.vocabulary.slice(0, 20)) lines.push(`- ${v.term}: ${v.meaning}`);
  }
  return capText(lines.join('\n'), maxChars);
}

/** Salient transcript lines (headings, teacher questions, opening speech). */
export function transcriptExcerpts(transcript: Transcript, maxChars = 3000): string {
  const picked: string[] = [];
  for (const seg of transcript.segments) {
    if (seg.kind === 'heading') picked.push(`## ${seg.text}`);
    else if (seg.kind === 'question' || seg.isTeacherQuestion) picked.push(`Q: ${seg.text}`);
  }
  if (picked.length < 6) {
    for (const seg of transcript.segments) {
      if (seg.kind === 'speech') {
        picked.push(seg.text);
        if (picked.length >= 14) break;
      }
    }
  }
  let out = '';
  for (const line of picked) {
    if (out.length + line.length + 1 > maxChars) break;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

/**
 * The shared "here is the lecture" context block every AI generator prepends to
 * its task-specific instructions. Course/lecture names, difficulty guidance, the
 * serialized analysis and salient transcript excerpts, capped at ~12k chars.
 */
export function buildContextBlock(ctx: GenerationContext, includeExcerpts = true): string {
  const parts: string[] = [
    `Course: ${ctx.courseName}`,
    `Lecture: ${ctx.lecture.title}`,
    '',
    difficultyInstructions(ctx.difficulty),
    '',
    'LECTURE ANALYSIS:',
    serializeAnalysis(ctx.analysis),
  ];
  if (includeExcerpts) {
    const excerpts = transcriptExcerpts(ctx.transcript);
    if (excerpts) {
      parts.push('', 'SALIENT TRANSCRIPT EXCERPTS:', excerpts);
    }
  }
  return capText(parts.join('\n'), 12000);
}
