import { create } from 'zustand';
import type { JobProgress } from '@studdybuddy/shared';
import { onEvent } from '@renderer/lib/api';
import { useToastStore } from '@renderer/components/toast/toast-store';

/** Friendly labels for the job kinds the backend emits. */
const KIND_LABELS: Record<string, string> = {
  'study-kit': 'Study kit',
  analysis: 'Lecture analysis',
  slides: 'Slide deck',
  'exam-prep': 'Exam prep',
};

const TOAST_KINDS = new Set(Object.keys(KIND_LABELS));

interface JobsState {
  /** Active + recently-finished jobs keyed by jobId. */
  jobs: Record<string, JobProgress>;
  /** Ingest a job:progress event (used by the subscription + tests). */
  ingest: (job: JobProgress) => void;
}

/**
 * Tracks long-running backend jobs (study-kit, analysis, slides, exam-prep) so
 * any component can show live progress. Success/failure of the notable kinds
 * raise a toast automatically. Subscribe via {@link initJobSubscriptions}.
 */
export const useJobsStore = create<JobsState>((set) => ({
  jobs: {},
  ingest: (job) => {
    set((s) => {
      const next = { ...s.jobs, [job.jobId]: job };
      // Drop terminal jobs shortly after so the map doesn't grow unbounded.
      if (job.state === 'succeeded' || job.state === 'failed') {
        setTimeout(() => {
          useJobsStore.setState((cur) => {
            const { [job.jobId]: _drop, ...rest } = cur.jobs;
            return { jobs: rest };
          });
        }, 4000);
      }
      return { jobs: next };
    });

    if (!TOAST_KINDS.has(job.kind)) return;
    const label = KIND_LABELS[job.kind] ?? 'Job';
    const toasts = useToastStore.getState();
    if (job.state === 'succeeded') {
      toasts.push({ variant: 'success', title: `${label} ready`, description: job.message });
    } else if (job.state === 'failed') {
      toasts.push({ variant: 'error', title: `${label} failed`, description: job.error?.message ?? job.message });
    }
  },
}));

/** Subscribe the jobs store to `job:progress`. Returns an unsubscribe function. */
export function initJobSubscriptions(): () => void {
  return onEvent('job:progress', (job) => useJobsStore.getState().ingest(job));
}

/** Select a single job by id (or undefined). */
export const selectJob = (jobId: string | undefined) => (s: JobsState) => (jobId ? s.jobs[jobId] : undefined);
