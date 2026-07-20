import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { Course, CourseInput } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast/useToast';
import { Button, Input, Modal } from '@renderer/components/ui';
import { COURSE_COLORS, ICON_KEYS, ICON_MAP } from './CourseIcon';

export interface CourseDialogProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog edits this course; otherwise it creates one. */
  course?: Course;
  /** Called with the created/updated course after a successful save. */
  onSaved?: (course: Course) => void;
}

function toDateInput(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Create or edit a course: name, instructor, semester, an accent-color swatch
 * row, an icon grid, and an optional exam date. Persists via
 * `api.courses.create|update`, refreshes the global course list, and toasts.
 */
export function CourseDialog({ open, onClose, course, onSaved }: CourseDialogProps) {
  const editing = Boolean(course);
  const refreshCourses = useAppStore((s) => s.refreshCourses);
  const toast = useToast();

  const [name, setName] = useState('');
  const [instructor, setInstructor] = useState('');
  const [semester, setSemester] = useState('');
  const [color, setColor] = useState<string>(COURSE_COLORS[0]);
  const [icon, setIcon] = useState<string>('book-open');
  const [examDate, setExamDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string>();

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(course?.name ?? '');
    setInstructor(course?.instructor ?? '');
    setSemester(course?.semester ?? 'Fall 2026');
    setColor(course?.color ?? COURSE_COLORS[0]);
    setIcon(course?.icon ?? 'book-open');
    setExamDate(toDateInput(course?.examDates?.[0]));
    setNameError(undefined);
    setSaving(false);
  }, [open, course]);

  async function handleSave() {
    if (!name.trim()) {
      setNameError('Give your course a name.');
      return;
    }
    setSaving(true);
    const examTs = examDate ? new Date(`${examDate}T09:00:00`).getTime() : undefined;
    const input: CourseInput = {
      name: name.trim(),
      instructor: instructor.trim(),
      semester: semester.trim(),
      color,
      icon,
      ...(examTs ? { examDates: [examTs] } : {}),
    };
    try {
      const saved = course ? await api.courses.update(course.id, input) : await api.courses.create(input);
      await refreshCourses();
      toast.success(editing ? 'Course updated' : 'Course added', { description: saved.name });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(editing ? 'Could not update course' : 'Could not add course', {
        description: err instanceof Error ? err.message : undefined,
      });
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit course' : 'Add a course'}
      description={editing ? 'Update the details for this class.' : 'Group your lectures, notes, and study materials by class.'}
      size="md"
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {editing ? 'Save changes' : 'Add course'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Course name"
          placeholder="e.g. Molecular Biology"
          value={name}
          error={nameError}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(undefined);
          }}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Instructor" placeholder="Dr. Vasquez" value={instructor} onChange={(e) => setInstructor(e.target.value)} />
          <Input label="Semester" placeholder="Fall 2026" value={semester} onChange={(e) => setSemester(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-t2">Accent color</span>
          <div className="flex flex-wrap gap-2">
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  'focus-ring flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                  color === c && 'ring-2 ring-offset-2 ring-offset-panel',
                )}
                style={{ backgroundColor: c, boxShadow: `0 0 0 1px ${c}55` }}
              >
                {color === c && <Check size={15} className="text-white" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-t2">Icon</span>
          <div className="grid grid-cols-6 gap-2">
            {ICON_KEYS.map((key) => {
              const Icon = ICON_MAP[key]!;
              const active = icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  aria-pressed={active}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'focus-ring flex h-10 items-center justify-center rounded-xl border transition-colors',
                    active ? 'border-primary/60 text-primary' : 'border-stroke text-t3 hover:border-primary/40 hover:text-t2',
                  )}
                  style={active ? { backgroundColor: `${color}18` } : undefined}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </div>

        <Input
          type="date"
          label="Next exam (optional)"
          hint="Powers exam countdowns and Smart Review."
          value={examDate}
          onChange={(e) => setExamDate(e.target.value)}
        />
      </div>
    </Modal>
  );
}
