import { describe, expect, it, vi } from 'vitest';
import type {
  Lecture,
  LectureAnalysis,
  Transcript,
  TranscriptSection,
  TranscriptSegment,
} from '@studdybuddy/shared';
import { LogManager, type Logger } from '../src/infra/logger';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEventBus } from '../src/infra/core-events';
import { SbError } from '../src/infra/errors';
import type { AIFacade } from '../src/ai/types';
import type { Repositories } from '../src/storage/types';
import {
  analyzeHeuristically,
  extractTeacherQuestions,
  normalizeName,
} from '../src/analysis/heuristics';
import { RawAnalysisSchema, type RawAnalysis } from '../src/analysis/schemas';
import { assembleAnalysis, createLectureAnalyzer } from '../src/analysis/analyzer';
import { AnalysisService } from '../src/analysis/analysis-service';
import { ExplainService } from '../src/analysis/explain-service';

const logger: Logger = new LogManager().getLogger('test');

/* ————————————————————————— fixtures ————————————————————————— */

interface Line {
  text: string;
  kind?: TranscriptSegment['kind'];
  question?: boolean;
}

/** ~40 sentences of teacher speech about DNA replication, richly cued. */
const DNA_LINES: Line[] = [
  { text: 'Introduction to DNA Replication', kind: 'heading' },
  { text: 'Today we are going to talk about DNA replication and why it matters.' },
  {
    text: 'DNA replication is the process by which a cell copies its entire genome before division.',
  },
  { text: 'This will be on the exam, so pay attention to the details.' },
  {
    text: 'Remember that DNA replication is semiconservative, meaning each new molecule keeps one old strand.',
  },
  { text: 'Key Enzymes', kind: 'heading' },
  { text: 'The first enzyme we meet is helicase.' },
  { text: 'Helicase is an enzyme that unwinds the double helix at the replication fork.' },
  { text: 'The key point is that helicase unwinds the strands before anything else can happen.' },
  { text: 'What do you think happens if helicase fails to unwind the DNA?', kind: 'question', question: true },
  {
    text: 'DNA polymerase is the enzyme that synthesizes new DNA strands in the five to three direction.',
  },
  { text: 'For example, DNA polymerase adds nucleotides one at a time to the growing chain.' },
  { text: 'A primer is a short strand of RNA that provides a starting point for polymerase.' },
  { text: 'Imagine the primer as a springboard that lets the polymerase begin its work.' },
  { text: 'Primase is the enzyme that lays down the primer.' },
  { text: 'Ligase seals the gaps between fragments, and it is crucial for the lagging strand.' },
  { text: 'Leading and Lagging Strands', kind: 'heading' },
  { text: 'The leading strand is synthesized continuously toward the replication fork.' },
  { text: 'The lagging strand is made in short pieces called Okazaki fragments.' },
  { text: 'In contrast to the leading strand, the lagging strand requires many primers.' },
  { text: 'Can anyone tell me why the lagging strand needs more primers?', kind: 'question', question: true },
  { text: 'The replication fork is the Y-shaped region where the DNA is being unwound.' },
  { text: 'It is like a zipper being pulled open down the middle of the molecule.' },
  { text: 'This process was first understood clearly in the year 1958 with a famous experiment.' },
  { text: 'Meselson and Stahl proved that replication is semiconservative in 1958.' },
  { text: 'The most important takeaway is that replication is fast, accurate, and tightly regulated.' },
  { text: 'DNA replication happens during the S phase of the cell cycle.' },
  { text: 'Before replication, helicase must find the origin of replication.' },
  { text: 'The enzyme helicase works together with single strand binding proteins.' },
  { text: 'Polymerase proofreads its own work to reduce errors.' },
  { text: 'Errors in DNA replication can lead to mutations.' },
  { text: 'Mutations, which are changes in the DNA sequence, can cause disease.' },
  { text: 'Think of it as a typo that gets copied into every future edition of a book.' },
  { text: 'The origin of replication is the specific site where copying begins.' },
  { text: 'Note that the two new molecules are identical to the original template.' },
  { text: 'Each daughter cell receives one complete copy of the genome.' },
  { text: 'The whole process is remarkably fast in bacteria.' },
  { text: 'In humans, replication uses thousands of origins at once.' },
  { text: 'That is the big picture of DNA replication for today.' },
];

function buildTranscript(lectureId: string, lines: Line[]): Transcript {
  const segments: TranscriptSegment[] = lines.map((line, index) => ({
    id: `${lectureId}-s${index}`,
    index,
    startMs: index * 4000,
    endMs: index * 4000 + 3500,
    text: line.text,
    kind: line.kind ?? 'speech',
    ...(line.question ? { isTeacherQuestion: true } : {}),
  }));
  const last = segments[segments.length - 1];
  const endMs = last ? last.endMs : 0;
  const sections: TranscriptSection[] = [
    { id: `${lectureId}-sec0`, title: 'Introduction to DNA Replication', startMs: 0, endMs: 20000, paragraphIds: [] },
    { id: `${lectureId}-sec1`, title: 'Key Enzymes', startMs: 20000, endMs: 64000, paragraphIds: [] },
    { id: `${lectureId}-sec2`, title: 'Leading and Lagging Strands', startMs: 64000, endMs, paragraphIds: [] },
  ];
  return {
    lectureId,
    segments,
    paragraphs: [],
    sections,
    language: 'en',
    engine: 'simulated',
    updatedAt: 1_700_000_000_000,
  };
}

function buildLecture(id: string, courseId: string, number: number): Lecture {
  return {
    id,
    courseId,
    title: `Lecture ${number}`,
    number,
    status: 'ready',
    recordedAt: 1_700_000_000_000,
    durationMs: DNA_LINES.length * 4000,
    topics: [],
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

const offlineAi: AIFacade = {
  available: async () => false,
  activeLabel: () => 'offline/mock',
  chat: async () => ({ text: '', model: 'mock' }),
  generate: (async () => {
    throw new Error('generate must not be called on the offline path');
  }) as AIFacade['generate'],
};

/* ————————————————————————— heuristics ————————————————————————— */

describe('analyzeHeuristically (offline path)', () => {
  const transcript = buildTranscript('lec-h', DNA_LINES);
  const raw = analyzeHeuristically(transcript);
  const names = raw.concepts.map((c) => c.name);

  it('surfaces the expected concepts', () => {
    expect(names).toContain('dna replication');
    expect(names).toContain('helicase');
    expect(raw.concepts.length).toBeGreaterThanOrEqual(6);
  });

  it('extracts at least two definitions with real terms', () => {
    expect(raw.definitions.length).toBeGreaterThanOrEqual(2);
    const defTerms = raw.definitions.map((d) => normalizeName(d.term));
    expect(defTerms).toContain('helicase');
  });

  it('detects emphasis cues', () => {
    expect(raw.emphasisCues.length).toBeGreaterThanOrEqual(2);
    const joined = raw.emphasisCues.map((c) => c.quote.toLowerCase()).join(' ');
    expect(joined).toContain('exam');
  });

  it('detects examples/analogies and a key date', () => {
    expect(raw.examples.length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(raw.examples.map((e) => e.kind));
    expect(kinds.has('analogy') || kinds.has('example')).toBe(true);
    expect(raw.keyDates.some((k) => k.label === '1958')).toBe(true);
  });

  it('counts teacher questions', () => {
    const questions = extractTeacherQuestions(transcript);
    expect(questions.length).toBeGreaterThanOrEqual(2);
  });

  it('gives helicase a firstMentionMs at its first appearance', () => {
    const helicase = raw.concepts.find((c) => c.name === 'helicase');
    expect(helicase).toBeDefined();
    // First "helicase" line is index 6 -> 24000ms.
    expect(helicase!.firstMentionMs).toBe(24000);
  });
});

describe('watchlists (via assembleAnalysis of heuristic output)', () => {
  const transcript = buildTranscript('lec-w', DNA_LINES);
  const analysis = assembleAnalysis(analyzeHeuristically(transcript), 'lec-w', 'heuristic', []);
  const byId = new Map(analysis.concepts.map((c) => [c.id, c]));

  it('exam watchlist is capped and ordered by examLikelihood desc', () => {
    expect(analysis.examWatchlist.length).toBeGreaterThan(0);
    expect(analysis.examWatchlist.length).toBeLessThanOrEqual(8);
    const scores = analysis.examWatchlist.map((id) => byId.get(id)!.examLikelihood);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    for (const id of analysis.examWatchlist) expect(byId.get(id)!.examLikelihood).toBeGreaterThanOrEqual(0.5);
  });

  it('struggle watchlist is capped and ordered by difficulty desc', () => {
    expect(analysis.struggleWatchlist.length).toBeGreaterThan(0);
    expect(analysis.struggleWatchlist.length).toBeLessThanOrEqual(8);
    const scores = analysis.struggleWatchlist.map((id) => byId.get(id)!.difficulty);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    for (const id of analysis.struggleWatchlist) expect(byId.get(id)!.difficulty).toBeGreaterThanOrEqual(0.6);
  });
});

/* ————————————————————————— analyzer AI path ————————————————————————— */

describe('LectureAnalyzer AI path with chunk merge', () => {
  function bigTranscript(): Transcript {
    const lines: Line[] = [];
    for (let i = 0; i < 260; i++) {
      lines.push({
        text: `Filler sentence number ${i} discussing mitochondria and cellular respiration in careful detail for padding.`,
      });
    }
    return buildTranscript('lec-ai', lines);
  }

  const rawA: RawAnalysis = RawAnalysisSchema.parse({
    gist: 'Chunk one gist.',
    concepts: [
      {
        name: 'helicase',
        summary: 'Helicase unwinds DNA.',
        importance: 0.9,
        examLikelihood: 0.8,
        difficulty: 0.7,
        mentions: 3,
        firstMentionMs: 1000,
        related: [{ name: 'dna replication', relation: 'unwinds' }],
      },
    ],
  });

  const rawB: RawAnalysis = RawAnalysisSchema.parse({
    gist: 'Chunk two gist, which is deliberately a bit longer than the first.',
    concepts: [
      {
        name: 'dna replication',
        summary: 'Copying the whole genome before a cell divides into two.',
        importance: 0.7,
        examLikelihood: 0.6,
        difficulty: 0.9,
        mentions: 4,
        firstMentionMs: 200,
        related: [],
      },
      {
        name: 'helicase',
        summary: 'Helicase again mentioned here.',
        importance: 0.5,
        examLikelihood: 0.5,
        difficulty: 0.6,
        mentions: 2,
        firstMentionMs: 500,
        related: [],
      },
    ],
  });

  it('runs one extraction per chunk, merges concepts and resolves related ids', async () => {
    let call = 0;
    const generate = vi.fn(async () => (call++ === 0 ? rawA : rawB));
    const ai: AIFacade = {
      available: async () => true,
      activeLabel: () => 'stub/model-x',
      chat: async () => ({ text: '', model: 'x' }),
      generate: generate as unknown as AIFacade['generate'],
    };
    const analyzer = createLectureAnalyzer({ ai, logger });
    const lecture = buildLecture('lec-ai', 'course-1', 1);
    const analysis = await analyzer.analyze({
      lecture,
      transcript: bigTranscript(),
      priorLectures: [],
    });

    // The transcript exceeded the chunk threshold, so >= 2 extraction calls ran.
    expect(generate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(analysis.generatedBy).toBe('stub/model-x');

    const helicase = analysis.concepts.find((c) => c.name === 'helicase');
    const replication = analysis.concepts.find((c) => c.name === 'dna replication');
    expect(helicase).toBeDefined();
    expect(replication).toBeDefined();

    // Merge: summed mentions, min firstMentionMs, max importance.
    expect(helicase!.mentions).toBeGreaterThanOrEqual(5);
    expect(helicase!.firstMentionMs).toBe(500);
    expect(helicase!.importance).toBeCloseTo(0.9);

    // Related name from chunk A resolved to the concept id from chunk B.
    expect(helicase!.related).toHaveLength(1);
    expect(helicase!.related[0]!.relation).toBe('unwinds');
    expect(helicase!.related[0]!.conceptId).toBe(replication!.id);
  });

  it('falls back to heuristics when the AI call throws', async () => {
    const ai: AIFacade = {
      available: async () => true,
      activeLabel: () => 'stub/model-x',
      chat: async () => ({ text: '', model: 'x' }),
      generate: (async () => {
        throw new Error('provider exploded');
      }) as AIFacade['generate'],
    };
    const analyzer = createLectureAnalyzer({ ai, logger });
    const analysis = await analyzer.analyze({
      lecture: buildLecture('lec-fb', 'course-1', 1),
      transcript: buildTranscript('lec-fb', DNA_LINES),
      priorLectures: [],
    });
    expect(analysis.generatedBy).toBe('heuristic');
    expect(analysis.concepts.map((c) => c.name)).toContain('helicase');
  });
});

/* ————————————————————————— cross-lecture links ————————————————————————— */

describe('cross-lecture link matching', () => {
  it('links a current concept to an overlapping earlier-lecture concept', async () => {
    const analyzer = createLectureAnalyzer({ ai: offlineAi, logger });
    const analysis = await analyzer.analyze({
      lecture: buildLecture('lec-2', 'course-1', 2),
      transcript: buildTranscript('lec-2', DNA_LINES),
      priorLectures: [
        { lectureId: 'lec-1', number: 1, title: 'Enzyme Basics', conceptNames: ['helicase', 'ribosome'] },
      ],
    });
    const link = analysis.crossLectureLinks.find((l) => l.earlierConceptName === 'helicase');
    expect(link).toBeDefined();
    expect(link!.earlierLectureId).toBe('lec-1');
    const helicase = analysis.concepts.find((c) => c.name === 'helicase');
    expect(link!.conceptId).toBe(helicase!.id);
    expect(link!.note).toContain('Lecture 1');
  });

  it('does not link unrelated concept names', () => {
    const analysis = assembleAnalysis(
      { gist: '', concepts: [{ name: 'osmosis', summary: '', importance: 1, examLikelihood: 0.5, difficulty: 0.5, mentions: 1, firstMentionMs: 0, related: [] }], definitions: [], formulas: [], examples: [], keyDates: [], emphasisCues: [], vocabulary: [], sections: [] },
      'lec-x',
      'heuristic',
      [{ lectureId: 'lec-0', number: 1, title: 'Prev', conceptNames: ['mitochondria'] }],
    );
    expect(analysis.crossLectureLinks).toHaveLength(0);
  });
});

/* ————————————————————————— AnalysisService ————————————————————————— */

/** Minimal in-memory repositories covering only what AnalysisService touches. */
function fakeRepos(seed: {
  lectures: Lecture[];
  transcripts: Record<string, Transcript>;
  analyses: Record<string, LectureAnalysis>;
}): { repos: Repositories; state: typeof seed } {
  const state = {
    lectures: [...seed.lectures],
    transcripts: { ...seed.transcripts },
    analyses: { ...seed.analyses },
  };
  const repos = {
    lectures: {
      get: async (id: string) => state.lectures.find((l) => l.id === id) ?? null,
      byCourse: async (courseId: string) =>
        state.lectures.filter((l) => l.courseId === courseId).sort((a, b) => a.number - b.number),
      put: async (lecture: Lecture) => {
        const idx = state.lectures.findIndex((l) => l.id === lecture.id);
        if (idx >= 0) state.lectures[idx] = lecture;
        else state.lectures.push(lecture);
      },
    },
    transcripts: {
      getByLecture: async (lectureId: string) => state.transcripts[lectureId] ?? null,
    },
    analyses: {
      getByLecture: async (lectureId: string) => state.analyses[lectureId] ?? null,
      put: async (doc: LectureAnalysis) => {
        state.analyses[doc.lectureId] = doc;
      },
    },
  } as unknown as Repositories;
  return { repos, state };
}

describe('AnalysisService', () => {
  it('runs analysis, persists it, refreshes topics, and emits progress', async () => {
    const l1 = buildLecture('l1', 'c1', 1);
    const l2 = buildLecture('l2', 'c1', 2);
    const priorAnalysis = assembleAnalysis(
      analyzeHeuristically(buildTranscript('l1', DNA_LINES)),
      'l1',
      'heuristic',
      [],
    );
    const { repos, state } = fakeRepos({
      lectures: [l1, l2],
      transcripts: { l2: buildTranscript('l2', DNA_LINES) },
      analyses: { l1: priorAnalysis },
    });

    const bus: CoreEventBus = new EventBus();
    const events: { state: string; kind: string }[] = [];
    bus.on('job:progress', (p) => events.push({ state: p.state, kind: p.kind }));

    const analyzer = createLectureAnalyzer({ ai: offlineAi, logger });
    const service = new AnalysisService({ repos, analyzer, bus, logger });
    const analysis = await service.run('l2');

    expect(analysis.lectureId).toBe('l2');
    expect(state.analyses['l2']).toBeDefined();
    expect(events.map((e) => e.state)).toEqual(['queued', 'running', 'succeeded']);
    expect(events.every((e) => e.kind === 'analysis')).toBe(true);

    const updated = state.lectures.find((l) => l.id === 'l2')!;
    expect(updated.topics.length).toBeGreaterThan(0);
    expect(updated.topics).toContain('Key Enzymes');

    // Prior lecture 1 concepts feed cross-lecture links on lecture 2.
    expect(analysis.crossLectureLinks.length).toBeGreaterThan(0);

    const fetched = await service.get('l2');
    expect(fetched?.lectureId).toBe('l2');
  });

  it('throws NOT_FOUND when the lecture is missing', async () => {
    const { repos } = fakeRepos({ lectures: [], transcripts: {}, analyses: {} });
    const bus: CoreEventBus = new EventBus();
    const analyzer = createLectureAnalyzer({ ai: offlineAi, logger });
    const service = new AnalysisService({ repos, analyzer, bus, logger });
    const err = await service.run('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SbError);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });

  it('throws NOT_FOUND when the transcript is missing', async () => {
    const l1 = buildLecture('l1', 'c1', 1);
    const { repos } = fakeRepos({ lectures: [l1], transcripts: {}, analyses: {} });
    const bus: CoreEventBus = new EventBus();
    const analyzer = createLectureAnalyzer({ ai: offlineAi, logger });
    const service = new AnalysisService({ repos, analyzer, bus, logger });
    const err = await service.run('l1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SbError);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });
});

/* ————————————————————————— ExplainService ————————————————————————— */

describe('ExplainService', () => {
  function explainRepos(): Repositories {
    const transcript = buildTranscript('lx', DNA_LINES);
    const analysis = assembleAnalysis(analyzeHeuristically(transcript), 'lx', 'heuristic', []);
    return {
      analyses: { getByLecture: async (id: string) => (id === 'lx' ? analysis : null) },
      transcripts: { getByLecture: async (id: string) => (id === 'lx' ? transcript : null) },
    } as unknown as Repositories;
  }

  it('rotates styles across attempts 1..6 and varies structure offline', async () => {
    const service = new ExplainService({ repos: explainRepos(), ai: offlineAi, logger });
    const styles: string[] = [];
    const markdowns: string[] = [];
    let visualMermaid: string | undefined;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const exp = await service.concept({ lectureId: 'lx', conceptName: 'helicase', attempt });
      styles.push(exp.style);
      markdowns.push(exp.markdown);
      expect(exp.attempt).toBe(attempt);
      expect(exp.generatedBy).toBe('heuristic');
      if (exp.style === 'visual') visualMermaid = exp.mermaid;
    }

    expect(styles).toEqual([
      'simple',
      'analogy',
      'step-by-step',
      'visual',
      'example',
      'simple',
    ]);

    // Offline visual explanation includes a mermaid mindmap.
    expect(visualMermaid).toBeDefined();
    expect(visualMermaid!).toContain('mindmap');
    expect(visualMermaid!.toLowerCase()).toContain('helicase');

    // Different styles produce visibly different markdown structure.
    expect(markdowns[0]).not.toBe(markdowns[1]);
    expect(markdowns[2]).toMatch(/^1\.|\n1\./m); // step-by-step is numbered
    expect(markdowns[3]).toContain('at a glance'); // visual caption
    expect(markdowns[4]).toContain('worked example');
  });

  it('honors an explicit style override', async () => {
    const service = new ExplainService({ repos: explainRepos(), ai: offlineAi, logger });
    const exp = await service.concept({ lectureId: 'lx', conceptName: 'helicase', attempt: 1, style: 'visual' });
    expect(exp.style).toBe('visual');
    expect(exp.mermaid).toBeDefined();
  });

  it('throws NOT_FOUND for an unknown concept', async () => {
    const service = new ExplainService({ repos: explainRepos(), ai: offlineAi, logger });
    const err = await service
      .concept({ lectureId: 'lx', conceptName: 'quantum chromodynamics' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SbError);
    expect((err as SbError).code).toBe('NOT_FOUND');
  });

  it('uses the AI path when available and enforces a mermaid diagram for visual', async () => {
    const ai: AIFacade = {
      available: async () => true,
      activeLabel: () => 'stub/model-y',
      chat: async () => ({ text: '', model: 'y' }),
      // Return valid markdown but omit mermaid; the service must add one for visual.
      generate: (async () => ({ markdown: 'A concise AI explanation of helicase.' })) as AIFacade['generate'],
    };
    const service = new ExplainService({ repos: explainRepos(), ai, logger });
    const exp = await service.concept({ lectureId: 'lx', conceptName: 'helicase', style: 'visual' });
    expect(exp.generatedBy).toBe('stub/model-y');
    expect(exp.markdown).toContain('AI explanation');
    expect(exp.mermaid).toBeDefined();
    expect(exp.mermaid!).toContain('mindmap');
  });
});
