import {
  newId,
  truncate,
  type Concept,
  type Course,
  type EmphasisCue,
  type Formula,
  type JobProgress,
  type KeyDate,
  type Lecture,
  type LectureAnalysis,
  type Slide,
  type SlideChartSpec,
  type SlideDeck,
  type SlideTimelineEvent,
  type Transcript,
  type VocabularyEntry,
} from '@studdybuddy/shared';
import type { CoreEventBus } from '../infra/core-events';
import { ErrorCodes, SbError } from '../infra/errors';
import type { Logger } from '../infra/logger';
import type { Repositories } from '../storage/types';
import type { z } from 'zod';
import type { AIFacade } from '../ai/types';
import { RawDeckSchema, type RawDeck, type RawSlide } from './schemas';
import { mindmap, type MindmapBranch } from './mermaid-gen';

/**
 * The raw-deck schema retyped to its output type. Zod's `.transform`/`.catch`
 * make the schema's input and output types differ, which the generic
 * {@link StructuredGenerator} (`schema: z.ZodType<T>`) cannot unify on its own;
 * this cast pins `T` to the validated output shape.
 */
const RawDeckSchemaType = RawDeckSchema as unknown as z.ZodType<RawDeck>;

/**
 * A slide without its stamped id; both the AI and heuristic paths build these,
 * and the service assigns ids when it materializes the persisted deck.
 */
type DraftSlide = Omit<Slide, 'id'>;

export interface SlidesServiceDeps {
  repos: Repositories;
  ai: AIFacade;
  bus: CoreEventBus;
  logger: Logger;
}

/** Default accent used when a lecture's course has no color and no token applies. */
const DEFAULT_ACCENT = '#8b7cff';

const SYSTEM_PROMPT = [
  'You are a master teacher turning a lecture into a beautiful, high-signal slide deck',
  'for a student to review from. Return JSON matching the SlideDeck schema exactly.',
  '',
  'Build a 10-16 slide teaching deck. Requirements:',
  '- Open with a "title" slide and end with a closing "summary"-style "bullets" slide',
  '  that names what to focus on for the exam.',
  '- Include a "section" slide introducing each major section of the lecture.',
  '- Include AT LEAST ONE "diagram" slide whose "mermaid" field is valid Mermaid',
  '  source — either a "flowchart TD" or a "mindmap". Keep node labels short and',
  '  free of parentheses, quotes and colons.',
  '- Include a "timeline" slide ONLY if the lecture has 3 or more key dates.',
  '- Include one "quote" slide built from the single strongest emphasis cue',
  '  (something the professor stressed as important or exam-worthy).',
  '- Use "bullets" (max 6 per slide, each under 110 characters) and "two-column"',
  '  slides for concept-heavy material; add a "chart" slide only when numeric data',
  '  is genuinely present.',
  '- Every slide needs "speakerNotes": 2-4 sentences in a warm, encouraging,',
  '  student-facing voice that expand on the slide.',
  '- Set "icon" to a lucide icon name (e.g. "dna", "git-branch", "sigma", "quote").',
  '- Set "accent" to one of: primary, amber, rose, emerald, sky.',
].join('\n');

/**
 * Generates and persists {@link SlideDeck}s for lectures.
 *
 * With a real AI provider it asks for a full teaching deck through the
 * structured-generation path ({@link RawDeckSchema}). With no provider — the
 * offline-first default — it derives a genuinely useful deck deterministically
 * from the lecture's analysis and transcript structure (a title, one section +
 * bullets pair per transcript section, a Mermaid mind map, formulas, an
 * optional timeline, a quote from the strongest emphasis cue, a vocabulary
 * two-column slide, and an exam-watchlist summary). If an AI attempt fails, it
 * falls back to the same heuristic deck so a deck is always produced.
 */
export class SlidesService {
  private readonly repos: Repositories;
  private readonly ai: AIFacade;
  private readonly bus: CoreEventBus;
  private readonly logger: Logger;

  constructor(deps: SlidesServiceDeps) {
    this.repos = deps.repos;
    this.ai = deps.ai;
    this.bus = deps.bus;
    this.logger = deps.logger.child('slides-service');
  }

  /**
   * Build, persist and return a slide deck for a lecture.
   * @throws SbError NOT_FOUND if the lecture or its transcript is missing.
   * @throws SbError VALIDATION if the lecture has not been analyzed yet.
   */
  async generate(lectureId: string): Promise<SlideDeck> {
    const jobId = newId();
    this.emit(jobId, 0, 'Preparing slides…', 'running');

    const lecture = await this.repos.lectures.get(lectureId);
    if (!lecture) throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${lectureId}" not found.`);

    const transcript = await this.repos.transcripts.getByLecture(lectureId);
    if (!transcript) {
      throw new SbError(
        ErrorCodes.NOT_FOUND,
        `Transcript for lecture "${lectureId}" not found; record or transcribe it first.`,
      );
    }

    const analysis = await this.repos.analyses.getByLecture(lectureId);
    if (!analysis) {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Lecture "${lectureId}" has not been analyzed yet; run analysis before generating slides.`,
      );
    }

    const course = await this.repos.courses.get(lecture.courseId);
    const courseName = course?.name ?? 'Course';
    const courseColor = normalizeHex(course?.color) ?? DEFAULT_ACCENT;

    const aiAvailable = await this.ai.available();
    let deckTitle = lecture.title;
    let drafts: DraftSlide[];
    let generatedBy: string;

    if (aiAvailable) {
      this.emit(jobId, 0.3, 'Designing your deck…', 'running');
      try {
        const raw = await this.aiDeck(lecture, transcript, analysis, courseName);
        deckTitle = raw.title;
        drafts = raw.slides.map((s) => rawSlideToDraft(s, courseColor));
        generatedBy = this.ai.activeLabel();
      } catch (e) {
        this.logger.warn('AI slide generation failed; falling back to heuristics', {
          lectureId,
          error: e instanceof Error ? e.message : String(e),
        });
        drafts = buildHeuristicDrafts(lecture, transcript, analysis, courseName, courseColor);
        generatedBy = 'heuristic';
      }
    } else {
      drafts = buildHeuristicDrafts(lecture, transcript, analysis, courseName, courseColor);
      generatedBy = 'heuristic';
    }

    this.emit(jobId, 0.85, 'Finalizing slides…', 'running');

    const deck: SlideDeck = {
      id: newId(),
      lectureId,
      courseId: lecture.courseId,
      title: deckTitle,
      slides: drafts.map((draft) => ({ id: newId(), ...draft })),
      theme: 'auto',
      generatedBy,
      createdAt: Date.now(),
    };

    await this.repos.slideDecks.put(deck);
    this.emit(jobId, 1, `Slides ready (${deck.slides.length} slides)`, 'succeeded');
    this.logger.info('slide deck generated', {
      lectureId,
      slides: deck.slides.length,
      generatedBy,
    });
    return deck;
  }

  /** The persisted deck for a lecture, or null if none has been generated. */
  get(lectureId: string): Promise<SlideDeck | null> {
    return this.repos.slideDecks.byLecture(lectureId);
  }

  /** Ask the active provider for a full deck through the structured path. */
  private aiDeck(
    lecture: Lecture,
    transcript: Transcript,
    analysis: LectureAnalysis,
    courseName: string,
  ): Promise<RawDeck> {
    return this.ai.generate({
      schema: RawDeckSchemaType,
      schemaName: 'SlideDeck',
      system: SYSTEM_PROMPT,
      user: buildDeckContext(lecture, transcript, analysis, courseName),
      temperature: 0.5,
      maxTokens: 8192,
    });
  }

  private emit(jobId: string, progress: number, message: string, state: JobProgress['state']): void {
    this.bus.emit('job:progress', { jobId, kind: 'slides', progress, message, state });
  }
}

export function createSlidesService(deps: SlidesServiceDeps): SlidesService {
  return new SlidesService(deps);
}

/* ————————————————————————————————————————————————————————————————
 * AI context
 * ———————————————————————————————————————————————————————————————— */

/** Compact, model-friendly digest of everything known about the lecture. */
function buildDeckContext(
  lecture: Lecture,
  transcript: Transcript,
  analysis: LectureAnalysis,
  courseName: string,
): string {
  const byId = conceptById(analysis);
  const lines: string[] = [
    `Course: ${courseName}`,
    `Lecture ${lecture.number}: ${lecture.title}`,
    `Gist: ${analysis.gist}`,
    '',
  ];

  if (transcript.sections.length > 0) {
    lines.push('Sections (in order):');
    for (const section of transcript.sections) lines.push(`- ${section.title}`);
    lines.push('');
  }

  lines.push('Key concepts (most important first):');
  for (const concept of topConcepts(analysis, 12)) {
    const related = concept.related
      .map((r) => byId.get(r.conceptId)?.name)
      .filter((n): n is string => Boolean(n));
    const relatedNote = related.length ? ` [related: ${related.slice(0, 4).join(', ')}]` : '';
    lines.push(`- ${concept.name}: ${firstSentence(concept.summary)}${relatedNote}`);
  }
  lines.push('');

  if (analysis.definitions.length > 0) {
    lines.push('Definitions:');
    for (const def of analysis.definitions.slice(0, 10)) {
      lines.push(`- ${def.term}: ${def.definition}`);
    }
    lines.push('');
  }

  if (analysis.formulas.length > 0) {
    lines.push('Formulas:');
    for (const f of analysis.formulas) lines.push(`- ${f.name}: ${f.expression} (${f.explanation})`);
    lines.push('');
  }

  if (analysis.keyDates.length > 0) {
    lines.push(`Key dates (${analysis.keyDates.length}):`);
    for (const k of analysis.keyDates) lines.push(`- ${k.label}: ${k.event}`);
    lines.push('');
  }

  if (analysis.emphasisCues.length > 0) {
    lines.push('Emphasis cues (things the professor stressed):');
    for (const cue of analysis.emphasisCues) {
      const name = cue.conceptId ? byId.get(cue.conceptId)?.name : undefined;
      lines.push(`- "${cue.quote}"${name ? ` (about ${name})` : ''}`);
    }
    lines.push('');
  }

  if (analysis.vocabulary.length > 0) {
    lines.push('Vocabulary:');
    for (const v of analysis.vocabulary.slice(0, 12)) lines.push(`- ${v.term}: ${v.meaning}`);
    lines.push('');
  }

  const watchlist = analysis.examWatchlist
    .map((id) => byId.get(id)?.name)
    .filter((n): n is string => Boolean(n));
  if (watchlist.length > 0) lines.push(`Exam watchlist: ${watchlist.join(', ')}`);

  lines.push('', 'Design the deck now.');
  return lines.join('\n');
}

/* ————————————————————————————————————————————————————————————————
 * Raw → draft conversion (AI path)
 * ———————————————————————————————————————————————————————————————— */

/** Convert a validated raw slide into a draft, defaulting accent to the course color. */
function rawSlideToDraft(raw: RawSlide, courseColor: string): DraftSlide {
  const draft: DraftSlide = {
    layout: raw.layout,
    title: raw.title,
    accent: raw.accent ?? courseColor,
    speakerNotes: raw.speakerNotes,
  };
  if (raw.subtitle) draft.subtitle = raw.subtitle;
  if (raw.bullets && raw.bullets.length > 0) draft.bullets = raw.bullets;
  if (raw.mermaid) draft.mermaid = raw.mermaid;
  if (raw.chart) draft.chart = raw.chart;
  if (raw.timeline && raw.timeline.length > 0) draft.timeline = raw.timeline;
  if (raw.quote) draft.quote = raw.quote;
  if (raw.columns && raw.columns.length > 0) draft.columns = raw.columns;
  if (raw.icon) draft.icon = raw.icon;
  return draft;
}

/* ————————————————————————————————————————————————————————————————
 * Heuristic deck (offline path)
 * ———————————————————————————————————————————————————————————————— */

/**
 * Build a complete deck straight from the analysis + transcript structure. The
 * ordering mirrors how a student would review the lecture: an opener, a walk
 * section by section, a connecting diagram, then reference slides (formulas,
 * timeline, a memorable quote, vocabulary) and a closing exam watchlist.
 */
export function buildHeuristicDrafts(
  lecture: Lecture,
  transcript: Transcript,
  analysis: LectureAnalysis,
  courseName: string,
  courseColor: string,
): DraftSlide[] {
  const byId = conceptById(analysis);
  const drafts: DraftSlide[] = [];

  // 1) Title
  drafts.push({
    layout: 'title',
    title: lecture.title,
    subtitle: analysis.gist,
    icon: 'presentation',
    accent: courseColor,
    speakerNotes: composeTitleNotes(lecture, analysis, courseName),
  });

  // 2) One section + bullets pair per transcript section.
  const grouped = groupConceptsBySection(transcript, topConcepts(analysis, 20));
  for (const group of grouped) {
    drafts.push({
      layout: 'section',
      title: group.title,
      subtitle: sectionSubtitle(group.concepts),
      icon: 'bookmark',
      accent: 'sky',
      speakerNotes: composeSectionNotes(group.title, group.concepts, analysis),
    });
    drafts.push({
      layout: 'bullets',
      title: `${group.title} — Key Points`,
      bullets: sectionBullets(group),
      icon: 'list',
      accent: 'primary',
      speakerNotes: composeConceptNotes(group.concepts, analysis, courseName),
    });
  }

  // 3) Connecting mind map.
  drafts.push(buildDiagramDraft(lecture, analysis, byId));

  // 4) Formulas (only when present).
  if (analysis.formulas.length > 0) {
    drafts.push({
      layout: 'bullets',
      title: 'Key Formulas',
      bullets: analysis.formulas
        .slice(0, 6)
        .map((f) => truncate(`${f.name}: ${f.expression}`, 110)),
      icon: 'sigma',
      accent: 'amber',
      speakerNotes: composeFormulaNotes(analysis.formulas),
    });
  }

  // 5) Timeline (only when there are at least two dated events).
  if (analysis.keyDates.length >= 2) {
    drafts.push(buildTimelineDraft(analysis.keyDates));
  }

  // 6) A memorable quote from the strongest emphasis cue.
  const quoteDraft = buildQuoteDraft(analysis, byId, courseName);
  if (quoteDraft) drafts.push(quoteDraft);

  // 7) Vocabulary as two columns.
  if (analysis.vocabulary.length > 0) {
    drafts.push(buildVocabularyDraft(analysis.vocabulary));
  }

  // 8) Closing exam watchlist.
  drafts.push(buildSummaryDraft(lecture, analysis, byId, courseColor));

  return drafts;
}

function buildDiagramDraft(
  lecture: Lecture,
  analysis: LectureAnalysis,
  byId: Map<string, Concept>,
): DraftSlide {
  const root = lecture.topics[0] ?? lecture.title;
  const branches: MindmapBranch[] = topConcepts(analysis, 5).map((concept) => {
    const children = concept.related
      .map((r) => byId.get(r.conceptId)?.name)
      .filter((n): n is string => Boolean(n));
    if (children.length === 0) {
      const def = analysis.definitions.find((d) => d.conceptId === concept.id);
      if (def) children.push(def.term);
    }
    return { label: concept.name, children };
  });
  const branchNames = branches.map((b) => b.label).join(', ');
  return {
    layout: 'diagram',
    title: 'How It Connects',
    subtitle: 'A mind map of the core ideas',
    mermaid: mindmap(root, branches),
    icon: 'git-branch',
    accent: 'emerald',
    speakerNotes: ensureSentence(
      `This mind map ties ${root} to its core ideas — ${branchNames}. ` +
        `Follow each branch to see how the pieces of this lecture fit together`,
    ),
  };
}

function buildTimelineDraft(keyDates: KeyDate[]): DraftSlide {
  const events: SlideTimelineEvent[] = keyDates
    .slice(0, 8)
    .map((k) => ({ label: k.label, description: truncate(k.event, 140) }));
  const first = keyDates[0];
  const last = keyDates[keyDates.length - 1];
  const span = first && last && first.label !== last.label ? ` from ${first.label} to ${last.label}` : '';
  return {
    layout: 'timeline',
    title: 'Timeline',
    timeline: events,
    icon: 'history',
    accent: 'sky',
    speakerNotes: ensureSentence(
      `These are the dated milestones this lecture referenced${span}. ` +
        'Knowing the order helps you place each development in context',
    ),
  };
}

function buildQuoteDraft(
  analysis: LectureAnalysis,
  byId: Map<string, Concept>,
  courseName: string,
): DraftSlide | null {
  const cue = strongestCue(analysis, byId);
  if (!cue) return null;
  const concept = cue.conceptId ? byId.get(cue.conceptId) : undefined;
  const attribution = concept ? concept.name : courseName;
  return {
    layout: 'quote',
    title: 'Worth Remembering',
    quote: { text: cue.quote, attribution },
    icon: 'quote',
    accent: 'rose',
    speakerNotes: ensureSentence(
      `Your professor emphasized this${concept ? ` while covering ${concept.name}` : ''}. ` +
        'When an instructor stresses a point this directly, it is almost always worth extra study time',
    ),
  };
}

function buildVocabularyDraft(vocabulary: VocabularyEntry[]): DraftSlide {
  const entries = vocabulary.slice(0, 12);
  const mid = Math.ceil(entries.length / 2);
  const toBullets = (list: VocabularyEntry[]): string[] =>
    list.map((v) => truncate(`${v.term} — ${v.meaning}`, 110));
  const left = entries.slice(0, mid);
  const right = entries.slice(mid);
  const columns = [{ heading: 'Terms', bullets: toBullets(left) }];
  if (right.length > 0) columns.push({ heading: 'More Terms', bullets: toBullets(right) });
  const preview = entries
    .slice(0, 3)
    .map((v) => v.term)
    .join(', ');
  return {
    layout: 'two-column',
    title: 'Vocabulary',
    columns,
    icon: 'book-a',
    accent: 'primary',
    speakerNotes: ensureSentence(
      `Keep these terms handy while you review — ${preview} and a few more. ` +
        'Being fluent in the vocabulary makes every other part of the lecture easier to follow',
    ),
  };
}

function buildSummaryDraft(
  lecture: Lecture,
  analysis: LectureAnalysis,
  byId: Map<string, Concept>,
  courseColor: string,
): DraftSlide {
  const watchIds = analysis.examWatchlist.length > 0
    ? analysis.examWatchlist
    : topConcepts(analysis, 5).map((c) => c.id);
  const watched = watchIds
    .map((id) => byId.get(id))
    .filter((c): c is Concept => Boolean(c))
    .slice(0, 6);
  const bullets =
    watched.length > 0
      ? watched.map((c) => truncate(`${c.name} — ${firstSentence(c.summary)}`, 110))
      : [truncate(`Review the core ideas of ${lecture.title}.`, 110)];
  const names = watched.map((c) => c.name).join(', ');
  return {
    layout: 'bullets',
    title: 'Summary & Exam Watchlist',
    subtitle: 'What to focus on when you review',
    bullets,
    icon: 'target',
    accent: courseColor,
    speakerNotes: ensureSentence(
      `To wrap up ${lecture.title}: the ideas most likely to show up on an exam are ${names || 'the core concepts above'}. ` +
        'Give these the most of your review time',
    ),
  };
}

/* ————————————————————————————————————————————————————————————————
 * Section grouping + speaker notes
 * ———————————————————————————————————————————————————————————————— */

interface SectionGroup {
  title: string;
  concepts: Concept[];
}

/** Bucket concepts into transcript sections by first-mention time. */
function groupConceptsBySection(transcript: Transcript, concepts: Concept[]): SectionGroup[] {
  if (transcript.sections.length === 0) {
    // No section structure: chunk the top concepts into pseudo-sections of 3.
    const groups: SectionGroup[] = [];
    for (let i = 0; i < concepts.length && groups.length < 5; i += 3) {
      const slice = concepts.slice(i, i + 3);
      if (slice.length > 0) groups.push({ title: `Part ${groups.length + 1}`, concepts: slice });
    }
    return groups;
  }
  const groups: SectionGroup[] = transcript.sections.map((s) => ({ title: s.title, concepts: [] }));
  const unplaced: Concept[] = [];
  for (const concept of concepts) {
    const idx = transcript.sections.findIndex(
      (s) => concept.firstMentionMs >= s.startMs && concept.firstMentionMs < s.endMs,
    );
    const group = idx >= 0 ? groups[idx] : undefined;
    if (group) group.concepts.push(concept);
    else unplaced.push(concept);
  }
  const first = groups[0];
  if (first) first.concepts.push(...unplaced);
  return groups.filter((g) => g.concepts.length > 0);
}

/** Bullets for a section slide; always non-empty. */
function sectionBullets(group: SectionGroup): string[] {
  const bullets = group.concepts.slice(0, 6).map(conceptBullet);
  if (bullets.length > 0) return bullets;
  return [truncate(`Key ideas from the ${group.title} portion of the lecture.`, 110)];
}

function sectionSubtitle(concepts: Concept[]): string {
  const names = concepts.slice(0, 3).map((c) => c.name);
  return names.length ? names.join(' · ') : 'Overview';
}

function conceptBullet(c: Concept): string {
  return truncate(`${c.name} — ${firstSentence(c.summary)}`, 110);
}

function composeTitleNotes(
  lecture: Lecture,
  analysis: LectureAnalysis,
  courseName: string,
): string {
  const topics = topConcepts(analysis, 3)
    .map((c) => c.name)
    .join(', ');
  return ensureSentence(
    `Welcome to ${lecture.title}, part of ${courseName}. ${ensureSentence(firstSentence(analysis.gist))} ` +
      `By the end you'll be comfortable with ${topics || 'the key ideas'}`,
  );
}

function composeSectionNotes(
  title: string,
  concepts: Concept[],
  analysis: LectureAnalysis,
): string {
  const lead = ensureSentence(`This part of the lecture focuses on ${title.toLowerCase()}`);
  const body = composeConceptNotes(concepts, analysis, undefined, 2);
  return `${lead} ${body}`.trim();
}

/** Two-to-three sentences of speaker notes drawn from concept summaries + definitions. */
function composeConceptNotes(
  concepts: Concept[],
  analysis: LectureAnalysis,
  courseName: string | undefined,
  max = 3,
): string {
  const parts: string[] = [];
  for (const concept of concepts.slice(0, max)) {
    parts.push(ensureSentence(firstSentence(concept.summary)));
    const def = analysis.definitions.find((d) => d.conceptId === concept.id);
    if (def && parts.length <= max) {
      parts.push(ensureSentence(`In short, ${def.term.toLowerCase()} is ${lowerFirst(def.definition)}`));
    }
  }
  if (parts.length === 0) {
    parts.push(ensureSentence(firstSentence(analysis.gist)));
  }
  if (courseName && parts.length < 2) {
    parts.push(ensureSentence(`Keep this in mind as you study for ${courseName}`));
  }
  return parts.join(' ').trim();
}

function composeFormulaNotes(formulas: Formula[]): string {
  const parts = formulas
    .slice(0, 3)
    .map((f) => ensureSentence(`${f.name}: ${f.explanation}`));
  parts.push('Make sure you can recognize each of these and explain what the symbols mean.');
  return parts.join(' ').trim();
}

/* ————————————————————————————————————————————————————————————————
 * Small pure helpers
 * ———————————————————————————————————————————————————————————————— */

function strongestCue(
  analysis: LectureAnalysis,
  byId: Map<string, Concept>,
): EmphasisCue | null {
  if (analysis.emphasisCues.length === 0) return null;
  let best: EmphasisCue | null = null;
  let bestScore = -Infinity;
  for (const cue of analysis.emphasisCues) {
    const importance = cue.conceptId ? (byId.get(cue.conceptId)?.importance ?? 0) : 0;
    // Weight concept importance most, then prefer a substantive quote.
    const score = importance * 10 + Math.min(cue.quote.length, 120) / 120;
    if (score > bestScore) {
      bestScore = score;
      best = cue;
    }
  }
  return best;
}

function topConcepts(analysis: LectureAnalysis, n: number): Concept[] {
  return [...analysis.concepts].sort((a, b) => b.importance - a.importance).slice(0, n);
}

function conceptById(analysis: LectureAnalysis): Map<string, Concept> {
  return new Map(analysis.concepts.map((c) => [c.id, c]));
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : trimmed).trim();
}

function ensureSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Normalize a hex color to `#rrggbb`, or undefined when it is not a hex value. */
function normalizeHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const group = color.trim().match(/^#?([0-9a-fA-F]{6})$/)?.[1];
  return group ? `#${group.toLowerCase()}` : undefined;
}
