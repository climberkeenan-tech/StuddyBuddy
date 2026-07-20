import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MicOff, Pause, Play, Radio, Sparkles } from 'lucide-react';
import type { RecordingStatus, TranscriptSegment } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync, useIpcEvent, usePageTitle } from '@renderer/lib/hooks';
import { formatOffset } from '@renderer/lib/format';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { useRecordingStore } from '@renderer/stores/recording-store';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast/useToast';
import { PageHeader } from '@renderer/components/layout';
import { Badge, Button, GlassPanel, Input, Select } from '@renderer/components/ui';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { AudioMeter } from './AudioMeter';
import { LiveTranscript } from './LiveTranscript';
import { RecordButton } from './RecordButton';
import { useMicCapture } from './useMicCapture';

const IDLE_STATUS: RecordingStatus = {
  lectureId: null,
  state: 'idle',
  elapsedMs: 0,
  audioLevel: 0,
  segmentCount: 0,
};

interface Session {
  lectureId: string;
  courseId: string;
  /** True when the mock/browser backend is simulating audio (no real mic). */
  demo: boolean;
}

/** Friendly recovery panel shown when the browser blocks microphone access. */
function MicDeniedPanel({
  onRetry,
  onDemo,
}: {
  onRetry: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose/15 text-rose">
        <MicOff size={26} />
      </span>
      <div className="space-y-1.5">
        <h2 className="font-display text-lg font-semibold text-t1">Microphone access is blocked</h2>
        <p className="mx-auto max-w-sm text-sm text-t2">
          StuddyBuddy needs your microphone to capture the lecture. Allow access in your browser or
          system settings, then try again — or explore a simulated recording to see how it works.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>Try again</Button>
        <Button variant="secondary" leftIcon={<Sparkles size={16} />} onClick={onDemo}>
          Use demo mode
        </Button>
      </div>
    </div>
  );
}

/**
 * The live recording studio — StuddyBuddy's signature screen. Drives the
 * recording pipeline (start/pause/resume/stop) via the recording store, captures
 * real microphone audio when available (streaming webm/opus chunks + RMS levels
 * to the backend), and renders a live audio meter, elapsed timer, and a
 * streaming transcript. When no microphone is available (browser preview / tests)
 * it gracefully falls back to demo mode, where the backend simulates the session.
 */
export default function RecordPage() {
  usePageTitle('Record a lecture', 'Capture live audio and get an instant, structured transcript.');

  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const paramCourseId = params.get('courseId');

  const begin = useRecordingStore((s) => s.begin);
  const pause = useRecordingStore((s) => s.pause);
  const resume = useRecordingStore((s) => s.resume);
  const stop = useRecordingStore((s) => s.stop);

  const storeCourses = useAppStore((s) => s.courses);
  const { data: fetchedCourses } = useAsync(() => api.courses.list(), []);
  const courses = storeCourses.length > 0 ? storeCourses : (fetchedCourses ?? []);

  const mic = useMicCapture();

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<RecordingStatus>(IDLE_STATUS);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const effectiveCourseId = paramCourseId ?? selectedCourseId;
  const activeCourse = useMemo(
    () => courses.find((c) => c.id === effectiveCourseId),
    [courses, effectiveCourseId],
  );

  // Default the class picker to the first course once the list loads.
  useEffect(() => {
    if (!paramCourseId && !selectedCourseId && courses.length > 0) {
      setSelectedCourseId(courses[0]?.id ?? '');
    }
  }, [paramCourseId, selectedCourseId, courses]);

  // Live pipeline status (elapsed, level, segment count).
  useIpcEvent('recording:status', (next) => setStatus(next));

  // Streaming transcript segments for the active lecture.
  useIpcEvent('transcript:segments', ({ lectureId, segments: incoming }) => {
    if (!session || lectureId !== session.lectureId) return;
    setSegments((prev) => {
      const seen = new Set(prev.map((s) => s.id));
      const merged = prev.slice();
      for (const seg of incoming) if (!seen.has(seg.id)) merged.push(seg);
      merged.sort((a, b) => a.index - b.index);
      return merged;
    });
  });

  const active = session !== null;
  const paused = status.state === 'paused';

  async function handleStart(forceDemo = false) {
    const courseId = effectiveCourseId;
    if (!courseId) {
      toast.error('Choose a class first', {
        description: 'Pick which class this lecture belongs to, then start recording.',
      });
      return;
    }
    setStarting(true);

    let demo = forceDemo;
    if (!forceDemo && mic.supported) {
      const result = await mic.start();
      if (result === 'denied') {
        // The denied recovery panel renders from mic.state.
        setStarting(false);
        return;
      }
      if (result === 'unavailable' || result === 'error') demo = true;
    } else if (!mic.supported) {
      demo = true;
    }

    const lectureId = await begin(courseId, title.trim() || undefined);
    if (!lectureId) {
      mic.stop();
      setStarting(false);
      return;
    }
    setSegments([]);
    setSession({ lectureId, courseId, demo });
    setStarting(false);
  }

  async function handleTogglePause() {
    if (status.state === 'recording') {
      mic.pause();
      await pause();
    } else if (status.state === 'paused') {
      mic.resume();
      await resume();
    }
  }

  async function handleStop() {
    if (stopping || !session) return;
    setStopping(true);
    mic.stop();
    const lectureId = await stop();
    if (!lectureId) {
      setStopping(false);
      return;
    }
    toast.success('Lecture saved — building your study kit', {
      description: 'Your notes, flashcards, and quiz are on the way.',
    });
    const courseId = session.courseId;
    setSession(null);
    setSegments([]);
    setStatus(IDLE_STATUS);
    setStopping(false);
    nav(`/courses/${courseId}/lectures/${lectureId}`);
  }

  const showDenied = mic.state === 'denied' && !active;
  const elapsed = formatOffset(active ? status.elapsedMs : 0);
  const segmentCount = active ? Math.max(status.segmentCount, segments.length) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record a lecture"
        subtitle="Capture live audio and get an instant, structured transcript."
      />

      <motion.div
        className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
        variants={staggerChildren}
        initial="hidden"
        animate="show"
      >
        {/* ————— Control panel ————— */}
        <motion.div variants={fadeSlideUp}>
          <GlassPanel padding="lg" className="flex h-full flex-col items-center gap-6">
            {showDenied ? (
              <MicDeniedPanel
                onRetry={() => void handleStart(false)}
                onDemo={() => void handleStart(true)}
              />
            ) : active ? (
              <div className="flex w-full flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
                      paused ? 'bg-amber/15 text-amber' : 'bg-rose/15 text-rose',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        paused ? 'bg-amber' : 'bg-rose animate-pulse-dot',
                      )}
                    />
                    {paused ? 'Paused' : 'Recording'}
                  </span>
                  <p
                    className="font-display text-5xl font-semibold tabular-nums text-t1"
                    aria-label={`Elapsed time ${elapsed}`}
                  >
                    {elapsed}
                  </p>
                  <p className="text-xs text-t3">
                    {segmentCount} {segmentCount === 1 ? 'segment' : 'segments'} captured
                    {session?.demo && ' · demo mode'}
                  </p>
                </div>

                <AudioMeter level={status.audioLevel} active={!paused} className="w-full" />

                <RecordButton
                  recording
                  paused={paused}
                  busy={stopping}
                  level={status.audioLevel}
                  onClick={() => void handleStop()}
                />

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    variant="secondary"
                    leftIcon={paused ? <Play size={16} /> : <Pause size={16} />}
                    onClick={() => void handleTogglePause()}
                    disabled={stopping}
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    variant="danger"
                    loading={stopping}
                    onClick={() => void handleStop()}
                  >
                    Stop &amp; save
                  </Button>
                </div>
                <p className="text-center text-xs text-t3">
                  We&apos;ll transcribe everything and build your study kit automatically.
                </p>
              </div>
            ) : (
              <div className="flex w-full flex-col items-center gap-6">
                <div className="w-full space-y-4">
                  {activeCourse ? (
                    <div className="flex items-center gap-3 rounded-panel border border-stroke bg-surface/40 p-3">
                      <CourseIcon icon={activeCourse.icon} color={activeCourse.color} size="md" />
                      <div className="min-w-0">
                        <p className="truncate font-display text-sm font-semibold text-t1">
                          {activeCourse.name}
                        </p>
                        <p className="truncate text-xs text-t3">
                          {activeCourse.instructor || 'Ready to record'}
                        </p>
                      </div>
                    </div>
                  ) : !paramCourseId ? (
                    <Select
                      label="Class"
                      placeholder={courses.length ? 'Choose a class' : 'No classes yet'}
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      options={courses.map((c) => ({ value: c.id, label: c.name }))}
                    />
                  ) : null}

                  <Input
                    label="Lecture title"
                    hint="Optional — we'll number it for you if you leave this blank."
                    placeholder="e.g. Photosynthesis & the Calvin cycle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                  />
                </div>

                <RecordButton
                  recording={false}
                  busy={starting}
                  onClick={() => void handleStart()}
                />

                <div className="space-y-1 text-center">
                  <p className="font-display text-base font-semibold text-t1">
                    {effectiveCourseId ? 'Ready when you are' : 'Pick a class to begin'}
                  </p>
                  <p className="mx-auto max-w-xs text-xs text-t3">
                    Tap the button to start capturing. You can pause anytime and stop when class ends.
                  </p>
                  {!mic.supported && (
                    <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-t3">
                      <Radio size={12} />
                      Demo mode — this preview simulates a live lecture.
                    </span>
                  )}
                </div>
              </div>
            )}
          </GlassPanel>
        </motion.div>

        {/* ————— Live transcript ————— */}
        <motion.div variants={fadeSlideUp}>
          <GlassPanel padding="lg" className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-t3">
                Live transcript
              </h2>
              {active && (
                <Badge variant={paused ? 'amber' : 'rose'} solid={!paused}>
                  {paused ? 'Paused' : 'Live'}
                </Badge>
              )}
            </div>
            <LiveTranscript segments={segments} live={active && !paused} />
          </GlassPanel>
        </motion.div>
      </motion.div>
    </div>
  );
}
