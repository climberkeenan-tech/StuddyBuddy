import type { PluginManifest } from '@studdybuddy/shared';
import type { PluginRegistry } from '../plugins/registry';
import type { MaterialGenerator } from './types';
import { notesGenerator } from './generators/notes';
import { summaryConciseGenerator, summaryDetailedGenerator } from './generators/summaries';
import { studyGuideGenerator } from './generators/study-guide';
import { flashcardsGenerator } from './generators/flashcards';
import {
  practiceTestGenerator,
  quizMcqGenerator,
  quizShortAnswerGenerator,
} from './generators/quizzes';
import { cheatSheetGenerator, reviewSheetGenerator } from './generators/sheets';
import { glossaryGenerator, vocabularyGenerator } from './generators/vocabulary';

/** Manifest for the bundled study-material generators. */
export const BUILTIN_MATERIALS_MANIFEST: PluginManifest = {
  id: 'builtin-materials',
  name: 'Built-in Study Materials',
  version: '1.0.0',
  description:
    'The default set of study-material generators: notes, summaries, study guides, ' +
    'flashcards, quizzes, practice tests, review and cheat sheets, vocabulary and glossary.',
  author: 'StuddyBuddy',
  contributes: ['material-generator'],
  builtIn: true,
};

/**
 * Every built-in generator, one per {@link MaterialType}. Kept as a flat list so
 * the registration loop (and tests) can iterate them uniformly.
 */
export const BUILTIN_GENERATORS: MaterialGenerator[] = [
  notesGenerator,
  summaryConciseGenerator,
  summaryDetailedGenerator,
  studyGuideGenerator,
  flashcardsGenerator,
  quizMcqGenerator,
  quizShortAnswerGenerator,
  practiceTestGenerator,
  reviewSheetGenerator,
  cheatSheetGenerator,
  vocabularyGenerator,
  glossaryGenerator,
];

/**
 * Register the built-in generators into a {@link PluginRegistry} under the
 * `material-generator` extension point, each keyed by its material type. Uses
 * the exact same registration path a third-party generator plugin would.
 */
export function registerBuiltinGenerators(registry: PluginRegistry): void {
  registry.register(BUILTIN_MATERIALS_MANIFEST, (ctx) => {
    for (const generator of BUILTIN_GENERATORS) {
      ctx.contribute('material-generator', generator.type, generator);
    }
  });
}
