import { create } from 'zustand';
import type { RecordingStatus } from '@studdybuddy/shared';
import { api, onEvent } from '@renderer/lib/api';
import { useToastStore } from '@renderer/components/toast/toast-store';

const IDLE: RecordingStatus = { lectureId: null, state: 'idle', elapsedMs: 0, audioLevel: 0, segmentCount: 0 };

interface RecordingState {
  status: RecordingStatus;
  /** True when a recording is active or paused (drives the Topbar pill). */
  isActive: boolean;
  /** Start recording a course; resolves with the new lecture id. */
  begin: (courseId: string, title?: string) => Promise<string | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Stop recording; resolves with the finalized lecture id. */
  stop: () => Promise<string | null>;
  /** Apply a status update (used by the subscription + tests). */
  setStatus: (status: RecordingStatus) => void;
}

function toastError(err: unknown, fallback: string) {
  useToastStore.getState().push({ variant: 'error', title: fallback, description: err instanceof Error ? err.message : undefined });
}

/**
 * Mirrors the live recording pipeline status and wraps the recording API with
 * error toasts. The Topbar reads `isActive` + `status.elapsedMs`; the record
 * page drives `begin`/`pause`/`resume`/`stop`.
 */
export const useRecordingStore = create<RecordingState>((set) => ({
  status: IDLE,
  isActive: false,
  setStatus: (status) => set({ status, isActive: status.state === 'recording' || status.state === 'paused' }),
  begin: async (courseId, title) => {
    try {
      const { lectureId } = await api.recording.start(courseId, title);
      return lectureId;
    } catch (err) {
      toastError(err, 'Could not start recording');
      return null;
    }
  },
  pause: async () => {
    try {
      await api.recording.pause();
    } catch (err) {
      toastError(err, 'Could not pause recording');
    }
  },
  resume: async () => {
    try {
      await api.recording.resume();
    } catch (err) {
      toastError(err, 'Could not resume recording');
    }
  },
  stop: async () => {
    try {
      const { lectureId } = await api.recording.stop();
      return lectureId;
    } catch (err) {
      toastError(err, 'Could not stop recording');
      return null;
    }
  },
}));

/** Subscribe the recording store to `recording:status`. Returns an unsubscribe. */
export function initRecordingSubscriptions(): () => void {
  // Prime from the current backend status (best-effort).
  api.recording
    .getStatus()
    .then((s) => useRecordingStore.getState().setStatus(s))
    .catch(() => {});
  return onEvent('recording:status', (status) => useRecordingStore.getState().setStatus(status));
}
