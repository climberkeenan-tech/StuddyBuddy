import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { Check, GripVertical, Puzzle, Target, Timer } from 'lucide-react';
import { Button } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { formatOffset } from '@renderer/lib/format';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { useElapsed } from '../useElapsed';
import { GameIntro, GameResult, GameStatusBar } from '../GameShell';
import { shuffle, type Pair } from '../lib';
import type { GameCompletion } from '../types';

export interface ConceptMatchProps {
  pairs: Pair[];
  onComplete: (c: GameCompletion) => void;
  onExit: () => void;
}

type Phase = 'intro' | 'playing' | 'done';

/** A draggable definition tile (also click-selectable for keyboard users). */
function DefinitionTile({
  pair,
  selected,
  onSelect,
}: {
  pair: Pair;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: pair.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      {...listeners}
      {...attributes}
      aria-pressed={selected}
      className={cn(
        'focus-ring flex w-full items-start gap-2 rounded-panel border px-3 py-3 text-left text-sm transition-all',
        'border-stroke bg-surface text-t2 hover:border-primary/50 hover:bg-panel',
        selected && 'border-primary bg-gradient-primary-soft text-t1 shadow-glow',
        isDragging && 'opacity-40',
      )}
    >
      <GripVertical size={15} className="mt-0.5 shrink-0 text-t3" aria-hidden />
      <span className="flex-1">{pair.definition}</span>
    </button>
  );
}

/** A term slot that accepts a matching definition. */
function TermSlot({
  pair,
  matchedDefinition,
  wrong,
  active,
  onClick,
}: {
  pair: Pair;
  matchedDefinition: string | null;
  wrong: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: pair.id });
  const done = matchedDefinition !== null;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      disabled={done}
      className={cn(
        'focus-ring flex w-full flex-col gap-1 rounded-panel border px-4 py-3 text-left transition-all',
        done
          ? 'border-success/50 bg-success/10'
          : 'border-dashed border-stroke-strong bg-surface hover:border-primary/60',
        (isOver || active) && !done && 'border-primary bg-gradient-primary-soft',
        wrong && 'animate-pulse border-rose bg-rose/10',
      )}
    >
      <span className="flex items-center gap-2">
        {done ? (
          <Check size={15} className="text-success" aria-hidden />
        ) : (
          <Target size={15} className="text-t3" aria-hidden />
        )}
        <span className="font-display text-sm font-semibold text-t1">{pair.term}</span>
      </span>
      {done && <span className="pl-6 text-xs text-t2">{matchedDefinition}</span>}
    </button>
  );
}

/**
 * Concept Match — pair each term with its definition by dragging a definition
 * tile onto a term (or click a tile, then click a term). Tracks time and
 * mistakes; accuracy drives the final score.
 */
export function ConceptMatch({ pairs, onComplete, onExit }: ConceptMatchProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState(0);
  const [matched, setMatched] = useState<Record<string, string>>({});
  const [mistakes, setMistakes] = useState(0);
  const [selectedDef, setSelectedDef] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [wrongTerm, setWrongTerm] = useState<string | null>(null);
  const { elapsedMs, reset: resetTimer } = useElapsed(phase === 'playing');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Fresh shuffles per round so replays feel new.
  const terms = useMemo(() => shuffle(pairs), [pairs, round]);
  const defs = useMemo(() => shuffle(pairs), [pairs, round]);
  const byId = useMemo(() => new Map(pairs.map((p) => [p.id, p])), [pairs]);

  const total = pairs.length;
  const matchedCount = Object.keys(matched).length;
  const remainingDefs = defs.filter((d) => !matched[d.id]);
  const accuracy = total + mistakes > 0 ? total / (total + mistakes) : 1;
  const scorePct = Math.round(accuracy * 100);

  function start() {
    setPhase('playing');
    setMatched({});
    setMistakes(0);
    setSelectedDef(null);
    setWrongTerm(null);
    setRound((r) => r + 1);
    resetTimer();
  }

  function attempt(defId: string, termId: string) {
    if (matched[termId]) return;
    setSelectedDef(null);
    if (defId === termId) {
      const def = byId.get(defId);
      const nextMatched = { ...matched, [termId]: def?.definition ?? '' };
      setMatched(nextMatched);
      if (Object.keys(nextMatched).length === total) finish(mistakes);
    } else {
      setMistakes((m) => m + 1);
      setWrongTerm(termId);
      setTimeout(() => setWrongTerm(null), 450);
    }
  }

  function finish(finalMistakes: number) {
    const acc = total + finalMistakes > 0 ? total / (total + finalMistakes) : 1;
    const pct = Math.round(acc * 100);
    setPhase('done');
    onComplete({
      scorePct: pct,
      headline: `${total} matched in ${formatOffset(elapsedMs)} · ${finalMistakes} mistakes`,
      stats: [
        { label: 'Matched', value: `${total}/${total}` },
        { label: 'Mistakes', value: finalMistakes },
        { label: 'Time', value: formatOffset(elapsedMs) },
      ],
      data: { game: 'match', scorePct: pct, mistakes: finalMistakes },
    });
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
    setSelectedDef(null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!e.over) return;
    attempt(String(e.active.id), String(e.over.id));
  }

  if (phase === 'intro') {
    return (
      <GameIntro icon={<Puzzle size={26} />} title="Concept Match" onStart={start}>
        Match every <span className="font-semibold text-t1">term</span> with its correct{' '}
        <span className="font-semibold text-t1">definition</span>. Drag a definition onto a term —
        or click a definition, then click its term. Fewer mistakes means a higher score.
      </GameIntro>
    );
  }

  if (phase === 'done') {
    return (
      <GameResult
        scorePct={scorePct}
        headline={`You matched all ${total} concepts`}
        xp={25}
        stats={[
          { label: 'Matched', value: `${total}/${total}` },
          { label: 'Mistakes', value: mistakes },
          { label: 'Time', value: formatOffset(elapsedMs) },
        ]}
        onReplay={start}
        onDone={onExit}
      />
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-5">
        <GameStatusBar
          progress={matchedCount / total}
          stats={[
            { label: 'Matched', value: `${matchedCount}/${total}`, icon: <Check size={14} /> },
            { label: 'Mistakes', value: mistakes, emphasis: mistakes > 0 },
            { label: 'Time', value: formatOffset(elapsedMs), icon: <Timer size={14} /> },
          ]}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-t3">Terms</p>
            <motion.div variants={staggerChildren} initial="hidden" animate="show" className="space-y-2.5">
              {terms.map((p) => (
                <motion.div key={p.id} variants={fadeSlideUp}>
                  <TermSlot
                    pair={p}
                    matchedDefinition={matched[p.id] ?? null}
                    wrong={wrongTerm === p.id}
                    active={selectedDef !== null && !matched[p.id]}
                    onClick={() => selectedDef && attempt(selectedDef, p.id)}
                  />
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-t3">Definitions</p>
            {remainingDefs.length === 0 ? (
              <p className="rounded-panel border border-dashed border-stroke px-4 py-6 text-center text-sm text-t3">
                All placed — nice!
              </p>
            ) : (
              <div className="space-y-2.5">
                {remainingDefs.map((p) => (
                  <DefinitionTile
                    key={p.id}
                    pair={p}
                    selected={selectedDef === p.id}
                    onSelect={() => setSelectedDef((cur) => (cur === p.id ? null : p.id))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onExit}>
            Quit
          </Button>
          {selectedDef && <span className="self-center text-xs text-t3">Now click its term ↖</span>}
        </div>
      </div>

      <DragOverlay>
        {dragging ? (
          <div className="max-w-xs rounded-panel border border-primary bg-panel px-3 py-3 text-sm text-t1 shadow-pop">
            {byId.get(dragging)?.definition}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
