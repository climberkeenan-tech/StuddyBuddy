import type { TranscriptSegment } from '@studdybuddy/shared';
import type { TranscriptStage } from '../types';

/** Interrogative openings that mark a segment as a question. */
const INTERROGATIVE_OPENING =
  /^(who|what|when|where|why|how|does|do|did|is|are|can|could|would|should|will)\b/i;

/** Conversational phrasings professors use to pose a question to the room. */
const QUESTION_CUES = /\b(anyone know|can someone|can anyone|does anyone|who can|who knows)\b/i;

/** True when a speech segment reads as a question the teacher asked. */
function looksLikeQuestion(segment: TranscriptSegment): boolean {
  if (segment.kind !== 'speech') return false;
  const trimmed = segment.text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith('?')) return true;
  if (INTERROGATIVE_OPENING.test(trimmed) && trimmed.includes('?')) return true;
  return QUESTION_CUES.test(trimmed);
}

/**
 * Cheap, deterministic question detector (safe to run live on each update).
 * A speech segment that ends in "?", opens with an interrogative word and
 * contains a "?", or uses a classroom question cue ("anyone know…", "can
 * someone…") is retagged as a `question` and flagged as a teacher question.
 * Segments already tagged as headings/pauses are left alone.
 */
export function questionsStage(): TranscriptStage {
  return {
    id: 'questions',
    live: true,
    process: async (segments) =>
      segments.map((segment) =>
        looksLikeQuestion(segment)
          ? { ...segment, kind: 'question' as const, isTeacherQuestion: true }
          : segment,
      ),
  };
}
