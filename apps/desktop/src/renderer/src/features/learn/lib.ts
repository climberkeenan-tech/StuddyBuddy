import type { LectureAnalysis, QuizContent, McqQuestion } from '@studdybuddy/shared';

/**
 * Pure helpers that turn a {@link LectureAnalysis} (and optional quiz material)
 * into the data each mini-game consumes, plus small scoring utilities. Kept
 * framework-free so the games stay thin and everything is unit-testable.
 */

export type GameKind = 'match' | 'memory' | 'quiz' | 'map';

/** A term ↔ definition pairing used by Concept Match and the Memory Game. */
export interface Pair {
  id: string;
  term: string;
  definition: string;
  /** 0..1 importance, used to color/weight the pair. */
  importance: number;
}

/** One normalized multiple-choice question for Quiz Rush. */
export interface RushQuestion {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** Deterministic-ish shuffle (Fisher–Yates) — accepts an optional seed source. */
export function shuffle<T>(input: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

function truncate(text: string, max = 160): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build term/definition pairs, preferring the analyzer's explicit definitions
 * and falling back to concepts (name → summary). Capped for a playable board.
 */
export function buildPairs(analysis: LectureAnalysis, limit = 6): Pair[] {
  const byConcept = new Map(analysis.concepts.map((c) => [c.id, c]));
  const pairs: Pair[] = [];
  const seen = new Set<string>();

  for (const d of analysis.definitions) {
    const key = d.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const importance = d.conceptId ? (byConcept.get(d.conceptId)?.importance ?? 0.6) : 0.6;
    pairs.push({ id: d.id, term: d.term, definition: truncate(d.definition), importance });
  }

  for (const c of analysis.concepts) {
    if (pairs.length >= limit) break;
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ id: c.id, term: c.name, definition: truncate(c.summary), importance: c.importance });
  }

  return pairs.slice(0, limit);
}

/** Build memory-game pairs (shorter definitions read better on small cards). */
export function buildMemoryPairs(analysis: LectureAnalysis, limit = 6): Pair[] {
  return buildPairs(analysis, limit).map((p) => ({ ...p, definition: truncate(p.definition, 90) }));
}

/**
 * Normalize quiz questions for Quiz Rush. Prefers real MCQ quiz material; if
 * none exists, synthesizes questions by matching each concept to its own
 * summary against distractors drawn from sibling concepts.
 */
export function buildRushQuestions(
  analysis: LectureAnalysis,
  quiz: QuizContent | null,
  limit = 8,
): RushQuestion[] {
  const mcqs = (quiz?.questions ?? []).filter((q): q is McqQuestion => q.kind === 'mcq');
  if (mcqs.length > 0) {
    return mcqs.slice(0, limit).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    }));
  }

  const concepts = analysis.concepts;
  if (concepts.length < 2) return [];
  const questions: RushQuestion[] = [];
  for (const c of concepts.slice(0, limit)) {
    const distractors = shuffle(concepts.filter((o) => o.id !== c.id))
      .slice(0, 3)
      .map((o) => truncate(o.summary, 110));
    const correct = truncate(c.summary, 110);
    const choices = shuffle([correct, ...distractors]);
    questions.push({
      id: `syn-${c.id}`,
      prompt: `Which statement best describes “${c.name}”?`,
      choices,
      correctIndex: Math.max(0, choices.indexOf(correct)),
      explanation: `${c.name}: ${truncate(c.summary, 200)}`,
    });
  }
  return questions;
}

/** Map a 0..1 score to a friendly grade + accent token used for badges. */
export function grade(scorePct: number): { label: string; accent: 'success' | 'sky' | 'amber' | 'rose' } {
  if (scorePct >= 90) return { label: 'Outstanding', accent: 'success' };
  if (scorePct >= 70) return { label: 'Great job', accent: 'sky' };
  if (scorePct >= 50) return { label: 'Good effort', accent: 'amber' };
  return { label: 'Keep going', accent: 'rose' };
}

/** Importance → tier accent used to color Concept Map nodes and pair dots. */
export function importanceAccent(importance: number): 'primary' | 'sky' | 't3' {
  if (importance >= 0.85) return 'primary';
  if (importance >= 0.65) return 'sky';
  return 't3';
}
