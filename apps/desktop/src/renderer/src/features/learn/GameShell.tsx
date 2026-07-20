import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Trophy } from 'lucide-react';
import { Badge, Button, ProgressRing } from '@renderer/components/ui';
import { fadeSlideUp, scaleIn, staggerChildren } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { grade } from './lib';

/** A single live metric shown in the game's status bar (timer, streak, moves…). */
export interface GameStat {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  emphasis?: boolean;
}

export interface GameStatusBarProps {
  /** 0..1 progress through the round. */
  progress: number;
  stats: GameStat[];
}

/** Sticky metrics row shown at the top of every active game. */
export function GameStatusBar({ progress, stats }: GameStatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProgressRing value={progress} size={40} thickness={4} aria-label="Round progress">
        <span className="text-[10px] font-semibold text-t2">{Math.round(progress * 100)}%</span>
      </ProgressRing>
      <div className="flex flex-1 flex-wrap gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className={cn(
              'flex items-center gap-2 rounded-xl border border-stroke bg-surface px-3 py-1.5',
              s.emphasis && 'border-primary/40 bg-gradient-primary-soft',
            )}
          >
            {s.icon && <span className="text-t3">{s.icon}</span>}
            <span className="text-xs text-t3">{s.label}</span>
            <span className={cn('font-display text-sm font-semibold tabular-nums text-t1', s.emphasis && 'text-primary')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface GameResultProps {
  /** 0..100 headline percentage. */
  scorePct: number;
  /** Big headline, e.g. "6 / 6 matched". */
  headline: string;
  stats: GameStat[];
  onReplay: () => void;
  onDone: () => void;
  /** XP awarded, shown in the summary. */
  xp?: number;
}

/**
 * Celebratory results screen shared by all games: a gradient score ring, a
 * grade label, per-game stats, and replay / done actions.
 */
export function GameResult({ scorePct, headline, stats, onReplay, onDone, xp }: GameResultProps) {
  const g = grade(scorePct);
  return (
    <motion.div
      variants={staggerChildren}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center gap-6 py-4 text-center"
    >
      <motion.div variants={scaleIn} className="relative">
        <ProgressRing value={scorePct / 100} size={132} thickness={9} aria-label={`Score ${scorePct}%`}>
          <div className="flex flex-col items-center">
            <span className="font-display text-3xl font-bold text-gradient tabular-nums">{scorePct}%</span>
            <span className="text-[11px] text-t3">score</span>
          </div>
        </ProgressRing>
      </motion.div>

      <motion.div variants={fadeSlideUp} className="space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Trophy size={18} className="text-gold" />
          <h3 className="font-display text-xl font-semibold text-t1">{g.label}</h3>
        </div>
        <p className="text-sm text-t2">{headline}</p>
        {xp !== undefined && (
          <Badge variant="primary" solid className="mt-1">
            +{xp} XP earned
          </Badge>
        )}
      </motion.div>

      {stats.length > 0 && (
        <motion.div variants={fadeSlideUp} className="grid w-full grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-panel border border-stroke bg-surface px-3 py-3">
              <p className="font-display text-lg font-semibold tabular-nums text-t1">{s.value}</p>
              <p className="text-xs text-t3">{s.label}</p>
            </div>
          ))}
        </motion.div>
      )}

      <motion.div variants={fadeSlideUp} className="flex gap-3">
        <Button variant="secondary" leftIcon={<RotateCcw size={16} />} onClick={onReplay}>
          Play again
        </Button>
        <Button onClick={onDone}>Done</Button>
      </motion.div>
    </motion.div>
  );
}

export interface GameIntroProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onStart: () => void;
  startLabel?: string;
}

/** Friendly pre-game instructions panel with a Start button. */
export function GameIntro({ icon, title, children, onStart, startLabel = 'Start' }: GameIntroProps) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary-soft text-primary">
        {icon}
      </span>
      <div className="max-w-md space-y-2">
        <h3 className="font-display text-xl font-semibold text-t1">{title}</h3>
        <div className="text-sm leading-relaxed text-t2">{children}</div>
      </div>
      <Button size="lg" onClick={onStart}>
        {startLabel}
      </Button>
    </div>
  );
}
