import { CalendarDays, ChevronLeft, Clock, MessageSquare, Presentation, Sparkles, Wand2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Course, Lecture } from '@studdybuddy/shared';
import { Badge, Button, Chip } from '@renderer/components/ui';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { formatDuration, shortDate } from '@renderer/lib/format';
import { cn } from '@renderer/lib/cn';
import { statusMeta } from '../lecture-utils';

export interface LectureHeaderProps {
  lecture: Lecture;
  course: Course | undefined;
  /** Topics to show; falls back to the lecture's own topics. */
  topics: string[];
  onGenerateKit: () => void;
  generatingKit: boolean;
}

/**
 * The sticky lecture header: course breadcrumb, number, title, status, date,
 * duration, detected topics, and the primary workspace actions (generate study
 * kit, slides, interactive mode, ask AI). Tinted with the course accent color.
 */
export function LectureHeader({ lecture, course, topics, onGenerateKit, generatingKit }: LectureHeaderProps) {
  const nav = useNavigate();
  const color = course?.color ?? '#7c3aed';
  const status = statusMeta(lecture.status);

  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-6 -mt-8 mb-2 border-b border-stroke px-6 pb-4 pt-8',
        'bg-bg/80 backdrop-blur-xl',
      )}
      style={{ boxShadow: `inset 3px 0 0 0 ${color}` }}
    >
      {course && (
        <Link
          to={`/courses/${lecture.courseId}`}
          className="focus-ring mb-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-t3 transition-colors hover:text-t1"
        >
          <ChevronLeft size={15} />
          <CourseIcon icon={course.icon} color={course.color} size="sm" />
          {course.name}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="neutral">Lecture {lecture.number}</Badge>
            <Badge variant={status.variant} leftIcon={<span className="h-1.5 w-1.5 rounded-full bg-current" />}>
              {status.label}
            </Badge>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-t1">{lecture.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-t3">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={15} /> {shortDate(lecture.recordedAt)}
            </span>
            {lecture.durationMs > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={15} /> {formatDuration(lecture.durationMs)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button leftIcon={<Wand2 size={16} />} loading={generatingKit} onClick={onGenerateKit}>
            Generate study kit
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Presentation size={16} />}
            onClick={() => nav(`/lectures/${lecture.id}/slides`)}
          >
            Slides
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Sparkles size={16} />}
            onClick={() => nav(`/learn/${lecture.id}`)}
          >
            Interactive
          </Button>
          <Button
            variant="ghost"
            leftIcon={<MessageSquare size={16} />}
            onClick={() => nav(`/search?lectureId=${lecture.id}`)}
          >
            Ask about this lecture
          </Button>
        </div>
      </div>

      {topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}
