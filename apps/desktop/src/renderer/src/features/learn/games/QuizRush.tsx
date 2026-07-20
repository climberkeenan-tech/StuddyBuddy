import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Flame, Sparkles, Timer, X, Zap } from 'lucide-react';
import { Button, Badge } from '@renderer/components/ui';
import { fadeSlideUp } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { useElapsed } from '../useElapsed';
import { formatOffset } from '@renderer/lib/format';
import { GameIntro, GameResult, GameStatusBar } from '../GameShell';
import type { GameCompletion } from '../types';
import type { RushQuestion } from '../lib';

export interface QuizRushProps {
  questions: RushQuestion[];
  onComplete: (c: GameCompletion) => void;
  onExit: () => void;
}

type Phase = 'intro' | 'playing' | 'done';

/**
 * Quiz Rush — rapid-fire multiple choice with a running streak and a combo
 * multiplier that rewards consecutive correct answers. Fully keyboard-driven.
 */
export function QuizRush({ questions, onComplete, onExit }: QuizRushProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [points, setPoints] = useState(0);
  const { elapsedMs, reset: resetTimer } = useElapsed(phase === 'playing');

  const total = questions.length;
  const current = questions[index];
  const answered = selected !== null;
  const scorePct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const combo = 1 + Math.min(streak, 4) * 0.5;

  function start() {
    setPhase('playing');
    setIndex(0);
    setSelected(null);
    setCorrectCount(0);
    setStreak(0);
    setBestStreak(0);
    setPoints(0);
    resetTimer();
  }

  function choose(choiceIndex: number) {
    if (answered || !current) return;
    setSelected(choiceIndex);
    const isCorrect = choiceIndex === current.correctIndex;
    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
      setPoints((p) => Math.round(p + 100 * (1 + Math.min(streak, 4) * 0.5)));
    } else {
      setStreak(0);
    }
  }

  function next() {
    if (index + 1 >= total) {
      setPhase('done');
      onComplete({
        scorePct,
        headline: `${correctCount} of ${total} correct · best streak ${bestStreak}`,
        stats: [
          { label: 'Correct', value: `${correctCount}/${total}` },
          { label: 'Best streak', value: bestStreak },
          { label: 'Points', value: points },
        ],
        data: { game: 'quiz', scorePct, points, bestStreak },
      });
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
  }

  if (phase === 'intro') {
    return (
      <GameIntro
        icon={<Zap size={26} />}
        title="Quiz Rush"
        onStart={start}
        startLabel={total > 0 ? `Start ${total} questions` : 'Start'}
      >
        Answer as fast as you can. Chain correct answers to build a{' '}
        <span className="font-semibold text-t1">streak</span> and a growing{' '}
        <span className="font-semibold text-primary">combo multiplier</span>. Pick an answer to see
        why it&apos;s right.
      </GameIntro>
    );
  }

  if (phase === 'done') {
    return (
      <GameResult
        scorePct={scorePct}
        headline={`You answered ${correctCount} of ${total} correctly`}
        xp={25}
        stats={[
          { label: 'Correct', value: `${correctCount}/${total}` },
          { label: 'Best streak', value: bestStreak },
          { label: 'Points', value: points },
        ]}
        onReplay={start}
        onDone={onExit}
      />
    );
  }

  if (!current) return null;

  return (
    <div className="space-y-5">
      <GameStatusBar
        progress={index / total}
        stats={[
          { label: 'Question', value: `${index + 1}/${total}`, icon: <Sparkles size={14} /> },
          { label: 'Streak', value: streak, icon: <Flame size={14} />, emphasis: streak >= 2 },
          { label: 'Points', value: points, icon: <Zap size={14} /> },
          { label: 'Time', value: formatOffset(elapsedMs), icon: <Timer size={14} /> },
        ]}
      />

      {streak >= 2 && (
        <div className="flex justify-center">
          <Badge variant="amber" solid leftIcon={<Flame size={13} />}>
            {combo.toFixed(1)}× combo
          </Badge>
        </div>
      )}

      <motion.div
        key={current.id}
        variants={fadeSlideUp}
        initial="hidden"
        animate="show"
        className="space-y-4"
      >
        <p className="font-display text-lg font-semibold leading-snug text-t1">{current.prompt}</p>
        <div className="grid gap-2.5">
          {current.choices.map((choice, i) => {
            const isCorrect = i === current.correctIndex;
            const isPicked = i === selected;
            const state = !answered
              ? 'idle'
              : isCorrect
                ? 'correct'
                : isPicked
                  ? 'wrong'
                  : 'muted';
            return (
              <button
                key={i}
                type="button"
                disabled={answered}
                onClick={() => choose(i)}
                aria-pressed={isPicked}
                className={cn(
                  'focus-ring flex items-center gap-3 rounded-panel border px-4 py-3 text-left text-sm transition-all',
                  state === 'idle' &&
                    'border-stroke bg-surface text-t1 hover:border-primary/50 hover:bg-panel active:scale-[0.99]',
                  state === 'correct' && 'border-success/60 bg-success/10 text-t1',
                  state === 'wrong' && 'border-rose/60 bg-rose/10 text-t1',
                  state === 'muted' && 'border-stroke bg-surface text-t3 opacity-70',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold',
                    state === 'correct' && 'border-success bg-success text-white',
                    state === 'wrong' && 'border-rose bg-rose text-white',
                    (state === 'idle' || state === 'muted') && 'border-stroke-strong text-t2',
                  )}
                >
                  {state === 'correct' ? (
                    <Check size={14} />
                  ) : state === 'wrong' ? (
                    <X size={14} />
                  ) : (
                    String.fromCharCode(65 + i)
                  )}
                </span>
                <span className="flex-1">{choice}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <motion.div
            variants={fadeSlideUp}
            initial="hidden"
            animate="show"
            className="rounded-panel border border-stroke bg-panel px-4 py-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-t3">
              {selected === current.correctIndex ? 'Correct' : 'Not quite'}
            </p>
            <p className="mt-1 text-sm text-t2">{current.explanation}</p>
          </motion.div>
        )}
      </motion.div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onExit}>
          Quit
        </Button>
        <Button onClick={next} disabled={!answered}>
          {index + 1 >= total ? 'See results' : 'Next question'}
        </Button>
      </div>
    </div>
  );
}
