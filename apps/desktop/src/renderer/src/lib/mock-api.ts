import type {
  AchievementDef,
  AppSettings,
  AskAnswer,
  Concept,
  Course,
  CourseInput,
  DashboardSummary,
  Difficulty,
  ExamPrepPlan,
  Explanation,
  ExplanationStyle,
  Flashcard,
  GamificationState,
  IpcApi,
  IpcEventMap,
  Lecture,
  LectureAnalysis,
  MaterialType,
  ProviderDescriptor,
  QuizAttempt,
  RecordingStatus,
  SearchHit,
  SlideDeck,
  StudyEvent,
  StudyMaterial,
  Transcript,
  TranscriptSegment,
} from '@studdybuddy/shared';
import { DEFAULT_SETTINGS, dayKey, newId } from '@studdybuddy/shared';
import { levelForXp } from './xp';

/**
 * A fully in-memory implementation of {@link IpcApi} with believable, seeded
 * demo data. It powers the app whenever there is no Electron backend — browser
 * preview and the entire vitest suite — and drives every push event through the
 * injected `emit` callback so live features (recording, jobs) behave for real.
 *
 * Everything is deterministic apart from wall-clock timers used to simulate the
 * recording pipeline and generation latency.
 */
export type EmitFn = <K extends keyof IpcEventMap>(event: K, payload: IpcEventMap[K]) => void;

const GEN_DELAY = 350;
const AI_BY = 'mock/claude-sonnet-5';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Deep clone so callers never mutate the seeded store by reference. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

// ————————————————————————————————————————————————————————————————
//  Seed builders
// ————————————————————————————————————————————————————————————————

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function seg(
  index: number,
  startMs: number,
  endMs: number,
  text: string,
  kind: TranscriptSegment['kind'] = 'speech',
  extra: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return { id: `seg-${index}-${startMs}`, index, startMs, endMs, text, kind, confidence: 0.94, ...extra };
}

function buildTranscript(lectureId: string, segments: TranscriptSegment[]): Transcript {
  const paragraphs = segments
    .filter((s) => s.kind !== 'heading')
    .map((s) => ({ id: `par-${s.id}`, segmentIds: [s.id], startMs: s.startMs, endMs: s.endMs }));
  const sections = segments
    .filter((s) => s.kind === 'heading')
    .map((s, i) => ({
      id: `sec-${s.id}`,
      title: s.text,
      startMs: s.startMs,
      endMs: segments[segments.length - 1]?.endMs ?? s.endMs,
      paragraphIds: paragraphs.filter((p) => p.startMs >= s.startMs).map((p) => p.id),
      _i: i,
    }))
    .map(({ _i, ...rest }) => rest);
  return { lectureId, segments, paragraphs, sections, language: 'en', engine: 'simulated', updatedAt: NOW };
}

function concept(
  id: string,
  name: string,
  summary: string,
  o: Partial<Concept> = {},
): Concept {
  return {
    id,
    name,
    summary,
    importance: 0.8,
    examLikelihood: 0.7,
    difficulty: 0.5,
    mentions: 4,
    firstMentionMs: 30_000,
    related: [],
    ...o,
  };
}

// —— Biology · Lecture 3: DNA Replication ——
const bioSegments: TranscriptSegment[] = [
  seg(0, 0, 8_000, 'DNA Replication', 'heading'),
  seg(1, 8_000, 26_000, 'Today we are going to walk through how a cell copies its entire genome before it divides. This is one of the most elegant processes in all of biology.'),
  seg(2, 26_000, 44_000, 'The key idea is that replication is semi-conservative. Each new double helix keeps one original strand and one brand-new strand.'),
  seg(3, 44_000, 52_000, 'So why does the process need to be so accurate?', 'question', { isTeacherQuestion: true }),
  seg(4, 52_000, 74_000, 'Because a single uncorrected error can become a permanent mutation. The polymerase enzyme has a proofreading function precisely for this reason — this will absolutely show up on the exam.'),
  seg(5, 74_000, 80_000, 'The Replication Fork', 'heading'),
  seg(6, 80_000, 104_000, 'Helicase unwinds the double helix at the origin of replication, creating a Y-shaped replication fork. Single-strand binding proteins then keep the strands apart.'),
  seg(7, 104_000, 128_000, 'Because the two strands are antiparallel, one strand — the leading strand — is synthesized continuously, while the lagging strand is built in short Okazaki fragments.'),
  seg(8, 128_000, 150_000, 'DNA ligase finally seals the nicks between those fragments. Remember this trio: helicase, polymerase, ligase. It is a classic short-answer question.'),
];

const bioConcepts: Concept[] = [
  concept('c-semiconservative', 'Semi-conservative replication', 'Each daughter DNA molecule retains one parental strand and one newly synthesized strand, proven by the Meselson–Stahl experiment.', { importance: 0.95, examLikelihood: 0.9, difficulty: 0.45, mentions: 6, firstMentionMs: 26_000, related: [{ conceptId: 'c-fork', relation: 'prerequisite' }] }),
  concept('c-fork', 'Replication fork', 'The Y-shaped region where the double helix is unwound and both strands are copied simultaneously.', { importance: 0.85, examLikelihood: 0.8, difficulty: 0.55, mentions: 5, firstMentionMs: 80_000 }),
  concept('c-okazaki', 'Okazaki fragments', 'Short DNA segments synthesized discontinuously on the lagging strand, later joined by DNA ligase.', { importance: 0.8, examLikelihood: 0.85, difficulty: 0.7, mentions: 4, firstMentionMs: 104_000 }),
  concept('c-proofreading', 'Polymerase proofreading', 'The 3′→5′ exonuclease activity that lets DNA polymerase correct mispaired bases, keeping error rates extremely low.', { importance: 0.75, examLikelihood: 0.75, difficulty: 0.6, mentions: 3, firstMentionMs: 52_000 }),
];

const bioAnalysis: LectureAnalysis = {
  lectureId: 'lec-bio-1',
  gist: 'DNA replication is a semi-conservative process where helicase, polymerase, and ligase cooperate at the replication fork. Accuracy comes from polymerase proofreading, and the lagging strand is assembled from Okazaki fragments.',
  concepts: bioConcepts,
  definitions: [
    { id: 'd-1', term: 'Semi-conservative', definition: 'A mode of replication in which each new molecule contains one old and one new strand.', conceptId: 'c-semiconservative', atMs: 26_000 },
    { id: 'd-2', term: 'Okazaki fragment', definition: 'A short newly synthesized DNA fragment on the lagging strand.', conceptId: 'c-okazaki', atMs: 104_000 },
    { id: 'd-3', term: 'Replication fork', definition: 'The Y-shaped structure formed when the double helix is unwound for copying.', conceptId: 'c-fork', atMs: 80_000 },
  ],
  formulas: [
    { id: 'f-1', name: 'Fidelity', expression: 'error rate ≈ 10⁻⁹ per base pair', explanation: 'Combined base-pairing and proofreading fidelity of DNA polymerase.', atMs: 52_000 },
  ],
  examples: [
    { id: 'e-1', conceptId: 'c-semiconservative', description: 'The Meselson–Stahl density-gradient experiment using heavy nitrogen (¹⁵N).', kind: 'example', atMs: 26_000 },
    { id: 'e-2', conceptId: 'c-fork', description: 'Think of unwinding the fork like unzipping a jacket from one end.', kind: 'analogy', atMs: 80_000 },
  ],
  keyDates: [{ id: 'kd-1', label: '1958', event: 'Meselson–Stahl confirm semi-conservative replication.', atMs: 26_000 }],
  emphasisCues: [
    { id: 'em-1', quote: 'this will absolutely show up on the exam', conceptId: 'c-proofreading', atMs: 52_000 },
    { id: 'em-2', quote: 'It is a classic short-answer question', conceptId: 'c-okazaki', atMs: 128_000 },
  ],
  vocabulary: [
    { id: 'v-1', term: 'Helicase', meaning: 'Enzyme that unwinds the DNA double helix.', partOfSpeech: 'noun' },
    { id: 'v-2', term: 'Ligase', meaning: 'Enzyme that seals breaks in the DNA backbone.', partOfSpeech: 'noun' },
    { id: 'v-3', term: 'Antiparallel', meaning: 'Running in opposite 5′→3′ directions.', partOfSpeech: 'adjective' },
  ],
  examWatchlist: ['c-semiconservative', 'c-okazaki', 'c-proofreading'],
  struggleWatchlist: ['c-okazaki', 'c-fork'],
  crossLectureLinks: [
    { conceptId: 'c-semiconservative', earlierLectureId: 'lec-bio-2', earlierConceptName: 'S phase of the cell cycle', note: 'Replication happens during the S phase you covered last week.' },
  ],
  generatedBy: AI_BY,
  createdAt: NOW - 2 * DAY,
};

// —— Biology · Lecture 4: Cell Division ——
const bioSegments2: TranscriptSegment[] = [
  seg(0, 0, 6_000, 'Mitosis and Meiosis', 'heading'),
  seg(1, 6_000, 30_000, 'Now that a cell has copied its DNA, it needs to divide. Mitosis produces two genetically identical daughter cells, while meiosis produces four genetically unique gametes.'),
  seg(2, 30_000, 40_000, 'What is the single most important difference between the two?', 'question', { isTeacherQuestion: true }),
  seg(3, 40_000, 64_000, 'Meiosis includes crossing over and independent assortment, which shuffle the genetic deck. That genetic variation is the entire point — and yes, it is on the exam.'),
];
const bioAnalysis2: LectureAnalysis = {
  lectureId: 'lec-bio-2',
  gist: 'Mitosis yields two identical cells; meiosis yields four unique gametes through crossing over and independent assortment. The S phase precedes both by copying the genome.',
  concepts: [
    concept('c-mitosis', 'Mitosis', 'Division producing two genetically identical diploid daughter cells for growth and repair.', { importance: 0.9, examLikelihood: 0.85, firstMentionMs: 6_000 }),
    concept('c-meiosis', 'Meiosis', 'Division producing four genetically unique haploid gametes, introducing variation.', { importance: 0.9, examLikelihood: 0.88, difficulty: 0.65, firstMentionMs: 6_000 }),
    concept('c-crossingover', 'Crossing over', 'Exchange of segments between homologous chromosomes during prophase I.', { importance: 0.8, examLikelihood: 0.8, difficulty: 0.7, firstMentionMs: 40_000 }),
  ],
  definitions: [
    { id: 'd2-1', term: 'Gamete', definition: 'A haploid reproductive cell (sperm or egg).', conceptId: 'c-meiosis', atMs: 6_000 },
  ],
  formulas: [],
  examples: [{ id: 'e2-1', conceptId: 'c-crossingover', description: 'Shuffling two decks of cards together, then dealing new hands.', kind: 'analogy', atMs: 40_000 }],
  keyDates: [],
  emphasisCues: [{ id: 'em2-1', quote: 'it is on the exam', conceptId: 'c-crossingover', atMs: 40_000 }],
  vocabulary: [
    { id: 'v2-1', term: 'Haploid', meaning: 'Having a single set of chromosomes.', partOfSpeech: 'adjective' },
    { id: 'v2-2', term: 'Diploid', meaning: 'Having two complete sets of chromosomes.', partOfSpeech: 'adjective' },
  ],
  examWatchlist: ['c-meiosis', 'c-mitosis'],
  struggleWatchlist: ['c-crossingover'],
  crossLectureLinks: [],
  generatedBy: AI_BY,
  createdAt: NOW - 9 * DAY,
};

// —— History · Lecture 2: French Revolution ——
const histSegments: TranscriptSegment[] = [
  seg(0, 0, 6_000, 'The French Revolution', 'heading'),
  seg(1, 6_000, 32_000, 'In 1789 France was bankrupt, its society locked into three rigid estates. The financial crisis lit a fuse that had been waiting decades to catch.'),
  seg(2, 32_000, 42_000, 'So what actually turned a fiscal crisis into a revolution?', 'question', { isTeacherQuestion: true }),
  seg(3, 42_000, 68_000, 'The storming of the Bastille on July 14th became the symbolic spark. Keep the sequence straight: Estates-General, then the National Assembly, then the Bastille. Order matters on the exam.'),
];
const histAnalysis: LectureAnalysis = {
  lectureId: 'lec-hist-1',
  gist: 'A bankrupt monarchy and a rigid three-estate society collided in 1789. The Estates-General gave way to the National Assembly, and the storming of the Bastille became the revolution’s symbolic spark.',
  concepts: [
    concept('c-estates', 'The Three Estates', 'The clergy, nobility, and commoners — a rigid social hierarchy that concentrated privilege.', { importance: 0.9, examLikelihood: 0.85, firstMentionMs: 6_000 }),
    concept('c-bastille', 'Storming of the Bastille', 'The July 14, 1789 attack on the royal fortress that became the revolution’s defining symbol.', { importance: 0.88, examLikelihood: 0.9, firstMentionMs: 42_000 }),
    concept('c-assembly', 'National Assembly', 'The body formed by the Third Estate asserting popular sovereignty.', { importance: 0.8, examLikelihood: 0.75, difficulty: 0.6, firstMentionMs: 42_000 }),
  ],
  definitions: [
    { id: 'dh-1', term: 'Estates-General', definition: 'A general assembly representing the three estates of the realm.', conceptId: 'c-estates', atMs: 6_000 },
  ],
  formulas: [],
  examples: [{ id: 'eh-1', conceptId: 'c-estates', description: 'Two thin slices of privilege sitting on a giant base of commoners who paid the taxes.', kind: 'analogy', atMs: 6_000 }],
  keyDates: [
    { id: 'kdh-1', label: 'July 14, 1789', event: 'Storming of the Bastille.', atMs: 42_000 },
    { id: 'kdh-2', label: 'May 1789', event: 'Estates-General convenes at Versailles.', atMs: 6_000 },
  ],
  emphasisCues: [{ id: 'emh-1', quote: 'Order matters on the exam', conceptId: 'c-bastille', atMs: 42_000 }],
  vocabulary: [
    { id: 'vh-1', term: 'Bourgeoisie', meaning: 'The urban middle class.', partOfSpeech: 'noun' },
    { id: 'vh-2', term: 'Ancien Régime', meaning: 'The political and social system before 1789.', partOfSpeech: 'noun' },
  ],
  examWatchlist: ['c-bastille', 'c-estates'],
  struggleWatchlist: ['c-assembly'],
  crossLectureLinks: [],
  generatedBy: AI_BY,
  createdAt: NOW - 5 * DAY,
};

function srsDue(offsetDays: number, reps = 2): Flashcard['srs'] {
  return { ease: 2.5, intervalDays: Math.max(1, offsetDays), reps, lapses: 0, dueAt: NOW + offsetDays * DAY };
}

function notesMaterial(): StudyMaterial<'notes'> {
  return {
    id: 'mat-bio-notes',
    lectureId: 'lec-bio-1',
    courseId: 'course-bio',
    type: 'notes',
    title: 'DNA Replication — Study Notes',
    difficulty: 'medium',
    generatedBy: AI_BY,
    createdAt: NOW - 2 * DAY,
    content: {
      blocks: [
        { id: 'nb-1', type: 'heading', level: 1, text: 'DNA Replication' },
        { id: 'nb-2', type: 'paragraph', text: 'Replication copies the entire genome **before** cell division. It is **semi-conservative**: each daughter helix keeps one parental strand.', keywords: ['semi-conservative'] },
        { id: 'nb-3', type: 'fact', icon: 'sparkles', accent: 'primary', term: 'Exam favorite', text: 'The trio **helicase → polymerase → ligase** is a classic short-answer question.' },
        { id: 'nb-4', type: 'heading', level: 2, text: 'At the Replication Fork' },
        { id: 'nb-5', type: 'bullets', items: ['Helicase unwinds the double helix', 'Single-strand binding proteins hold strands apart', 'Leading strand is synthesized continuously', 'Lagging strand is built from Okazaki fragments'] },
        { id: 'nb-6', type: 'definition', term: 'Okazaki fragments', text: 'Short DNA segments on the lagging strand, later joined by DNA ligase.', accent: 'sky' },
        { id: 'nb-7', type: 'mistake', icon: 'triangle-alert', accent: 'rose', text: "Don't say both strands are made continuously — only the **leading** strand is." },
        { id: 'nb-8', type: 'formula', term: 'Fidelity', text: 'error rate ≈ 10⁻⁹ per base pair (with proofreading)' },
        { id: 'nb-9', type: 'example', icon: 'flask-conical', accent: 'emerald', text: 'Meselson–Stahl used heavy nitrogen (¹⁵N) to prove replication is semi-conservative.' },
      ],
    },
  };
}

function flashcardsMaterial(): StudyMaterial<'flashcards'> {
  return {
    id: 'mat-bio-cards',
    lectureId: 'lec-bio-1',
    courseId: 'course-bio',
    type: 'flashcards',
    title: 'DNA Replication — Flashcards',
    difficulty: 'medium',
    generatedBy: AI_BY,
    createdAt: NOW - 2 * DAY,
    content: {
      cards: [
        { id: 'fc-1', front: 'What does "semi-conservative" replication mean?', back: 'Each new DNA molecule keeps one original strand and one newly made strand.', hint: 'Think about what is conserved.', conceptId: 'c-semiconservative', srs: srsDue(-1, 3) },
        { id: 'fc-2', front: 'Which enzyme unwinds the double helix?', back: 'Helicase.', conceptId: 'c-fork', srs: srsDue(-1, 1) },
        { id: 'fc-3', front: 'What are Okazaki fragments?', back: 'Short DNA pieces synthesized discontinuously on the lagging strand, later joined by ligase.', hint: 'Lagging strand.', conceptId: 'c-okazaki', srs: srsDue(0, 2) },
        { id: 'fc-4', front: 'How does DNA polymerase keep error rates so low?', back: 'Through 3′→5′ exonuclease proofreading that removes mispaired bases.', conceptId: 'c-proofreading', srs: srsDue(2, 2) },
        { id: 'fc-5', front: 'Which enzyme seals the nicks between fragments?', back: 'DNA ligase.', conceptId: 'c-okazaki', srs: srsDue(3, 2) },
      ],
    },
  };
}

function mcqMaterial(): StudyMaterial<'quiz-mcq'> {
  return {
    id: 'mat-bio-mcq',
    lectureId: 'lec-bio-1',
    courseId: 'course-bio',
    type: 'quiz-mcq',
    title: 'DNA Replication — Practice Quiz',
    difficulty: 'medium',
    generatedBy: AI_BY,
    createdAt: NOW - 2 * DAY,
    content: {
      difficulty: 'medium',
      questions: [
        { id: 'q-1', kind: 'mcq', prompt: 'DNA replication is best described as:', choices: ['Conservative', 'Semi-conservative', 'Dispersive', 'Random'], correctIndex: 1, explanation: 'Each daughter molecule keeps one parental and one new strand, as shown by Meselson–Stahl.', conceptId: 'c-semiconservative' },
        { id: 'q-2', kind: 'mcq', prompt: 'Okazaki fragments are found on the:', choices: ['Leading strand', 'Lagging strand', 'Both strands', 'Neither strand'], correctIndex: 1, explanation: 'The lagging strand is built discontinuously because it runs opposite to the fork movement.', conceptId: 'c-okazaki' },
        { id: 'q-3', kind: 'mcq', prompt: 'Which enzyme joins Okazaki fragments together?', choices: ['Helicase', 'Primase', 'DNA ligase', 'Topoisomerase'], correctIndex: 2, explanation: 'DNA ligase seals the sugar–phosphate backbone nicks.', conceptId: 'c-okazaki' },
      ],
    },
  };
}

function bioSlideDeck(): SlideDeck {
  return {
    id: 'deck-bio-1',
    lectureId: 'lec-bio-1',
    courseId: 'course-bio',
    title: 'DNA Replication',
    theme: 'auto',
    generatedBy: AI_BY,
    createdAt: NOW - 2 * DAY,
    slides: [
      { id: 's-1', layout: 'title', title: 'DNA Replication', subtitle: 'How a cell copies its genome', icon: 'dna', accent: '#7c3aed', speakerNotes: 'Set the stage: replication precedes every cell division.' },
      { id: 's-2', layout: 'bullets', title: 'Three Key Enzymes', bullets: ['Helicase unwinds the helix', 'Polymerase builds new strands & proofreads', 'Ligase seals the fragments'], icon: 'wrench', speakerNotes: 'Students should memorize this trio.' },
      { id: 's-3', layout: 'diagram', title: 'The Replication Fork', mermaid: 'graph LR\n  A[Origin] --> B{Helicase}\n  B --> C[Leading strand]\n  B --> D[Lagging strand]\n  D --> E[Okazaki fragments]\n  E --> F[Ligase seals nicks]', speakerNotes: 'Walk through the fork left to right.' },
      { id: 's-4', layout: 'quote', title: 'Why Accuracy Matters', quote: { text: 'A single uncorrected error can become a permanent mutation.', attribution: 'Dr. Vasquez' }, speakerNotes: 'Motivates proofreading.' },
      { id: 's-5', layout: 'timeline', title: 'A Landmark Experiment', timeline: [{ label: '1958', description: 'Meselson–Stahl density-gradient experiment' }, { label: 'Result', description: 'Confirmed semi-conservative replication' }], speakerNotes: 'Historical anchor.' },
    ],
  };
}

// ————————————————————————————————————————————————————————————————
//  Achievements catalog + gamification
// ————————————————————————————————————————————————————————————————

const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-lecture', name: 'First Class', description: 'Record your very first lecture.', icon: 'mic', xp: 50, tier: 'bronze' },
  { id: 'note-taker', name: 'Note Taker', description: 'Generate your first set of study notes.', icon: 'notebook-pen', xp: 40, tier: 'bronze' },
  { id: 'streak-3', name: 'Warming Up', description: 'Study 3 days in a row.', icon: 'flame', xp: 60, tier: 'bronze' },
  { id: 'streak-7', name: 'On Fire', description: 'Keep a 7-day study streak.', icon: 'flame', xp: 120, tier: 'silver' },
  { id: 'quiz-ace', name: 'Perfect Score', description: 'Ace a quiz with 90% or higher.', icon: 'target', xp: 100, tier: 'silver' },
  { id: 'card-100', name: 'Card Shark', description: 'Review 100 flashcards.', icon: 'layers', xp: 150, tier: 'silver' },
  { id: 'curious-mind', name: 'Curious Mind', description: 'Ask your lectures 10 questions.', icon: 'sparkles', xp: 90, tier: 'silver' },
  { id: 'scholar', name: 'Scholar', description: 'Reach level 5.', icon: 'graduation-cap', xp: 250, tier: 'gold' },
  { id: 'exam-ready', name: 'Exam Ready', description: 'Generate an exam-prep plan for a course.', icon: 'clipboard-check', xp: 130, tier: 'gold' },
];

function buildGamification(): GamificationState {
  // A brand-new user hasn't studied yet — start honest. Progress only appears
  // as the student actually records, reviews, and studies (which the mock
  // credits live via bumpGamification). This mirrors the real app's first run.
  return {
    xp: 0,
    level: 1,
    streak: { current: 0, best: 0, lastStudyDay: '' },
    unlocked: [],
    studyMinutes: 0,
    dailyMinutes: {},
    updatedAt: NOW,
  };
}

// ————————————————————————————————————————————————————————————————
//  Store
// ————————————————————————————————————————————————————————————————

interface MockStore {
  courses: Map<string, Course>;
  lectures: Map<string, Lecture>;
  transcripts: Map<string, Transcript>;
  analyses: Map<string, LectureAnalysis>;
  materials: Map<string, StudyMaterial>;
  decks: Map<string, SlideDeck>;
  attempts: QuizAttempt[];
  examPrep: Map<string, ExamPrepPlan>;
  gamification: GamificationState;
  settings: AppSettings;
}

/**
 * When true, the mock starts as a pristine, never-used app (no classes, no
 * lectures, zero progress) — the real out-of-the-box experience. Enabled for
 * the standalone web demo via VITE_SB_EMPTY; unit tests keep the seeded data.
 */
const START_EMPTY =
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SB_EMPTY === '1';

function emptyStore(): MockStore {
  return {
    courses: new Map(),
    lectures: new Map(),
    transcripts: new Map(),
    analyses: new Map(),
    materials: new Map(),
    decks: new Map(),
    attempts: [],
    examPrep: new Map(),
    gamification: buildGamification(),
    settings: { ...DEFAULT_SETTINGS, onboardingComplete: true, aiProvider: 'mock' },
  };
}

function buildStore(): MockStore {
  if (START_EMPTY) return emptyStore();
  const courses = new Map<string, Course>([
    ['course-bio', { id: 'course-bio', name: 'Biology', instructor: 'Dr. Elena Vasquez', semester: 'Fall 2026', color: '#7c3aed', icon: 'dna', description: 'Molecular and cellular foundations of life.', examDates: [NOW + 12 * DAY], archived: false, createdAt: NOW - 40 * DAY, updatedAt: NOW - 2 * DAY }],
    ['course-hist', { id: 'course-hist', name: 'European History', instructor: 'Prof. Marcus Reed', semester: 'Fall 2026', color: '#d97706', icon: 'landmark', description: 'Revolutions and the making of the modern world.', examDates: [NOW + 26 * DAY], archived: false, createdAt: NOW - 38 * DAY, updatedAt: NOW - 5 * DAY }],
  ]);

  const lectures = new Map<string, Lecture>([
    ['lec-bio-1', { id: 'lec-bio-1', courseId: 'course-bio', title: 'DNA Replication', number: 3, status: 'ready', recordedAt: NOW - 2 * DAY, durationMs: 150_000, topics: ['Semi-conservative replication', 'Replication fork', 'Okazaki fragments'], tags: ['genetics', 'exam-2'], createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY }],
    ['lec-bio-2', { id: 'lec-bio-2', courseId: 'course-bio', title: 'Cell Division: Mitosis & Meiosis', number: 4, status: 'ready', recordedAt: NOW - 9 * DAY, durationMs: 64_000, topics: ['Mitosis', 'Meiosis', 'Crossing over'], tags: ['genetics'], createdAt: NOW - 9 * DAY, updatedAt: NOW - 9 * DAY }],
    ['lec-hist-1', { id: 'lec-hist-1', courseId: 'course-hist', title: 'The French Revolution', number: 2, status: 'ready', recordedAt: NOW - 5 * DAY, durationMs: 68_000, topics: ['Three Estates', 'Bastille', 'National Assembly'], tags: ['revolution', 'exam-1'], createdAt: NOW - 5 * DAY, updatedAt: NOW - 5 * DAY }],
  ]);

  const transcripts = new Map<string, Transcript>([
    ['lec-bio-1', buildTranscript('lec-bio-1', bioSegments)],
    ['lec-bio-2', buildTranscript('lec-bio-2', bioSegments2)],
    ['lec-hist-1', buildTranscript('lec-hist-1', histSegments)],
  ]);

  const analyses = new Map<string, LectureAnalysis>([
    ['lec-bio-1', bioAnalysis],
    ['lec-bio-2', bioAnalysis2],
    ['lec-hist-1', histAnalysis],
  ]);

  const materials = new Map<string, StudyMaterial>();
  for (const m of [notesMaterial(), flashcardsMaterial(), mcqMaterial()]) materials.set(m.id, m as StudyMaterial);

  const decks = new Map<string, SlideDeck>([['deck-bio-1', bioSlideDeck()]]);

  return {
    courses,
    lectures,
    transcripts,
    analyses,
    materials,
    decks,
    attempts: [],
    examPrep: new Map(),
    gamification: buildGamification(),
    settings: { ...DEFAULT_SETTINGS, onboardingComplete: true, aiProvider: 'mock' },
  };
}

// ————————————————————————————————————————————————————————————————
//  Content generators
// ————————————————————————————————————————————————————————————————

const PROVIDERS: ProviderDescriptor[] = [
  { id: 'mock', kind: 'ai', name: 'Built-in Demo AI', description: 'Offline demo model that powers the sample data. No key required.', requiresApiKey: false, hasApiKey: false, available: true, models: ['demo-1'] },
  { id: 'anthropic', kind: 'ai', name: 'Anthropic Claude', description: 'Highest-quality analysis and study material generation.', requiresApiKey: true, hasApiKey: false, available: false, models: ['claude-sonnet-5', 'claude-opus-4-8'] },
  { id: 'openai', kind: 'ai', name: 'OpenAI GPT', description: 'Fast, capable models for generation and Q&A.', requiresApiKey: true, hasApiKey: false, available: false, models: ['gpt-5', 'gpt-5-mini'] },
  { id: 'ollama', kind: 'ai', name: 'Ollama (Local)', description: 'Run open models entirely on your machine.', requiresApiKey: false, hasApiKey: false, available: false, models: ['llama-3.3', 'qwen-2.5'] },
  { id: 'openai-whisper', kind: 'transcription', name: 'OpenAI Whisper', description: 'Cloud speech-to-text with excellent accuracy.', requiresApiKey: true, hasApiKey: false, available: false },
  { id: 'simulated', kind: 'transcription', name: 'Simulated Transcription', description: 'Deterministic demo transcription for offline use.', requiresApiKey: false, hasApiKey: false, available: true },
  { id: 'local-hash', kind: 'embedding', name: 'Local Hashing', description: 'Lightweight on-device embeddings for search.', requiresApiKey: false, hasApiKey: false, available: true },
];

function makeMaterial(store: MockStore, lectureId: string, type: MaterialType, difficulty: Difficulty): StudyMaterial {
  const lecture = store.lectures.get(lectureId);
  const courseId = lecture?.courseId ?? 'course-bio';
  const analysis = store.analyses.get(lectureId);
  const title = `${lecture?.title ?? 'Lecture'} — ${type.replace(/-/g, ' ')}`;
  const base = { id: `mat-${type}-${newId().slice(0, 6)}`, lectureId, courseId, type, title, difficulty, generatedBy: AI_BY, createdAt: Date.now() };
  const md = `# ${lecture?.title ?? 'Lecture'}\n\n${analysis?.gist ?? 'Key ideas from this lecture.'}\n\n## Key concepts\n${(analysis?.concepts ?? []).map((c) => `- **${c.name}** — ${c.summary}`).join('\n')}\n`;
  switch (type) {
    case 'notes':
      return { ...base, content: notesMaterial().content } as StudyMaterial;
    case 'flashcards':
      return { ...base, content: { cards: (analysis?.concepts ?? []).map((c, i) => ({ id: `gc-${i}`, front: `What is ${c.name}?`, back: c.summary, conceptId: c.id, srs: srsDue(0, 0) })) } } as StudyMaterial;
    case 'quiz-mcq':
    case 'quiz-short-answer':
    case 'practice-test':
      return { ...base, content: { difficulty, questions: type === 'quiz-short-answer' ? (analysis?.concepts ?? []).map((c, i) => ({ id: `sq-${i}`, kind: 'short-answer' as const, prompt: `Explain ${c.name} in your own words.`, modelAnswer: c.summary, rubric: [c.name, 'clear explanation'], conceptId: c.id })) : mcqMaterial().content.questions } } as StudyMaterial;
    case 'vocabulary':
    case 'glossary':
      return { ...base, content: { entries: (analysis?.vocabulary ?? []).map((v) => ({ term: v.term, meaning: v.meaning })) } } as StudyMaterial;
    default:
      return { ...base, content: { markdown: md } } as StudyMaterial;
  }
}

function explanationFor(name: string, style: ExplanationStyle, attempt: number): Explanation {
  const bodies: Record<ExplanationStyle, string> = {
    simple: `**${name}** in plain terms:\n\nThink of it as the cell being careful. It copies information, checks its work, and fixes mistakes before moving on.`,
    analogy: `Imagine photocopying a rare book. You keep the original safe, make one clean copy, and a proofreader catches every typo before it ships. That is **${name}**.`,
    'step-by-step': `1. Unwind the structure.\n2. Read one side as a template.\n3. Build the matching side.\n4. Proofread and seal the result.\n\nThat sequence is the heart of **${name}**.`,
    visual: `Here is **${name}** as a diagram — follow the arrows from start to finish.`,
    example: `Worked example of **${name}**: in the Meselson–Stahl experiment, scientists tracked heavy vs. light nitrogen to literally watch the process play out.`,
  };
  return {
    conceptName: name,
    style,
    markdown: bodies[style],
    mermaid: style === 'visual' ? 'graph TD\n  A[Start] --> B[Template]\n  B --> C[New copy]\n  C --> D[Proofread]' : undefined,
    attempt,
    generatedBy: AI_BY,
  };
}

function styleForAttempt(attempt: number): ExplanationStyle {
  const order: ExplanationStyle[] = ['simple', 'analogy', 'step-by-step', 'example', 'visual'];
  return order[(attempt - 1) % order.length] ?? 'simple';
}

// ————————————————————————————————————————————————————————————————
//  Factory
// ————————————————————————————————————————————————————————————————

/** Build a fresh, isolated mock backend. Each call reseeds its own store. */
export function createMockApi(emit: EmitFn): IpcApi {
  const store = buildStore();
  let recording: RecordingStatus = { lectureId: null, state: 'idle', elapsedMs: 0, audioLevel: 0, segmentCount: 0 };
  let recTimer: ReturnType<typeof setInterval> | null = null;
  let recStart = 0;
  let liveSegIndex = 0;

  const liveScript = [
    'Alright everyone, let us get started with today’s material.',
    'The core idea I want you to take away is deceptively simple.',
    'Notice how each step builds directly on the previous one.',
    'This part trips people up every single year, so pay attention.',
    'And that connection is exactly what shows up on the exam.',
  ];

  function stopTimer() {
    if (recTimer) {
      clearInterval(recTimer);
      recTimer = null;
    }
  }

  function tickRecording(lectureId: string) {
    recTimer = setInterval(() => {
      if (recording.state !== 'recording') return;
      recording = {
        ...recording,
        elapsedMs: Date.now() - recStart,
        audioLevel: 0.25 + Math.random() * 0.5,
      };
      emit('recording:status', { ...recording });
      // Every ~2s add a transcript segment.
      if (recording.elapsedMs > (liveSegIndex + 1) * 2000 && liveSegIndex < liveScript.length * 4) {
        const text = liveScript[liveSegIndex % liveScript.length] ?? 'Continuing with the lecture.';
        const s = seg(liveSegIndex, liveSegIndex * 2000, (liveSegIndex + 1) * 2000, text);
        liveSegIndex += 1;
        recording = { ...recording, segmentCount: liveSegIndex };
        emit('transcript:segments', { lectureId, segments: [s] });
      }
    }, 500);
  }

  function bumpGamification(deltaXp: number, minutes = 0): GamificationState {
    const g = store.gamification;
    const xp = g.xp + deltaXp;
    const today = dayKey();
    const dailyMinutes = { ...g.dailyMinutes, [today]: (g.dailyMinutes[today] ?? 0) + minutes };
    store.gamification = {
      ...g,
      xp,
      level: levelForXp(xp),
      studyMinutes: g.studyMinutes + minutes,
      dailyMinutes,
      updatedAt: Date.now(),
    };
    emit('gamification:updated', clone(store.gamification));
    return store.gamification;
  }

  return {
    courses: {
      async list() {
        return clone([...store.courses.values()].filter((c) => !c.archived));
      },
      async get(id) {
        return clone(store.courses.get(id) ?? null);
      },
      async create(input: CourseInput) {
        const now = Date.now();
        const course: Course = { id: `course-${newId().slice(0, 8)}`, archived: false, createdAt: now, updatedAt: now, description: undefined, examDates: undefined, ...input };
        store.courses.set(course.id, course);
        return clone(course);
      },
      async update(id, patch) {
        const existing = store.courses.get(id);
        if (!existing) throw Object.assign(new Error('Course not found'), { code: 'NOT_FOUND' });
        const updated = { ...existing, ...patch, updatedAt: Date.now() };
        store.courses.set(id, updated);
        return clone(updated);
      },
      async remove(id) {
        store.courses.delete(id);
      },
    },

    lectures: {
      async listByCourse(courseId) {
        return clone([...store.lectures.values()].filter((l) => l.courseId === courseId).sort((a, b) => b.recordedAt - a.recordedAt));
      },
      async listRecent(limit) {
        return clone(
          [...store.lectures.values()]
            .sort((a, b) => b.recordedAt - a.recordedAt)
            .slice(0, limit)
            .map((l) => {
              const c = store.courses.get(l.courseId);
              return { ...l, courseName: c?.name ?? 'Course', courseColor: c?.color ?? '#7c3aed' };
            }),
        );
      },
      async get(id) {
        return clone(store.lectures.get(id) ?? null);
      },
      async update(id, patch) {
        const existing = store.lectures.get(id);
        if (!existing) throw Object.assign(new Error('Lecture not found'), { code: 'NOT_FOUND' });
        const updated = { ...existing, ...patch, updatedAt: Date.now() };
        store.lectures.set(id, updated);
        return clone(updated);
      },
      async remove(id) {
        store.lectures.delete(id);
      },
      async importDemo(courseId) {
        await delay(GEN_DELAY);
        const now = Date.now();
        const id = `lec-${newId().slice(0, 8)}`;
        const num = [...store.lectures.values()].filter((l) => l.courseId === courseId).length + 1;
        const lecture: Lecture = { id, courseId, title: 'Imported Demo Lecture', number: num, status: 'ready', recordedAt: now, durationMs: 150_000, topics: ['Demo topic'], tags: ['demo'], createdAt: now, updatedAt: now };
        store.lectures.set(id, lecture);
        store.transcripts.set(id, buildTranscript(id, bioSegments));
        store.analyses.set(id, { ...bioAnalysis, lectureId: id });
        emit('lecture:ready', { lectureId: id });
        return clone(lecture);
      },
    },

    recording: {
      async start(courseId, title) {
        const now = Date.now();
        const id = `lec-${newId().slice(0, 8)}`;
        const num = [...store.lectures.values()].filter((l) => l.courseId === courseId).length + 1;
        const lecture: Lecture = { id, courseId, title: title || `Lecture ${num}`, number: num, status: 'recording', recordedAt: now, durationMs: 0, topics: [], tags: [], createdAt: now, updatedAt: now };
        store.lectures.set(id, lecture);
        recStart = now;
        liveSegIndex = 0;
        recording = { lectureId: id, state: 'recording', elapsedMs: 0, audioLevel: 0, segmentCount: 0 };
        emit('recording:status', { ...recording });
        tickRecording(id);
        return { lectureId: id };
      },
      async pushAudioChunk() {
        /* discarded in the mock */
      },
      async pushAudioLevel(level) {
        recording = { ...recording, audioLevel: level };
      },
      async pause() {
        recording = { ...recording, state: 'paused' };
        emit('recording:status', { ...recording });
      },
      async resume() {
        recStart = Date.now() - recording.elapsedMs;
        recording = { ...recording, state: 'recording' };
        emit('recording:status', { ...recording });
      },
      async stop() {
        const id = recording.lectureId;
        // Capture elapsed before the idle reset below — the deferred job reads it.
        const elapsedMs = recording.elapsedMs;
        stopTimer();
        recording = { ...recording, state: 'stopping' };
        emit('recording:status', { ...recording });
        if (!id) throw Object.assign(new Error('No active recording'), { code: 'NO_RECORDING' });
        const lecture = store.lectures.get(id);
        if (lecture) {
          const updated: Lecture = { ...lecture, status: 'processing', durationMs: elapsedMs, updatedAt: Date.now() };
          store.lectures.set(id, updated);
        }
        // Kick off a short processing job, then mark ready.
        const jobId = `job-${newId().slice(0, 6)}`;
        emit('job:progress', { jobId, kind: 'analysis', progress: 0.2, message: 'Transcribing audio…', state: 'running' });
        setTimeout(() => {
          store.transcripts.set(id, buildTranscript(id, bioSegments));
          store.analyses.set(id, { ...bioAnalysis, lectureId: id });
          const lec = store.lectures.get(id);
          if (lec) store.lectures.set(id, { ...lec, status: 'ready', topics: bioAnalysis.concepts.slice(0, 3).map((c) => c.name), updatedAt: Date.now() });
          emit('job:progress', { jobId, kind: 'analysis', progress: 1, message: 'Lecture ready', state: 'succeeded' });
          emit('lecture:ready', { lectureId: id });
          bumpGamification(50, Math.round(elapsedMs / 60000) || 1);
        }, GEN_DELAY);
        recording = { lectureId: null, state: 'idle', elapsedMs: 0, audioLevel: 0, segmentCount: 0 };
        emit('recording:status', { ...recording });
        return { lectureId: id };
      },
      async getStatus() {
        return { ...recording };
      },
    },

    transcripts: {
      async get(lectureId) {
        return clone(store.transcripts.get(lectureId) ?? null);
      },
      async search(query, scope) {
        return searchAll(store, query, scope);
      },
    },

    analysis: {
      async get(lectureId) {
        return clone(store.analyses.get(lectureId) ?? null);
      },
      async run(lectureId) {
        const jobId = `job-${newId().slice(0, 6)}`;
        emit('job:progress', { jobId, kind: 'analysis', progress: 0, message: 'Analyzing lecture…', state: 'running' });
        setTimeout(() => {
          if (!store.analyses.has(lectureId)) store.analyses.set(lectureId, { ...bioAnalysis, lectureId });
          emit('job:progress', { jobId, kind: 'analysis', progress: 1, message: 'Analysis complete', state: 'succeeded' });
        }, GEN_DELAY);
        return { jobId };
      },
    },

    materials: {
      async list(lectureId) {
        return clone([...store.materials.values()].filter((m) => m.lectureId === lectureId).map(({ content, ...meta }) => meta));
      },
      async get(materialId) {
        return clone(store.materials.get(materialId) ?? null);
      },
      async generate(lectureId, type, options) {
        await delay(GEN_DELAY);
        const mat = makeMaterial(store, lectureId, type, options?.difficulty ?? store.settings.defaultDifficulty);
        store.materials.set(mat.id, mat);
        return clone(mat);
      },
      async generateKit(lectureId, difficulty) {
        const jobId = `job-${newId().slice(0, 6)}`;
        const types: MaterialType[] = ['notes', 'summary-concise', 'flashcards', 'quiz-mcq'];
        emit('job:progress', { jobId, kind: 'study-kit', progress: 0, message: 'Building your study kit…', state: 'running' });
        types.forEach((type, i) => {
          setTimeout(() => {
            const mat = makeMaterial(store, lectureId, type, difficulty ?? store.settings.defaultDifficulty);
            store.materials.set(mat.id, mat);
            const progress = (i + 1) / types.length;
            emit('job:progress', { jobId, kind: 'study-kit', progress, message: progress < 1 ? `Generating ${type.replace(/-/g, ' ')}…` : 'Study kit ready', state: progress < 1 ? 'running' : 'succeeded' });
          }, GEN_DELAY * (i + 1));
        });
        return { jobId };
      },
      async remove(materialId) {
        store.materials.delete(materialId);
      },
    },

    flashcards: {
      async due(courseId) {
        const now = Date.now();
        const out: (Flashcard & { lectureId: string; materialId: string })[] = [];
        for (const m of store.materials.values()) {
          if (m.type !== 'flashcards') continue;
          if (courseId && m.courseId !== courseId) continue;
          for (const card of (m.content as { cards: Flashcard[] }).cards) {
            if (card.srs.dueAt <= now) out.push({ ...clone(card), lectureId: m.lectureId, materialId: m.id });
          }
        }
        return out;
      },
      async review(materialId, cardId, quality) {
        const mat = store.materials.get(materialId);
        if (!mat || mat.type !== 'flashcards') throw Object.assign(new Error('Flashcards not found'), { code: 'NOT_FOUND' });
        const cards = (mat.content as { cards: Flashcard[] }).cards;
        const card = cards.find((c) => c.id === cardId);
        if (!card) throw Object.assign(new Error('Card not found'), { code: 'NOT_FOUND' });
        const srs = card.srs;
        if (quality < 3) {
          srs.reps = 0;
          srs.lapses += 1;
          srs.intervalDays = 1;
        } else {
          srs.reps += 1;
          srs.ease = Math.max(1.3, srs.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
          srs.intervalDays = srs.reps === 1 ? 1 : srs.reps === 2 ? 6 : Math.round(srs.intervalDays * srs.ease);
        }
        srs.dueAt = Date.now() + srs.intervalDays * DAY;
        bumpGamification(5, 1);
        return clone(card);
      },
    },

    quizzes: {
      async submitAttempt(attempt) {
        const correct = attempt.answers.filter((a) => a.correct).length;
        const score = attempt.answers.length ? correct / attempt.answers.length : 0;
        const missedConceptIds: string[] = [];
        const mat = store.materials.get(attempt.materialId);
        if (mat && (mat.type === 'quiz-mcq' || mat.type === 'quiz-short-answer' || mat.type === 'practice-test')) {
          const qs = (mat.content as { questions: { id: string; conceptId?: string }[] }).questions;
          for (const a of attempt.answers) {
            if (!a.correct) {
              const q = qs.find((x) => x.id === a.questionId);
              if (q?.conceptId) missedConceptIds.push(q.conceptId);
            }
          }
        }
        const full: QuizAttempt = { ...attempt, id: `attempt-${newId().slice(0, 6)}`, score, missedConceptIds };
        store.attempts.push(full);
        bumpGamification(score >= 0.9 ? 40 : 20, 3);
        return clone(full);
      },
      async attemptsForLecture(lectureId) {
        return clone(store.attempts.filter((a) => a.lectureId === lectureId));
      },
      async gradeShortAnswer({ response }) {
        await delay(GEN_DELAY);
        const words = response.trim().split(/\s+/).filter(Boolean).length;
        const score = Math.min(1, words / 25);
        return {
          score,
          feedback:
            score > 0.8
              ? 'Excellent — you hit the key points clearly and completely.'
              : score > 0.5
                ? 'Good start. You captured the main idea; add a concrete detail or example to strengthen it.'
                : 'You are on the right track, but the answer is thin. Explain the mechanism and name the key terms.',
        };
      },
    },

    explain: {
      async concept({ conceptName, attempt, style }) {
        await delay(GEN_DELAY);
        const a = attempt ?? 1;
        return explanationFor(conceptName, style ?? styleForAttempt(a), a);
      },
    },

    slides: {
      async get(lectureId) {
        return clone([...store.decks.values()].find((d) => d.lectureId === lectureId) ?? null);
      },
      async generate(lectureId) {
        await delay(GEN_DELAY);
        const existing = [...store.decks.values()].find((d) => d.lectureId === lectureId);
        if (existing) return clone(existing);
        const lecture = store.lectures.get(lectureId);
        const deck: SlideDeck = { ...bioSlideDeck(), id: `deck-${newId().slice(0, 6)}`, lectureId, courseId: lecture?.courseId ?? 'course-bio', title: lecture?.title ?? 'Lecture', createdAt: Date.now() };
        store.decks.set(deck.id, deck);
        return clone(deck);
      },
      async export(deckId, format) {
        await delay(GEN_DELAY);
        return { format, filePath: `/Users/you/Downloads/${deckId}.${format === 'notebooklm' ? 'txt' : format}` };
      },
    },

    knowledge: {
      async search(query, scope) {
        return searchAll(store, query, scope);
      },
      async ask(question, scope) {
        await delay(GEN_DELAY);
        const hits = searchAll(store, question, scope);
        if (hits.length === 0) {
          return { question, markdown: `I couldn’t find anything in your lectures about that yet. Try recording or importing a lecture on this topic.`, citations: [], noSources: true, generatedBy: AI_BY };
        }
        const top = hits.slice(0, 3);
        const markdown = `Based on your lectures, here’s what your professors covered:\n\n${top
          .map((h) => `- In **${h.lectureTitle}** (${h.courseName}), the key point was: ${h.chunk.text}`)
          .join('\n')}\n\n> The most exam-relevant idea here is **${top[0]?.lectureTitle}**. Review it before your next test.`;
        bumpGamification(5, 1);
        return {
          question,
          markdown,
          citations: top.map((h) => ({ lectureId: h.chunk.lectureId, lectureTitle: h.lectureTitle, courseName: h.courseName, atMs: h.chunk.atMs, excerpt: h.chunk.text.slice(0, 140) })),
          noSources: false,
          generatedBy: AI_BY,
        };
      },
    },

    review: {
      async examPrep(courseId) {
        await delay(GEN_DELAY);
        const plan = buildExamPrep(store, courseId);
        store.examPrep.set(courseId, plan);
        bumpGamification(60, 5);
        return clone(plan);
      },
      async latestExamPrep(courseId) {
        return clone(store.examPrep.get(courseId) ?? null);
      },
    },

    gamification: {
      async getState() {
        return clone(store.gamification);
      },
      async getAchievements() {
        return clone(ACHIEVEMENTS);
      },
      async recordEvent(event: Omit<StudyEvent, 'at'>) {
        const xpByType: Record<string, number> = { 'lecture-recorded': 50, 'notes-generated': 40, 'flashcard-reviewed': 5, 'quiz-completed': 20, 'quiz-aced': 40, 'concept-explained': 10, 'game-completed': 25, 'exam-prep-generated': 60, 'search-asked': 5 };
        return clone(bumpGamification(xpByType[event.type] ?? 10, event.minutes ?? 1));
      },
    },

    dashboard: {
      async getSummary() {
        return buildDashboard(store);
      },
    },

    settings: {
      async get() {
        return clone(store.settings);
      },
      async update(patch) {
        store.settings = { ...store.settings, ...patch };
        return clone(store.settings);
      },
    },

    providers: {
      async list() {
        return clone(PROVIDERS);
      },
      async setApiKey(providerId) {
        const p = PROVIDERS.find((x) => x.id === providerId);
        if (p) {
          p.hasApiKey = true;
          p.available = true;
        }
      },
      async clearApiKey(providerId) {
        const p = PROVIDERS.find((x) => x.id === providerId);
        if (p) {
          p.hasApiKey = false;
          p.available = !p.requiresApiKey;
        }
      },
      async test(providerId) {
        await delay(GEN_DELAY);
        const p = PROVIDERS.find((x) => x.id === providerId);
        if (!p) return { ok: false, message: 'Unknown provider.' };
        if (p.requiresApiKey && !p.hasApiKey) return { ok: false, message: 'Add an API key first.' };
        return { ok: true, message: `${p.name} responded successfully.` };
      },
    },

    plugins: {
      async list() {
        return clone([
          { id: 'core-anthropic', name: 'Anthropic Provider', version: '1.0.0', description: 'Claude models for analysis and generation.', author: 'StuddyBuddy', contributes: ['ai-provider'], builtIn: true, enabled: true },
          { id: 'core-whisper', name: 'Whisper Transcription', version: '1.0.0', description: 'OpenAI Whisper speech-to-text.', author: 'StuddyBuddy', contributes: ['transcription-provider'], builtIn: true, enabled: true },
          { id: 'core-pptx', name: 'PPTX Exporter', version: '1.0.0', description: 'Export slide decks to PowerPoint.', author: 'StuddyBuddy', contributes: ['exporter'], builtIn: true, enabled: true },
          { id: 'community-mindmap', name: 'Mind Map Visualizer', version: '0.4.2', description: 'Render concept maps from lecture analysis.', author: 'community', contributes: ['visualization'], builtIn: false, enabled: false },
        ]);
      },
      async setEnabled() {
        /* no-op in the mock */
      },
    },

    system: {
      async getInfo() {
        return { version: '0.1.0', dataDir: '/Users/you/Library/Application Support/StuddyBuddy', platform: typeof navigator !== 'undefined' ? navigator.platform : 'browser' };
      },
      async backup() {
        await delay(GEN_DELAY);
        return { filePath: `/Users/you/Downloads/studdybuddy-backup-${dayKey()}.zip` };
      },
      async restore() {
        await delay(GEN_DELAY);
      },
      async openPath() {
        /* no-op in the mock */
      },
      async getLogs(limit) {
        const lines = ['[info] app ready', '[info] mock backend seeded', '[info] 2 courses, 3 lectures loaded', '[info] gamification restored'];
        return lines.slice(0, limit ?? lines.length);
      },
    },
  };
}

// ————————————————————————————————————————————————————————————————
//  Cross-cutting helpers
// ————————————————————————————————————————————————————————————————

function searchAll(store: MockStore, query: string, scope?: { courseId?: string; lectureId?: string }): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const t of store.transcripts.values()) {
    const lecture = store.lectures.get(t.lectureId);
    if (!lecture) continue;
    if (scope?.courseId && lecture.courseId !== scope.courseId) continue;
    if (scope?.lectureId && lecture.id !== scope.lectureId) continue;
    const course = store.courses.get(lecture.courseId);
    for (const s of t.segments) {
      const text = s.text.toLowerCase();
      if (s.kind === 'heading') continue;
      if (!text.includes(q)) continue;
      hits.push({
        chunk: { id: `chunk-${s.id}`, courseId: lecture.courseId, lectureId: lecture.id, source: 'transcript', text: s.text, atMs: s.startMs, createdAt: lecture.recordedAt },
        score: Math.min(1, 0.5 + q.length / Math.max(text.length, 1)),
        courseName: course?.name ?? 'Course',
        lectureTitle: lecture.title,
        lectureNumber: lecture.number,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 25);
}

function buildExamPrep(store: MockStore, courseId: string): ExamPrepPlan {
  const lectures = [...store.lectures.values()].filter((l) => l.courseId === courseId);
  const concepts = lectures.flatMap((l) => (store.analyses.get(l.id)?.concepts ?? []).map((c) => ({ c, lectureId: l.id })));
  const keyConcepts = concepts
    .sort((a, b) => b.c.importance - a.c.importance)
    .slice(0, 6)
    .map(({ c, lectureId }) => ({ conceptName: c.name, lectureId, importance: c.importance }));
  return {
    id: `exam-${newId().slice(0, 6)}`,
    courseId,
    cumulativeReview: `# Course Review\n\nAcross your lectures, the recurring theme is how small, precise steps combine into a larger system. Focus your revision on the concepts your professor emphasized most and the ones students typically find hardest.\n\n## Study strategy\n1. Re-read the flagged **exam watchlist** concepts.\n2. Redo the practice quiz until you score above 90%.\n3. Explain each weak-area concept out loud in your own words.`,
    keyConcepts,
    recurringTopics: [...new Set(concepts.map(({ c }) => c.name))].slice(0, 5),
    likelyExamQuestions: [
      'Compare and contrast the two processes covered in this unit.',
      'Describe, step by step, how the system maintains accuracy.',
      'Explain why the professor emphasized this particular concept.',
    ],
    weakAreas: concepts
      .filter(({ c }) => c.difficulty >= 0.6)
      .slice(0, 3)
      .map(({ c, lectureId }) => ({ conceptId: c.id, conceptName: c.name, lectureId, weakness: c.difficulty, reason: 'Flagged as commonly misunderstood.' })),
    studyOrder: keyConcepts.slice(0, 3).map((k) => ({ title: k.conceptName, lectureId: k.lectureId, rationale: 'High importance and exam likelihood.' })),
    generatedBy: AI_BY,
    createdAt: Date.now(),
  };
}

function buildDashboard(store: MockStore): DashboardSummary {
  const courses = [...store.courses.values()].filter((c) => !c.archived);
  const g = store.gamification;
  const now = Date.now();
  const dueReviews = courses
    .map((c) => {
      let dueCards = 0;
      for (const m of store.materials.values()) {
        if (m.type === 'flashcards' && m.courseId === c.id) {
          dueCards += (m.content as { cards: Flashcard[] }).cards.filter((card) => card.srs.dueAt <= now).length;
        }
      }
      return { courseId: c.id, courseName: c.name, dueCards };
    })
    .filter((d) => d.dueCards > 0);
  const upcomingExams = courses.flatMap((c) => (c.examDates ?? []).filter((d) => d - now < 30 * DAY && d > now).map((date) => ({ courseId: c.id, courseName: c.name, date })));
  const today = dayKey();

  // Recommendations derive from what actually exists, so a brand-new (empty)
  // app shows onboarding prompts and never deep-links to missing content.
  const recommendations: DashboardSummary['recommendations'] = [];
  if (courses.length === 0) {
    recommendations.push(
      { title: 'Add your first class', detail: 'Use the ＋ next to “Your Classes” to create one — Biology, History, anything.' },
      { title: 'Record your first lecture', detail: 'Tap Record up top to capture a class live and get an instant transcript.' },
      { title: 'Everything stays on your device', detail: 'Your lectures, notes, and progress are stored locally and privately.' },
    );
  } else {
    const firstReady = [...store.lectures.values()].find((l) => l.status === 'ready');
    if (firstReady) {
      recommendations.push({ title: `Study “${firstReady.title}”`, detail: 'Open its notes, flashcards, quiz, and slides.', courseId: firstReady.courseId, lectureId: firstReady.id });
    }
    const examCourse = courses.find((c) => (c.examDates ?? []).some((d) => d > now));
    if (examCourse) {
      recommendations.push({ title: `Prep for ${examCourse.name}`, detail: 'Generate a cumulative exam-prep plan to see what to study first.', courseId: examCourse.id });
    }
    recommendations.push({ title: 'Start a study streak', detail: 'Study any lecture today to begin your streak — consistency is where it clicks.' });
  }

  return {
    courses: clone(courses),
    recentLectures: clone(
      [...store.lectures.values()]
        .sort((a, b) => b.recordedAt - a.recordedAt)
        .slice(0, 5)
        .map((l) => {
          const c = store.courses.get(l.courseId);
          return { ...l, courseName: c?.name ?? 'Course', courseColor: c?.color ?? '#7c3aed' };
        }),
    ),
    dueReviews,
    upcomingExams,
    studyStreak: g.streak.current,
    xp: g.xp,
    level: g.level,
    studyMinutesToday: g.dailyMinutes[today] ?? 0,
    studyMinutesWeek: Object.entries(g.dailyMinutes).reduce((sum, [, m]) => sum + m, 0),
    recommendations,
  };
}

export { ACHIEVEMENTS as MOCK_ACHIEVEMENTS };
