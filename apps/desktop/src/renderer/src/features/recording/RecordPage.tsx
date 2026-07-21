import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Cpu, Loader2, MicOff, Pause, Play, Radio, Sparkles } from 'lucide-react';
import type { RecordingStatus, TranscriptSegment } from '@studdybuddy/shared';
import { api, usingMockApi } from '@renderer/lib/api';
import { useAsync, useIpcEvent, usePageTitle } from '@renderer/lib/hooks';
import { formatOffset } from '@renderer/lib/format';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';
import { useRecordingStore } from '@renderer/stores/recording-store';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast/useToast';
import { PageHeader } from '@renderer/components/layout';
import { Badge, Button, GlassPanel, Input, Modal, Select } from '@renderer/components/ui';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { AudioMeter } from './AudioMeter';
import { LiveTranscript } from './LiveTranscript';
import { RecordButton } from './RecordButton';
import { useMicCapture } from './useMicCapture';
import { useBrowserWhisper } from './useBrowserWhisper';

/** How often on-device Whisper re-transcribes the clip for a live transcript. */
const LIVE_TRANSCRIBE_INTERVAL_MS = 15000;

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
  const transcriptionProvider = useAppStore((s) => s.settings.transcriptionProvider);
  const { data: fetchedCourses } = useAsync(() => api.courses.list(), []);
  const { data: providerList } = useAsync(() => api.providers.list(), []);
  const courses = storeCourses.length > 0 ? storeCourses : (fetchedCourses ?? []);

  // In the real desktop app the default "simulated" engine replays sample text
  // instead of transcribing the microphone. Just as bad: picking a real engine
  // (Whisper) but never finishing its setup silently *falls back* to that same
  // demo voice. Detect both so a recording never quietly comes back as canned
  // content the user never said.
  const demoVoice = !usingMockApi && transcriptionProvider === 'simulated';
  const selectedRealUnconfigured = useMemo(() => {
    if (usingMockApi || transcriptionProvider === 'simulated' || !providerList) return false;
    const descriptor = providerList.find(
      (p) => p.kind === 'transcription' && p.id === transcriptionProvider,
    );
    return !!descriptor && !descriptor.available;
  }, [usingMockApi, transcriptionProvider, providerList]);
  // Either way, the transcript will be fake sample text rather than real speech.
  const willFakeTranscript = demoVoice || selectedRealUnconfigured;

  // Real, no-setup transcription: Whisper runs on-device in the renderer.
  const browserWhisper = !usingMockApi && transcriptionProvider === 'browser-whisper';
  const whisper = useBrowserWhisper(browserWhisper);

  const mic = useMicCapture();

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<RecordingStatus>(IDLE_STATUS);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [webInfoOpen, setWebInfoOpen] = useState(false);

  // Live on-device transcription bookkeeping (refs so the interval sees latest).
  const liveTimerRef = useRef<number | null>(null);
  const transcribingRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);

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

  // Streaming transcript segments for the active lecture. `replace` (Whisper
  // engines re-transcribe the whole clip) supersedes everything; otherwise
  // append newly-recognized segments.
  useIpcEvent('transcript:segments', ({ lectureId, segments: incoming, replace }) => {
    if (!session || lectureId !== session.lectureId) return;
    setSegments((prev) => {
      if (replace) return [...incoming].sort((a, b) => a.index - b.index);
      const seen = new Set(prev.map((s) => s.id));
      const merged = prev.slice();
      for (const seg of incoming) if (!seen.has(seg.id)) merged.push(seg);
      merged.sort((a, b) => a.index - b.index);
      return merged;
    });
  });

  const active = session !== null;
  const paused = status.state === 'paused';

  // Keep a ref copy of the active session so timers read the latest value.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * Transcribe everything captured so far with on-device Whisper and push the
   * (authoritative) result to the backend. Serialized via `transcribingRef` so
   * passes never overlap; failures are swallowed for the live path.
   */
  async function runWhisperPass(final: boolean): Promise<void> {
    if (transcribingRef.current) return;
    const blob = final ? await mic.finishRecording() : mic.snapshotBlob();
    if (!blob) return;
    transcribingRef.current = true;
    try {
      const segs = await whisper.transcribe(blob);
      if (segs.length > 0 && (final || sessionRef.current)) {
        await api.recording.pushSegments(segs);
      }
    } catch (err) {
      if (final) {
        toast.error('On-device transcription hit a snag', {
          description: err instanceof Error ? err.message : 'Please try recording again.',
        });
      }
    } finally {
      transcribingRef.current = false;
    }
  }

  // While recording with on-device Whisper, refresh the live transcript on a
  // timer once the model is ready. Cleaned up whenever recording stops/pauses.
  useEffect(() => {
    const canLive = browserWhisper && active && !paused && whisper.state.phase === 'ready';
    if (!canLive) return;
    const tick = () => {
      if (!transcribingRef.current) void runWhisperPass(false);
    };
    liveTimerRef.current = window.setInterval(tick, LIVE_TRANSCRIBE_INTERVAL_MS);
    return () => {
      if (liveTimerRef.current !== null) window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserWhisper, active, paused, whisper.state.phase]);

  // Warm up the on-device model as soon as the record screen opens, so the
  // one-time download is done (or well underway) before the user hits record.
  useEffect(() => {
    if (browserWhisper) void whisper.ensureLoaded().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserWhisper]);

  async function handleStart(forceDemo = false) {
    // The browser preview has no real backend and a web page can't access a
    // microphone, so it cannot transcribe real speech. Rather than fabricate a
    // recording, explain honestly and point to the desktop app.
    if (usingMockApi) {
      setWebInfoOpen(true);
      return;
    }
    const courseId = effectiveCourseId;
    if (!courseId) {
      toast.error('Choose a class first', {
        description: 'Pick which class this lecture belongs to, then start recording.',
      });
      return;
    }
    setStarting(true);

    // Kick off the on-device model download now so it's ready by the time the
    // lecture ends (first run only — it's cached afterwards).
    if (browserWhisper) void whisper.ensureLoaded().catch(() => {});

    let demo = forceDemo;
    if (!demo && mic.supported) {
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

    if (liveTimerRef.current !== null) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }

    if (browserWhisper) {
      // Transcribe the full recording on-device before finalizing the lecture,
      // so the saved transcript is the user's real words — not a partial or
      // empty one. finishRecording() also releases the microphone.
      setFinalizing(true);
      // Wait out any in-flight live pass so it can't clobber the final result.
      while (transcribingRef.current) await new Promise((r) => setTimeout(r, 120));
      await runWhisperPass(true);
      setFinalizing(false);
    } else {
      mic.stop();
    }

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

      {usingMockApi && !active && (
        <div className="flex items-start gap-3 rounded-panel border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-t2">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
          <p>
            <span className="font-semibold text-t1">Web preview.</span> A browser tab can&apos;t use
            your microphone, so real recording and transcription live in the desktop app. You can
            still explore every screen here.
          </p>
        </div>
      )}

      {willFakeTranscript && !active && (
        <div className="flex flex-col gap-3 rounded-panel border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-t2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber" />
            {demoVoice ? (
              <p>
                <span className="font-semibold text-t1">You&apos;re in Demo Voice mode.</span>{' '}
                Recording won&apos;t transcribe what you actually say — it fills in sample text so
                you can try the app. Turn on a real engine to transcribe your own lectures.
              </p>
            ) : (
              <p>
                <span className="font-semibold text-t1">
                  Your transcription engine isn&apos;t set up yet.
                </span>{' '}
                You picked a real engine, but it still needs an API key (or a model path), so
                recording will fall back to demo sample text until you finish setup.
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() =>
              nav(
                selectedRealUnconfigured
                  ? '/settings?tab=providers'
                  : '/settings?tab=transcription',
              )
            }
          >
            {selectedRealUnconfigured ? 'Finish setup' : 'Set up real transcription'}
          </Button>
        </div>
      )}

      {browserWhisper && !active && whisper.state.phase !== 'error' && (
        <div className="flex items-start gap-3 rounded-panel border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-t2">
          {whisper.state.phase === 'ready' ? (
            <>
              <Cpu size={16} className="mt-0.5 shrink-0 text-primary" />
              <p>
                <span className="font-semibold text-t1">On-device transcription ready.</span> Your
                mic is transcribed by Whisper running on your Mac — no API key, and your audio never
                leaves your device.
              </p>
            </>
          ) : (
            <>
              <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-primary" />
              <p>
                <span className="font-semibold text-t1">
                  Preparing on-device transcription
                  {whisper.state.progress > 0
                    ? ` — ${Math.round(whisper.state.progress * 100)}%`
                    : '…'}
                </span>{' '}
                Downloading a small speech model once (needs internet the first time). It&apos;s
                cached afterwards, so future lectures work offline. You can start recording now — it
                finishes in the background.
              </p>
            </>
          )}
        </div>
      )}

      {browserWhisper && !active && whisper.state.phase === 'error' && (
        <div className="flex flex-col gap-3 rounded-panel border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-t2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose" />
            <p>
              <span className="font-semibold text-t1">
                Couldn&apos;t load the on-device speech model.
              </span>{' '}
              The one-time download needs an internet connection. {whisper.state.error}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => void whisper.ensureLoaded().catch(() => {})}
          >
            Try again
          </Button>
        </div>
      )}

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
                  {willFakeTranscript && (
                    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-medium text-amber">
                      <AlertTriangle size={12} />
                      Demo voice — sample text, not your words
                    </span>
                  )}
                  {browserWhisper && !willFakeTranscript && (
                    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {whisper.state.phase === 'ready' ? (
                        <>
                          <Cpu size={12} />
                          On-device Whisper — transcribing your words
                        </>
                      ) : (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Preparing on-device model
                          {whisper.state.progress > 0
                            ? ` · ${Math.round(whisper.state.progress * 100)}%`
                            : '…'}
                        </>
                      )}
                    </span>
                  )}
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
                  {finalizing
                    ? 'Transcribing your lecture on your device… this can take a moment for a long recording.'
                    : willFakeTranscript
                      ? 'Heads up: the transcript will be sample text until a real engine is set up in Settings — not your real words yet.'
                      : browserWhisper
                        ? 'Your words are transcribed on-device with Whisper. The complete transcript is finalized when you press Stop.'
                        : "We'll transcribe everything and build your study kit automatically."}
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
                    {courses.length === 0
                      ? 'Add a class to begin'
                      : effectiveCourseId
                        ? 'Ready when you are'
                        : 'Pick a class to begin'}
                  </p>
                  <p className="mx-auto max-w-xs text-xs text-t3">
                    {courses.length === 0
                      ? 'Create a class with the ＋ next to “Your Classes” in the sidebar, then come back to record.'
                      : 'Tap the button to start capturing. You can pause anytime and stop when class ends.'}
                  </p>
                  {!mic.supported && courses.length > 0 && (
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

      <Modal
        open={webInfoOpen}
        onClose={() => setWebInfoOpen(false)}
        title="Real recording lives in the desktop app"
        description="This web preview can't hear your microphone."
        footer={
          <Button onClick={() => setWebInfoOpen(false)}>Got it</Button>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-t2">
          <p>
            For security, a web page — especially inside another app — isn&apos;t allowed to use
            your microphone, so it can&apos;t transcribe what you say. To keep this preview honest,
            it won&apos;t invent a recording for you.
          </p>
          <p>
            To capture your <span className="font-medium text-t1">real</span> lectures and get a real
            transcript, run the free desktop app. Turn on a transcription engine in{' '}
            <span className="font-medium text-t1">Settings → Transcription</span> — add an OpenAI API
            key for cloud Whisper, or point it at a local whisper.cpp model to stay fully offline.
          </p>
          <p className="text-t3">
            Meanwhile, you can explore every screen here, and open a class&apos;s{' '}
            <span className="font-medium text-t2">Import demo lecture</span> to see a finished,
            clearly-labelled sample.
          </p>
        </div>
      </Modal>
    </div>
  );
}
