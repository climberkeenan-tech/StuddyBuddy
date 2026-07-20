import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  FileText,
  Maximize2,
  Minimize2,
  NotebookText,
  Presentation,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import type { SlideDeck, SlideExportFormat, SlideLayout } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { relativeTime } from '@renderer/lib/format';
import { useAsync, usePageTitle } from '@renderer/lib/hooks';
import { PageHeader } from '@renderer/components/layout';
import {
  Badge,
  Button,
  DropdownMenu,
  EmptyState,
  GlassPanel,
  IconButton,
  Skeleton,
  Tooltip,
  type DropdownEntry,
} from '@renderer/components/ui';
import { useToast } from '@renderer/components/toast';
import { SlideStage } from './SlideStage';

const DEFAULT_ACCENT = '#7c3aed';

const EXPORT_OPTIONS: { format: SlideExportFormat; label: string; hint: string }[] = [
  { format: 'pptx', label: 'PowerPoint (.pptx)', hint: 'Editable slides' },
  { format: 'pdf', label: 'PDF', hint: 'Print & share' },
  { format: 'markdown', label: 'Markdown', hint: 'Plain text outline' },
  { format: 'notebooklm', label: 'NotebookLM', hint: 'Import to NotebookLM' },
];

const LAYOUT_LABEL: Record<SlideLayout, string> = {
  title: 'Title',
  section: 'Section',
  bullets: 'Bullets',
  diagram: 'Diagram',
  chart: 'Chart',
  timeline: 'Timeline',
  quote: 'Quote',
  'two-column': 'Two column',
};

/**
 * The slideshow viewer and exporter for a lecture. Loads the AI-generated deck
 * (offering a Generate CTA when none exists yet), renders each slide on a
 * full-bleed 16:9 stage, and supports keyboard/thumbnail navigation, a speaker-
 * notes panel, a distraction-free present mode, and export to PPTX/PDF/Markdown/
 * NotebookLM.
 */
export default function SlidesPage() {
  const { lectureId = '' } = useParams<{ lectureId: string }>();
  const nav = useNavigate();
  const toast = useToast();
  usePageTitle('Slides', 'Your lecture as a presentation.');

  const { data: deck, loading, error, reload } = useAsync<SlideDeck | null>(
    () => api.slides.get(lectureId),
    [lectureId],
  );

  const { data: course } = useAsync(
    () => (deck ? api.courses.get(deck.courseId) : Promise.resolve(null)),
    [deck?.courseId],
  );
  const deckAccent = course?.color ?? DEFAULT_ACCENT;
  const dark = document.documentElement.classList.contains('dark');

  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<SlideExportFormat | null>(null);
  const presentRef = useRef<HTMLDivElement>(null);

  const slides = deck?.slides ?? [];
  const count = slides.length;
  const current = slides[Math.min(index, Math.max(0, count - 1))];

  // Keep the index valid if the deck changes underneath us.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, count - 1)));
  }, [count]);

  const goTo = useCallback(
    (next: number) => {
      setIndex((i) => {
        const target = typeof next === 'number' ? next : i;
        return Math.max(0, Math.min(count - 1, target));
      });
    },
    [count],
  );
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);

  const exitPresent = useCallback(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    setPresenting(false);
  }, []);

  const enterPresent = useCallback(() => {
    setPresenting(true);
    const el = presentRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => {
        /* fullscreen denied — the in-app present overlay still works */
      });
    }
  }, []);

  // Sync present state when the user leaves OS fullscreen (Esc / F11).
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setPresenting(false);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Global keyboard navigation while a deck is loaded.
  useEffect(() => {
    if (!count) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          prev();
          break;
        case 'Home':
          e.preventDefault();
          goTo(0);
          break;
        case 'End':
          e.preventDefault();
          goTo(count - 1);
          break;
        case 'n':
        case 'N':
          setShowNotes((v) => !v);
          break;
        case 'f':
        case 'F':
          if (presenting) exitPresent();
          else enterPresent();
          break;
        case 'Escape':
          if (presenting) exitPresent();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, next, prev, goTo, presenting, enterPresent, exitPresent]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await api.slides.generate(lectureId);
      reload();
      toast.success('Slides ready', { description: 'Your lecture has been turned into a deck.' });
    } catch (e) {
      toast.error('Could not generate slides', { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport(format: SlideExportFormat) {
    if (!deck) return;
    setExporting(format);
    try {
      const result = await api.slides.export(deck.id, format);
      toast.success('Export complete', {
        description: result.filePath,
        action: { label: 'Open', onClick: () => void api.system.openPath(result.filePath).catch(() => {}) },
      });
    } catch (e) {
      toast.error('Export failed', { description: (e as Error).message });
    } finally {
      setExporting(null);
    }
  }

  const exportItems: DropdownEntry[] = EXPORT_OPTIONS.map((opt) => ({
    key: opt.format,
    label: (
      <span className="flex flex-col">
        <span className="text-t1">{opt.label}</span>
        <span className="text-xs text-t3">{opt.hint}</span>
      </span>
    ),
    icon: exporting === opt.format ? <Spinner /> : <FileDown size={16} />,
    disabled: exporting !== null,
    onSelect: () => void handleExport(opt.format),
  }));

  // ——— Loading ———
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton height={40} width="40%" />
        <Skeleton className="aspect-video w-full rounded-panel" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-28 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ——— Error / no deck ———
  if (error || !deck) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Slides"
          subtitle="Turn this lecture into a polished, presentable deck."
          eyebrow={
            <Link to={`/learn/${lectureId}`} className="text-sm text-t3 transition-colors hover:text-t1">
              ← Back to lecture
            </Link>
          }
        />
        <GlassPanel padding="lg">
          <EmptyState
            icon={<Presentation size={26} />}
            title={error ? 'Slides unavailable' : 'No slides yet'}
            hint={
              error
                ? error.message
                : 'Generate a beautiful slide deck from this lecture — titles, bullets, diagrams and charts, ready to present.'
            }
            action={
              <div className="flex gap-3">
                {error && (
                  <Button variant="secondary" onClick={reload}>
                    Try again
                  </Button>
                )}
                <Button leftIcon={<Sparkles size={16} />} loading={generating} onClick={handleGenerate}>
                  Generate slides
                </Button>
              </div>
            }
          />
        </GlassPanel>
      </div>
    );
  }

  // ——— Present (fullscreen) overlay ———
  const stage = current ? (
    <SlideStage slide={current} deckAccent={deckAccent} dark={dark || presenting} className="h-full w-full" />
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={deck.title}
        subtitle={`${count} slide${count === 1 ? '' : 's'} · updated ${relativeTime(deck.createdAt)}`}
        eyebrow={
          <button
            type="button"
            onClick={() => nav(`/learn/${lectureId}`)}
            className="text-sm text-t3 transition-colors hover:text-t1"
          >
            ← Back to lecture
          </button>
        }
        actions={
          <div className="flex items-center gap-2">
            <Tooltip content="Speaker notes (N)">
              <IconButton
                label="Toggle speaker notes"
                variant={showNotes ? 'primary' : 'surface'}
                icon={<StickyNote size={18} />}
                onClick={() => setShowNotes((v) => !v)}
              />
            </Tooltip>
            <Button variant="secondary" leftIcon={<Maximize2 size={16} />} onClick={enterPresent}>
              Present
            </Button>
            <DropdownMenu
              trigger={
                <Button leftIcon={<Download size={16} />} loading={exporting !== null}>
                  Export
                </Button>
              }
              items={exportItems}
            />
          </div>
        }
      />

      {/* Stage */}
      <div className="relative">
        <div className="group relative aspect-video w-full overflow-hidden rounded-panel border border-stroke bg-panel/70 shadow-soft">
          {stage}

          {/* Slide counter */}
          <div className="absolute bottom-3 left-3 z-10">
            <Badge variant="neutral" solid>
              {index + 1} / {count}
            </Badge>
          </div>
          {current && (
            <div className="absolute right-3 top-3 z-10">
              <Badge variant="primary">{LAYOUT_LABEL[current.layout]}</Badge>
            </div>
          )}

          {/* Edge nav */}
          <StageNav side="left" disabled={index === 0} onClick={prev} />
          <StageNav side="right" disabled={index >= count - 1} onClick={next} />
        </div>

        {/* Live region for screen readers */}
        <p className="sr-only" aria-live="polite">
          {current ? `Slide ${index + 1} of ${count}: ${current.title}` : ''}
        </p>
      </div>

      {/* Progress dots + prev/next */}
      <div className="flex items-center justify-center gap-4">
        <IconButton label="Previous slide" variant="surface" icon={<ChevronLeft size={18} />} onClick={prev} disabled={index === 0} />
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                'focus-ring h-2 rounded-full transition-all duration-200',
                i === index ? 'w-6 bg-primary' : 'w-2 bg-stroke-strong hover:bg-t3',
              )}
            />
          ))}
        </div>
        <IconButton label="Next slide" variant="surface" icon={<ChevronRight size={18} />} onClick={next} disabled={index >= count - 1} />
      </div>

      {/* Speaker notes */}
      {showNotes && current && (
        <GlassPanel className="space-y-2">
          <div className="flex items-center gap-2 text-t2">
            <NotebookText size={16} />
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Speaker notes</h2>
          </div>
          <p className="text-t1">{current.speakerNotes || 'No notes for this slide.'}</p>
        </GlassPanel>
      )}

      {/* Thumbnail rail */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-t2">
          <FileText size={15} /> All slides
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              aria-current={i === index}
              className={cn(
                'focus-ring group relative flex aspect-video w-36 shrink-0 flex-col justify-between overflow-hidden rounded-lg border p-2.5 text-left transition-all duration-150',
                i === index
                  ? 'border-primary bg-surface shadow-glow'
                  : 'border-stroke bg-surface/50 hover:border-stroke-strong hover:bg-surface',
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-t3">
                {i + 1} · {LAYOUT_LABEL[s.layout]}
              </span>
              <span className="line-clamp-2 font-display text-xs font-semibold leading-tight text-t1">
                {s.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Present-mode overlay */}
      {presenting && current && (
        <div
          ref={presentRef}
          className="fixed inset-0 z-[60] flex flex-col bg-bg"
          role="region"
          aria-label="Presentation"
        >
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            <div className="relative aspect-video max-h-full w-full max-w-[min(100vw,177.78vh)]">
              <SlideStage slide={current} deckAccent={deckAccent} dark className="h-full w-full" />
            </div>
            <StageNav side="left" disabled={index === 0} onClick={prev} />
            <StageNav side="right" disabled={index >= count - 1} onClick={next} />
          </div>

          {/* Present controls */}
          <div className="flex items-center justify-between gap-4 border-t border-stroke bg-panel/80 px-6 py-3 backdrop-blur">
            <Badge variant="neutral" solid>
              {index + 1} / {count}
            </Badge>
            {showNotes && (
              <p className="line-clamp-2 flex-1 text-center text-sm text-t2">{current.speakerNotes}</p>
            )}
            <div className="flex items-center gap-2">
              <IconButton label="Previous slide" variant="surface" icon={<ChevronLeft size={18} />} onClick={prev} disabled={index === 0} />
              <IconButton label="Next slide" variant="surface" icon={<ChevronRight size={18} />} onClick={next} disabled={index >= count - 1} />
              <Tooltip content="Speaker notes (N)">
                <IconButton
                  label="Toggle speaker notes"
                  variant={showNotes ? 'primary' : 'surface'}
                  icon={<StickyNote size={18} />}
                  onClick={() => setShowNotes((v) => !v)}
                />
              </Tooltip>
              <Tooltip content="Exit present (Esc)">
                <IconButton label="Exit present mode" variant="surface" icon={<Minimize2 size={18} />} onClick={exitPresent} />
              </Tooltip>
              <IconButton label="Close" variant="surface" icon={<X size={18} />} onClick={exitPresent} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small inline spinner used inside dropdown item icons. */
function Spinner() {
  return <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-stroke border-t-primary" />;
}

/** Left/right edge navigation control overlaid on the stage. */
function StageNav({
  side,
  onClick,
  disabled,
}: {
  side: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous slide' : 'Next slide'}
      className={cn(
        'focus-ring absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-stroke bg-overlay/80 text-t1 opacity-0 shadow-pop backdrop-blur transition-all duration-150 hover:bg-overlay focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-0',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      {side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
