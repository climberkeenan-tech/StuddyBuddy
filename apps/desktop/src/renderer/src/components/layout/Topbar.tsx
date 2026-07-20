import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Search, Sun } from 'lucide-react';
import { formatOffset } from '@renderer/lib/format';
import { usePageTitle } from '@renderer/lib/hooks';
import { useAppStore } from '@renderer/stores/app-store';
import { useRecordingStore } from '@renderer/stores/recording-store';
import { IconButton, Kbd } from '@renderer/components/ui';

/** The live "recording in progress" pill; click to jump to the record page. */
function RecordingPill() {
  const navigate = useNavigate();
  const status = useRecordingStore((s) => s.status);
  const paused = status.state === 'paused';
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      onClick={() => navigate('/record')}
      className="focus-ring flex items-center gap-2 rounded-full border border-rose/30 bg-rose/10 px-3 py-1.5 text-sm font-semibold text-rose transition-colors hover:bg-rose/15"
    >
      <span className={paused ? 'h-2 w-2 rounded-full bg-rose' : 'h-2 w-2 animate-pulse-dot rounded-full bg-rose'} />
      {paused ? 'Paused' : 'Recording'}
      <span className="tabular-nums font-mono text-xs text-rose/80">{formatOffset(status.elapsedMs)}</span>
    </motion.button>
  );
}

/** Theme toggle with a cross-fading sun/moon glyph. */
function ThemeToggle() {
  const theme = useAppStore((s) => s.settings.theme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  return (
    <IconButton
      label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      variant="ghost"
      onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
      icon={
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span key="moon" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <Moon size={18} />
            </motion.span>
          ) : (
            <motion.span key="sun" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <Sun size={18} />
            </motion.span>
          )}
        </AnimatePresence>
      }
    />
  );
}

/**
 * The top application bar: the current page title/subtitle (from
 * {@link usePageTitle}), a global search launcher, a recording pill when a
 * capture is live, and the theme toggle.
 */
export function Topbar() {
  const { title, subtitle } = usePageTitle();
  const navigate = useNavigate();
  const isRecording = useRecordingStore((s) => s.isActive);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-stroke bg-panel/40 px-6 backdrop-blur-xl">
      <div className="min-w-0">
        <h2 className="truncate font-display text-base font-semibold text-t1">{title}</h2>
        {subtitle && <p className="truncate text-xs text-t3">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        <AnimatePresence>{isRecording && <RecordingPill />}</AnimatePresence>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="focus-ring group hidden items-center gap-2 rounded-xl border border-stroke bg-surface px-3 py-2 text-sm text-t3 transition-colors hover:border-primary/40 hover:text-t2 sm:flex"
        >
          <Search size={16} />
          <span>Ask your lectures…</span>
          <Kbd className="ml-2">⌘K</Kbd>
        </button>
        <IconButton label="Search" variant="ghost" className="sm:hidden" onClick={() => navigate('/search')} icon={<Search size={18} />} />
        <ThemeToggle />
      </div>
    </header>
  );
}
