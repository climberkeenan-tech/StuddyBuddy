import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Brain,
  ChevronLeft,
  Flame,
  Gamepad2,
  Lock,
  Network,
  Puzzle,
  Sparkles,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { QuizContent } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync, usePageTitle } from '@renderer/lib/hooks';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast/useToast';
import { PageHeader } from '@renderer/components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GlassPanel,
  Modal,
  ProgressRing,
  Skeleton,
  StatCard,
} from '@renderer/components/ui';
import { buildMemoryPairs, buildPairs, buildRushQuestions, grade, type GameKind } from './lib';
import type { GameCompletion } from './types';
import { Celebration } from './Celebration';
import { QuizRush } from './games/QuizRush';
import { ConceptMatch } from './games/ConceptMatch';
import { MemoryGame } from './games/MemoryGame';
import { ConceptMap } from './games/ConceptMap';

/** Per-game presentation metadata for the hub cards. */
interface Activity {
  kind: GameKind;
  title: string;
  tagline: string;
  icon: LucideIcon;
  accent: string;
}

const ACTIVITIES: Activity[] = [
  { kind: 'quiz', title: 'Quiz Rush', tagline: 'Rapid-fire questions with streaks and combos.', icon: Zap, accent: 'from-primary to-accent' },
  { kind: 'match', title: 'Concept Match', tagline: 'Pair each term with its definition against the clock.', icon: Puzzle, accent: 'from-sky to-primary' },
  { kind: 'memory', title: 'Memory Game', tagline: 'Flip cards to find hidden term pairs.', icon: Brain, accent: 'from-accent to-sky' },
  { kind: 'map', title: 'Concept Map', tagline: 'Explore an interactive graph and timeline.', icon: Network, accent: 'from-primary to-sky' },
];

const BEST_KEY = (lectureId: string, kind: GameKind) => `sb:learn:best:${lectureId}:${kind}`;

function readBest(lectureId: string, kind: GameKind): number {
  try {
    const raw = localStorage.getItem(BEST_KEY(lectureId, kind));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Loading placeholder for the activity grid. */
function HubSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="space-y-4">
          <Skeleton width={44} height={44} className="rounded-2xl" />
          <Skeleton width="55%" height={16} />
          <Skeleton width="85%" height={12} />
          <Skeleton width={120} height={34} className="rounded-xl" />
        </Card>
      ))}
    </div>
  );
}

/**
 * The Learn hub for a single lecture: a playground of study games built from
 * the lecture's AI analysis. Each activity opens in a modal, records a
 * `game-completed` event on finish (earning XP), and tracks a local best score.
 */
export default function LearnPage() {
  const { lectureId = '' } = useParams<{ lectureId: string }>();
  usePageTitle('Study Games', 'Turn this lecture into a game.');

  const toast = useToast();
  const nav = useNavigate();
  const refreshGamification = useAppStore((s) => s.refreshGamification);
  const gamification = useAppStore((s) => s.gamification);

  const [active, setActive] = useState<GameKind | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [bests, setBests] = useState<Record<string, number>>({});

  const { data, loading, error } = useAsync(async () => {
    const [analysis, lecture] = await Promise.all([
      api.analysis.get(lectureId),
      api.lectures.get(lectureId),
    ]);
    let quiz: QuizContent | null = null;
    try {
      const metas = await api.materials.list(lectureId);
      const quizMeta =
        metas.find((m) => m.type === 'quiz-mcq') ??
        metas.find((m) => m.type === 'practice-test') ??
        metas.find((m) => m.type === 'quiz-short-answer');
      if (quizMeta) {
        const mat = await api.materials.get(quizMeta.id);
        if (
          mat &&
          (mat.type === 'quiz-mcq' || mat.type === 'practice-test' || mat.type === 'quiz-short-answer')
        ) {
          quiz = mat.content as QuizContent;
        }
      }
    } catch {
      /* Quiz material is optional — Quiz Rush falls back to synthesized questions. */
    }
    return { analysis, lecture, quiz };
  }, [lectureId]);

  useEffect(() => {
    if (error) toast.error('Could not load this lecture', { description: error.message });
  }, [error, toast]);

  useEffect(() => {
    if (!lectureId) return;
    setBests({
      quiz: readBest(lectureId, 'quiz'),
      match: readBest(lectureId, 'match'),
      memory: readBest(lectureId, 'memory'),
    });
  }, [lectureId]);

  const analysis = data?.analysis ?? null;
  const pairs = useMemo(() => (analysis ? buildPairs(analysis) : []), [analysis]);
  const memoryPairs = useMemo(() => (analysis ? buildMemoryPairs(analysis) : []), [analysis]);
  const questions = useMemo(
    () => (analysis ? buildRushQuestions(analysis, data?.quiz ?? null) : []),
    [analysis, data?.quiz],
  );

  /** Minimum-data gate + reason for each activity. */
  const availability = useMemo<Record<GameKind, { ok: boolean; reason: string }>>(
    () => ({
      quiz: { ok: questions.length >= 2, reason: 'Needs a couple of quiz questions.' },
      match: { ok: pairs.length >= 3, reason: 'Needs at least 3 concepts.' },
      memory: { ok: memoryPairs.length >= 3, reason: 'Needs at least 3 concepts.' },
      map: { ok: (analysis?.concepts.length ?? 0) >= 1, reason: 'Needs analyzed concepts.' },
    }),
    [questions.length, pairs.length, memoryPairs.length, analysis],
  );

  const handleComplete = useCallback(
    async (kind: GameKind, completion: GameCompletion) => {
      // Persist a local best score (games with a percentage only).
      if (kind !== 'map') {
        setBests((prev) => {
          const best = Math.max(prev[kind] ?? 0, completion.scorePct);
          try {
            localStorage.setItem(BEST_KEY(lectureId, kind), String(best));
          } catch {
            /* storage may be unavailable — non-fatal */
          }
          return { ...prev, [kind]: best };
        });
      }

      setCelebrate((c) => c + 1);
      const title = ACTIVITIES.find((a) => a.kind === kind)?.title ?? 'Activity';
      try {
        await api.gamification.recordEvent({
          type: 'game-completed',
          lectureId,
          courseId: data?.lecture?.courseId,
          minutes: 2,
          data: completion.data,
        });
        toast.success(`${title} complete!`, {
          description:
            kind === 'map' ? '+25 XP · nice review' : `+25 XP · ${completion.scorePct}% score`,
        });
        void refreshGamification();
      } catch (e) {
        toast.error('Could not save your progress', { description: (e as Error).message });
      }
    },
    [lectureId, data?.lecture?.courseId, toast, refreshGamification],
  );

  const backTo = data?.lecture
    ? `/courses/${data.lecture.courseId}/lectures/${lectureId}`
    : undefined;

  const eyebrow = backTo ? (
    <Link
      to={backTo}
      className="focus-ring inline-flex items-center gap-1 rounded-md text-sm text-t3 transition-colors hover:text-t1"
    >
      <ChevronLeft size={15} /> {data?.lecture?.title ?? 'Back to lecture'}
    </Link>
  ) : undefined;

  return (
    <div className="space-y-6">
      <Celebration trigger={celebrate} />

      <PageHeader
        eyebrow={eyebrow}
        title="Study Games"
        subtitle={analysis?.gist ?? 'Make studying this lecture feel like play.'}
      />

      {loading ? (
        <HubSkeleton />
      ) : !analysis ? (
        <EmptyState
          icon={<Gamepad2 size={26} />}
          title="No games yet for this lecture"
          hint="Once this lecture has been analyzed, its concepts turn into games you can play here."
          action={
            backTo ? <Button onClick={() => nav(backTo)}>Back to lecture</Button> : undefined
          }
        />
      ) : (
        <>
          {/* Progress strip */}
          <motion.div
            variants={staggerChildren}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-3"
          >
            <motion.div variants={fadeSlideUp}>
              <StatCard
                label="Level"
                value={gamification ? gamification.level : '—'}
                icon={<Trophy size={16} className="text-gold" />}
              />
            </motion.div>
            <motion.div variants={fadeSlideUp}>
              <StatCard
                label="Day streak"
                value={gamification ? `${gamification.streak.current}` : '—'}
                icon={<Flame size={16} className="text-amber" />}
              />
            </motion.div>
            <motion.div variants={fadeSlideUp}>
              <StatCard
                label="Concepts in play"
                value={analysis.concepts.length}
                icon={<Sparkles size={16} className="text-primary" />}
              />
            </motion.div>
          </motion.div>

          {/* Activity grid */}
          <motion.div
            variants={staggerChildren}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2"
          >
            {ACTIVITIES.map((a) => {
              const avail = availability[a.kind];
              const best = bests[a.kind] ?? 0;
              const g = best > 0 ? grade(best) : null;
              const Icon = a.icon;
              return (
                <motion.div key={a.kind} variants={fadeSlideUp}>
                  <Card
                    interactive={avail.ok}
                    className={cn('flex h-full flex-col gap-4', !avail.ok && 'opacity-70')}
                  >
                    <div className="flex items-start justify-between">
                      <span
                        className={cn(
                          'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-soft',
                          a.accent,
                        )}
                      >
                        <Icon size={22} />
                      </span>
                      {a.kind !== 'map' && best > 0 && g && (
                        <div className="flex items-center gap-2">
                          <ProgressRing value={best / 100} size={34} thickness={4} aria-label={`Best score ${best}%`}>
                            <span className="text-[9px] font-semibold text-t2">{best}</span>
                          </ProgressRing>
                          <Badge variant={g.accent}>Best</Badge>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-1">
                      <h3 className="font-display text-lg font-semibold text-t1">{a.title}</h3>
                      <p className="text-sm text-t2">{a.tagline}</p>
                    </div>

                    {avail.ok ? (
                      <Button
                        className="self-start"
                        aria-label={`Start ${a.title}`}
                        onClick={() => setActive(a.kind)}
                      >
                        {a.kind === 'map' ? 'Explore' : best > 0 ? 'Play again' : 'Play'}
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-t3">
                        <Lock size={13} /> {avail.reason}
                      </span>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>

          <GlassPanel padding="md" className="flex items-center gap-3 text-sm text-t2">
            <Sparkles size={18} className="shrink-0 text-primary" />
            <p>
              Every game you finish earns XP and keeps your streak alive. Aim for a higher best
              score each round — your progress shows on each card.
            </p>
          </GlassPanel>
        </>
      )}

      {/* Active game modal */}
      <Modal
        open={active !== null}
        onClose={() => setActive(null)}
        size="lg"
        title={ACTIVITIES.find((a) => a.kind === active)?.title}
      >
        {active === 'quiz' && (
          <QuizRush
            questions={questions}
            onComplete={(c) => handleComplete('quiz', c)}
            onExit={() => setActive(null)}
          />
        )}
        {active === 'match' && (
          <ConceptMatch
            pairs={pairs}
            onComplete={(c) => handleComplete('match', c)}
            onExit={() => setActive(null)}
          />
        )}
        {active === 'memory' && (
          <MemoryGame
            pairs={memoryPairs}
            onComplete={(c) => handleComplete('memory', c)}
            onExit={() => setActive(null)}
          />
        )}
        {active === 'map' && analysis && (
          <ConceptMap
            analysis={analysis}
            onExit={() => setActive(null)}
            onReviewed={() =>
              handleComplete('map', {
                scorePct: 100,
                headline: 'Concept map reviewed',
                stats: [],
                data: { game: 'map' },
              })
            }
          />
        )}
      </Modal>
    </div>
  );
}
