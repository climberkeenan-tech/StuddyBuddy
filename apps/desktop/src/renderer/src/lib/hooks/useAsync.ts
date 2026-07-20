import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  /** Re-run the async function (e.g. after a mutation or a retry). */
  reload: () => void;
}

/**
 * Run an async function on mount and whenever `deps` change, exposing loading,
 * data, and error, plus a `reload` to re-run on demand. Stale results from a
 * superseded run are discarded so the latest call always wins.
 *
 * @example
 * const { data: courses, loading, error, reload } = useAsync(() => api.courses.list(), []);
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const runId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(undefined);
    fnRef.current().then(
      (value) => {
        if (id === runId.current) {
          setData(value);
          setLoading(false);
        }
      },
      (err: unknown) => {
        if (id === runId.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    run();
    return () => {
      runId.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run };
}
