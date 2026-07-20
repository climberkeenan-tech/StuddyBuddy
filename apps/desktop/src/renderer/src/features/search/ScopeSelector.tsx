import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import type { SearchScope } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAppStore } from '@renderer/stores/app-store';
import { Chip, Select } from '@renderer/components/ui';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';

export interface ScopeSelectorProps {
  scope: SearchScope;
  onChange: (scope: SearchScope) => void;
}

/**
 * Lets the student narrow Ask/Search to a single course, and surfaces (and
 * clears) a lecture-level focus that arrived via `?lectureId=`. Course choices
 * come from the app store so the sidebar and this control never drift apart.
 */
export function ScopeSelector({ scope, onChange }: ScopeSelectorProps) {
  const courses = useAppStore((s) => s.courses);
  const [lectureTitle, setLectureTitle] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!scope.lectureId) {
      setLectureTitle(null);
      return;
    }
    void api.lectures
      .get(scope.lectureId)
      .then((lecture) => {
        if (alive) setLectureTitle(lecture?.title ?? null);
      })
      .catch(() => {
        if (alive) setLectureTitle(null);
      });
    return () => {
      alive = false;
    };
  }, [scope.lectureId]);

  const activeCourse = courses.find((c) => c.id === scope.courseId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-t3">
        <GraduationCap size={14} aria-hidden />
        Scope
      </span>

      {scope.lectureId ? (
        <Chip
          selected
          leftIcon={activeCourse ? <CourseIcon icon={activeCourse.icon} color={activeCourse.color} size="sm" /> : undefined}
          onRemove={() => onChange({ courseId: scope.courseId })}
        >
          {lectureTitle ?? 'This lecture'}
        </Chip>
      ) : (
        <Select
          aria-label="Limit to a course"
          className="min-w-[13rem]"
          value={scope.courseId ?? ''}
          placeholder="All courses"
          options={[
            { value: '', label: 'All courses' },
            ...courses.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(e) => {
            const value = e.target.value;
            onChange(value ? { courseId: value } : {});
          }}
        />
      )}
    </div>
  );
}
