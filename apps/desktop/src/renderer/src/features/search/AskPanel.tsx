import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Clock, Quote, Sparkles, Trash2, User } from 'lucide-react';
import type { AskAnswer, Citation, SearchScope } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useToast } from '@renderer/components/toast';
import {
  Button,
  Card,
  EmptyState,
  GlassPanel,
  IconButton,
  Markdown,
  Spinner,
  Textarea,
  Tooltip,
} from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp } from '@renderer/lib/motion';
import { formatOffset } from '@renderer/lib/format';
import { useOpenLecture } from './search-lib';

interface QaEntry {
  id: string;
  question: string;
  answer?: AskAnswer;
  error?: string;
}

const SUGGESTIONS = [
  'What did my professor say about DNA replication?',
  'Summarize the key differences covered this week.',
  'Which concepts were flagged as likely exam questions?',
  'Explain the Meselson–Stahl experiment in simple terms.',
];

let entrySeq = 0;

export interface AskPanelProps {
  scope: SearchScope;
  /** Question to auto-ask on mount (from a `?q=` deep-link, e.g. Smart Review). */
  initialQuestion?: string;
}

/**
 * The "Ask AI" chat surface: a running transcript of grounded Q&A. Each answer
 * renders as Markdown with numbered citation chips that scroll to a sources
 * list; every source deep-links into the lecture at its timestamp.
 */
export function AskPanel({ scope, initialQuestion }: AskPanelProps) {
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<QaEntry[]>([]);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const listEndRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      const el = listEndRef.current;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
  };

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || pending) return;
    const id = `qa-${++entrySeq}`;
    setEntries((prev) => [...prev, { id, question: q }]);
    setQuestion('');
    setPending(true);
    scrollToEnd();
    try {
      const answer = await api.knowledge.ask(q, scope);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, answer } : e)));
    } catch (err) {
      const message = (err as Error).message;
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, error: message } : e)));
      toast.error('Could not answer that', { description: message });
    } finally {
      setPending(false);
      scrollToEnd();
    }
  };

  // Auto-run a deep-linked question exactly once on mount.
  const didAutoAsk = useRef(false);
  useEffect(() => {
    if (!didAutoAsk.current && initialQuestion && initialQuestion.trim()) {
      didAutoAsk.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(question);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {entries.length === 0 ? (
        <EmptyAsk onPick={(s) => void ask(s)} disabled={pending} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-t3">
              This session
            </p>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 size={15} />}
              onClick={() => setEntries([])}
            >
              Clear
            </Button>
          </div>
          {entries.map((entry) => (
            <QaBlock key={entry.id} entry={entry} />
          ))}
          <div ref={listEndRef} />
        </div>
      )}

      <form onSubmit={onSubmit} className="sticky bottom-0 -mx-1 px-1 pb-1">
        <GlassPanel padding="sm" className="flex items-end gap-2 shadow-pop">
          <div className="flex-1">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              aria-label="Ask a question about your lectures"
              placeholder="Ask anything about your lectures…"
              className="max-h-40 min-h-[2.75rem] resize-none border-0 bg-transparent px-2 py-2 focus:ring-0"
            />
          </div>
          <IconButton
            type="submit"
            label="Send question"
            variant="primary"
            size="md"
            disabled={!question.trim() || pending}
            icon={pending ? <Spinner size={16} /> : <ArrowUp size={18} />}
          />
        </GlassPanel>
        <p className="mt-1.5 px-2 text-[0.7rem] text-t3">
          Answers are grounded in your recorded lectures. Press Enter to send, Shift+Enter for a new line.
        </p>
      </form>
    </div>
  );
}

function EmptyAsk({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  return (
    <GlassPanel className="flex flex-col items-center gap-5 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary-soft text-primary">
        <Sparkles size={26} />
      </span>
      <div className="space-y-1.5">
        <h3 className="font-display text-lg font-semibold text-t1">Ask your lectures anything</h3>
        <p className="mx-auto max-w-md text-sm text-t2">
          I read across everything you have recorded and answer with citations you can jump into.
          Try one of these to get started:
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className={cn(
              'group rounded-panel border border-stroke bg-surface px-4 py-3 text-left text-sm text-t2 transition',
              'hover:border-stroke-strong hover:bg-panel hover:text-t1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="flex items-start gap-2">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-primary/70 group-hover:text-primary" />
              {s}
            </span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

function QaBlock({ entry }: { entry: QaEntry }) {
  const citeRefs = useRef<Record<number, HTMLLIElement | null>>({});

  const scrollToCitation = (index: number) => {
    const el = citeRefs.current[index];
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (typeof el.animate === 'function') {
      el.animate(
        [
          { backgroundColor: 'rgb(var(--sb-primary) / 0.14)' },
          { backgroundColor: 'rgb(var(--sb-primary) / 0)' },
        ],
        { duration: 1200, easing: 'ease-out' },
      );
    }
  };

  return (
    <motion.div variants={fadeSlideUp} initial="hidden" animate="show" className="flex flex-col gap-3">
      {/* Question bubble */}
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[80%] rounded-panel rounded-tr-md bg-gradient-primary px-4 py-2.5 text-sm font-medium text-white shadow-soft">
          {entry.question}
        </div>
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-t2">
          <User size={15} />
        </span>
      </div>

      {/* Answer */}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-primary-soft text-primary">
          <Sparkles size={15} />
        </span>
        <div className="min-w-0 flex-1">
          {entry.error ? (
            <Card padding="md" className="border-rose/40 bg-rose/5 text-sm text-t2">
              {entry.error}
            </Card>
          ) : !entry.answer ? (
            <div className="flex items-center gap-2 py-2 text-sm text-t3">
              <Spinner size={16} />
              Reading your lectures…
            </div>
          ) : (
            <AnswerBody answer={entry.answer} onCitationClick={scrollToCitation} citeRefs={citeRefs} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AnswerBody({
  answer,
  onCitationClick,
  citeRefs,
}: {
  answer: AskAnswer;
  onCitationClick: (index: number) => void;
  citeRefs: React.MutableRefObject<Record<number, HTMLLIElement | null>>;
}) {
  const hasCitations = answer.citations.length > 0;
  return (
    <Card padding="lg" className="space-y-4">
      <Markdown className="text-sm leading-relaxed text-t1">{answer.markdown}</Markdown>

      {answer.noSources ? (
        <div className="flex items-start gap-2 rounded-panel border border-stroke bg-surface px-3.5 py-3 text-xs text-t2">
          <Quote size={14} className="mt-0.5 shrink-0 text-t3" />
          <span>
            No lecture matched this yet. Record or import a lecture on the topic and ask again — every
            answer here is grounded in what you have captured.
          </span>
        </div>
      ) : hasCitations ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-t3">Sources:</span>
            {answer.citations.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onCitationClick(i)}
                className={cn(
                  'flex h-6 min-w-6 items-center justify-center rounded-md border border-stroke bg-surface px-1.5 text-xs font-semibold tabular-nums text-accent transition',
                  'hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                )}
                aria-label={`Jump to source ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <ol className="space-y-2">
            {answer.citations.map((citation, i) => (
              <CitationCard
                key={i}
                index={i}
                citation={citation}
                setRef={(el) => {
                  citeRefs.current[i] = el;
                }}
              />
            ))}
          </ol>
        </div>
      ) : null}

      <p className="text-[0.7rem] text-t3">Generated by {answer.generatedBy}</p>
    </Card>
  );
}

const CitationCard = ({
  index,
  citation,
  setRef,
}: {
  index: number;
  citation: Citation;
  setRef: (el: HTMLLIElement | null) => void;
}) => {
  const open = useOpenLecture();
  return (
    <li ref={setRef} className="scroll-mt-6 rounded-panel border border-stroke bg-surface transition">
      <button
        type="button"
        onClick={() => void open(citation.lectureId, { atMs: citation.atMs })}
        className={cn(
          'flex w-full items-start gap-3 px-3.5 py-3 text-left transition',
          'hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        )}
      >
        <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-gradient-primary-soft px-1.5 text-xs font-semibold tabular-nums text-primary">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-t3">
            <span className="font-medium text-t2">{citation.courseName}</span>
            <span aria-hidden>·</span>
            <span>{citation.lectureTitle}</span>
            {citation.atMs != null && (
              <span className="flex items-center gap-1 tabular-nums">
                <Clock size={11} />
                {formatOffset(citation.atMs)}
              </span>
            )}
          </span>
          <span className="block text-sm italic text-t2">“{citation.excerpt}”</span>
        </span>
      </button>
    </li>
  );
};
