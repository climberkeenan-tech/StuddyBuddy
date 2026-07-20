import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchScope } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useToast } from '@renderer/components/toast';

/**
 * Resolve a lecture's course and deep-link to it, optionally at a timestamp.
 *
 * Citations only carry a `lectureId`, so we fetch the lecture to learn its
 * course before routing to `/courses/:courseId/lectures/:lectureId?t=<ms>`.
 * Search hits already know their `courseId` and can skip the fetch.
 */
export function useOpenLecture(): (
  lectureId: string,
  opts?: { courseId?: string; atMs?: number },
) => Promise<void> {
  const nav = useNavigate();
  const toast = useToast();
  return async (lectureId, opts) => {
    try {
      let courseId = opts?.courseId;
      if (!courseId) {
        const lecture = await api.lectures.get(lectureId);
        if (!lecture) throw new Error('That lecture is no longer available.');
        courseId = lecture.courseId;
      }
      const query =
        opts?.atMs != null && opts.atMs > 0 ? `?t=${Math.round(opts.atMs)}` : '';
      nav(`/courses/${courseId}/lectures/${lectureId}${query}`);
    } catch (e) {
      toast.error('Could not open that lecture', { description: (e as Error).message });
    }
  };
}

/** A scope with at least one field set is "narrowed". */
export function isScoped(scope: SearchScope): boolean {
  return Boolean(scope.courseId || scope.lectureId);
}

/**
 * Split `text` into nodes with the query's word-tokens wrapped in `<mark>`.
 * Dependency-free and safe (no raw HTML). Case-insensitive, whole substrings.
 */
export function highlightExcerpt(text: string, query: string): ReactNode {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((t) => t.length >= 2),
    ),
  );
  if (terms.length === 0) return text;
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    terms.includes(part.toLowerCase()) ? (
      <mark
        key={i}
        className="rounded bg-primary/15 px-0.5 font-medium text-t1 [color-scheme:normal]"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
