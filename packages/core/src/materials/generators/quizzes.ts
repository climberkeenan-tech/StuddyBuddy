import {
  newId,
  truncate,
  type Concept,
  type Difficulty,
  type EntityId,
  type LectureAnalysis,
  type McqQuestion,
  type QuizContent,
  type QuizQuestion,
  type ShortAnswerQuestion,
} from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import {
  RawMcqQuizSchema,
  RawMixedQuizSchema,
  RawShortAnswerQuizSchema,
  type RawMcq,
  type RawMcqQuiz,
  type RawMixedQuiz,
  type RawShortAnswer,
  type RawShortAnswerQuiz,
} from '../schemas';
import {
  buildContextBlock,
  conceptById,
  conceptLimit,
  definitionForConcept,
  firstSentence,
  keyNounPhrases,
  matchConceptIdByText,
  relatedConceptNames,
  seededRng,
  seededShuffle,
  selectConcepts,
} from '../common';

/**
 * The quiz family: an MCQ generator, a short-answer generator, and a mixed
 * practice test. All three share the deterministic question builders below so
 * offline quizzes are consistent and reproducible: choice ordering is driven by
 * a PRNG seeded from the lecture id, which makes the same lecture always shuffle
 * the same way while still looking randomized.
 */

const McqQuizSchemaType = RawMcqQuizSchema as unknown as z.ZodType<RawMcqQuiz>;
const ShortQuizSchemaType = RawShortAnswerQuizSchema as unknown as z.ZodType<RawShortAnswerQuiz>;
const MixedQuizSchemaType = RawMixedQuizSchema as unknown as z.ZodType<RawMixedQuiz>;

/** Longest a single MCQ choice may be, to keep options scannable. */
const MAX_CHOICE_CHARS = 200;

/* ————————————————————————————————— generators ————————————————————————————————— */

export const quizMcqGenerator: MaterialGenerator<'quiz-mcq'> = {
  type: 'quiz-mcq',
  name: 'Multiple-Choice Quiz',
  async generate(ctx) {
    const content = ctx.aiAvailable ? await aiMcqQuiz(ctx) : heuristicMcqQuiz(ctx);
    return { title: `${ctx.lecture.title} — Quiz`, content };
  },
};

export const quizShortAnswerGenerator: MaterialGenerator<'quiz-short-answer'> = {
  type: 'quiz-short-answer',
  name: 'Short-Answer Quiz',
  async generate(ctx) {
    const content = ctx.aiAvailable ? await aiShortAnswerQuiz(ctx) : heuristicShortAnswerQuiz(ctx);
    return { title: `${ctx.lecture.title} — Short Answer`, content };
  },
};

export const practiceTestGenerator: MaterialGenerator<'practice-test'> = {
  type: 'practice-test',
  name: 'Practice Test',
  async generate(ctx) {
    const content = ctx.aiAvailable ? await aiPracticeTest(ctx) : heuristicPracticeTest(ctx);
    return { title: `${ctx.lecture.title} — Practice Test`, content };
  },
};

/* ————————————————————————————————— heuristic paths ————————————————————————————————— */

function heuristicMcqQuiz(ctx: GenerationContext): QuizContent {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const rng = seededRng(`${ctx.lecture.id}:mcq`);
  const questions: QuizQuestion[] = concepts.map((concept, index) =>
    buildMcq(analysis, concept, ctx.difficulty, rng, index),
  );
  return { questions, difficulty: ctx.difficulty };
}

function heuristicShortAnswerQuiz(ctx: GenerationContext): QuizContent {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const byId = conceptById(analysis);
  const questions: QuizQuestion[] = concepts.map((concept, index) =>
    buildShortAnswer(analysis, concept, byId, index),
  );
  return { questions, difficulty: ctx.difficulty };
}

/** Roughly 60% MCQ / 40% short-answer over an expanded concept set. */
function heuristicPracticeTest(ctx: GenerationContext): QuizContent {
  const { analysis } = ctx;
  const byId = conceptById(analysis);
  const rng = seededRng(`${ctx.lecture.id}:practice`);
  const limit = Math.min(analysis.concepts.length, conceptLimit(ctx.difficulty) + 4);
  const concepts = [...analysis.concepts]
    .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name))
    .slice(0, limit);

  const questions: QuizQuestion[] = concepts.map((concept, index) =>
    index % 5 < 3
      ? buildMcq(analysis, concept, ctx.difficulty, rng, index)
      : buildShortAnswer(analysis, concept, byId, index),
  );
  return { questions, difficulty: ctx.difficulty };
}

/* ————————————————————————————————— question builders ————————————————————————————————— */

const MCQ_STEMS: ((name: string) => string)[] = [
  (name) => `Which of the following best describes ${name}?`,
  (name) => `${name} is best defined as which of these?`,
  (name) => `Select the statement that correctly characterizes ${name}.`,
];

const SHORT_STEMS: ((name: string) => string)[] = [
  (name) => `Explain ${name} in your own words.`,
  (name) => `Describe the role of ${name} and why it matters.`,
  (name) => `Why is ${name} important in this lecture?`,
];

const GENERIC_DISTRACTORS = [
  'This statement is not accurate for the concept in question.',
  'A related but ultimately incorrect description.',
  'An unrelated process drawn from a different topic.',
  'None of the above.',
];

/** Canonical descriptive text for a concept: its definition, else its gist. */
function conceptText(analysis: LectureAnalysis, concept: Concept): string {
  const def = definitionForConcept(analysis, concept);
  const text = def?.definition ?? firstSentence(concept.summary) ?? concept.summary;
  return text.trim() || `${concept.name} as taught in this lecture.`;
}

function capChoice(text: string): string {
  return truncate(text.trim(), MAX_CHOICE_CHARS);
}

/**
 * Build one MCQ for a concept. The correct choice is the concept's own
 * description; distractors are other concepts' descriptions, ordered by
 * difficulty (hard prefers *related* concepts for subtle confusion; easy prefers
 * unrelated ones for gentle distractors), then padded with generic wrong answers
 * to guarantee four distinct choices. Choice order is shuffled with the shared
 * seeded RNG so it is deterministic per lecture.
 */
export function buildMcq(
  analysis: LectureAnalysis,
  concept: Concept,
  difficulty: Difficulty,
  rng: () => number,
  index: number,
): McqQuestion {
  const correct = capChoice(conceptText(analysis, concept));
  const relatedIds = new Set(concept.related.map((r) => r.conceptId));

  const others = analysis.concepts.filter((c) => c.id !== concept.id);
  const related = others.filter((c) => relatedIds.has(c.id));
  const unrelated = others.filter((c) => !relatedIds.has(c.id));
  const ordered =
    difficulty === 'hard'
      ? [...related, ...unrelated]
      : difficulty === 'easy'
        ? [...unrelated, ...related]
        : others;

  const candidateTexts = [
    ...ordered.map((c) => capChoice(conceptText(analysis, c))),
    ...analysis.vocabulary.map((v) => capChoice(v.meaning)),
    ...GENERIC_DISTRACTORS,
  ];

  const seen = new Set<string>([correct.toLowerCase()]);
  const distractors: string[] = [];
  for (const text of candidateTexts) {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    distractors.push(text);
    if (distractors.length === 3) break;
  }

  const choices = seededShuffle([correct, ...distractors], rng);
  const correctIndex = choices.findIndex((c) => c === correct);

  const stem = (MCQ_STEMS[index % MCQ_STEMS.length] as (name: string) => string)(concept.name);
  return {
    id: newId(),
    kind: 'mcq',
    prompt: stem,
    choices,
    correctIndex,
    explanation: `${concept.name} is best described as: ${firstSentence(correct)} This concept was covered in the lecture.`,
    conceptId: concept.id,
  };
}

/**
 * Build one short-answer question for a concept, with a model answer stitched
 * from its summary and definition, and a rubric of the key noun phrases a strong
 * answer should hit (always 2-5 items, per the schema).
 */
export function buildShortAnswer(
  analysis: LectureAnalysis,
  concept: Concept,
  byId: Map<EntityId, Concept>,
  index: number,
): ShortAnswerQuestion {
  const def = definitionForConcept(analysis, concept);
  const modelAnswer = def
    ? `${concept.summary.trim()} ${def.term} — ${def.definition}`.trim()
    : concept.summary.trim() || `${concept.name} is a key idea in this lecture.`;

  const relatedNames = relatedConceptNames(concept, byId).slice(0, 2);
  const rubric = keyNounPhrases(modelAnswer, [concept.name, ...relatedNames], 5);

  const stem = (SHORT_STEMS[index % SHORT_STEMS.length] as (name: string) => string)(concept.name);
  return {
    id: newId(),
    kind: 'short-answer',
    prompt: stem,
    modelAnswer,
    rubric,
    conceptId: concept.id,
  };
}

/* ————————————————————————————————— AI paths ————————————————————————————————— */

async function aiMcqQuiz(ctx: GenerationContext): Promise<QuizContent> {
  const raw = await ctx.generate({
    schema: McqQuizSchemaType,
    schemaName: 'RawMcqQuiz',
    system: mcqSystem(ctx),
    user: `${buildContextBlock(ctx)}\n\nWrite the multiple-choice quiz now.`,
    temperature: 0.5,
  });
  return { questions: raw.questions.map((q) => rawMcqToQuestion(q, ctx.analysis)), difficulty: ctx.difficulty };
}

async function aiShortAnswerQuiz(ctx: GenerationContext): Promise<QuizContent> {
  const raw = await ctx.generate({
    schema: ShortQuizSchemaType,
    schemaName: 'RawShortAnswerQuiz',
    system: shortAnswerSystem(ctx),
    user: `${buildContextBlock(ctx)}\n\nWrite the short-answer quiz now.`,
    temperature: 0.5,
  });
  return {
    questions: raw.questions.map((q) => rawShortToQuestion(q, ctx.analysis)),
    difficulty: ctx.difficulty,
  };
}

async function aiPracticeTest(ctx: GenerationContext): Promise<QuizContent> {
  const raw = await ctx.generate({
    schema: MixedQuizSchemaType,
    schemaName: 'RawMixedQuiz',
    system: [
      'You write a comprehensive practice test from a lecture analysis.',
      'Return JSON: { "questions": [...] } mixing about 60% multiple-choice and 40%',
      'short-answer items. Make it longer and more thorough than a single quiz.',
      'MCQ item: { prompt, choices (exactly 4, distinct), correctIndex (0-3), explanation, conceptName? }.',
      'Short-answer item: { prompt, modelAnswer, rubric (2-5 key points), conceptName? }.',
      difficultyInstructionLine(ctx),
    ].join('\n'),
    user: `${buildContextBlock(ctx)}\n\nWrite the practice test now.`,
    temperature: 0.5,
  });
  const questions: QuizQuestion[] = raw.questions.map((q) =>
    'choices' in q ? rawMcqToQuestion(q, ctx.analysis) : rawShortToQuestion(q, ctx.analysis),
  );
  return { questions, difficulty: ctx.difficulty };
}

function mcqSystem(ctx: GenerationContext): string {
  return [
    'You write a multiple-choice quiz from a lecture analysis.',
    'Return JSON: { "questions": [{ prompt, choices, correctIndex, explanation, conceptName? }] }.',
    'Every question has exactly four distinct choices and a correctIndex in 0-3.',
    'The explanation should justify the correct answer and reference the concept.',
    difficultyInstructionLine(ctx),
  ].join('\n');
}

function shortAnswerSystem(ctx: GenerationContext): string {
  return [
    'You write a short-answer quiz from a lecture analysis.',
    'Return JSON: { "questions": [{ prompt, modelAnswer, rubric, conceptName? }] }.',
    'rubric is 2-5 key points a good answer must include.',
    difficultyInstructionLine(ctx),
  ].join('\n');
}

function difficultyInstructionLine(ctx: GenerationContext): string {
  return `Target difficulty: ${ctx.difficulty}.`;
}

function rawMcqToQuestion(raw: RawMcq, analysis: LectureAnalysis): McqQuestion {
  const question: McqQuestion = {
    id: newId(),
    kind: 'mcq',
    prompt: raw.prompt,
    choices: raw.choices,
    correctIndex: raw.correctIndex,
    explanation: raw.explanation,
  };
  const conceptId = raw.conceptName
    ? matchConceptIdByText(raw.conceptName, analysis)
    : matchConceptIdByText(raw.prompt, analysis);
  if (conceptId) question.conceptId = conceptId;
  return question;
}

function rawShortToQuestion(raw: RawShortAnswer, analysis: LectureAnalysis): ShortAnswerQuestion {
  const question: ShortAnswerQuestion = {
    id: newId(),
    kind: 'short-answer',
    prompt: raw.prompt,
    modelAnswer: raw.modelAnswer,
    rubric: raw.rubric,
  };
  const conceptId = raw.conceptName
    ? matchConceptIdByText(raw.conceptName, analysis)
    : matchConceptIdByText(raw.prompt, analysis);
  if (conceptId) question.conceptId = conceptId;
  return question;
}
