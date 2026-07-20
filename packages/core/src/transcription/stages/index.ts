/**
 * Transcript post-processing stages. Cheap deterministic ones (headings,
 * questions) also run live on each update; the punctuation stage and the
 * structural paragraph/pause pass run once when recording stops.
 */
export { runStages } from './run-stages';
export {
  paragraphsAndPauses,
  PAUSE_GAP_MS,
  PARAGRAPH_GAP_MS,
  MAX_SENTENCES_PER_PARAGRAPH,
} from './paragraphs';
export { headingsStage, cleanHeadingTitle } from './headings';
export { questionsStage } from './questions';
export { punctuationStage, type PunctuationAI } from './punctuation';
