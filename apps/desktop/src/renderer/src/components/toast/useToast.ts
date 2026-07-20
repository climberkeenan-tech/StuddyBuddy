import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useToastStore, type ToastAction } from './toast-store';

interface ToastOptions {
  description?: ReactNode;
  action?: ToastAction;
  duration?: number;
}

/**
 * Ergonomic toast helper. Returns stable `success`/`error`/`info` methods plus
 * `dismiss`. For failed API calls, `error(err.message)` is the norm.
 *
 * @example
 * const toast = useToast();
 * try { await api.courses.remove(id); toast.success('Course deleted'); }
 * catch (e) { toast.error('Could not delete course', { description: (e as Error).message }); }
 */
export function useToast() {
  const push = useToastStore((s) => s.push);
  const dismiss = useToastStore((s) => s.dismiss);
  return useMemo(
    () => ({
      success: (title: string, opts?: ToastOptions) => push({ variant: 'success', title, ...opts }),
      error: (title: string, opts?: ToastOptions) => push({ variant: 'error', title, ...opts }),
      info: (title: string, opts?: ToastOptions) => push({ variant: 'info', title, ...opts }),
      dismiss,
    }),
    [push, dismiss],
  );
}
