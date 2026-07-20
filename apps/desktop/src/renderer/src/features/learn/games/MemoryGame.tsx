import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Layers, Sparkles, Timer } from 'lucide-react';
import { Button } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { formatOffset } from '@renderer/lib/format';
import { springSoft } from '@renderer/lib/motion';
import { useElapsed } from '../useElapsed';
import { GameIntro, GameResult, GameStatusBar } from '../GameShell';
import { shuffle, type Pair } from '../lib';
import type { GameCompletion } from '../types';

export interface MemoryGameProps {
  pairs: Pair[];
  onComplete: (c: GameCompletion) => void;
  onExit: () => void;
}

type Phase = 'intro' | 'playing' | 'done';

interface Card {
  cardId: string;
  pairId: string;
  kind: 'term' | 'def';
  text: string;
}

function buildCards(pairs: Pair[]): Card[] {
  const cards: Card[] = [];
  for (const p of pairs) {
    cards.push({ cardId: `${p.id}-t`, pairId: p.id, kind: 'term', text: p.term });
    cards.push({ cardId: `${p.id}-d`, pairId: p.id, kind: 'def', text: p.definition });
  }
  return cards;
}

/**
 * Memory Game — flip cards two at a time to find each term/definition pair.
 * Scored on efficiency (moves vs. the perfect minimum) and elapsed time.
 */
export function MemoryGame({ pairs, onComplete, onExit }: MemoryGameProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);
  const { elapsedMs, reset: resetTimer } = useElapsed(phase === 'playing');

  const total = pairs.length;
  const matchedCount = matched.size;
  const perfect = total;
  const scorePct = moves > 0 ? Math.min(100, Math.round((perfect / moves) * 100)) : 100;

  function start() {
    setPhase('playing');
    setCards(shuffle(buildCards(pairs)));
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setLocked(false);
    resetTimer();
  }

  function flip(card: Card) {
    if (locked) return;
    if (matched.has(card.pairId)) return;
    if (flipped.includes(card.cardId)) return;
    if (flipped.length === 2) return;

    const next = [...flipped, card.cardId];
    setFlipped(next);
    if (next.length !== 2) return;

    setMoves((m) => m + 1);
    const first = cards.find((c) => c.cardId === next[0]);
    const second = cards.find((c) => c.cardId === next[1]);
    if (first && second && first.pairId === second.pairId) {
      const nextMatched = new Set(matched).add(first.pairId);
      setMatched(nextMatched);
      setFlipped([]);
      if (nextMatched.size === total) finish(moves + 1);
    } else {
      setLocked(true);
      setTimeout(() => {
        setFlipped([]);
        setLocked(false);
      }, 750);
    }
  }

  function finish(finalMoves: number) {
    const pct = finalMoves > 0 ? Math.min(100, Math.round((perfect / finalMoves) * 100)) : 100;
    setPhase('done');
    onComplete({
      scorePct: pct,
      headline: `${total} pairs in ${finalMoves} moves · ${formatOffset(elapsedMs)}`,
      stats: [
        { label: 'Pairs', value: total },
        { label: 'Moves', value: finalMoves },
        { label: 'Time', value: formatOffset(elapsedMs) },
      ],
      data: { game: 'memory', scorePct: pct, moves: finalMoves },
    });
  }

  if (phase === 'intro') {
    return (
      <GameIntro icon={<Brain size={26} />} title="Memory Game" onStart={start}>
        Flip two cards at a time to find each{' '}
        <span className="font-semibold text-t1">term and its definition</span>. Match all{' '}
        {total} pairs in as few moves as you can — a sharp memory means a higher score.
      </GameIntro>
    );
  }

  if (phase === 'done') {
    return (
      <GameResult
        scorePct={scorePct}
        headline={`You cleared the board in ${moves} moves`}
        xp={25}
        stats={[
          { label: 'Pairs', value: total },
          { label: 'Moves', value: moves },
          { label: 'Time', value: formatOffset(elapsedMs) },
        ]}
        onReplay={start}
        onDone={onExit}
      />
    );
  }

  return (
    <div className="space-y-5">
      <GameStatusBar
        progress={matchedCount / total}
        stats={[
          { label: 'Pairs', value: `${matchedCount}/${total}`, icon: <Layers size={14} /> },
          { label: 'Moves', value: moves, icon: <Sparkles size={14} /> },
          { label: 'Time', value: formatOffset(elapsedMs), icon: <Timer size={14} /> },
        ]}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => {
          const isMatched = matched.has(card.pairId);
          const isUp = isMatched || flipped.includes(card.cardId);
          return (
            <button
              key={card.cardId}
              type="button"
              onClick={() => flip(card)}
              disabled={isUp || locked}
              aria-label={isUp ? card.text : 'Hidden card'}
              className="focus-ring aspect-[4/3] [perspective:900px]"
            >
              <motion.div
                animate={{ rotateY: isUp ? 180 : 0 }}
                transition={springSoft}
                className="relative h-full w-full [transform-style:preserve-3d]"
              >
                {/* Back (hidden face). */}
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-panel border border-stroke',
                    'bg-gradient-primary-soft text-primary [backface-visibility:hidden]',
                  )}
                >
                  <Sparkles size={20} />
                </div>
                {/* Front (revealed face). */}
                <div
                  className={cn(
                    'absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-panel border p-2.5 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]',
                    isMatched
                      ? 'border-success/60 bg-success/10'
                      : 'border-primary/50 bg-panel',
                  )}
                >
                  <span
                    className={cn(
                      'text-[9px] font-semibold uppercase tracking-wide',
                      card.kind === 'term' ? 'text-primary' : 'text-accent',
                    )}
                  >
                    {card.kind === 'term' ? 'Term' : 'Definition'}
                  </span>
                  <span className="text-[11px] leading-tight text-t1">{card.text}</span>
                </div>
              </motion.div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-start">
        <Button variant="ghost" onClick={onExit}>
          Quit
        </Button>
      </div>
    </div>
  );
}
