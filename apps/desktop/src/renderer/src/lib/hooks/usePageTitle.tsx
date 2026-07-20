import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface PageTitleValue {
  title: string;
  subtitle?: string;
  setPageTitle: (title: string, subtitle?: string) => void;
}

const PageTitleContext = createContext<PageTitleValue | null>(null);

/**
 * Provides the current page title/subtitle to the Topbar. Wrap the app shell in
 * this once; pages announce their heading via {@link usePageTitle}.
 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string; subtitle?: string }>({ title: 'StuddyBuddy' });
  const value = useMemo<PageTitleValue>(
    () => ({
      title: state.title,
      subtitle: state.subtitle,
      setPageTitle: (title, subtitle) => setState({ title, subtitle }),
    }),
    [state],
  );
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/**
 * Read or set the current page title shown in the Topbar.
 *
 * Call with arguments to register this page's title on mount:
 * `usePageTitle('Dashboard', 'Your study home')`. Call with none to read the
 * current value (the Topbar does this).
 */
export function usePageTitle(title?: string, subtitle?: string): PageTitleValue {
  const ctx = useContext(PageTitleContext);
  if (!ctx) throw new Error('usePageTitle must be used within a PageTitleProvider');
  const { setPageTitle } = ctx;
  useEffect(() => {
    if (title !== undefined) setPageTitle(title, subtitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);
  return ctx;
}
