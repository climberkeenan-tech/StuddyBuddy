import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  ClipboardCheck,
  Flame,
  GraduationCap,
  Layers,
  Mic,
  NotebookPen,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { springSoft, prefersReducedMotion } from '@renderer/lib/motion';
import { useToastStore, type AchievementCelebration } from './toast-store';

const ICONS: Record<string, LucideIcon> = {
  mic: Mic,
  'notebook-pen': NotebookPen,
  flame: Flame,
  target: Target,
  layers: Layers,
  sparkles: Sparkles,
  'graduation-cap': GraduationCap,
  'clipboard-check': ClipboardCheck,
  award: Award,
};

const TIER_GRADIENT = {
  bronze: 'bg-gradient-bronze',
  silver: 'bg-gradient-silver',
  gold: 'bg-gradient-gold',
} as const;

/**
 * A celebratory card shown when an achievement unlocks: tier-gradient badge,
 * XP chip, spring entrance, and a burst of `.sb-particle` dots (skipped under
 * reduced motion). Auto-dismisses after ~5s. Rendered by {@link Toaster}.
 */
export function AchievementToast({ celebration }: { celebration: AchievementCelebration }) {
  const dismiss = useToastStore((s) => s.dismissCelebration);
  const Icon = ICONS[celebration.icon] ?? Award;
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const id = setTimeout(() => dismiss(celebration.id), 5000);
    return () => clearTimeout(id);
  }, [celebration.id, dismiss]);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: -24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.95 }}
      transition={springSoft}
      className="glass-panel pointer-events-auto relative flex items-center gap-4 overflow-visible bg-panel/95 px-5 py-4 shadow-glow"
    >
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
        {!reduced &&
          Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className="sb-particle" style={{ ['--i' as string]: i }} />
          ))}
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-pop', TIER_GRADIENT[celebration.tier])}>
          <Icon size={24} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-t3">Achievement unlocked</p>
        <p className="font-display text-base font-semibold text-t1">{celebration.name}</p>
      </div>
      <span className="ml-2 shrink-0 rounded-full bg-gradient-primary px-2.5 py-1 text-xs font-bold text-white shadow-soft">+{celebration.xp} XP</span>
    </motion.div>
  );
}
