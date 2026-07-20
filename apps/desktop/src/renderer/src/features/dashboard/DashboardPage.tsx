import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Clock,
  Flame,
  Layers,
  Mic,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import type { AchievementDef, DashboardSummary, GamificationState } from '@studdybuddy/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/lib/api';
import { useAsync, usePageTitle } from '@renderer/lib/hooks';
import { PageHeader } from '@renderer/components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressRing,
  Skeleton,
  StatCard,
  Tooltip,
} from '@renderer/components/ui';
import { useToast } from '@renderer/components/toast';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { formatCountdown, formatDuration, greeting, relativeTime } from '@renderer/lib/format';
import { levelForXp, levelProgress, xpToNextLevel } from '@renderer/lib/xp';
import type { Lecture, LectureStatus } from '@studdybuddy/shared';
import { achievementIcon, recommendationIcon } from './dashboardIcons';

type RecentLecture = Lecture & { courseName: string; courseColor: string };

interface DashboardData {
  summary: DashboardSummary;
  gamification: GamificationState;
  achievements: AchievementDef[];
}

/**
 * The home dashboard: a time-of-day greeting, a row of study stats, and
 * actionable sections (continue studying, due reviews, upcoming exams, AI
 * recommendations, and the achievements strip). All data comes from the mock or
 * live backend through the foundation api; every section degrades to a friendly
 * empty state and shows skeletons while loading.
 */
export default function DashboardPage() {
  usePageTitle('Dashboard', 'Your study home');
  const toast = useToast();

  const { data, loading, error } = useAsync<DashboardData>(async () => {
    const [summary, gamification, achievements] = await Promise.all([
      api.dashboard.getSummary(),
      api.gamification.getState(),
      api.gamification.getAchievements(),
    ]);
    return { summary, gamification, achievements };
  }, []);

  const heading = `${greeting()}!`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-t3">
            <Sparkles size={14} className="text-primary" />
            Welcome back
          </span>
        }
        title={heading}
        subtitle="Here's everything you're learning, at a glance."
      />

      {loading && <DashboardSkeleton />}

      {!loading && error && (
        <Card>
          <EmptyState
            icon={<Sparkles size={22} />}
            title="We couldn't load your dashboard"
            hint={error.message}
            action={
              <Button
                variant="secondary"
                onClick={() =>
                  toast.info('Retrying…', { description: 'Give it a moment.' })
                }
              >
                Try again
              </Button>
            }
          />
        </Card>
      )}

      {!loading && data && <DashboardBody data={data} />}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Body
// ————————————————————————————————————————————————————————————————

function DashboardBody({ data }: { data: DashboardData }) {
  const { summary, gamification, achievements } = data;
  const nav = useNavigate();
  const hasAnything =
    summary.recentLectures.length > 0 || summary.courses.length > 0;

  if (!hasAnything) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={<Mic size={24} />}
          title="Record your first lecture"
          hint="Capture a class and StuddyBuddy turns it into notes, flashcards, and quizzes — automatically."
          action={<Button leftIcon={<Mic size={16} />} onClick={() => nav('/record')}>Start recording</Button>}
        />
      </Card>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={staggerChildren}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={fadeSlideUp}>
        <StatRow summary={summary} gamification={gamification} />
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div variants={fadeSlideUp} className="lg:col-span-2">
          <ContinueStudying lectures={summary.recentLectures} />
        </motion.div>
        <motion.div variants={fadeSlideUp}>
          <Recommendations items={summary.recommendations} />
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div variants={fadeSlideUp}>
          <DueForReview items={summary.dueReviews} />
        </motion.div>
        <motion.div variants={fadeSlideUp}>
          <UpcomingExams items={summary.upcomingExams} />
        </motion.div>
      </div>

      <motion.div variants={fadeSlideUp}>
        <AchievementsStrip achievements={achievements} gamification={gamification} />
      </motion.div>
    </motion.div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Stat row
// ————————————————————————————————————————————————————————————————

/** Build a 0..1 sparkline of study minutes over the last 7 days. */
function weekSparkline(dailyMinutes: Record<string, number>): number[] {
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    out.push(dailyMinutes[key] ?? 0);
  }
  const max = Math.max(...out, 1);
  return out.map((v) => v / max);
}

function StatRow({
  summary,
  gamification,
}: {
  summary: DashboardSummary;
  gamification: GamificationState;
}) {
  const level = levelForXp(summary.xp);
  const progress = levelProgress(summary.xp);
  const toNext = xpToNextLevel(summary.xp);
  const spark = weekSparkline(gamification.dailyMinutes);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Study streak"
        value={
          <span className="inline-flex items-baseline gap-1.5">
            {summary.studyStreak}
            <span className="text-sm font-medium text-t3">
              {summary.studyStreak === 1 ? 'day' : 'days'}
            </span>
          </span>
        }
        icon={<Flame size={16} className={cn(summary.studyStreak > 0 && 'text-amber')} />}
      />

      <StatCard
        label="Level & XP"
        value={
          <div className="flex items-center gap-3">
            <ProgressRing value={progress} size={40} thickness={4} aria-label={`Level ${level}`}>
              <span className="font-display text-xs font-bold text-t1">{level}</span>
            </ProgressRing>
            <span className="flex flex-col">
              <span className="font-display text-xl font-semibold leading-none text-t1">
                {summary.xp.toLocaleString()}
              </span>
              <span className="text-[11px] font-medium text-t3">{toNext} XP to next</span>
            </span>
          </div>
        }
        icon={<Star size={16} className="text-primary" />}
      />

      <StatCard
        label="Studied today"
        value={summary.studyMinutesToday > 0 ? formatDuration(summary.studyMinutesToday * 60_000) : '0m'}
        icon={<Clock size={16} />}
      />

      <StatCard
        label="This week"
        value={summary.studyMinutesWeek > 0 ? formatDuration(summary.studyMinutesWeek * 60_000) : '0m'}
        icon={<CalendarClock size={16} />}
        sparkline={spark}
      />
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Section shell
// ————————————————————————————————————————————————————————————————

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col" padding="lg">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-t1">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

// ————————————————————————————————————————————————————————————————
//  Continue studying
// ————————————————————————————————————————————————————————————————

const STATUS_META: Record<LectureStatus, { label: string; variant: 'success' | 'sky' | 'primary' | 'rose' }> = {
  ready: { label: 'Ready', variant: 'success' },
  processing: { label: 'Processing', variant: 'sky' },
  recording: { label: 'Recording', variant: 'primary' },
  failed: { label: 'Needs attention', variant: 'rose' },
};

function ContinueStudying({ lectures }: { lectures: RecentLecture[] }) {
  const nav = useNavigate();

  return (
    <Section title="Continue studying" icon={<BookOpen size={18} />}>
      {lectures.length === 0 ? (
        <EmptyState
          compact
          icon={<Mic size={20} />}
          title="Nothing recorded yet"
          hint="Record a lecture and it'll show up here to pick back up."
          action={<Button size="sm" onClick={() => nav('/record')}>Record a lecture</Button>}
        />
      ) : (
        <ul className="space-y-2.5">
          {lectures.map((lecture) => {
            const meta = STATUS_META[lecture.status];
            return (
              <li key={lecture.id}>
                <button
                  type="button"
                  onClick={() => nav(`/courses/${lecture.courseId}/lectures/${lecture.id}`)}
                  className="group flex w-full items-center gap-3 rounded-panel border border-stroke bg-surface px-3 py-2.5 text-left transition hover:border-stroke-strong hover:bg-overlay focus-ring"
                >
                  <CourseIcon icon="book-open" color={lecture.courseColor} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-t1">{lecture.title}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-t3">
                      <span className="truncate">{lecture.courseName}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{relativeTime(lecture.recordedAt)}</span>
                    </span>
                  </span>
                  <ChevronRight
                    size={18}
                    className="shrink-0 text-t3 transition group-hover:translate-x-0.5 group-hover:text-t2"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ————————————————————————————————————————————————————————————————
//  Recommendations
// ————————————————————————————————————————————————————————————————

function Recommendations({ items }: { items: DashboardSummary['recommendations'] }) {
  const nav = useNavigate();

  return (
    <Section title="For you" icon={<Sparkles size={18} />}>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<Sparkles size={20} />}
          title="No tips right now"
          hint="Study a little and personalized suggestions will appear here."
        />
      ) : (
        <ul className="space-y-2.5">
          {items.map((rec, i) => {
            const Icon = recommendationIcon(rec);
            const target = rec.lectureId
              ? `/learn/${rec.lectureId}`
              : rec.courseId
                ? `/courses/${rec.courseId}`
                : undefined;
            const interactive = Boolean(target);
            return (
              <li key={`${rec.title}-${i}`}>
                <button
                  type="button"
                  disabled={!interactive}
                  onClick={() => target && nav(target)}
                  className={cn(
                    'group flex w-full items-start gap-3 rounded-panel border border-stroke bg-gradient-primary-soft px-3 py-3 text-left transition',
                    interactive
                      ? 'hover:border-primary/40 hover:shadow-soft focus-ring'
                      : 'cursor-default',
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-soft">
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-t1">{rec.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-t2">{rec.detail}</span>
                  </span>
                  {interactive && (
                    <ArrowRight
                      size={16}
                      className="mt-1 shrink-0 text-primary opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ————————————————————————————————————————————————————————————————
//  Due for review
// ————————————————————————————————————————————————————————————————

function DueForReview({ items }: { items: DashboardSummary['dueReviews'] }) {
  const nav = useNavigate();
  const total = items.reduce((sum, d) => sum + d.dueCards, 0);

  return (
    <Section
      title="Due for review"
      icon={<Layers size={18} />}
      action={
        total > 0 ? (
          <Button size="sm" variant="ghost" rightIcon={<ArrowRight size={14} />} onClick={() => nav('/review')}>
            Review all
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<Trophy size={20} />}
          title="You're all caught up"
          hint="No flashcards are due right now — nice work staying on top of it."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.courseId}>
              <button
                type="button"
                onClick={() => nav(`/review?courseId=${d.courseId}`)}
                className="group flex w-full items-center justify-between gap-3 rounded-panel border border-stroke bg-surface px-3 py-2.5 text-left transition hover:border-stroke-strong hover:bg-overlay focus-ring"
              >
                <span className="min-w-0 truncate font-medium text-t1">{d.courseName}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="amber">
                    {d.dueCards} {d.dueCards === 1 ? 'card' : 'cards'}
                  </Badge>
                  <ArrowRight
                    size={16}
                    className="text-t3 transition group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ————————————————————————————————————————————————————————————————
//  Upcoming exams
// ————————————————————————————————————————————————————————————————

function UpcomingExams({ items }: { items: DashboardSummary['upcomingExams'] }) {
  const nav = useNavigate();

  return (
    <Section title="Upcoming exams" icon={<CalendarClock size={18} />}>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarClock size={20} />}
          title="No exams on the horizon"
          hint="Add exam dates to a course and they'll count down here."
        />
      ) : (
        <ul className="flex flex-wrap gap-2.5">
          {items.map((exam) => {
            const soon = exam.date - Date.now() < 7 * 86_400_000;
            return (
              <li key={`${exam.courseId}-${exam.date}`}>
                <button
                  type="button"
                  onClick={() => nav(`/courses/${exam.courseId}`)}
                  className="group flex items-center gap-2.5 rounded-panel border border-stroke bg-surface px-3 py-2 text-left transition hover:border-stroke-strong hover:bg-overlay focus-ring"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-t1">{exam.courseName}</span>
                    <span className={cn('text-xs font-semibold', soon ? 'text-rose' : 'text-t3')}>
                      {formatCountdown(exam.date)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ————————————————————————————————————————————————————————————————
//  Achievements strip
// ————————————————————————————————————————————————————————————————

function AchievementsStrip({
  achievements,
  gamification,
}: {
  achievements: AchievementDef[];
  gamification: GamificationState;
}) {
  const unlockedIds = new Set(gamification.unlocked.map((u) => u.achievementId));
  const unlockedCount = achievements.filter((a) => unlockedIds.has(a.id)).length;

  return (
    <Section
      title="Achievements"
      icon={<Trophy size={18} />}
      action={
        <span className="text-xs font-medium text-t3">
          {unlockedCount} / {achievements.length} unlocked
        </span>
      }
    >
      {achievements.length === 0 ? (
        <EmptyState compact icon={<Trophy size={20} />} title="No achievements yet" />
      ) : (
        <div className="flex flex-wrap gap-3">
          {achievements.map((a) => {
            const unlocked = unlockedIds.has(a.id);
            const Icon = achievementIcon(a.icon);
            const tip = unlocked ? `Unlocked · +${a.xp} XP` : `${a.description} · +${a.xp} XP`;
            return (
              <Tooltip key={a.id} content={tip}>
                <div
                  tabIndex={0}
                  role="img"
                  aria-label={`${a.name}: ${unlocked ? 'unlocked' : a.description}`}
                  className={cn(
                    'flex w-[132px] flex-col items-center gap-2 rounded-panel border px-3 py-4 text-center transition focus-ring',
                    unlocked
                      ? 'border-stroke bg-surface shadow-soft'
                      : 'border-stroke bg-surface/40 opacity-60 hover:opacity-90',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-full text-white',
                      unlocked
                        ? a.tier === 'gold'
                          ? 'bg-gradient-gold'
                          : a.tier === 'silver'
                            ? 'bg-gradient-silver'
                            : 'bg-gradient-bronze'
                        : 'bg-overlay text-t3',
                    )}
                  >
                    <Icon size={20} />
                  </span>
                  <span className="text-xs font-semibold leading-tight text-t1">{a.name}</span>
                  <Badge variant={a.tier} solid={unlocked}>
                    {a.tier}
                  </Badge>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ————————————————————————————————————————————————————————————————
//  Loading skeleton
// ————————————————————————————————————————————————————————————————

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-stroke bg-surface p-4 shadow-soft">
            <Skeleton width="45%" height={12} />
            <Skeleton className="mt-3" width="60%" height={24} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-panel border border-stroke bg-surface p-5 shadow-soft lg:col-span-2">
          <Skeleton width={160} height={16} />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={56} className="rounded-panel" />
            ))}
          </div>
        </div>
        <div className="rounded-panel border border-stroke bg-surface p-5 shadow-soft">
          <Skeleton width={120} height={16} />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={64} className="rounded-panel" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
