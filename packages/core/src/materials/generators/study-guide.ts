import type {
  Concept,
  EntityId,
  LectureAnalysis,
  StudyGuideContent,
  StudyGuideSection,
} from '@studdybuddy/shared';
import type { z } from 'zod';
import type { GenerationContext, MaterialGenerator } from '../types';
import { StudyGuideContentSchema, type RawStudyGuideContent } from '../schemas';
import {
  buildContextBlock,
  conceptById,
  definitionForConcept,
  exampleForConcept,
  matchConceptIdByText,
  relatedConceptNames,
  selectConcepts,
} from '../common';

/**
 * A section-per-concept study guide: each section gathers a concept's summary,
 * definition, worked example and related concepts, and records the concept ids
 * it covers so the UI can cross-link to the analysis. The AI path returns
 * sections with concept *names*, which are resolved to ids here.
 */

const StudyGuideSchemaType = StudyGuideContentSchema as unknown as z.ZodType<RawStudyGuideContent>;

const STUDY_GUIDE_SYSTEM = [
  'You write a focused exam study guide from a lecture analysis.',
  'Return JSON: { "sections": [{ "title", "markdown", "conceptNames"? }] }.',
  'One section per major concept. In each section explain the concept, give its',
  'definition and a concrete example, and note how it relates to other concepts.',
  'List the concept names the section covers in conceptNames.',
].join('\n');

export const studyGuideGenerator: MaterialGenerator<'study-guide'> = {
  type: 'study-guide',
  name: 'Study Guide',
  async generate(ctx) {
    const content = ctx.aiAvailable ? await aiStudyGuide(ctx) : heuristicStudyGuide(ctx);
    return { title: `${ctx.lecture.title} — Study Guide`, content };
  },
};

async function aiStudyGuide(ctx: GenerationContext): Promise<StudyGuideContent> {
  const raw = await ctx.generate({
    schema: StudyGuideSchemaType,
    schemaName: 'StudyGuideContent',
    system: STUDY_GUIDE_SYSTEM,
    user: `${buildContextBlock(ctx)}\n\nWrite the study guide now.`,
    temperature: 0.4,
  });
  const sections: StudyGuideSection[] = raw.sections.map((s) => {
    const ids = new Set<EntityId>();
    for (const name of s.conceptNames ?? []) {
      const id = matchConceptIdByText(name, ctx.analysis);
      if (id) ids.add(id);
    }
    // Fall back to matching the section title against a concept.
    if (ids.size === 0) {
      const id = matchConceptIdByText(s.title, ctx.analysis);
      if (id) ids.add(id);
    }
    return { title: s.title, markdown: s.markdown, conceptIds: [...ids] };
  });
  return { sections };
}

function heuristicStudyGuide(ctx: GenerationContext): StudyGuideContent {
  const { analysis } = ctx;
  const concepts = selectConcepts(analysis, ctx.difficulty);
  const byId = conceptById(analysis);
  const sections: StudyGuideSection[] = concepts.map((concept) =>
    buildSection(analysis, concept, byId),
  );
  return { sections };
}

function buildSection(
  analysis: LectureAnalysis,
  concept: Concept,
  byId: Map<EntityId, Concept>,
): StudyGuideSection {
  const lines: string[] = [concept.summary.trim()];
  const conceptIds = new Set<EntityId>([concept.id]);

  const def = definitionForConcept(analysis, concept);
  if (def) lines.push('', `**Definition:** ${def.term} — ${def.definition}`);

  const example = exampleForConcept(analysis, concept);
  if (example) lines.push('', `**Example:** ${example.description}`);

  const relatedNames = relatedConceptNames(concept, byId);
  if (relatedNames.length) {
    lines.push('', `**Related:** ${relatedNames.join(', ')}`);
    for (const ref of concept.related) conceptIds.add(ref.conceptId);
  }

  return { title: concept.name, markdown: lines.join('\n'), conceptIds: [...conceptIds] };
}
