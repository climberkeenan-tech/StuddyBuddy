import type { TranscriptSegment } from '@studdybuddy/shared';
import type { TranscriptStage } from '../types';

/**
 * Run post-processing stages in order, threading each stage's output into the
 * next. Stages are pure transforms over the segment list, so this is just a
 * sequential async reduce — the single place the pipeline's ordering lives.
 */
export async function runStages(
  segments: TranscriptSegment[],
  stages: TranscriptStage[],
): Promise<TranscriptSegment[]> {
  let current = segments;
  for (const stage of stages) {
    current = await stage.process(current);
  }
  return current;
}
