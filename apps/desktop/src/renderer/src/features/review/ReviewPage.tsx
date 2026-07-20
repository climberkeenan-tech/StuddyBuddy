import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Layers, RefreshCw, Sparkles } from 'lucide-react';
import type { Course, ExamPrepPlan } from '@studdybuddy/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/lib/api';
import { useAsync, usePageTitle } from '@renderer/lib/hooks';
import { PageHeader } from '@renderer/components/layout';
import {
  Badge,
  Button,
  EmptyState,
  GlassPanel,
  Select,
  Skeleton,
  Spinner,
} from '@renderer/components/ui';
import { useToast } from '@renderer/components/toast';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { fadeSlideUp } from '@renderer/lib/motion';
import { ExamPrepPlanView } from './ExamPrepPlanView';
import { FlashcardReviewer, type DueCard } from './FlashcardReviewer';

/** Skeleton shown while the exam-prep plan loads. */
function PlanSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton height={20} width="40%" />
      <Skeleton height={140} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton height={96} />
        <Skeleton height={96} />
      </div>
    </div>
  );
}

/**
 * Smart Review — the study command center for one course. Surfaces the AI exam
 * prep plan (or generates one on demand) and a spaced-repetition queue of due
 * flashcards that launches an inline {@link FlashcardReviewer} session.
 */
export default function ReviewPage() {
  usePageTitle('Smart Review', 'Focus your studying where it counts most.');
  const nav = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: courses, loading: coursesLoading } = useAsync<Course[]>(
    () => api.courses.list(),
    [],
  );

  const paramCourseId = searchParams.get('courseId') ?? undefined;
  const activeCourses = useMemo(
    () => (courses ?? []).filter((c) => !c.archived),
    [courses],
  );
  const courseId = useMemo(() => {
    if (paramCourseId && activeCourses.some((c) => c.id === paramCourseId)) {
      return paramCourseId;
    }
    return activeCourses[0]?.id;
  }, [paramCourseId, activeCourses]);

  const selectCourse = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('courseId', id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const currentCourse = activeCourses.find((c) => c.id === courseId);

  // Existing plan (may be null until generated).
  const {
    data: fetchedPlan,
    loading: planLoading,
    error: planError,
    reload: reloadPlan,
  } = useAsync<ExamPrepPlan | null>(
    () => (courseId ? api.review.latestExamPrep(courseId) : Promise.resolve(null)),
    [courseId],
  );

  const [generating, setGenerating] = useState(false);
  // A freshly generated plan takes precedence over the fetched one, and is
  // cleared whenever the selected course changes.
  const [generatedPlan, setGeneratedPlan] = useState<ExamPrepPlan | null>(null);
  useEffect(() => {
    setGeneratedPlan(null);
  }, [courseId]);
  const plan = generatedPlan ?? fetchedPlan ?? null;

  const generatePlan = useCallback(async () => {
    if (!courseId) return;
    setGenerating(true);
    try {
      const p = await api.review.examPrep(courseId);
      setGeneratedPlan(p);
      toast.success('Exam prep ready', {
        description: 'Your personalized study plan is below.',
      });
    } catch (e) {
      toast.error('Could not generate exam prep', {
        description: (e as Error).message,
      });
    } finally {
      setGenerating(false);
    }
  }, [courseId, toast]);

  // Due flashcards for this course.
  const {
    data: dueCards,
    loading: dueLoading,
    reload: reloadDue,
  } = useAsync<DueCard[]>(
    () => (courseId ? api.flashcards.due(courseId) : Promise.resolve([])),
    [courseId],
  );

  const [sessionCards, setSessionCards] = useState<DueCard[] | null>(null);

  const startSession = useCallback(() => {
    if (dueCards && dueCards.length > 0) setSessionCards(dueCards);
  }, [dueCards]);

  const endSession = useCallback(() => {
    setSessionCards(null);
    reloadDue();
  }, [reloadDue]);

  const dueCount = dueCards?.length ?? 0;

  const courseOptions = useMemo(
    () => activeCourses.map((c) => ({ value: c.id, label: c.name })),
    [activeCourses],
  );

  // ——— Render ———

  if (coursesLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Smart Review"
          subtitle="Focus your studying where it counts most."
        />
        <PlanSkeleton />
      </div>
    );
  }

  if (activeCourses.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Smart Review"
          subtitle="Focus your studying where it counts most."
        />
        <EmptyState
          icon={<GraduationCap size={26} />}
          title="No classes yet"
          hint="Add a class and record or import a lecture, then Smart Review will build you a personalized exam plan."
          action={<Button onClick={() => nav('/')}>Go to dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart Review"
        subtitle="Focus your studying where it counts most."
        actions={
          courseOptions.length > 1 && courseId ? (
            <div className="flex items-center gap-2">
              {currentCourse && (
                <CourseIcon
                  icon={currentCourse.icon}
                  color={currentCourse.color}
                  size="sm"
                />
              )}
              <Select
                aria-label="Choose a course"
                options={courseOptions}
                value={courseId}
                onChange={(e) => selectCourse(e.target.value)}
                className="min-w-[12rem]"
              />
            </div>
          ) : undefined
        }
      />

      {/* Due for review */}
      <motion.div variants={fadeSlideUp} initial="hidden" animate="show">
        {sessionCards ? (
          <FlashcardReviewer cards={sessionCards} onDone={endSession} />
        ) : (
          <GlassPanel
            padding="lg"
            className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary">
                <Layers size={24} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-t1">
                    Due for review
                  </h2>
                  {!dueLoading && dueCount > 0 && (
                    <Badge variant="primary" solid>
                      {dueCount}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-t2">
                  {dueLoading
                    ? 'Checking your spaced-repetition queue…'
                    : dueCount > 0
                      ? `${dueCount} flashcard${dueCount === 1 ? '' : 's'} ready to strengthen your memory.`
                      : "You're all caught up — no cards due right now. Nice work!"}
                </p>
              </div>
            </div>
            <div className="shrink-0">
              {dueLoading ? (
                <Spinner label="Loading" />
              ) : dueCount > 0 ? (
                <Button
                  leftIcon={<Sparkles size={16} />}
                  onClick={startSession}
                >
                  Start review session
                </Button>
              ) : (
                <Badge variant="success" leftIcon={<Sparkles size={13} />}>
                  All caught up
                </Badge>
              )}
            </div>
          </GlassPanel>
        )}
      </motion.div>

      {/* Exam prep plan */}
      {planLoading ? (
        <PlanSkeleton />
      ) : planError ? (
        <EmptyState
          icon={<RefreshCw size={24} />}
          title="Couldn't load your exam plan"
          hint={planError.message}
          action={<Button onClick={reloadPlan}>Try again</Button>}
        />
      ) : plan ? (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw size={15} />}
              loading={generating}
              onClick={generatePlan}
            >
              Regenerate
            </Button>
          </div>
          <ExamPrepPlanView
            plan={plan}
            onStudyLecture={(lectureId) => nav(`/learn/${lectureId}`)}
            onAskQuestion={(q) =>
              nav(`/search?q=${encodeURIComponent(q)}`)
            }
          />
        </div>
      ) : (
        <GlassPanel
          padding="lg"
          className="flex flex-col items-center gap-4 text-center"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-white shadow-glow">
            <GraduationCap size={28} />
          </span>
          <div className="space-y-1">
            <h2 className="font-display text-xl font-semibold text-t1">
              Build your exam prep plan
            </h2>
            <p className="max-w-md text-sm text-t2">
              StuddyBuddy will read every lecture in{' '}
              <span className="font-medium text-t1">
                {currentCourse?.name ?? 'this course'}
              </span>{' '}
              and craft a cumulative review, rank the concepts that matter most,
              predict likely exam questions, and map out exactly what to study.
            </p>
          </div>
          <Button
            size="lg"
            leftIcon={<Sparkles size={18} />}
            loading={generating}
            onClick={generatePlan}
          >
            Generate exam prep
          </Button>
        </GlassPanel>
      )}
    </div>
  );
}
