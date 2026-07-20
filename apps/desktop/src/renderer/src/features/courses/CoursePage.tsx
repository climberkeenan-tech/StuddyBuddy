import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ChevronLeft,
  Download,
  GraduationCap,
  Mic,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Course } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync, usePageTitle } from '@renderer/lib/hooks';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast/useToast';
import { PageHeader } from '@renderer/components/layout';
import {
  Button,
  Card,
  DropdownMenu,
  EmptyState,
  GlassPanel,
  IconButton,
  Modal,
  Skeleton,
} from '@renderer/components/ui';
import { CourseDialog } from './CourseDialog';
import { CourseIcon } from './CourseIcon';
import { LectureRow } from './LectureRow';

/** Loading skeleton for the lecture list. */
function LectureListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Card key={i} padding="sm" className="flex items-center gap-4">
          <Skeleton width={36} height={36} className="rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton width="45%" height={14} />
            <Skeleton width="65%" height={10} />
          </div>
        </Card>
      ))}
    </div>
  );
}

type CourseAction = 'archive' | 'delete';

/**
 * The course workspace: course identity in the header, quick actions
 * (record, import a demo lecture, exam prep, edit, archive/delete), and a
 * staggered, live-updating list of the course's lectures.
 */
export default function CoursePage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const refreshCourses = useAppStore((s) => s.refreshCourses);

  const {
    data: course,
    loading: courseLoading,
    error: courseError,
    reload: reloadCourse,
  } = useAsync<Course | null>(() => api.courses.get(courseId), [courseId]);

  const {
    data: lectures,
    loading: lecturesLoading,
    reload: reloadLectures,
  } = useAsync(() => api.lectures.listByCourse(courseId), [courseId]);

  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<CourseAction | null>(null);
  const [working, setWorking] = useState(false);

  usePageTitle(course?.name ?? 'Course', course?.instructor);

  async function handleImportDemo() {
    setImporting(true);
    try {
      const lecture = await api.lectures.importDemo(courseId);
      toast.success('Demo lecture imported', {
        description: `"${lecture.title}" is ready to study.`,
      });
      reloadLectures();
      void refreshCourses();
    } catch (err) {
      toast.error('Could not import demo lecture', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setImporting(false);
    }
  }

  async function runCourseAction(action: CourseAction) {
    if (!course) return;
    setWorking(true);
    try {
      if (action === 'archive') {
        await api.courses.update(course.id, { archived: true });
        toast.success('Course archived', { description: course.name });
      } else {
        await api.courses.remove(course.id);
        toast.success('Course deleted', { description: course.name });
      }
      await refreshCourses();
      setPending(null);
      nav('/');
    } catch (err) {
      toast.error(action === 'archive' ? 'Could not archive course' : 'Could not delete course', {
        description: err instanceof Error ? err.message : undefined,
      });
      setWorking(false);
    }
  }

  const backLink = (
    <Link
      to="/"
      className="focus-ring inline-flex items-center gap-1 rounded-md text-xs font-medium text-t3 transition-colors hover:text-t1"
    >
      <ChevronLeft size={14} />
      All courses
    </Link>
  );

  // Course failed to load (bad id, backend error).
  if (courseError || (!courseLoading && !course)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Course not found" eyebrow={backLink} />
        <GlassPanel>
          <EmptyState
            icon={<GraduationCap size={24} />}
            title="We couldn't open this course"
            hint="It may have been deleted or archived. Head back to your courses to keep studying."
            action={
              <Button onClick={() => nav('/')} leftIcon={<ChevronLeft size={16} />}>
                Back to courses
              </Button>
            }
          />
        </GlassPanel>
      </div>
    );
  }

  const title = course ? (
    <span className="flex items-center gap-3">
      <CourseIcon icon={course.icon} color={course.color} size="lg" />
      <span>{course.name}</span>
    </span>
  ) : (
    <Skeleton width={220} height={28} />
  );

  const subtitleParts = course
    ? [course.instructor, course.semester].filter(Boolean).join(' · ')
    : undefined;

  const actions = course && (
    <>
      <Button leftIcon={<Mic size={16} />} onClick={() => nav(`/record?courseId=${course.id}`)}>
        Record lecture
      </Button>
      <Button
        variant="secondary"
        leftIcon={<Download size={16} />}
        loading={importing}
        onClick={() => void handleImportDemo()}
      >
        Import demo
      </Button>
      <Button
        variant="outline"
        leftIcon={<GraduationCap size={16} />}
        onClick={() => nav(`/review?courseId=${course.id}`)}
      >
        Exam prep
      </Button>
      <DropdownMenu
        trigger={
          <IconButton
            label="Course settings"
            variant="surface"
            icon={<MoreHorizontal size={18} />}
          />
        }
        items={[
          {
            key: 'edit',
            label: 'Edit course',
            icon: <Pencil size={15} />,
            onSelect: () => setEditing(true),
          },
          {
            key: 'archive',
            label: 'Archive course',
            icon: <Archive size={15} />,
            onSelect: () => setPending('archive'),
          },
          { separator: true, key: 'sep' },
          {
            key: 'delete',
            label: 'Delete course',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => setPending('delete'),
          },
        ]}
      />
    </>
  );

  const hasLectures = (lectures?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitleParts} eyebrow={backLink} actions={actions} />

      {course?.description && <p className="max-w-2xl text-sm text-t2">{course.description}</p>}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-t3">
            Lectures
          </h2>
          {hasLectures && (
            <span className="text-xs text-t3">
              {lectures!.length} {lectures!.length === 1 ? 'lecture' : 'lectures'}
            </span>
          )}
        </div>

        {lecturesLoading && !lectures ? (
          <LectureListSkeleton />
        ) : hasLectures ? (
          <motion.div
            className="space-y-3"
            variants={staggerChildren}
            initial="hidden"
            animate="show"
          >
            {lectures!.map((lecture) => (
              <LectureRow
                key={lecture.id}
                lecture={lecture}
                accent={course?.color ?? '#7c3aed'}
                onChanged={reloadLectures}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div variants={fadeSlideUp} initial="hidden" animate="show">
            <GlassPanel>
              <EmptyState
                icon={<Mic size={24} />}
                title="No lectures yet"
                hint="Record your first lecture live, or import a ready-made demo to explore notes, flashcards, and quizzes right away."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      leftIcon={<Mic size={16} />}
                      onClick={() => course && nav(`/record?courseId=${course.id}`)}
                    >
                      Record a lecture
                    </Button>
                    <Button
                      variant="secondary"
                      leftIcon={<Download size={16} />}
                      loading={importing}
                      onClick={() => void handleImportDemo()}
                    >
                      Import demo lecture
                    </Button>
                  </div>
                }
              />
            </GlassPanel>
          </motion.div>
        )}
      </section>

      {course && (
        <CourseDialog
          open={editing}
          onClose={() => setEditing(false)}
          course={course}
          onSaved={() => reloadCourse()}
        />
      )}

      <Modal
        open={pending !== null}
        onClose={() => (working ? undefined : setPending(null))}
        title={pending === 'delete' ? 'Delete this course?' : 'Archive this course?'}
        description={
          pending === 'delete'
            ? `"${course?.name ?? ''}" and all of its lectures, notes, and study materials will be permanently deleted. This can't be undone.`
            : `"${course?.name ?? ''}" will be hidden from your sidebar. You can restore it anytime from settings.`
        }
        size="sm"
        dismissible={!working}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={working}>
              Cancel
            </Button>
            <Button
              variant={pending === 'delete' ? 'danger' : 'primary'}
              loading={working}
              onClick={() => pending && void runCourseAction(pending)}
            >
              {pending === 'delete' ? 'Delete course' : 'Archive course'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-t2">
          {pending === 'delete'
            ? 'Consider archiving instead if you might want this class back later.'
            : 'Archiving keeps your data safe while tidying up your workspace.'}
        </p>
      </Modal>
    </div>
  );
}
