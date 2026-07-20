import type {
  Concept,
  Course,
  Lecture,
  LectureAnalysis,
  StudyMaterial,
  StudyMaterialMeta,
  Transcript,
  TranscriptSection,
  TranscriptSegment,
} from '@studdybuddy/shared';
import type { AIFacade, StructuredRequest } from '../src/ai/types';
import type { Repositories } from '../src/storage/types';
import type { GenerationContext } from '../src/materials/types';

/**
 * Shared, deterministic fixtures for the materials tests: a rich cellular-
 * respiration lecture analysis + transcript, plus small fakes (AI facades,
 * in-memory repos) and a GenerationContext builder. Crafted once here so every
 * materials-*.test.ts file exercises the same, control-rich input.
 */

export const LECTURE_ID = 'lec-respiration';
export const COURSE_ID = 'course-bio';

function concept(
  id: string,
  name: string,
  summary: string,
  importance: number,
  firstMentionMs: number,
  extra: Partial<Concept> = {},
): Concept {
  return {
    id,
    name,
    summary,
    importance,
    examLikelihood: extra.examLikelihood ?? importance * 0.9,
    difficulty: extra.difficulty ?? 0.5,
    mentions: extra.mentions ?? 2,
    firstMentionMs,
    related: extra.related ?? [],
  };
}

const CONCEPTS: Concept[] = [
  concept(
    'c1',
    'Glycolysis',
    'Glycolysis is the first stage of respiration. It splits one glucose molecule into two pyruvate molecules. It happens in the cytoplasm and yields a small amount of ATP.',
    0.95,
    0,
    { mentions: 5, related: [{ conceptId: 'c6', relation: 'produces' }] },
  ),
  concept(
    'c2',
    'Krebs Cycle',
    'The Krebs cycle oxidizes acetyl CoA to carbon dioxide. It generates NADH and FADH2 for the electron transport chain. It runs in the mitochondrial matrix.',
    0.9,
    20000,
    {
      mentions: 4,
      related: [
        { conceptId: 'c10', relation: 'consumes' },
        { conceptId: 'c8', relation: 'produces' },
      ],
    },
  ),
  concept(
    'c3',
    'Electron Transport Chain',
    'The electron transport chain is a set of protein complexes in the inner membrane. It passes electrons down an energy gradient and pumps protons. This builds the proton gradient that powers ATP synthesis.',
    0.88,
    40000,
    {
      mentions: 4,
      difficulty: 0.85,
      related: [
        { conceptId: 'c4', relation: 'drives' },
        { conceptId: 'c8', relation: 'uses' },
      ],
    },
  ),
  concept(
    'c4',
    'ATP Synthase',
    'ATP synthase is an enzyme embedded in the inner mitochondrial membrane. It uses the flow of protons to phosphorylate ADP into ATP.',
    0.82,
    44000,
    { mentions: 3 },
  ),
  concept(
    'c5',
    'Oxidative Phosphorylation',
    'Oxidative phosphorylation couples electron transport to ATP production. It is where most of the cell’s ATP is generated.',
    0.78,
    52000,
    { difficulty: 0.8, related: [{ conceptId: 'c3', relation: 'part-of' }] },
  ),
  concept(
    'c6',
    'Pyruvate',
    'Pyruvate is the three-carbon product of glycolysis. It is converted to acetyl CoA before entering the Krebs cycle.',
    0.72,
    8000,
  ),
  concept(
    'c7',
    'Mitochondria',
    'Mitochondria are the organelles where aerobic respiration occurs. They have an inner and outer membrane.',
    0.68,
    60000,
  ),
  concept(
    'c8',
    'NADH',
    'NADH is an electron carrier produced during glycolysis and the Krebs cycle. It donates electrons to the electron transport chain.',
    0.62,
    64000,
  ),
  concept(
    'c9',
    'FADH2',
    'FADH2 is an electron carrier that feeds electrons into the chain at a later complex than NADH.',
    0.55,
    68000,
    { difficulty: 0.75 },
  ),
  concept(
    'c10',
    'Acetyl CoA',
    'Acetyl CoA is the two-carbon molecule that enters the Krebs cycle. It is formed from pyruvate.',
    0.5,
    24000,
  ),
  concept(
    'c11',
    'Proton Gradient',
    'The proton gradient is the difference in proton concentration across the inner membrane. Its stored energy drives ATP synthase.',
    0.45,
    48000,
    { difficulty: 0.9 },
  ),
  concept(
    'c12',
    'Fermentation',
    'Fermentation is an anaerobic pathway that regenerates NAD+ when oxygen is absent. It lets glycolysis continue without the electron transport chain.',
    0.4,
    76000,
  ),
];

const ANALYSIS: LectureAnalysis = {
  lectureId: LECTURE_ID,
  gist: 'This lecture covers how cells extract energy from glucose through glycolysis, the Krebs cycle and oxidative phosphorylation. It emphasizes the proton gradient and ATP synthase.',
  concepts: CONCEPTS,
  definitions: [
    { id: 'd1', term: 'Glycolysis', definition: 'the metabolic pathway that breaks glucose into two pyruvate molecules', conceptId: 'c1', atMs: 1000 },
    { id: 'd2', term: 'Krebs Cycle', definition: 'a cycle of reactions that oxidizes acetyl CoA to carbon dioxide', conceptId: 'c2', atMs: 21000 },
    { id: 'd3', term: 'Electron Transport Chain', definition: 'a chain of protein complexes that transfer electrons and pump protons', conceptId: 'c3', atMs: 41000 },
    { id: 'd4', term: 'ATP Synthase', definition: 'the enzyme that synthesizes ATP from ADP using a proton gradient', conceptId: 'c4', atMs: 45000 },
    { id: 'd5', term: 'Mitochondria', definition: 'the organelles where most cellular respiration takes place', conceptId: 'c7', atMs: 61000 },
    { id: 'd6', term: 'Fermentation', definition: 'an anaerobic process that regenerates NAD+ without oxygen', conceptId: 'c12', atMs: 77000 },
  ],
  formulas: [
    { id: 'f1', name: 'Net ATP yield', expression: '~30-32 ATP per glucose', explanation: 'the approximate net ATP produced per glucose molecule', atMs: 70000 },
    { id: 'f2', name: 'Glucose oxidation', expression: 'C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O', explanation: 'the overall balanced equation of aerobic respiration', atMs: 5000 },
  ],
  examples: [
    { id: 'e1', conceptId: 'c1', description: 'Breaking down a glucose molecule at the start of a sprint for quick energy.', kind: 'example', atMs: 3000 },
    { id: 'e2', conceptId: 'c3', description: 'The electron transport chain works like a bucket brigade passing electrons along.', kind: 'analogy', atMs: 42000 },
    { id: 'e3', conceptId: 'c4', description: 'ATP synthase spins like a turbine driven by flowing water.', kind: 'analogy', atMs: 46000 },
  ],
  keyDates: [{ id: 'k1', label: '1937', event: 'Hans Krebs described the citric acid cycle', atMs: 22000 }],
  emphasisCues: [
    { id: 'cue1', quote: 'This will absolutely be on the exam.', conceptId: 'c2', atMs: 20500 },
    { id: 'cue2', quote: 'The most important takeaway is the proton gradient.', conceptId: 'c11', atMs: 48500 },
  ],
  vocabulary: [
    { id: 'v1', term: 'Aerobic', meaning: 'requiring oxygen' },
    { id: 'v2', term: 'Anaerobic', meaning: 'occurring without oxygen' },
    { id: 'v3', term: 'Substrate', meaning: 'the molecule an enzyme acts upon' },
    { id: 'v4', term: 'Cofactor', meaning: 'a non-protein helper molecule for an enzyme' },
  ],
  examWatchlist: ['c1', 'c2', 'c3'],
  struggleWatchlist: ['c11', 'c3', 'c5', 'c9'],
  crossLectureLinks: [],
  generatedBy: 'heuristic',
  createdAt: 1_700_000_000_000,
};

const SECTIONS: TranscriptSection[] = [
  { id: 's-sec0', title: 'Glycolysis', startMs: 0, endMs: 20000, paragraphIds: [] },
  { id: 's-sec1', title: 'Krebs Cycle', startMs: 20000, endMs: 40000, paragraphIds: [] },
  { id: 's-sec2', title: 'Electron Transport Chain', startMs: 40000, endMs: 60000, paragraphIds: [] },
  { id: 's-sec3', title: 'Wrap-up', startMs: 60000, endMs: 80000, paragraphIds: [] },
];

const SEGMENT_LINES: { text: string; kind?: TranscriptSegment['kind']; question?: boolean }[] = [
  { text: 'Glycolysis', kind: 'heading' },
  { text: 'Today we start with glycolysis, which breaks glucose into pyruvate.' },
  { text: 'Glycolysis happens in the cytoplasm and does not need oxygen.' },
  { text: 'Krebs Cycle', kind: 'heading' },
  { text: 'The Krebs cycle oxidizes acetyl CoA and produces NADH and FADH2.' },
  { text: 'This will absolutely be on the exam.' },
  { text: 'What do you think powers ATP synthase?', kind: 'question', question: true },
  { text: 'Electron Transport Chain', kind: 'heading' },
  { text: 'The electron transport chain pumps protons to build a gradient.' },
  { text: 'The most important takeaway is the proton gradient.' },
  { text: 'Wrap-up', kind: 'heading' },
  { text: 'Without oxygen, cells fall back on fermentation to regenerate NAD plus.' },
];

const SEGMENTS: TranscriptSegment[] = SEGMENT_LINES.map((line, index) => ({
  id: `seg-${index}`,
  index,
  startMs: index * 6000,
  endMs: index * 6000 + 5500,
  text: line.text,
  kind: line.kind ?? 'speech',
  ...(line.question ? { isTeacherQuestion: true } : {}),
}));

const TRANSCRIPT: Transcript = {
  lectureId: LECTURE_ID,
  segments: SEGMENTS,
  paragraphs: [],
  sections: SECTIONS,
  language: 'en',
  engine: 'simulated',
  updatedAt: 1_700_000_000_000,
};

const LECTURE: Lecture = {
  id: LECTURE_ID,
  courseId: COURSE_ID,
  title: 'Cellular Respiration',
  number: 3,
  status: 'ready',
  recordedAt: 1_700_000_000_000,
  durationMs: 80000,
  topics: [],
  tags: [],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const COURSE: Course = {
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

/** Deep clones so a test mutating content cannot leak into another test. */
export function analysis(): LectureAnalysis {
  return structuredClone(ANALYSIS);
}
export function transcript(): Transcript {
  return structuredClone(TRANSCRIPT);
}
export function lecture(): Lecture {
  return structuredClone(LECTURE);
}
export function course(): Course {
  return structuredClone(COURSE);
}

/** An AI facade reporting offline; `generate`/`chat` throw if ever called. */
export const offlineAi: AIFacade = {
  available: async () => false,
  activeLabel: () => 'offline/mock',
  chat: async () => {
    throw new Error('chat must not be called on the offline path');
  },
  generate: (async () => {
    throw new Error('generate must not be called on the offline path');
  }) as AIFacade['generate'],
};

/** Build an online AI facade with a stubbed structured generator. */
export function stubAi(
  generate: <T>(req: StructuredRequest<T>) => Promise<T>,
  label = 'stub/model-x',
): AIFacade {
  return {
    available: async () => true,
    activeLabel: () => label,
    chat: async () => ({ text: '', model: 'stub' }),
    generate: generate as AIFacade['generate'],
  };
}

/** A heuristic-path GenerationContext for a chosen difficulty. */
export function makeContext(
  difficulty: GenerationContext['difficulty'],
  overrides: Partial<GenerationContext> = {},
): GenerationContext {
  return {
    lecture: lecture(),
    transcript: transcript(),
    analysis: analysis(),
    difficulty,
    generate: offlineAi.generate,
    aiAvailable: false,
    courseName: COURSE.name,
    ...overrides,
  };
}

/** Mutable in-memory state backing {@link fakeRepos}. */
export interface RepoState {
  materials: StudyMaterial[];
  quizAttempts: import('@studdybuddy/shared').QuizAttempt[];
}

/**
 * Minimal in-memory {@link Repositories} covering what MaterialsService and
 * QuizService touch. `seed` controls which lecture/transcript/analysis/course
 * lookups succeed so NOT_FOUND / VALIDATION paths can be exercised.
 */
export function fakeRepos(
  seed: {
    lecture?: Lecture | null;
    transcript?: Transcript | null;
    analysis?: LectureAnalysis | null;
    course?: Course | null;
    materials?: StudyMaterial[];
  } = {},
): { repos: Repositories; state: RepoState } {
  const state: RepoState = {
    materials: seed.materials ? [...seed.materials] : [],
    quizAttempts: [],
  };
  const repos = {
    lectures: {
      get: async (id: string) =>
        seed.lecture !== undefined
          ? seed.lecture && seed.lecture.id === id
            ? seed.lecture
            : null
          : id === LECTURE_ID
            ? lecture()
            : null,
    },
    transcripts: {
      getByLecture: async (id: string) =>
        seed.transcript !== undefined
          ? seed.transcript
          : id === LECTURE_ID
            ? transcript()
            : null,
    },
    analyses: {
      getByLecture: async (id: string) =>
        seed.analysis !== undefined ? seed.analysis : id === LECTURE_ID ? analysis() : null,
    },
    courses: {
      get: async (id: string) =>
        seed.course !== undefined ? seed.course : id === COURSE_ID ? course() : null,
    },
    materials: {
      put: async (material: StudyMaterial) => {
        const idx = state.materials.findIndex((m) => m.id === material.id);
        if (idx >= 0) state.materials[idx] = material;
        else state.materials.push(material);
      },
      get: async (id: string) => state.materials.find((m) => m.id === id) ?? null,
      listMeta: async (lectureId: string): Promise<StudyMaterialMeta[]> =>
        state.materials
          .filter((m) => m.lectureId === lectureId)
          .map(({ content: _content, ...meta }) => meta)
          .reverse(),
      delete: async (id: string) => {
        state.materials = state.materials.filter((m) => m.id !== id);
      },
    },
    quizAttempts: {
      byLecture: async (lectureId: string) =>
        state.quizAttempts.filter((a) => a.lectureId === lectureId),
      put: async (attempt: import('@studdybuddy/shared').QuizAttempt) => {
        state.quizAttempts.push(attempt);
      },
    },
  } as unknown as Repositories;
  return { repos, state };
}
