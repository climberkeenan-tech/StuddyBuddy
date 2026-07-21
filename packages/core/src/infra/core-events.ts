import type {
  GamificationState,
  JobProgress,
  RecordingStatus,
  TranscriptSegment,
} from '@studdybuddy/shared';
import type { EventBus } from './event-bus';

/**
 * Domain events flowing through the in-process bus. The Electron main process
 * bridges these 1:1 onto the renderer push channels (IpcEventMap), so core
 * stays Electron-free while the UI still gets live updates.
 */
export interface CoreEvents extends Record<string, unknown> {
  'recording:status': RecordingStatus;
  'transcript:segments': { lectureId: string; segments: TranscriptSegment[]; replace?: boolean };
  'transcript:updated': { lectureId: string };
  'job:progress': JobProgress;
  'lecture:ready': { lectureId: string };
  'achievement:unlocked': { achievementId: string; name: string; icon: string; xp: number };
  'gamification:updated': GamificationState;
}

export type CoreEventBus = EventBus<CoreEvents>;
