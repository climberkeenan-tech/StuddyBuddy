import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Footprints, Heart, Skull, Sparkles, Swords, Timer, X } from 'lucide-react';
import { Button, Kbd } from '@renderer/components/ui';
import { fadeSlideUp, prefersReducedMotion } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { formatOffset } from '@renderer/lib/format';
import { useElapsed } from '../useElapsed';
import { GameIntro, GameResult, GameStatusBar } from '../GameShell';
import { shuffle, type RushQuestion } from '../lib';
import type { GameCompletion } from '../types';
import { QuestScene, type HeroFx, type MonsterFx, type ScenePopup } from './QuestScene';
import {
  ENCOUNTER_X,
  MAX_HEARTS,
  applyAnswer,
  battleOutcome,
  hasReachedMonster,
  initialBattle,
  initialHero,
  pulse,
  questScore,
  ramp,
  stepHero,
  walkProgress,
  type BattleState,
  type HeroState,
  type WalkDir,
} from './quest';

export interface MonsterQuestProps {
  questions: RushQuestion[];
  onComplete: (c: GameCompletion) => void;
  onExit: () => void;
}

type Phase = 'intro' | 'explore' | 'battle' | 'done';

const MONSTER_NAME = 'Muddlebeast';

/** Battle animation timings (ms). A hit lands at the peak of the attacker's lunge. */
const ATTACK_MS = 420;
const HURT_MS = 380;
const HIT_DELAY_MS = 200;
const POPUP_MS = 900;

interface FxTimes {
  encounter: number | null;
  heroAttack: number | null;
  heroHurt: number | null;
  monsterAttack: number | null;
  monsterHurt: number | null;
  monsterDefeated: number | null;
  heroDefeated: number | null;
  popups: { id: number; at: number; target: ScenePopup['target']; text: string }[];
}

const NO_FX: FxTimes = {
  encounter: null,
  heroAttack: null,
  heroHurt: null,
  monsterAttack: null,
  monsterHurt: null,
  monsterDefeated: null,
  heroDefeated: null,
  popups: [],
};

const now = () => performance.now();

function Hearts({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${count} of ${MAX_HEARTS} hearts`}>
      {Array.from({ length: MAX_HEARTS }, (_, i) => (
        <Heart key={i} size={13} className={i < count ? 'fill-rose text-rose' : 'text-t3'} />
      ))}
    </span>
  );
}

/**
 * Monster Quest: walk a knight through a scrolling valley to the Muddlebeast's
 * lair, then battle it with quiz questions. Each correct answer is a sword
 * strike, each wrong answer lets the monster hit back, and the hero has three
 * hearts. Scored on accuracy across every question asked.
 *
 * Movement runs on a requestAnimationFrame loop that only spins while a walk
 * key is held or a battle animation is playing, so an idle scene costs nothing.
 */
export function MonsterQuest({ questions, onComplete, onExit }: MonsterQuestProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [hero, setHero] = useState<HeroState>(initialHero);
  const [clock, setClock] = useState(now);
  const [battle, setBattle] = useState<BattleState>(() => initialBattle(questions.length));
  const [order, setOrder] = useState<RushQuestion[]>([]);
  const [turn, setTurn] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [fx, setFx] = useState<FxTimes>(NO_FX);
  const { elapsedMs, reset: resetTimer } = useElapsed(phase === 'explore' || phase === 'battle');

  const phaseRef = useRef<Phase>(phase);
  const held = useRef({ left: false, right: false });
  const frame = useRef<number | null>(null);
  const animUntil = useRef(0);
  const calm = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const runLoop = useCallback(() => {
    if (frame.current !== null) return;
    let last = now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      const { left, right } = held.current;
      const dir: WalkDir = phaseRef.current !== 'explore' || left === right ? 0 : right ? 1 : -1;
      setHero((h) => stepHero(h, dir, dt));
      setClock(t);
      frame.current = dir !== 0 || t < animUntil.current ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  /** Keep the clock running for `ms` (or jump straight to the end under reduced motion). */
  const animate = useCallback(
    (ms: number) => {
      animUntil.current = Math.max(animUntil.current, now() + ms);
      if (calm) setClock(animUntil.current);
      else runLoop();
    },
    [calm, runLoop],
  );

  const hold = useCallback(
    (side: 'left' | 'right', down: boolean) => {
      held.current[side] = down;
      if (down) runLoop();
    },
    [runLoop],
  );

  // Arrow keys / A-D walk while exploring. Releasing focus drops held keys so
  // the hero never walks on by itself.
  useEffect(() => {
    if (phase !== 'explore') return;
    const sideFor = (key: string) =>
      key === 'ArrowLeft' || key === 'a' || key === 'A'
        ? 'left'
        : key === 'ArrowRight' || key === 'd' || key === 'D'
          ? 'right'
          : null;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const side = sideFor(e.key);
      if (!side) return;
      e.preventDefault();
      hold(side, down);
    };
    const onDown = onKey(true);
    const onUp = onKey(false);
    const release = () => {
      held.current = { left: false, right: false };
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [phase, hold]);

  // Reaching the lair starts the battle.
  useEffect(() => {
    if (phase !== 'explore' || !hasReachedMonster(hero.x)) return;
    held.current = { left: false, right: false };
    setPhase('battle');
    setFx({ ...NO_FX, encounter: now() });
    animate(900);
  }, [phase, hero.x, animate]);

  const outcome = battleOutcome(battle);
  const current = order.length > 0 ? order[turn % order.length] : undefined;
  const answered = selected !== null;

  function start() {
    held.current = { left: false, right: false };
    animUntil.current = 0;
    setHero(initialHero());
    setBattle(initialBattle(questions.length));
    setOrder(shuffle(questions));
    setTurn(0);
    setSelected(null);
    setFx(NO_FX);
    setClock(now());
    resetTimer();
    setPhase('explore');
  }

  function skipToBattle() {
    setHero((h) => ({ ...h, x: ENCOUNTER_X, facing: 1, walking: false }));
  }

  function choose(choiceIndex: number) {
    if (answered || !current || outcome) return;
    setSelected(choiceIndex);
    const correct = choiceIndex === current.correctIndex;
    const next = applyAnswer(battle, correct);
    const result = battleOutcome(next);
    const t = now();
    const hit = t + HIT_DELAY_MS;
    setBattle(next);
    setFx((f) => ({
      ...f,
      heroAttack: correct ? t : f.heroAttack,
      monsterHurt: correct ? hit : f.monsterHurt,
      monsterAttack: correct ? f.monsterAttack : t,
      heroHurt: correct ? f.heroHurt : hit,
      monsterDefeated: result === 'won' ? hit : f.monsterDefeated,
      heroDefeated: result === 'lost' ? hit : f.heroDefeated,
      popups: [
        ...f.popups.slice(-3),
        { id: next.asked, at: hit, target: correct ? 'monster' : 'hero', text: correct ? '-1 HP' : '-1 ♥' },
      ],
    }));
    animate(result ? 1800 : 1000);
  }

  function finish() {
    const scorePct = questScore(battle);
    const won = outcome === 'won';
    setPhase('done');
    onComplete({
      scorePct,
      headline: `${won ? `Defeated the ${MONSTER_NAME}` : `Lost to the ${MONSTER_NAME}`} · ${battle.correct}/${battle.asked} correct`,
      stats: [
        { label: 'Result', value: won ? 'Victory' : 'Defeat' },
        { label: 'Correct', value: `${battle.correct}/${battle.asked}` },
        { label: 'Hearts left', value: battle.hearts },
      ],
      data: { game: 'quest', scorePct, won, correct: battle.correct, asked: battle.asked },
    });
  }

  function advance() {
    if (outcome) {
      finish();
      return;
    }
    setTurn((t) => t + 1);
    setSelected(null);
  }

  if (phase === 'intro') {
    return (
      <GameIntro icon={<Swords size={26} />} title="Monster Quest" onStart={start} startLabel="Start quest">
        Guide your knight through the valley to the {MONSTER_NAME}&apos;s lair. Hold{' '}
        <span className="font-semibold text-t1">→</span> or <span className="font-semibold text-t1">D</span> to
        walk. When you reach it, every correct answer is a{' '}
        <span className="font-semibold text-primary">sword strike</span> and every wrong one lets it hit back.
        You have {MAX_HEARTS} hearts.
      </GameIntro>
    );
  }

  if (phase === 'done') {
    const won = outcome === 'won';
    return (
      <GameResult
        scorePct={questScore(battle)}
        headline={
          won
            ? `You defeated the ${MONSTER_NAME} with ${battle.hearts} ${battle.hearts === 1 ? 'heart' : 'hearts'} to spare`
            : `The ${MONSTER_NAME} won this time. Study up and try again!`
        }
        xp={25}
        stats={[
          { label: 'Result', value: won ? 'Victory' : 'Defeat' },
          { label: 'Correct', value: `${battle.correct}/${battle.asked}` },
          { label: 'Hearts left', value: battle.hearts },
        ]}
        onReplay={start}
        onDone={onExit}
      />
    );
  }

  const attack = pulse(clock, fx.heroAttack, ATTACK_MS);
  const monsterAttack = pulse(clock, fx.monsterAttack, ATTACK_MS);
  const heroFx: HeroFx = {
    lunge: attack * 46,
    swing: attack * 110,
    recoil: pulse(clock, fx.heroHurt, HURT_MS) * 12,
    flash: pulse(clock, fx.heroHurt, HURT_MS),
    fall: ramp(clock, fx.heroDefeated, 500),
    ready: phase === 'battle',
    cheer: outcome === 'won' && ramp(clock, fx.monsterDefeated, 700) >= 1,
    alert: fx.encounter === null ? 1 : ramp(clock, fx.encounter, 900),
  };
  const monsterFx: MonsterFx = {
    lunge: monsterAttack * 46,
    swipe: monsterAttack * 70,
    recoil: pulse(clock, fx.monsterHurt, HURT_MS) * 14,
    flash: pulse(clock, fx.monsterHurt, HURT_MS),
    gone: ramp(clock, fx.monsterDefeated === null ? null : fx.monsterDefeated + 250, 650),
    roar: pulse(clock, fx.encounter, 700),
    hpPct: phase === 'battle' ? battle.monsterHp / battle.monsterMaxHp : null,
  };
  const popups: ScenePopup[] = fx.popups.map((p) => ({ ...p, progress: ramp(clock, p.at, POPUP_MS) }));

  const sceneLabel =
    phase === 'explore'
      ? `Your knight walks through a valley toward the ${MONSTER_NAME}'s lair`
      : `Your knight faces the ${MONSTER_NAME}: ${battle.monsterHp} of ${battle.monsterMaxHp} monster HP left, ${battle.hearts} hearts left`;

  return (
    <div className="space-y-4">
      {phase === 'explore' ? (
        <GameStatusBar
          progress={walkProgress(hero.x)}
          stats={[
            { label: 'Hearts', value: <Hearts count={battle.hearts} />, icon: <Heart size={14} /> },
            {
              label: 'To the lair',
              value: `${Math.ceil((ENCOUNTER_X - hero.x) / 40)} m`,
              icon: <Footprints size={14} />,
            },
            { label: 'Time', value: formatOffset(elapsedMs), icon: <Timer size={14} /> },
          ]}
        />
      ) : (
        <GameStatusBar
          progress={1 - battle.monsterHp / battle.monsterMaxHp}
          stats={[
            { label: 'Hearts', value: <Hearts count={battle.hearts} />, icon: <Heart size={14} /> },
            {
              label: 'Monster HP',
              value: `${battle.monsterHp}/${battle.monsterMaxHp}`,
              icon: <Skull size={14} />,
              emphasis: battle.monsterHp === 1,
            },
            { label: 'Correct', value: `${battle.correct}/${battle.asked}`, icon: <Sparkles size={14} /> },
          ]}
        />
      )}

      <div className="overflow-hidden rounded-panel border border-stroke">
        <QuestScene
          hero={hero}
          heroFx={heroFx}
          monsterFx={monsterFx}
          popups={popups}
          monsterName={MONSTER_NAME}
          label={sceneLabel}
        />
      </div>

      {phase === 'explore' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(['left', 'right'] as const).map((side) => (
              <Button
                key={side}
                variant="secondary"
                aria-label={side === 'left' ? 'Walk left' : 'Walk right'}
                className="touch-none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  hold(side, true);
                }}
                onPointerUp={() => hold(side, false)}
                onPointerCancel={() => hold(side, false)}
                onLostPointerCapture={() => hold(side, false)}
                onContextMenu={(e) => e.preventDefault()}
              >
                {side === 'left' ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
              </Button>
            ))}
            <p className="ml-1 hidden items-center gap-1 text-xs text-t3 sm:flex">
              Hold <Kbd>←</Kbd> <Kbd>→</Kbd> or <Kbd>A</Kbd> <Kbd>D</Kbd> to walk
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onExit}>
              Quit
            </Button>
            <Button variant="outline" onClick={skipToBattle}>
              Skip to battle
            </Button>
          </div>
        </div>
      ) : (
        current && (
          <>
            <motion.div
              key={`${turn}-${current.id}`}
              variants={fadeSlideUp}
              initial="hidden"
              animate="show"
              className="space-y-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-rose">
                {turn === 0 ? `A wild ${MONSTER_NAME} blocks the path!` : `Round ${turn + 1}`}
              </p>
              <p className="font-display text-lg font-semibold leading-snug text-t1">{current.prompt}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {current.choices.map((choice, i) => {
                  const isCorrect = i === current.correctIndex;
                  const isPicked = i === selected;
                  const state = !answered ? 'idle' : isCorrect ? 'correct' : isPicked ? 'wrong' : 'muted';
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={answered}
                      onClick={() => choose(i)}
                      aria-pressed={isPicked}
                      className={cn(
                        'focus-ring flex items-center gap-3 rounded-panel border px-4 py-2.5 text-left text-sm transition-all',
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
                    {outcome === 'won'
                      ? `The ${MONSTER_NAME} is defeated!`
                      : outcome === 'lost'
                        ? 'Your knight is out of hearts'
                        : selected === current.correctIndex
                          ? 'Direct hit!'
                          : `Ouch! The ${MONSTER_NAME} strikes back`}
                  </p>
                  <p className="mt-1 text-sm text-t2">{current.explanation}</p>
                </motion.div>
              )}
            </motion.div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={onExit}>
                Quit
              </Button>
              <Button onClick={advance} disabled={!answered}>
                {outcome === 'won' ? 'Claim victory' : outcome === 'lost' ? 'See results' : 'Next question'}
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
