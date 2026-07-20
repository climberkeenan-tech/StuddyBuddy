import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { Flashcard } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useToast, useToastStore } from '@renderer/components/toast';
import { Badge, Button, GlassPanel, Progress } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { springSoft, prefersReducedMotion } from '@renderer/lib/motion';

/** A due card as returned by `api.flashcards.due` (carries its material id). */
export type DueCard = Flashcard & { lectureId: string; materialId: string };

/**
 * The four SM-2 review grades a student can give a flashcard, mapped to the
 * quality score (0-5) the backend's spaced-repetition scheduler expects.
 */
const GRADES = [
  {
    quality: 1,
    label: 'Again',
    hint: 'Forgot it',
    className:
      'border-rose/40 text-rose hover:bg-rose/10 focus-visible:ring-rose/50',
    key: '1',
  },
  {
    quality: 3,
    label: 'Hard',
    hint: 'Struggled',
    className:
      'border-amber/40 text-amber hover:bg-amber/10 focus-visible:ring-amber/50',
    key: '2',
  },
  {
    quality: 4,
    label: 'Good',
    hint: 'Got it',
    className:
      'border-sky/40 text-sky hover:bg-sky/10 focus-visible:ring-sky/50',
    key: '3',
  },
  {
    quality: 5,
    label: 'Easy',
    hint: 'Too easy',
    className:
      'border-success/40 text-success hover:bg-success/10 focus-visible:ring-success/50',
    key: '4',
  },
] as const;

export interface FlashcardReviewerProps {
  /** Snapshot of due cards captured when the session started. */
  cards: DueCard[];
  /** Called when the student finishes or exits the session. */
  onDone: () => void;
}

/**
 * Inline spaced-repetition review session. Flip a card to reveal the answer,
 * grade your recall (Again / Hard / Good / Easy), and advance through every due
 * card. Each grade is persisted via `api.flashcards.review`; the run ends with a
 * celebratory summary. Keyboard: Space/Enter flips, 1-4 grade a flipped card.
 */
export function FlashcardReviewer({ cards, onDone }: FlashcardReviewerProps) {
  const toast = useToast();
  const celebrate = useToastStore((s) => s.celebrate);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);

  const total = cards.length;
  const current = cards[index];

  const grade = useCallback(
    async (quality: number) => {
      if (!current || saving) return;
      setSaving(true);
      try {
        await api.flashcards.review(current.materialId, current.id, quality);
        setReviewedCount((c) => c + 1);
        if (index + 1 >= total) {
          setFinished(true);
        } else {
          setIndex((i) => i + 1);
          setFlipped(false);
        }
      } catch (e) {
        toast.error('Could not save your review', {
          description: (e as Error).message,
        });
      } finally {
        setSaving(false);
      }
    },
    [current, saving, index, total, toast],
  );

  // Celebrate once, when the session completes.
  useEffect(() => {
    if (!finished) return;
    celebrate({
      achievementId: 'review-session',
      name: `Reviewed ${reviewedCount} card${reviewedCount === 1 ? '' : 's'}`,
      icon: 'layers',
      xp: reviewedCount * 5,
      tier: 'silver',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // Keyboard shortcuts for a fast, mouse-free review flow.
  useEffect(() => {
    if (finished) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (flipped) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) {
          e.preventDefault();
          void grade(g.quality);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flipped, finished, grade]);

  const progress = useMemo(
    () => (total === 0 ? 1 : reviewedCount / total),
    [reviewedCount, total],
  );
  const reduce = prefersReducedMotion();

  if (finished) {
    return (
      <GlassPanel
        padding="lg"
        className="flex flex-col items-center gap-4 text-center"
        role="status"
      >
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springSoft}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-white shadow-glow"
        >
          <Trophy size={30} />
        </motion.span>
        <div className="space-y-1">
          <h3 className="font-display text-xl font-semibold text-t1">
            Session complete!
          </h3>
          <p className="text-sm text-t2">
            You reviewed{' '}
            <span className="font-semibold text-t1">{reviewedCount}</span>{' '}
            card{reviewedCount === 1 ? '' : 's'} and earned{' '}
            <span className="font-semibold text-accent">
              +{reviewedCount * 5} XP
            </span>
            . Spaced repetition is doing its quiet magic.
          </p>
        </div>
        <Button leftIcon={<Check size={16} />} onClick={onDone}>
          Done
        </Button>
      </GlassPanel>
    );
  }

  if (!current) {
    return null;
  }

  return (
    <GlassPanel padding="lg" className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-t2">
          <Sparkles size={15} className="text-accent" />
          <span>
            Card <span className="font-semibold text-t1">{index + 1}</span> of{' '}
            {total}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDone}
          aria-label="End review session"
        >
          End session
        </Button>
      </div>

      <Progress
        value={progress}
        size="sm"
        aria-label={`${reviewedCount} of ${total} cards reviewed`}
      />

      <div className="relative">
        <AnimatePresence mode="wait" initial={false}>
          <motion.button
            key={current.id + (flipped ? '-back' : '-front')}
            type="button"
            onClick={() => !flipped && setFlipped(true)}
            initial={reduce ? false : { opacity: 0, rotateX: -8, y: 8 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, rotateX: 8, y: -8 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'flex min-h-[190px] w-full flex-col items-center justify-center gap-3 rounded-panel border border-stroke bg-surface/70 px-6 py-8 text-center transition-colors',
              !flipped &&
                'cursor-pointer hover:border-stroke-strong hover:bg-surface',
            )}
            aria-live="polite"
          >
            <Badge variant={flipped ? 'success' : 'primary'} solid>
              {flipped ? 'Answer' : 'Question'}
            </Badge>
            <p className="max-w-prose text-balance font-display text-lg font-medium text-t1">
              {flipped ? current.back : current.front}
            </p>
            {!flipped && current.hint && (
              <p className="text-xs text-t3">Hint: {current.hint}</p>
            )}
            {!flipped && (
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-t3">
                <RotateCcw size={12} /> Tap or press Space to flip
              </span>
            )}
          </motion.button>
        </AnimatePresence>
      </div>

      {flipped ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map((g) => (
            <button
              key={g.quality}
              type="button"
              disabled={saving}
              onClick={() => void grade(g.quality)}
              className={cn(
                'focus-ring flex flex-col items-center gap-0.5 rounded-xl border bg-surface/40 px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                g.className,
              )}
            >
              <span className="flex items-center gap-1.5">
                {g.label}
                <kbd className="rounded bg-overlay px-1 text-[10px] text-t3">
                  {g.key}
                </kbd>
              </span>
              <span className="text-[11px] font-normal text-t3">{g.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <Button fullWidth onClick={() => setFlipped(true)}>
          Show answer
        </Button>
      )}
    </GlassPanel>
  );
}
