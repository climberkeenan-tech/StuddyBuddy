import { useMemo, useState } from 'react';
import { MessageSquareText, Search as SearchIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { SearchScope } from '@studdybuddy/shared';
import { usePageTitle } from '@renderer/lib/hooks';
import { PageHeader } from '@renderer/components/layout';
import { SegmentedControl } from '@renderer/components/ui';
import { AskPanel } from './AskPanel';
import { SearchPanel } from './SearchPanel';
import { ScopeSelector } from './ScopeSelector';

type Mode = 'ask' | 'search';

const MODE_OPTIONS = [
  { value: 'ask' as const, label: 'Ask AI', icon: <MessageSquareText size={15} /> },
  { value: 'search' as const, label: 'Search', icon: <SearchIcon size={15} /> },
];

/**
 * Ask AI + Search — the ChatGPT-style Q&A over your lectures and a keyword
 * search across every transcript. The mode toggles between a grounded chat
 * surface and ranked, deep-linkable search hits; an optional scope narrows
 * either to a single course or lecture (seeded from `?courseId`/`?lectureId`).
 */
export default function SearchPage() {
  const [params] = useSearchParams();

  const initialMode: Mode = params.get('mode') === 'search' ? 'search' : 'ask';
  const [mode, setMode] = useState<Mode>(initialMode);

  const initialScope = useMemo<SearchScope>(() => {
    const courseId = params.get('courseId') ?? undefined;
    const lectureId = params.get('lectureId') ?? undefined;
    return { courseId, lectureId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [scope, setScope] = useState<SearchScope>(initialScope);

  usePageTitle(
    'Ask AI',
    mode === 'ask'
      ? 'Ask questions across everything you have learned.'
      : 'Search every word your professors said.',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask AI"
        subtitle="Get grounded answers and pinpoint moments from your lectures."
        actions={
          <SegmentedControl
            aria-label="Choose Ask or Search"
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
          />
        }
      />

      <ScopeSelector scope={scope} onChange={setScope} />

      {mode === 'ask' ? <AskPanel scope={scope} /> : <SearchPanel scope={scope} />}
    </div>
  );
}
