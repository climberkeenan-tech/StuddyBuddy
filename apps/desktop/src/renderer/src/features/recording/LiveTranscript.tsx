import { useEffect, useRef } from 'react';
import { HelpCircle, Pause } from 'lucide-react';
import type { TranscriptSegment } from '@studdybuddy/shared';
import { formatOffset } from '@renderer/lib/format';
import { cn } from '@renderer/lib/cn';
import { EmptyState } from '@renderer/components/ui';

export interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  /** Whether a session is live (drives the waiting-for-speech hint). */
  live: boolean;
}

/** A single transcript line, styled by its kind. */
function SegmentRow({ segment }: { segment: TranscriptSegment }) {
  const time = formatOffset(segment.startMs);

  if (segment.kind === 'heading') {
    return (
      <div className="pt-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-t2">
          {segment.text}
        </h3>
      </div>
    );
  }

  if (segment.kind === 'pause') {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-t3">
        <span className="h-px flex-1 bg-stroke" />
        <Pause size={12} />
        <span>pause</span>
        <span className="h-px flex-1 bg-stroke" />
      </div>
    );
  }

  const isQuestion = segment.kind === 'question' || segment.isTeacherQuestion;

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 w-11 shrink-0 select-none pt-px text-right font-mono text-[11px] tabular-nums text-t3">
        {time}
      </span>
      {isQuestion ? (
        <p className="flex-1 rounded-lg border border-primary/25 bg-gradient-primary-soft px-3 py-2 text-sm leading-relaxed text-t1">
          <HelpCircle size={14} className="mr-1.5 inline-block -translate-y-px text-primary" />
          {segment.text}
        </p>
      ) : (
        <p className="flex-1 text-sm leading-relaxed text-t1">{segment.text}</p>
      )}
    </div>
  );
}

/**
 * The live-updating transcript panel. Renders incoming {@link TranscriptSegment}s
 * with kind-specific styling (headings, highlighted teacher questions, pause
 * gaps) and keeps the newest line in view unless the reader has scrolled up.
 */
export function LiveTranscript({ segments, live }: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Track whether the reader is pinned to the bottom.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Live transcript"
      className={cn(
        'h-[22rem] space-y-2.5 overflow-y-auto rounded-panel border border-stroke bg-surface/50 p-4',
      )}
    >
      {segments.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            compact
            title={live ? 'Listening…' : 'Your transcript will appear here'}
            hint={
              live
                ? 'Words will stream in as your professor speaks — headings, questions, and pauses are detected automatically.'
                : 'Start recording to capture a live, time-stamped transcript.'
            }
          />
        </div>
      ) : (
        segments.map((segment) => <SegmentRow key={segment.id} segment={segment} />)
      )}
    </div>
  );
}
