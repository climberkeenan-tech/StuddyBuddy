import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, CornerDownRight, FileText, Search as SearchIcon } from 'lucide-react';
import type { SearchHit, SearchScope } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useDebounce } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { Badge, Card, EmptyState, Input, Progress, Skeleton } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { formatOffset } from '@renderer/lib/format';
import { highlightExcerpt, useOpenLecture } from './search-lib';

export interface SearchPanelProps {
  scope: SearchScope;
}

/**
 * Keyword search across every transcript. Debounced input, ranked hits with a
 * relevance bar, course/lecture badges, highlighted excerpts, and a deep-link
 * into the lecture at the matched timestamp.
 */
export function SearchPanel({ scope }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 300);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const reqId = useRef(0);

  useEffect(() => {
    if (debounced.length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    void api.knowledge
      .search(debounced, scope)
      .then((result) => {
        if (id !== reqId.current) return; // latest-wins
        setHits(result);
      })
      .catch((err) => {
        if (id !== reqId.current) return;
        setHits([]);
        toast.error('Search failed', { description: (err as Error).message });
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, scope.courseId, scope.lectureId]);

  const terms = useMemo(() => debounced, [debounced]);

  return (
    <div className="flex flex-col gap-5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        leftIcon={<SearchIcon size={17} />}
        placeholder="Search everything your professors said…"
        aria-label="Search transcripts"
        autoFocus
      />

      {loading ? (
        <SearchSkeletons />
      ) : hits === null ? (
        <EmptyState
          icon={<SearchIcon size={22} />}
          title="Search your lectures word for word"
          hint="Type at least two characters to find the exact moment a topic came up — then jump straight to it."
        />
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={22} />}
          title={`No matches for “${debounced}”`}
          hint="Try a different phrasing, a single keyword, or widen the scope to all courses."
        />
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-t3">
            {hits.length} {hits.length === 1 ? 'result' : 'results'}
          </p>
          <motion.ul
            variants={staggerChildren}
            initial="hidden"
            animate="show"
            className="space-y-2.5"
          >
            {hits.map((hit) => (
              <HitRow key={hit.chunk.id} hit={hit} terms={terms} />
            ))}
          </motion.ul>
        </div>
      )}
    </div>
  );
}

function HitRow({ hit, terms }: { hit: SearchHit; terms: string }) {
  const open = useOpenLecture();
  const pct = Math.round(hit.score * 100);
  return (
    <motion.li variants={fadeSlideUp}>
      <Card
        interactive
        padding="md"
        role="button"
        tabIndex={0}
        onClick={() =>
          void open(hit.chunk.lectureId, { courseId: hit.chunk.courseId, atMs: hit.chunk.atMs })
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void open(hit.chunk.lectureId, { courseId: hit.chunk.courseId, atMs: hit.chunk.atMs });
          }
        }}
        className="group space-y-2.5"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="primary" leftIcon={<FileText size={12} />}>
            {hit.courseName}
          </Badge>
          <span className="text-t2">
            Lecture {hit.lectureNumber} · {hit.lectureTitle}
          </span>
          {hit.chunk.atMs != null && (
            <span className="flex items-center gap-1 tabular-nums text-t3">
              <Clock size={11} />
              {formatOffset(hit.chunk.atMs)}
            </span>
          )}
        </div>

        <p className="text-sm leading-relaxed text-t2">{highlightExcerpt(hit.chunk.text, terms)}</p>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Progress value={hit.score} size="sm" aria-label={`Relevance ${pct}%`} />
          </div>
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-t3">{pct}%</span>
          <span
            className={cn(
              'flex items-center gap-1 text-xs font-medium text-accent opacity-0 transition',
              'group-hover:opacity-100',
            )}
          >
            Open <CornerDownRight size={13} />
          </span>
        </div>
      </Card>
    </motion.li>
  );
}

function SearchSkeletons() {
  return (
    <div className="space-y-2.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} padding="md" className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Skeleton width={90} height={20} />
            <Skeleton width={160} height={14} />
          </div>
          <Skeleton height={14} />
          <Skeleton width="70%" height={14} />
          <Skeleton height={6} />
        </Card>
      ))}
    </div>
  );
}
