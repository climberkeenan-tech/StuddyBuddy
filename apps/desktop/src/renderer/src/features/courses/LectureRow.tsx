import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
import type { Lecture, LectureStatus } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp } from '@renderer/lib/motion';
import { formatDuration, relativeTime, shortDate } from '@renderer/lib/format';
import { useToast } from '@renderer/components/toast/useToast';
import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  DropdownMenu,
  IconButton,
  Modal,
} from '@renderer/components/ui';

export interface LectureRowProps {
  lecture: Lecture;
  /** Course accent color, used to tint the leading number badge. */
  accent: string;
  /** Called after a successful rename or delete so the parent can refresh. */
  onChanged: () => void;
}

const STATUS_META: Record<LectureStatus, { label: string; variant: BadgeVariant; pulse?: boolean }> = {
  recording: { label: 'Recording', variant: 'rose', pulse: true },
  processing: { label: 'Processing', variant: 'amber', pulse: true },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'rose' },
};

/** A pulsing status dot for in-progress lecture states. */
function StatusDot({ variant }: { variant: BadgeVariant }) {
  const color =
    variant === 'amber' ? 'bg-amber' : variant === 'rose' ? 'bg-rose' : 'bg-success';
  return <span className={cn('h-1.5 w-1.5 rounded-full animate-pulse-dot', color)} aria-hidden />;
}

/**
 * A single lecture row inside the course page: number, title (inline-editable),
 * recorded date, duration, a live status chip, topic chips, and a kebab menu to
 * rename or delete. Clicking the row opens the lecture; controls stop propagation.
 */
export function LectureRow({ lecture, accent, onChanged }: LectureRowProps) {
  const nav = useNavigate();
  const toast = useToast();
  const status = STATUS_META[lecture.status];

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(lecture.title);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(lecture.title);
      // Focus + select after the input mounts.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [renaming, lecture.title]);

  const open = () => nav(`/courses/${lecture.courseId}/lectures/${lecture.id}`);

  async function commitRename() {
    const next = draft.trim();
    if (!next || next === lecture.title) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await api.lectures.update(lecture.id, { title: next });
      toast.success('Lecture renamed');
      setRenaming(false);
      onChanged();
    } catch (err) {
      toast.error('Could not rename lecture', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.lectures.remove(lecture.id);
      toast.success('Lecture deleted', { description: lecture.title });
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      toast.error('Could not delete lecture', {
        description: err instanceof Error ? err.message : undefined,
      });
      setDeleting(false);
    }
  }

  const topics = lecture.topics.slice(0, 3);
  const extraTopics = lecture.topics.length - topics.length;

  return (
    <motion.div variants={fadeSlideUp}>
      <Card
        interactive
        padding="sm"
        role="button"
        tabIndex={0}
        aria-label={`Open lecture ${lecture.title}`}
        onClick={renaming ? undefined : open}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className="group flex items-center gap-4"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
          aria-hidden
        >
          {lecture.number}
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                value={draft}
                disabled={saving}
                aria-label="Lecture title"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                className="focus-ring w-full max-w-sm rounded-lg border border-stroke bg-surface px-2.5 py-1 text-sm font-medium text-t1"
              />
              <IconButton
                label="Save title"
                size="sm"
                variant="primary"
                icon={<Check size={15} />}
                disabled={saving}
                onClick={() => void commitRename()}
              />
              <IconButton
                label="Cancel rename"
                size="sm"
                icon={<X size={15} />}
                disabled={saving}
                onClick={() => setRenaming(false)}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-t1">{lecture.title}</p>
              <Badge variant={status.variant} leftIcon={status.pulse ? <StatusDot variant={status.variant} /> : undefined}>
                {status.label}
              </Badge>
            </div>
          )}

          {!renaming && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-t3">
              <span title={new Date(lecture.recordedAt).toLocaleString()}>
                {shortDate(lecture.recordedAt)}
              </span>
              <span aria-hidden>·</span>
              <span>{relativeTime(lecture.recordedAt)}</span>
              {lecture.durationMs > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatDuration(lecture.durationMs)}</span>
                </>
              )}
              {topics.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {topics.map((t) => (
                    <Badge key={t} variant="neutral">
                      {t}
                    </Badge>
                  ))}
                  {extraTopics > 0 && <Badge variant="neutral">+{extraTopics}</Badge>}
                </span>
              )}
            </div>
          )}
        </div>

        {!renaming && (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu
              trigger={
                <IconButton
                  label={`Options for ${lecture.title}`}
                  size="sm"
                  icon={<MoreVertical size={16} />}
                  className="opacity-70 transition-opacity group-hover:opacity-100"
                />
              }
              items={[
                {
                  key: 'rename',
                  label: 'Rename',
                  icon: <Pencil size={15} />,
                  onSelect: () => setRenaming(true),
                },
                {
                  key: 'delete',
                  label: 'Delete',
                  icon: <Trash2 size={15} />,
                  danger: true,
                  onSelect: () => setConfirmDelete(true),
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => (deleting ? undefined : setConfirmDelete(false))}
        title="Delete this lecture?"
        description={`"${lecture.title}" and its notes, materials, and transcript will be permanently removed. This can't be undone.`}
        size="sm"
        dismissible={!deleting}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void handleDelete()}>
              Delete lecture
            </Button>
          </>
        }
      >
        <p className="text-sm text-t2">
          You can always re-record or import a demo lecture afterwards.
        </p>
      </Modal>
    </motion.div>
  );
}
