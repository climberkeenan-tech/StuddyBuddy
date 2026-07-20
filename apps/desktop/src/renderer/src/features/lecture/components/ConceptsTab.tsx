import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookMarked,
  CalendarClock,
  Flame,
  Quote,
  Repeat2,
  Sigma,
  Sparkles,
  Target,
} from 'lucide-react';
import type { LectureAnalysis } from '@studdybuddy/shared';
import { Badge, Card, EmptyState, Progress } from '@renderer/components/ui';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { formatOffset } from '@renderer/lib/format';
import { ConceptExplainer } from './ConceptExplainer';

export interface ConceptsTabProps {
  lectureId: string;
  analysis: LectureAnalysis | undefined;
  /** True while the analysis is still being produced. */
  processing: boolean;
}

function Meter({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'solid' }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-medium text-t3">
        <span>{label}</span>
        <span className="tabular-nums text-t2">{Math.round(value * 100)}%</span>
      </div>
      <Progress value={value} size="sm" variant={tone === 'primary' ? 'gradient' : 'solid'} aria-label={label} />
    </div>
  );
}

/**
 * The analysis tab: concept cards with importance / exam-likelihood / difficulty
 * meters, exam and struggle watchlists, and reference panels (definitions,
 * formulas, key dates, vocabulary). Clicking a concept opens the AI explainer.
 */
export function ConceptsTab({ lectureId, analysis, processing }: ConceptsTabProps) {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of analysis?.concepts ?? []) map.set(c.id, c.name);
    return map;
  }, [analysis]);

  if (!analysis) {
    return (
      <EmptyState
        icon={<Sparkles size={22} />}
        title={processing ? 'Still processing…' : 'No analysis yet'}
        hint={
          processing
            ? 'We’re reading through the lecture and pulling out the key concepts. This only takes a moment.'
            : 'Once this lecture finishes processing, its concepts, definitions, and exam watchlist will appear here.'
        }
      />
    );
  }

  const examWatch = analysis.examWatchlist
    .map((id) => analysis.concepts.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const struggleWatch = analysis.struggleWatchlist
    .map((id) => analysis.concepts.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  function explain(name: string) {
    setActive(name);
    setOpen(true);
  }

  return (
    <div className="space-y-8">
      {analysis.gist && (
        <Card padding="md" className="border-primary/25 bg-gradient-primary-soft">
          <p className="text-sm leading-relaxed text-t1">{analysis.gist}</p>
        </Card>
      )}

      {/* Concept cards */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold text-t2">Concepts in this lecture</h3>
        <motion.div
          variants={staggerChildren}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-2"
        >
          {analysis.concepts.map((c) => (
            <motion.div key={c.id} variants={fadeSlideUp}>
              <Card
                interactive
                padding="md"
                role="button"
                tabIndex={0}
                aria-label={`Explain ${c.name}`}
                onClick={() => explain(c.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    explain(c.name);
                  }
                }}
                className="flex h-full flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-display font-semibold text-t1">{c.name}</h4>
                  {analysis.examWatchlist.includes(c.id) && (
                    <Badge variant="amber" leftIcon={<Target size={11} />}>
                      Exam
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-t3">{c.summary}</p>
                <div className="mt-auto space-y-2 pt-1">
                  <Meter label="Importance" value={c.importance} tone="primary" />
                  <Meter label="Exam likelihood" value={c.examLikelihood} tone="solid" />
                  <Meter label="Difficulty" value={c.difficulty} tone="solid" />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-t3">
                  <span className="inline-flex items-center gap-1">
                    <Repeat2 size={12} /> {c.mentions} mentions
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock size={12} /> first at {formatOffset(c.firstMentionMs)}
                  </span>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Watchlists */}
      <div className="grid gap-4 md:grid-cols-2">
        {examWatch.length > 0 && (
          <Card padding="md" className="space-y-3">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-t1">
              <Target size={16} className="text-amber" /> Exam watchlist
            </h3>
            <ul className="space-y-2">
              {examWatch.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => explain(c.name)}
                    className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-t2 transition-colors hover:bg-overlay hover:text-t1"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-xs text-amber">
                      {Math.round(c.examLikelihood * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {struggleWatch.length > 0 && (
          <Card padding="md" className="space-y-3">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-t1">
              <Flame size={16} className="text-rose" /> Commonly tricky
            </h3>
            <ul className="space-y-2">
              {struggleWatch.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => explain(c.name)}
                    className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-t2 transition-colors hover:bg-overlay hover:text-t1"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-xs text-rose">
                      {Math.round(c.difficulty * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* Reference panels */}
      {analysis.definitions.length > 0 && (
        <ReferencePanel icon={<BookMarked size={16} className="text-sky" />} title="Definitions">
          {analysis.definitions.map((d) => (
            <div key={d.id} className="space-y-0.5">
              <p className="text-sm font-semibold text-t1">{d.term}</p>
              <p className="text-sm text-t3">{d.definition}</p>
            </div>
          ))}
        </ReferencePanel>
      )}

      {analysis.formulas.length > 0 && (
        <ReferencePanel icon={<Sigma size={16} className="text-primary" />} title="Formulas">
          {analysis.formulas.map((f) => (
            <div key={f.id} className="space-y-1">
              <p className="text-sm font-semibold text-t1">{f.name}</p>
              <p className="rounded-lg border border-stroke bg-bg/50 px-3 py-1.5 font-mono text-[13px] text-primary">
                {f.expression}
              </p>
              <p className="text-sm text-t3">{f.explanation}</p>
            </div>
          ))}
        </ReferencePanel>
      )}

      {analysis.keyDates.length > 0 && (
        <ReferencePanel icon={<CalendarClock size={16} className="text-amber" />} title="Key dates">
          {analysis.keyDates.map((k) => (
            <div key={k.id} className="flex gap-3">
              <span className="shrink-0 font-mono text-sm font-semibold text-amber">{k.label}</span>
              <span className="text-sm text-t3">{k.event}</span>
            </div>
          ))}
        </ReferencePanel>
      )}

      {analysis.emphasisCues.length > 0 && (
        <ReferencePanel icon={<Quote size={16} className="text-primary" />} title="What the professor stressed">
          {analysis.emphasisCues.map((cue) => (
            <blockquote key={cue.id} className="border-l-2 border-primary/50 pl-3 text-sm italic text-t2">
              &ldquo;{cue.quote}&rdquo;
              {cue.conceptId && nameById.get(cue.conceptId) && (
                <span className="ml-1 not-italic text-t3">— {nameById.get(cue.conceptId)}</span>
              )}
            </blockquote>
          ))}
        </ReferencePanel>
      )}

      {analysis.vocabulary.length > 0 && (
        <ReferencePanel icon={<BookMarked size={16} className="text-success" />} title="Vocabulary">
          <div className="grid gap-3 sm:grid-cols-2">
            {analysis.vocabulary.map((v) => (
              <div key={v.id} className="space-y-0.5">
                <p className="text-sm font-semibold text-t1">
                  {v.term}
                  {v.partOfSpeech && <span className="ml-1.5 text-xs font-normal italic text-t3">{v.partOfSpeech}</span>}
                </p>
                <p className="text-sm text-t3">{v.meaning}</p>
              </div>
            ))}
          </div>
        </ReferencePanel>
      )}

      <ConceptExplainer open={open} onClose={() => setOpen(false)} lectureId={lectureId} conceptName={active} />
    </div>
  );
}

function ReferencePanel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="md" className="space-y-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-t1">
        {icon}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}
