import { create } from 'zustand';
import type { AchievementDef, AppSettings, Course, GamificationState, ThemeMode } from '@studdybuddy/shared';
import { DEFAULT_SETTINGS } from '@studdybuddy/shared';
import { api, onEvent } from '@renderer/lib/api';
import { useToastStore } from '@renderer/components/toast/toast-store';
import { initJobSubscriptions } from './jobs-store';
import { initRecordingSubscriptions } from './recording-store';

interface AppState {
  settings: AppSettings;
  settingsLoaded: boolean;
  courses: Course[];
  coursesLoaded: boolean;
  gamification: GamificationState | null;
  achievements: AchievementDef[];

  loadSettings: () => Promise<void>;
  /** Optimistically patch settings, persist, and re-apply theme; rolls back on failure. */
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshCourses: () => Promise<void>;
  refreshGamification: () => Promise<void>;
}

// ————————————————————————————————————————————————————————————————
//  Theme + reduced-motion application
// ————————————————————————————————————————————————————————————————

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true;
}

function systemPrefersReduce(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Toggle `html.dark` and `html[data-reduce-motion]` to match the settings. */
export function applyTheme(theme: ThemeMode, reduceMotion: AppSettings['reduceMotion']): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  root.classList.toggle('dark', dark);

  const reduce = reduceMotion === 'on' || (reduceMotion === 'system' && systemPrefersReduce());
  if (reduce) root.setAttribute('data-reduce-motion', '');
  else root.removeAttribute('data-reduce-motion');
}

let mediaWired = false;
/** Re-apply theme when the OS scheme/motion preference changes (system modes). */
function wireMediaListeners(getState: () => AppState): void {
  if (mediaWired || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  mediaWired = true;
  const reapply = () => {
    const { settings } = getState();
    applyTheme(settings.theme, settings.reduceMotion);
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', reapply);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', reapply);
}

// ————————————————————————————————————————————————————————————————
//  Store
// ————————————————————————————————————————————————————————————————

/**
 * The central app store: user settings (with theme application), the course
 * list, gamification snapshot, and the achievement catalog. Call
 * {@link initAppSubscriptions} once at startup to load data and wire push events.
 */
export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  courses: [],
  coursesLoaded: false,
  gamification: null,
  achievements: [],

  loadSettings: async () => {
    try {
      const settings = await api.settings.get();
      set({ settings, settingsLoaded: true });
      applyTheme(settings.theme, settings.reduceMotion);
      wireMediaListeners(get);
    } catch {
      set({ settingsLoaded: true });
      applyTheme(DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.reduceMotion);
    }
  },

  updateSettings: async (patch) => {
    const previous = get().settings;
    const optimistic = { ...previous, ...patch };
    set({ settings: optimistic });
    applyTheme(optimistic.theme, optimistic.reduceMotion);
    try {
      const saved = await api.settings.update(patch);
      set({ settings: saved });
      applyTheme(saved.theme, saved.reduceMotion);
    } catch (err) {
      set({ settings: previous });
      applyTheme(previous.theme, previous.reduceMotion);
      useToastStore.getState().push({ variant: 'error', title: 'Could not save settings', description: err instanceof Error ? err.message : undefined });
    }
  },

  refreshCourses: async () => {
    try {
      const courses = await api.courses.list();
      set({ courses, coursesLoaded: true });
    } catch {
      set({ coursesLoaded: true });
    }
  },

  refreshGamification: async () => {
    try {
      const [gamification, achievements] = await Promise.all([api.gamification.getState(), api.gamification.getAchievements()]);
      set({ gamification, achievements });
    } catch {
      /* keep previous snapshot */
    }
  },
}));

/**
 * Bootstrap the renderer: load settings/courses/gamification and subscribe to
 * every app-level push event (gamification updates, achievement unlocks, error
 * toasts, job progress, recording status). Returns a teardown function that
 * removes all subscriptions.
 */
export function initAppSubscriptions(): () => void {
  const store = useAppStore.getState();
  void store.loadSettings();
  void store.refreshCourses();
  void store.refreshGamification();

  const unsubs: Array<() => void> = [];

  unsubs.push(
    onEvent('gamification:updated', (state) => {
      useAppStore.setState({ gamification: state });
    }),
  );

  unsubs.push(
    onEvent('achievement:unlocked', ({ achievementId, name, icon, xp }) => {
      const tier = useAppStore.getState().achievements.find((a) => a.id === achievementId)?.tier ?? 'gold';
      useToastStore.getState().celebrate({ achievementId, name, icon, xp, tier });
      void useAppStore.getState().refreshGamification();
    }),
  );

  unsubs.push(
    onEvent('app:error', (error) => {
      useToastStore.getState().push({ variant: 'error', title: error.message || 'Something went wrong', description: error.code });
    }),
  );

  unsubs.push(initJobSubscriptions());
  unsubs.push(initRecordingSubscriptions());

  return () => {
    for (const u of unsubs) u();
  };
}
