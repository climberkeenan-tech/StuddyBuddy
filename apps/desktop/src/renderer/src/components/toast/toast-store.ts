import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { AchievementDef } from '@studdybuddy/shared';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: ReactNode;
  action?: ToastAction;
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed. */
  duration: number;
}

/** An achievement celebration, shown by AchievementToast rather than the list. */
export interface AchievementCelebration {
  id: string;
  achievementId: string;
  name: string;
  icon: string;
  xp: number;
  tier: AchievementDef['tier'];
}

interface ToastState {
  toasts: Toast[];
  celebrations: AchievementCelebration[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  celebrate: (c: Omit<AchievementCelebration, 'id'>) => void;
  dismissCelebration: (id: string) => void;
}

let counter = 0;
const nextId = () => `toast-${Date.now()}-${counter++}`;

/**
 * Global toast + achievement-celebration store. Prefer the {@link useToast}
 * helper in components; the store is exported for the {@link Toaster} and for
 * app-level subscriptions that fire toasts outside React.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  celebrations: [],
  push: (toast) => {
    const id = nextId();
    const duration = toast.duration ?? (toast.variant === 'error' ? 6000 : 4000);
    set((s) => ({ toasts: [...s.toasts, { ...toast, id, duration }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  celebrate: (c) => set((s) => ({ celebrations: [...s.celebrations, { ...c, id: nextId() }] })),
  dismissCelebration: (id) => set((s) => ({ celebrations: s.celebrations.filter((c) => c.id !== id) })),
}));
