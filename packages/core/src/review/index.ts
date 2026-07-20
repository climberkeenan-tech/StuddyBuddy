/**
 * Smart Review: SM-2 spaced-repetition scheduling, flashcard review, weak-area
 * detection, and whole-course exam-prep plan generation. Fully functional
 * offline — scheduling and weak areas are pure/deterministic, and exam prep
 * falls back to specific heuristic plans when no AI provider is configured.
 */
export * from './sm2';
export * from './schemas';
export * from './flashcard-review-service';
export * from './exam-prep-service';
