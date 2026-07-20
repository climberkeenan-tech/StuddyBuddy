import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Sparkles } from 'lucide-react';
import type { Flashcard, FlashcardsContent, StudyMaterial } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { Button, Card, Progress, Skeleton, Spinner } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';

/** SM-2 grade buttons, mapped to a review quality (0–5). */
const GRADES: { label: string; quality: number; className: string }[] = [
  { label: 'Again', quality: 1, className: 'text-rose border-rose/40 hover:bg-rose/10' },
  { label: 'Hard', quality: 3, className: 'text-amber border-amber/40 hover:bg-amber/10' },
  { label: 'Good', quality: 4, className: 'text-sky border-sky/40 hover:bg-sky/10' },
  { label: 'Easy', quality: 5, className: 'text-success border-success/40 hover:bg-success/10' },
];

export interface FlashcardReviewerProps {
  materialId: string;
}

/**
 * A spaced-repetition flashcard session: tap to flip, then self-grade with the
 * SM-2 buttons. Each grade is recorded to the backend and the card is scheduled
 * for its next review, advancing to the next card until the deck is done.
 */
export function FlashcardReviewer({ materialId }: FlashcardReviewerProps) {
  const toast = useToast();
  const { data: material, loading } = useAsync<StudyMaterial | null>(
    () => api.materials.get(materialId),
    [materialId],
  );

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [grading, setGrading] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  if (loading) return <Skeleton height={280} />;
  if (!material || material.type !== 'flashcards') {
    return <p className="py-8 text-center text-sm text-t3">These flashcards couldn’t be loaded.</p>;
  }

  const cards: Flashcard[] = (material.content as FlashcardsContent).cards;
  if (cards.length === 0) {
    return <p className="py-8 text-center text-sm text-t3">This deck has no cards yet.</p>;
  }

  const done = index >= cards.length;
  const card = cards[index];

  async function grade(quality: number) {
    if (!card) return;
    setGrading(true);
    try {
      await api.flashcards.review(materialId, card.id, quality);
      setReviewed((n) => n + 1);
      setFlipped(false);
      setIndex((i) => i + 1);
    } catch (e) {
      toast.error('Could not save your review', { description: (e as Error).message });
    } finally {
      setGrading(false);
    }
  }

  function restart() {
    setIndex(0);
    setFlipped(false);
    setReviewed(0);
  }

  if (done) {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary-soft text-primary">
          <Sparkles size={26} />
        </span>
        <div>
          <h3 className="font-display text-lg font-semibold text-t1">Deck complete!</h3>
          <p className="mt-1 text-sm text-t3">
            You reviewed {reviewed} {reviewed === 1 ? 'card' : 'cards'}. Nice work keeping the streak alive.
          </p>
        </div>
        <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={restart}>
          Review again
        </Button>
      </Card>
    );
  }

  const progress = reviewed / cards.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={progress} aria-label="Flashcard progress" className="flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-t3">
          {index + 1} / {cards.length}
        </span>
      </div>

      <div className="[perspective:1600px]">
        <AnimatePresence mode="wait">
          <motion.button
            key={`${card?.id}-${flipped ? 'back' : 'front'}`}
            type="button"
            onClick={() => setFlipped((f) => !f)}
            initial={{ rotateX: 8, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: -8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'focus-ring flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-panel border p-8 text-center',
              flipped ? 'border-primary/40 bg-primary/5' : 'border-stroke bg-surface',
            )}
            aria-label={flipped ? 'Showing answer, tap to see question' : 'Showing question, tap to reveal answer'}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-t3">
              {flipped ? 'Answer' : 'Question'}
            </span>
            <p className="text-lg font-medium leading-relaxed text-t1">{flipped ? card?.back : card?.front}</p>
            {!flipped && card?.hint && <p className="text-sm text-t3">Hint: {card.hint}</p>}
            {!flipped && <span className="mt-2 text-xs text-t3">Tap to reveal</span>}
          </motion.button>
        </AnimatePresence>
      </div>

      {flipped ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map((g) => (
            <button
              key={g.label}
              type="button"
              disabled={grading}
              onClick={() => grade(g.quality)}
              className={cn(
                'focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border bg-surface text-sm font-medium transition-colors disabled:opacity-50',
                g.className,
              )}
            >
              {grading ? <Spinner size={14} /> : <Check size={15} />}
              {g.label}
            </button>
          ))}
        </div>
      ) : (
        <Button fullWidth variant="secondary" onClick={() => setFlipped(true)}>
          Show answer
        </Button>
      )}
    </div>
  );
}
