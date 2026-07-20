import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, MessageCircleQuestion, Search, X } from 'lucide-react';
import type { SearchHit, Transcript } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync, useDebounce } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { EmptyState, IconButton, Input, Spinner } from '@renderer/components/ui';
import { formatOffset } from '@renderer/lib/format';
import { cn } from '@renderer/lib/cn';
import { InlineText, copyText } from '../lecture-utils';

export interface TranscriptTabProps {
  lectureId: string;
  transcript: Transcript | undefined;
  processing: boolean;
  /** When set (from a `?t=` deep-link), scroll to and highlight this moment. */
  focusMs?: number;
}

/**
 * The transcript reader. With no filter it renders the structured transcript —
 * section headings, teacher questions, and spoken paragraphs, each stamped with
 * its offset and click-to-copy. Typing a keyword runs a lecture-scoped search
 * and shows only the matching moments.
 */
export function TranscriptTab({ lectureId, transcript, processing, focusMs }: TranscriptTabProps) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // The segment to focus for a `?t=` deep-link: the last one that starts at or
  // before the requested offset (falling back to the first).
  const focusId = useMemo(() => {
    if (focusMs === undefined || !transcript || transcript.segments.length === 0) return null;
    let candidate = transcript.segments[0] ?? null;
    for (const s of transcript.segments) {
      if (s.startMs <= focusMs) candidate = s;
      else break;
    }
    return candidate?.id ?? null;
  }, [focusMs, transcript]);

  // Scroll to + briefly highlight the focused segment once it is rendered.
  useEffect(() => {
    if (!focusId || debounced) return;
    setHighlightedId(focusId);
    const raf = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-seg-id="${focusId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const clear = setTimeout(() => setHighlightedId(null), 2600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [focusId, debounced]);

  const {
    data: hits,
    loading: searching,
  } = useAsync<SearchHit[]>(
    () => (debounced ? api.transcripts.search(debounced, { lectureId }) : Promise.resolve([])),
    [debounced, lectureId],
  );

  const keywords = useMemo(() => (debounced ? [debounced] : []), [debounced]);

  async function onCopy(text: string) {
    const ok = await copyText(text);
    if (ok) toast.success('Copied to clipboard');
    else toast.info('Copy isn’t available here', { description: 'Select the text to copy it manually.' });
  }

  if (!transcript || transcript.segments.length === 0) {
    return (
      <EmptyState
        icon={<Search size={22} />}
        title={processing ? 'Still processing…' : 'No transcript yet'}
        hint={
          processing
            ? 'The transcript will stream in as we finish processing this lecture.'
            : 'This lecture doesn’t have a transcript. Record or import a lecture to see one here.'
        }
      />
    );
  }

  const filtering = debounced.length > 0;

  return (
    <div className="space-y-4" ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search this transcript…"
        aria-label="Search this transcript"
        leftIcon={<Search size={16} />}
        rightSlot={
          query ? (
            <IconButton label="Clear search" size="sm" icon={<X size={15} />} onClick={() => setQuery('')} />
          ) : undefined
        }
      />

      {filtering ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-t3">
            {searching ? (
              <>
                <Spinner size={13} /> Searching…
              </>
            ) : (
              <span>
                {(hits?.length ?? 0) === 0
                  ? 'No matches in this lecture.'
                  : `${hits?.length} ${hits?.length === 1 ? 'match' : 'matches'} for “${debounced}”`}
              </span>
            )}
          </div>
          {(hits ?? []).map((hit) => (
            <SegmentRow
              key={hit.chunk.id}
              atMs={hit.chunk.atMs ?? 0}
              text={hit.chunk.text}
              keywords={keywords}
              onCopy={() => onCopy(hit.chunk.text)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {transcript.segments.map((s) => {
            if (s.kind === 'heading') {
              return (
                <h3
                  key={s.id}
                  data-seg-id={s.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg pb-1 pt-5 font-display text-base font-semibold text-t1 transition-colors first:pt-0',
                    highlightedId === s.id && 'bg-primary/10 ring-2 ring-primary/40',
                  )}
                >
                  <span className="text-xs font-normal tabular-nums text-t3">{formatOffset(s.startMs)}</span>
                  {s.text}
                </h3>
              );
            }
            const isQuestion = s.kind === 'question' || s.isTeacherQuestion;
            return (
              <SegmentRow
                key={s.id}
                segId={s.id}
                atMs={s.startMs}
                text={s.text}
                question={isQuestion}
                highlighted={highlightedId === s.id}
                onCopy={() => onCopy(s.text)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegmentRow({
  atMs,
  text,
  keywords,
  question,
  highlighted,
  segId,
  onCopy,
}: {
  atMs: number;
  text: string;
  keywords?: string[];
  question?: boolean;
  highlighted?: boolean;
  segId?: string;
  onCopy: () => void;
}) {
  return (
    <div
      data-seg-id={segId}
      className={cn(
        'group relative flex gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-overlay',
        question && 'border border-primary/25 bg-primary/5',
        highlighted && 'bg-primary/10 ring-2 ring-primary/40',
      )}
    >
      <button
        type="button"
        onClick={onCopy}
        title={`Copy · ${formatOffset(atMs)}`}
        className="focus-ring mt-0.5 shrink-0 select-none font-mono text-xs tabular-nums text-t3 transition-colors hover:text-primary"
      >
        {formatOffset(atMs)}
      </button>
      <div className="min-w-0 flex-1">
        {question && (
          <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <MessageCircleQuestion size={13} /> Professor asked
          </span>
        )}
        <p className={cn('text-sm leading-relaxed', question ? 'italic text-t1' : 'text-t2')}>
          <InlineText text={text} keywords={keywords} />
        </p>
      </div>
      <IconButton
        label="Copy this line"
        size="sm"
        icon={<Copy size={14} />}
        onClick={onCopy}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
