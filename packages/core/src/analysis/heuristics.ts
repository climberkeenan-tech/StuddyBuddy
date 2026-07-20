import type { Transcript, TranscriptSegment } from '@studdybuddy/shared';
import type {
  RawAnalysis,
  RawConcept,
  RawDefinition,
  RawExample,
  RawKeyDate,
} from './schemas';

/**
 * Deterministic, LLM-free lecture analysis.
 *
 * When no AI provider is configured the app must still deliver a genuinely
 * useful analysis, so this module derives concepts, definitions, formulas,
 * examples, emphasis cues, key dates and vocabulary directly from the
 * transcript using classic NLP heuristics (frequency, co-occurrence, cue
 * phrases, regexes). The output is the same `RawAnalysis` shape the LLM path
 * produces, so both paths share the analyzer's mapping/id-resolution stage.
 */

/** Common English + lecture-filler words excluded from concept extraction. */
const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'about', 'as', 'into', 'like', 'through', 'after', 'over',
  'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among', 'this',
  'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'should', 'can', 'could', 'may', 'might', 'must',
  'shall', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
  'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'whose', 'where', 'why',
  'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'here', 'there',
  'now', 'okay', 'ok', 'right', 'well', 'gonna', 'wanna', 'lets', 'us', 'thing', 'things',
  'lot', 'kind', 'sort', 'really', 'actually', 'basically', 'going', 'get', 'got', 'lets',
  'today', 'class', 'lecture', 'week', 'last', 'next', 'one', 'two', 'first', 'second', 'also',
  'because', 'up', 'down', 'off', 'from', 'again', 'once', 'yeah', 'know', 'think', 'see', 'look',
  'want', 'need', 'make', 'made', 'come', 'goes', 'lets', 'talk', 'talked', 'said', 'say',
]);

const WORD_RE = /[a-z][a-z'-]*/g;

/** Cue phrases signalling the professor is flagging exam-relevant material. */
const EMPHASIS_PHRASES = [
  'on the exam',
  'on the test',
  'this will be on',
  "you'll see this",
  'important',
  'remember',
  'key point',
  'crucial',
  'critical',
  'if you remember one thing',
  'make sure',
  'pay attention',
  'note that',
  'the takeaway',
  'do not forget',
  "don't forget",
];

/** Markers that introduce an example/analogy/story/comparison, with their kind. */
const EXAMPLE_MARKERS: { phrase: string; kind: RawExample['kind'] }[] = [
  { phrase: 'for example', kind: 'example' },
  { phrase: 'for instance', kind: 'example' },
  { phrase: 'such as', kind: 'example' },
  { phrase: 'e.g', kind: 'example' },
  { phrase: 'to illustrate', kind: 'example' },
  { phrase: 'imagine', kind: 'analogy' },
  { phrase: 'think of it as', kind: 'analogy' },
  { phrase: "it's like", kind: 'analogy' },
  { phrase: 'its like', kind: 'analogy' },
  { phrase: 'like a', kind: 'analogy' },
  { phrase: 'picture this', kind: 'analogy' },
  { phrase: 'analogy', kind: 'analogy' },
  { phrase: 'story', kind: 'story' },
  { phrase: 'anecdote', kind: 'story' },
  { phrase: 'in contrast', kind: 'comparison' },
  { phrase: 'compared to', kind: 'comparison' },
  { phrase: 'unlike', kind: 'comparison' },
  { phrase: 'whereas', kind: 'comparison' },
  { phrase: 'versus', kind: 'comparison' },
];

/** A transcript sentence carrying its source timing. */
interface Sentence {
  text: string;
  lower: string;
  atMs: number;
  segIndex: number;
}

/** Normalize a concept/term string for matching and dedup. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a block of text into trimmed sentences. */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]*/g);
  if (!matches) return text.trim() ? [text.trim()] : [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Flatten a transcript into timed sentences, skipping heading/pause segments. */
function toSentences(segments: TranscriptSegment[]): Sentence[] {
  const out: Sentence[] = [];
  for (const seg of segments) {
    if (seg.kind === 'pause') continue;
    for (const raw of splitSentences(seg.text)) {
      out.push({ text: raw, lower: raw.toLowerCase(), atMs: seg.startMs, segIndex: seg.index });
    }
  }
  return out;
}

/** Content tokens (stopword-filtered, length >= 3) of a lowercase string. */
function contentTokens(lower: string): string[] {
  const tokens = lower.match(WORD_RE) ?? [];
  return tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Whether `term` appears as a whole phrase inside `lower` text. */
function containsTerm(lower: string, term: string): boolean {
  if (!term) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:$|[^a-z0-9])`, 'i');
  return re.test(lower);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Candidate {
  name: string;
  count: number;
  tokens: string[];
}

/**
 * Rank candidate concepts from unigram + adjacent-bigram frequency. Multi-word
 * terms are preferred; a standalone unigram is dropped when it is essentially
 * always part of a stronger bigram, which keeps the concept list clean.
 */
function rankConcepts(sentences: Sentence[], limit: number): Candidate[] {
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  for (const s of sentences) {
    const rawTokens = s.lower.match(WORD_RE) ?? [];
    let prev: string | null = null;
    for (const tok of rawTokens) {
      const isContent = tok.length >= 3 && !STOPWORDS.has(tok);
      if (isContent) {
        uni.set(tok, (uni.get(tok) ?? 0) + 1);
        if (prev) {
          const bigram = `${prev} ${tok}`;
          bi.set(bigram, (bi.get(bigram) ?? 0) + 1);
        }
        prev = tok;
      } else {
        prev = null;
      }
    }
  }

  const bigrams = [...bi.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, tokens: name.split(' ') }));

  const bigramTokenCounts = new Map<string, number>();
  for (const b of bigrams) for (const t of b.tokens) bigramTokenCounts.set(t, b.count);

  const unigrams = [...uni.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([name, count]) => {
      const inBigram = bigramTokenCounts.get(name);
      // Drop a unigram that is dominated by a bigram it belongs to.
      return !(inBigram !== undefined && count < inBigram * 2);
    })
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, tokens: [name] }));

  const merged = [...bigrams, ...unigrams].sort((a, b) => b.count - a.count);
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const c of merged) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    result.push(c);
    if (result.length >= limit) break;
  }
  return result;
}

/** Difficulty rises with the longest token in a term (technical/long words). */
function difficultyFor(tokens: string[]): number {
  const maxLen = tokens.reduce((m, t) => Math.max(m, t.length), 0);
  return Math.min(1, Math.max(0, 0.2 + Math.min(0.8, (maxLen - 4) * 0.1)));
}

/** Group segment indexes into co-occurrence units (paragraphs, else windows). */
function coOccurrenceUnits(transcript: Transcript): Set<number>[] {
  const segByIndex = new Map<number, TranscriptSegment>();
  for (const seg of transcript.segments) segByIndex.set(seg.index, seg);

  if (transcript.paragraphs.length > 0) {
    const idToIndex = new Map<string, number>();
    for (const seg of transcript.segments) idToIndex.set(seg.id, seg.index);
    return transcript.paragraphs.map((p) => {
      const set = new Set<number>();
      for (const segId of p.segmentIds) {
        const idx = idToIndex.get(segId);
        if (idx !== undefined) set.add(idx);
      }
      return set;
    });
  }

  // No paragraph structure: slide a window of 3 consecutive segments.
  const indexes = transcript.segments.map((s) => s.index).sort((a, b) => a - b);
  const units: Set<number>[] = [];
  for (let i = 0; i < indexes.length; i += 3) {
    units.push(new Set(indexes.slice(i, i + 3)));
  }
  return units;
}

/** Extract definitions from cue-phrase patterns ("X is a…", "X refers to…"). */
function extractDefinitions(sentences: Sentence[]): RawDefinition[] {
  const defs: RawDefinition[] = [];
  const seen = new Set<string>();
  const push = (term: string, definition: string, atMs: number) => {
    const norm = normalizeName(term);
    if (!norm || norm.length < 3 || seen.has(norm)) return;
    seen.add(norm);
    defs.push({ term: term.trim(), definition: definition.trim(), atMs, conceptName: norm });
  };

  for (const s of sentences) {
    // "X is a/an/the …"
    let m = s.text.match(/^(.{2,60}?)\s+is\s+(?:a|an|the)\s+(.{5,200}?)[.!?]?$/i);
    if (m && m[1]) {
      push(tailNounPhrase(m[1]), s.text, s.atMs);
      continue;
    }
    // "X refers to …" / "X is defined as …"
    m = s.text.match(/^(.{2,60}?)\s+(?:refers to|is defined as|means)\s+(.{4,200})/i);
    if (m && m[1]) {
      push(tailNounPhrase(m[1]), s.text, s.atMs);
      continue;
    }
    // "X, which is/are …"
    m = s.text.match(/^(.{2,60}?),\s+which\s+(?:is|are)\s+(.{4,200})/i);
    if (m && m[1]) {
      push(tailNounPhrase(m[1]), s.text, s.atMs);
      continue;
    }
    // "known as X" / "called X" / "we call this/it X"
    m = s.text.match(/(?:known as|called|we call (?:this|it))\s+([A-Za-z][A-Za-z0-9 -]{2,40})/i);
    if (m && m[1]) {
      push(m[1], s.text, s.atMs);
    }
  }
  return defs.slice(0, 16);
}

/** The trailing 1–4 content words of a phrase — the likely defined term. */
function tailNounPhrase(before: string): string {
  const words = before.trim().split(/\s+/);
  const tail: string[] = [];
  for (let i = words.length - 1; i >= 0 && tail.length < 4; i--) {
    const w = words[i];
    if (!w) continue;
    const bare = w.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (tail.length > 0 && (STOPWORDS.has(bare) || bare === '')) break;
    tail.unshift(w);
  }
  return tail.join(' ').trim() || before.trim();
}

/** Extract equation-like formulas containing real math operators. */
function extractFormulas(sentences: Sentence[]): RawAnalysis['formulas'] {
  const out: RawAnalysis['formulas'] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z0-9)\]]\s*=\s*[-+(]?\s*[A-Za-z0-9][A-Za-z0-9 ()[\]^*/+.-]*)/;
  for (const s of sentences) {
    const m = s.text.match(re);
    if (!m || !m[1]) continue;
    const expr = m[1].trim().replace(/[.,;]$/, '');
    if (!/[=+\-*/^]/.test(expr)) continue;
    if (seen.has(expr)) continue;
    seen.add(expr);
    const namePart = expr.split('=')[0]?.trim() ?? 'Formula';
    out.push({
      name: namePart.length <= 24 ? namePart : 'Formula',
      expression: expr,
      explanation: s.text.trim(),
      atMs: s.atMs,
    });
    if (out.length >= 10) break;
  }
  return out;
}

/** Extract examples/analogies/stories/comparisons from marker phrases. */
function extractExamples(sentences: Sentence[]): RawExample[] {
  const out: RawExample[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    for (const { phrase, kind } of EXAMPLE_MARKERS) {
      if (s.lower.includes(phrase)) {
        const key = s.text.trim();
        if (seen.has(key)) break;
        seen.add(key);
        out.push({ description: s.text.trim(), kind, atMs: s.atMs });
        break;
      }
    }
    if (out.length >= 14) break;
  }
  return out;
}

/** Extract emphasis cues from professor cue phrases. */
function extractEmphasis(sentences: Sentence[]): RawAnalysis['emphasisCues'] {
  const out: RawAnalysis['emphasisCues'] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    if (EMPHASIS_PHRASES.some((p) => s.lower.includes(p))) {
      const key = s.text.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ quote: s.text.trim(), atMs: s.atMs });
      if (out.length >= 16) break;
    }
  }
  return out;
}

/** Extract key dates from 4-digit years (1000–2099) with their sentence. */
function extractKeyDates(sentences: Sentence[]): RawKeyDate[] {
  const out: RawKeyDate[] = [];
  const seen = new Set<string>();
  const re = /\b(1[0-9]{3}|20[0-9]{2})\b/;
  for (const s of sentences) {
    const m = s.text.match(re);
    if (!m || !m[1]) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ label: m[1], event: s.text.trim(), atMs: s.atMs });
    if (out.length >= 12) break;
  }
  return out;
}

/** Vocabulary = rare technical / mid-sentence-capitalized terms + their sentence. */
function extractVocabulary(
  sentences: Sentence[],
  uni: Map<string, number>,
): RawAnalysis['vocabulary'] {
  const out: RawAnalysis['vocabulary'] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    const tokens = s.text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) continue;
      const bare = tok.replace(/[^A-Za-z0-9-]/g, '');
      const lower = bare.toLowerCase();
      if (bare.length < 7 || STOPWORDS.has(lower)) continue;
      const capitalizedMidSentence = i > 0 && /^[A-Z]/.test(bare);
      const rare = (uni.get(lower) ?? 0) <= 2;
      if (!capitalizedMidSentence && !rare) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push({ term: bare, meaning: s.text.trim() });
      if (out.length >= 15) return out;
    }
  }
  return out;
}

/**
 * Teacher questions in the transcript: segments explicitly tagged, plus any
 * sentence ending in a question mark. Exposed as a helper the analysis UI and
 * tests can use to count/surface questions (the shared analysis type does not
 * carry them directly).
 */
export function extractTeacherQuestions(
  transcript: Transcript,
): { text: string; atMs: number }[] {
  const out: { text: string; atMs: number }[] = [];
  const seen = new Set<string>();
  for (const seg of transcript.segments) {
    const flagged = seg.kind === 'question' || seg.isTeacherQuestion === true;
    for (const sentence of splitSentences(seg.text)) {
      if ((flagged || sentence.endsWith('?')) && !seen.has(sentence)) {
        seen.add(sentence);
        out.push({ text: sentence, atMs: seg.startMs });
      }
    }
  }
  return out;
}

/**
 * Produce a full {@link RawAnalysis} from a transcript with no LLM involved.
 * This is the offline-first backbone: the analyzer maps the result onto the
 * shared `LectureAnalysis` exactly as it does for real model output.
 */
export function analyzeHeuristically(transcript: Transcript): RawAnalysis {
  const sentences = toSentences(transcript.segments);
  const uni = new Map<string, number>();
  for (const s of sentences) for (const t of contentTokens(s.lower)) uni.set(t, (uni.get(t) ?? 0) + 1);

  const emphasisCues = extractEmphasis(sentences);
  const emphasisText = emphasisCues.map((e) => e.quote.toLowerCase());
  const definitions = extractDefinitions(sentences);
  const defByConcept = new Map<string, RawDefinition>();
  for (const d of definitions) if (d.conceptName) defByConcept.set(d.conceptName, d);

  const candidates = rankConcepts(sentences, 14);
  const maxCount = candidates.reduce((m, c) => Math.max(m, c.count), 1);
  const units = coOccurrenceUnits(transcript);

  const concepts: RawConcept[] = candidates.map((cand) => {
    const importance = cand.count / maxCount;
    const inEmphasis = emphasisText.some((q) => containsTerm(q, cand.name));
    const baseExam = 0.25 + 0.5 * importance;
    const examLikelihood = inEmphasis ? Math.max(0.7, baseExam) : baseExam;

    // First mention: earliest sentence containing the whole term.
    let firstMentionMs = 0;
    let firstSentence: Sentence | undefined;
    for (const s of sentences) {
      if (containsTerm(s.lower, cand.name)) {
        firstMentionMs = s.atMs;
        firstSentence = s;
        break;
      }
    }

    // Which co-occurrence units contain this concept.
    const myUnits = units.filter((u) =>
      sentences.some((s) => u.has(s.segIndex) && containsTerm(s.lower, cand.name)),
    );

    const def = defByConcept.get(cand.name);
    const summary = def
      ? def.definition
      : firstSentence
        ? firstSentence.text
        : `${cand.name} is a key term discussed in this lecture.`;

    return {
      name: cand.name,
      summary,
      importance,
      examLikelihood: Math.min(1, examLikelihood),
      difficulty: difficultyFor(cand.tokens),
      mentions: cand.count,
      firstMentionMs,
      related: relatedFor(cand, candidates, sentences, myUnits),
    };
  });

  const examples = extractExamples(sentences);
  const formulas = extractFormulas(sentences);
  const keyDates = extractKeyDates(sentences);
  const vocabulary = extractVocabulary(sentences, uni);

  const sections = transcript.sections.map((sec) => ({
    title: sec.title,
    gist: firstSentenceInRange(sentences, sec.startMs, sec.endMs),
  }));

  const gist = buildGist(transcript, concepts);

  return {
    gist,
    concepts,
    definitions,
    formulas,
    examples,
    keyDates,
    emphasisCues,
    vocabulary,
    sections,
  };
}

/** Related concepts by co-occurrence in the same paragraph/window. */
function relatedFor(
  cand: Candidate,
  all: Candidate[],
  sentences: Sentence[],
  myUnits: Set<number>[],
): RawConcept['related'] {
  const scores = new Map<string, number>();
  for (const other of all) {
    if (other.name === cand.name) continue;
    let co = 0;
    for (const unit of myUnits) {
      const present = sentences.some(
        (s) => unit.has(s.segIndex) && containsTerm(s.lower, other.name),
      );
      if (present) co++;
    }
    if (co > 0) scores.set(other.name, co);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => ({ name, relation: 'related' }));
}

function firstSentenceInRange(sentences: Sentence[], startMs: number, endMs: number): string {
  const hit = sentences.find((s) => s.atMs >= startMs && s.atMs <= endMs);
  return hit?.text ?? '';
}

/** Two-sentence gist from section titles and the top concepts. */
function buildGist(transcript: Transcript, concepts: RawConcept[]): string {
  const titles = transcript.sections.map((s) => s.title).filter((t) => t.trim().length > 0);
  const top = concepts.slice(0, 4).map((c) => c.name);
  const first =
    titles.length > 0
      ? `This lecture covers ${joinList(titles.slice(0, 4))}.`
      : top.length > 0
        ? `This lecture focuses on ${joinList(top)}.`
        : 'This lecture has been transcribed and analyzed.';
  const second =
    top.length > 0
      ? `Key concepts include ${joinList(top)}.`
      : 'Review the transcript for the full detail.';
  return `${first} ${second}`.trim();
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
