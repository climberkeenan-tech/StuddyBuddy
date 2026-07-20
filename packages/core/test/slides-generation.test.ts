import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type {
  Course,
  Lecture,
  LectureAnalysis,
  SlideDeck,
  SlideExportFormat,
  Transcript,
} from '@studdybuddy/shared';
import { EventBus } from '../src/infra/event-bus';
import type { CoreEvents } from '../src/infra/core-events';
import { LogManager } from '../src/infra/logger';
import { PluginRegistry } from '../src/plugins/registry';
import type { AIFacade } from '../src/ai/types';
import type { Repositories } from '../src/storage/types';
import { SlidesService } from '../src/slides/slides-service';
import { flowchart, mindmap, sanitizeMermaidLabel } from '../src/slides/mermaid-gen';
import { PptxExporter } from '../src/export/pptx';
import { PdfExporter } from '../src/export/pdf';
import { MarkdownExporter } from '../src/export/markdown';
import { NotebookLMExporter } from '../src/export/notebooklm';
import { ExportService, registerBuiltinExporters } from '../src/export/export-service';

/* ————————————————————————————————— fixtures ————————————————————————————————— */

const LECTURE_ID = 'lec-1';
const COURSE_ID = 'course-1';

function analysisFixture(): LectureAnalysis {
  return {
    lectureId: LECTURE_ID,
    gist: 'Cells release energy from glucose in three linked stages. This lecture follows the carbons and electrons from glycolysis through the electron transport chain.',
    concepts: [
      { id: 'c1', name: 'Glycolysis', summary: 'Glycolysis splits glucose into two pyruvate molecules in the cytoplasm. It yields a small amount of ATP.', importance: 0.95, examLikelihood: 0.9, difficulty: 0.4, mentions: 5, firstMentionMs: 0, related: [{ conceptId: 'c2', relation: 'produces' }] },
      { id: 'c2', name: 'Pyruvate', summary: 'Pyruvate is the three-carbon product of glycolysis. It is converted to acetyl CoA.', importance: 0.7, examLikelihood: 0.5, difficulty: 0.3, mentions: 2, firstMentionMs: 8000, related: [] },
      { id: 'c3', name: 'Krebs Cycle', summary: 'The Krebs cycle oxidizes acetyl CoA to carbon dioxide. It generates NADH and FADH2.', importance: 0.9, examLikelihood: 0.85, difficulty: 0.6, mentions: 4, firstMentionMs: 20000, related: [{ conceptId: 'c4', relation: 'feeds' }] },
      { id: 'c4', name: 'ATP Synthase (F1Fo)', summary: 'ATP synthase uses the proton gradient to phosphorylate ADP into ATP.', importance: 0.85, examLikelihood: 0.8, difficulty: 0.7, mentions: 3, firstMentionMs: 44000, related: [] },
      { id: 'c5', name: 'Electron Transport Chain', summary: 'The electron transport chain passes electrons down protein complexes. It pumps protons across the inner membrane.', importance: 0.88, examLikelihood: 0.82, difficulty: 0.85, mentions: 4, firstMentionMs: 40000, related: [{ conceptId: 'c4', relation: 'drives' }, { conceptId: 'c6', relation: 'builds' }] },
      { id: 'c6', name: 'Proton Gradient', summary: 'The proton gradient stores potential energy across the inner membrane. It drives ATP synthase.', importance: 0.6, examLikelihood: 0.6, difficulty: 0.9, mentions: 2, firstMentionMs: 48000, related: [] },
      { id: 'c7', name: 'NADH', summary: 'NADH is an electron carrier produced in glycolysis and the Krebs cycle. It donates electrons to the chain.', importance: 0.55, examLikelihood: 0.5, difficulty: 0.5, mentions: 2, firstMentionMs: 52000, related: [] },
      { id: 'c8', name: 'Oxidative Phosphorylation', summary: 'Oxidative phosphorylation couples electron transport to ATP synthesis. It makes most of the cell ATP.', importance: 0.8, examLikelihood: 0.7, difficulty: 0.8, mentions: 3, firstMentionMs: 56000, related: [] },
    ],
    definitions: [
      { id: 'd1', term: 'Glycolysis', definition: 'the pathway that breaks glucose into two pyruvate molecules', conceptId: 'c1', atMs: 1000 },
      { id: 'd2', term: 'ATP synthase', definition: 'the enzyme that makes ATP: it turns like a turbine driven by protons', conceptId: 'c4', atMs: 45000 },
    ],
    formulas: [
      { id: 'f1', name: 'Net ATP yield', expression: '~30-32 ATP per glucose', explanation: 'the approximate net ATP produced per glucose', atMs: 58000 },
      { id: 'f2', name: 'Glucose oxidation', expression: 'C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O', explanation: 'the overall balanced equation', atMs: 5000 },
    ],
    examples: [],
    keyDates: [
      { id: 'k1', label: '1937', event: 'Hans Krebs described the citric acid cycle', atMs: 22000 },
      { id: 'k2', label: '1961', event: 'Peter Mitchell proposed the chemiosmotic hypothesis', atMs: 49000 },
    ],
    emphasisCues: [
      { id: 'cue1', quote: 'The Krebs cycle is where most of the carbon dioxide comes from — expect it on the exam.', conceptId: 'c3', atMs: 20500 },
      { id: 'cue2', quote: 'Remember: no oxygen, no electron transport chain.', conceptId: 'c5', atMs: 41000 },
    ],
    vocabulary: [
      { id: 'v1', term: 'Aerobic', meaning: 'requiring oxygen' },
      { id: 'v2', term: 'Anaerobic', meaning: 'occurring without oxygen' },
      { id: 'v3', term: 'Substrate', meaning: 'the molecule an enzyme acts upon' },
      { id: 'v4', term: 'Matrix', meaning: 'the space enclosed by the inner mitochondrial membrane' },
    ],
    examWatchlist: ['c1', 'c3', 'c5'],
    struggleWatchlist: ['c6', 'c5'],
    crossLectureLinks: [],
    generatedBy: 'heuristic',
    createdAt: 1_700_000_000_000,
  };
}

function transcriptFixture(): Transcript {
  return {
    lectureId: LECTURE_ID,
    segments: [
      { id: 's0', index: 0, startMs: 0, endMs: 5000, text: 'Glycolysis', kind: 'heading' },
      { id: 's1', index: 1, startMs: 5000, endMs: 19000, text: 'Glycolysis splits glucose into pyruvate in the cytoplasm.', kind: 'speech' },
      { id: 's2', index: 2, startMs: 20000, endMs: 25000, text: 'Krebs Cycle', kind: 'heading' },
      { id: 's3', index: 3, startMs: 25000, endMs: 39000, text: 'The Krebs cycle oxidizes acetyl CoA and makes NADH.', kind: 'speech' },
      { id: 's4', index: 4, startMs: 40000, endMs: 45000, text: 'Electron Transport Chain', kind: 'heading' },
      { id: 's5', index: 5, startMs: 45000, endMs: 59000, text: 'The chain pumps protons to build a gradient that powers ATP synthase.', kind: 'speech' },
    ],
    paragraphs: [],
    sections: [
      { id: 'sec0', title: 'Glycolysis', startMs: 0, endMs: 20000, paragraphIds: [] },
      { id: 'sec1', title: 'Krebs Cycle', startMs: 20000, endMs: 40000, paragraphIds: [] },
      { id: 'sec2', title: 'Electron Transport Chain', startMs: 40000, endMs: 60000, paragraphIds: [] },
    ],
    language: 'en',
    engine: 'simulated',
    updatedAt: 1_700_000_000_000,
  };
}

function lectureFixture(): Lecture {
  return {
    id: LECTURE_ID,
    courseId: COURSE_ID,
    title: 'Cellular Respiration',
    number: 3,
    status: 'ready',
    recordedAt: 1_700_000_000_000,
    durationMs: 60000,
    topics: [],
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function courseFixture(): Course {
  return {
    id: COURSE_ID,
    name: 'Introductory Biology',
    instructor: 'Dr. Mendel',
    semester: 'Fall 2026',
    color: '#10b981',
    icon: 'dna',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/** Offline AI facade: generation must never be invoked on the heuristic path. */
const offlineAi: AIFacade = {
  available: async () => false,
  activeLabel: () => 'offline/mock',
  chat: async () => {
    throw new Error('chat must not be called offline');
  },
  generate: (async () => {
    throw new Error('generate must not be called offline');
  }) as AIFacade['generate'],
};

interface Fakes {
  repos: Repositories;
  decks: Map<string, SlideDeck>;
}

function fakeRepos(seed: { course?: Course | null } = {}): Fakes {
  const decks = new Map<string, SlideDeck>();
  const repos = {
    lectures: { get: async (id: string) => (id === LECTURE_ID ? lectureFixture() : null) },
    transcripts: { getByLecture: async (id: string) => (id === LECTURE_ID ? transcriptFixture() : null) },
    analyses: { getByLecture: async (id: string) => (id === LECTURE_ID ? analysisFixture() : null) },
    courses: {
      get: async (id: string) =>
        seed.course !== undefined ? seed.course : id === COURSE_ID ? courseFixture() : null,
    },
    slideDecks: {
      put: async (deck: SlideDeck) => {
        decks.set(deck.id, deck);
      },
      get: async (id: string) => decks.get(id) ?? null,
      byLecture: async (lectureId: string) =>
        [...decks.values()].find((d) => d.lectureId === lectureId) ?? null,
    },
  } as unknown as Repositories;
  return { repos, decks };
}

function makeService(fakes: Fakes): { service: SlidesService; bus: EventBus<CoreEvents> } {
  const bus = new EventBus<CoreEvents>();
  const logger = new LogManager().getLogger('test');
  const service = new SlidesService({ repos: fakes.repos, ai: offlineAi, bus, logger });
  return { service, bus };
}

/* ————————————————————————————————— tests ————————————————————————————————— */

describe('SlidesService (heuristic deck)', () => {
  it('builds a rich, persisted deck entirely offline', async () => {
    const fakes = fakeRepos();
    const { service, bus } = makeService(fakes);
    const events: CoreEvents['job:progress'][] = [];
    bus.on('job:progress', (e) => events.push(e));

    const deck = await service.generate(LECTURE_ID);

    // Substantial deck with the required layouts.
    expect(deck.slides.length).toBeGreaterThanOrEqual(8);
    const layouts = new Set(deck.slides.map((s) => s.layout));
    expect(layouts.has('title')).toBe(true);
    expect(layouts.has('section')).toBe(true);
    expect(layouts.has('diagram')).toBe(true);
    // The closing "summary" slide (a bullets slide titled Summary…).
    expect(deck.slides.some((s) => /summary/i.test(s.title))).toBe(true);

    // Every slide has real speaker notes.
    for (const slide of deck.slides) {
      expect(slide.speakerNotes.trim().length).toBeGreaterThan(0);
    }

    // Envelope + persistence.
    expect(deck.theme).toBe('auto');
    expect(deck.generatedBy).toBe('heuristic');
    expect(deck.courseId).toBe(COURSE_ID);
    expect(await service.get(LECTURE_ID)).toEqual(deck);

    // Progress emitted under the 'slides' kind and finished successfully.
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.kind === 'slides')).toBe(true);
    expect(events.at(-1)?.state).toBe('succeeded');
  });

  it('sanitizes concept labels in the generated mind map', async () => {
    const { service } = makeService(fakeRepos());
    const deck = await service.generate(LECTURE_ID);
    const diagram = deck.slides.find((s) => s.layout === 'diagram');
    expect(diagram?.mermaid).toBeTruthy();
    const mermaid = diagram?.mermaid ?? '';

    // The concept "ATP Synthase (F1Fo)" must lose its parentheses in the label.
    expect(mermaid).toContain('ATP Synthase F1Fo');
    expect(mermaid).not.toContain('(F1Fo)');

    // No node/leaf line (indented content, not the `root((...))` header) may
    // contain a raw parenthesis.
    const nodeLines = mermaid.split('\n').filter((l) => l.startsWith('    '));
    expect(nodeLines.length).toBeGreaterThan(0);
    for (const line of nodeLines) expect(line).not.toMatch(/[()]/);
  });

  it('still produces a full deck when the course is missing', async () => {
    const { service } = makeService(fakeRepos({ course: null }));
    const deck = await service.generate(LECTURE_ID);
    expect(deck.slides.length).toBeGreaterThanOrEqual(8);
    expect(deck.title).toBe('Cellular Respiration');
  });
});

describe('mermaid-gen', () => {
  it('strips characters that break Mermaid syntax', () => {
    expect(sanitizeMermaidLabel('ATP synthase (F1Fo)')).toBe('ATP synthase F1Fo');
    expect(sanitizeMermaidLabel('Step 3: oxidation')).toBe('Step 3 oxidation');
    expect(sanitizeMermaidLabel('a "quoted" [bracketed] {brace}')).toBe('a quoted bracketed brace');
    expect(sanitizeMermaidLabel('arrow --> here')).toBe('arrow here');
    expect(sanitizeMermaidLabel('   ')).toBe('node');
    expect(sanitizeMermaidLabel('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('builds a valid mindmap with sanitized labels', () => {
    const src = mindmap('DNA Replication (overview)', [
      { label: 'Enzymes: the crew', children: ['Helicase', 'Helicase', 'DNA ligase'] },
    ]);
    expect(src.startsWith('mindmap')).toBe(true);
    expect(src).toContain('root((DNA Replication overview))');
    expect(src).toContain('    Enzymes the crew');
    // Duplicate "Helicase" child collapses to one.
    expect(src.match(/Helicase/g)?.length).toBe(1);
    // No stray parens/colons in any non-root line.
    for (const line of src.split('\n').slice(2)) expect(line).not.toMatch(/[():]/);
  });

  it('builds a valid flowchart with de-duplicated nodes and safe labels', () => {
    const src = flowchart([
      { from: 'Unwind (helicase)', to: 'Prime', label: 'needs: RNA' },
      { from: 'Prime', to: 'Extend' },
    ]);
    expect(src.startsWith('flowchart TD')).toBe(true);
    expect(src).toContain('n0["Unwind helicase"]');
    // "Prime" is declared once and reused across both edges.
    expect(src.match(/n1\["Prime"\]/g)?.length).toBe(1);
    expect(src).toContain('-->|needs RNA|');
    for (const line of src.split('\n')) expect(line).not.toMatch(/[()]/);
  });

  it('never emits an empty flowchart', () => {
    const src = flowchart([]);
    expect(src.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

/* —————————————————————————————— exporters —————————————————————————————— */

describe('exporters', () => {
  let tmpDir: string;
  let deck: SlideDeck;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-slides-'));
    const fakes = fakeRepos();
    const { service } = makeService(fakes);
    deck = await service.generate(LECTURE_ID);
    // Append a chart slide so exporter chart code paths are exercised.
    deck.slides.push({
      id: 'chart-slide',
      layout: 'chart',
      title: 'ATP by Stage',
      chart: {
        kind: 'bar',
        labels: ['Glycolysis', 'Krebs', 'Ox-Phos'],
        series: [{ label: 'ATP', data: [2, 2, 28] }],
      },
      accent: 'sky',
      speakerNotes: 'Most ATP comes from oxidative phosphorylation, not the earlier stages.',
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('PPTX: writes a non-trivial zip (PK magic)', async () => {
    const out = path.join(tmpDir, 'deck.pptx');
    await new PptxExporter().export(deck, out, { courseName: 'Introductory Biology' });
    const buf = await fs.readFile(out);
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
  });

  it('PDF: writes a loadable document with one page per slide', async () => {
    const out = path.join(tmpDir, 'deck.pdf');
    await new PdfExporter().export(deck, out, { courseName: 'Introductory Biology' });
    const bytes = await fs.readFile(out);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(deck.slides.length);
  });

  it('Markdown: contains a fenced mermaid block and every slide title', async () => {
    const out = path.join(tmpDir, 'deck.md');
    await new MarkdownExporter().export(deck, out, { courseName: 'Introductory Biology' });
    const md = await fs.readFile(out, 'utf8');
    expect(md).toContain('```mermaid');
    expect(md.startsWith('# Cellular Respiration')).toBe(true);
    for (const slide of deck.slides) expect(md).toContain(`## ${slide.title}`);
    // Speaker notes rendered consistently.
    expect(md).toContain('> **Speaker notes:**');
  });

  it('NotebookLM: bundles the deck plus a condensed lecture-context appendix', async () => {
    const out = path.join(tmpDir, 'deck.notebooklm.md');
    await new NotebookLMExporter().export(deck, out, { courseName: 'Introductory Biology' });
    const md = await fs.readFile(out, 'utf8');
    expect(md).toContain('## Lecture context');
    expect(md).toContain('# Cellular Respiration');
    // The appendix reuses transcript-derived narration (a section title shows up).
    expect(md).toContain('Electron Transport Chain');
  });
});

/* ———————————————————————————— ExportService ———————————————————————————— */

describe('ExportService', () => {
  let tmpDir: string;
  let service: ExportService;
  let deckId: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-export-'));
    const fakes = fakeRepos();
    const { service: slides } = makeService(fakes);
    const deck = await slides.generate(LECTURE_ID);
    deckId = deck.id;

    const logger = new LogManager().getLogger('test');
    const registry = new PluginRegistry(logger);
    registerBuiltinExporters(registry);
    service = new ExportService({
      pluginRegistry: registry,
      repos: fakes.repos,
      dataDir: tmpDir,
      logger,
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('slugs the filename from course, lecture number and deck title', async () => {
    const result = await service.export(deckId, 'markdown');
    expect(result.format).toBe('markdown');
    expect(path.dirname(result.filePath)).toBe(path.join(tmpDir, 'exports'));
    expect(path.basename(result.filePath)).toBe(
      'introductory-biology-lecture03-cellular-respiration.md',
    );
    await expect(fs.stat(result.filePath)).resolves.toBeDefined();
  });

  it('gives the NotebookLM bundle a distinct extension so it never collides', async () => {
    const result = await service.export(deckId, 'notebooklm');
    expect(path.basename(result.filePath)).toBe(
      'introductory-biology-lecture03-cellular-respiration.notebooklm.md',
    );
  });

  it('throws NOT_FOUND for an unknown deck', async () => {
    await expect(service.export('does-not-exist', 'markdown')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND for an unregistered format', async () => {
    await expect(service.export(deckId, 'xyz' as SlideExportFormat)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
