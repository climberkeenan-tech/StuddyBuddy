/**
 * Study-material generation.
 *
 * The `material-generator` extension point plus every built-in generator
 * (notes, summaries, study guide, flashcards, quizzes, practice test, review /
 * cheat sheets, vocabulary, glossary), the orchestrating {@link MaterialsService}
 * and quiz grading in {@link QuizService}. Every generator is fully functional
 * offline via deterministic heuristics and upgrades automatically when an AI
 * provider is configured.
 */
export * from './types';
export * from './schemas';
export * from './srs';
export * from './common';
export * from './generators/notes';
export * from './generators/summaries';
export * from './generators/study-guide';
export * from './generators/flashcards';
export * from './generators/quizzes';
export * from './generators/sheets';
export * from './generators/vocabulary';
export * from './materials-service';
export * from './quiz-service';
export * from './builtin-plugin';
