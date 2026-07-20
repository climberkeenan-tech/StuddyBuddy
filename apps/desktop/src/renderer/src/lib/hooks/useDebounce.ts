import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value. The returned value only updates after
 * `ms` have elapsed without a further change — ideal for search-as-you-type.
 *
 * @example
 * const query = useDebounce(rawQuery, 250);
 */
export function useDebounce<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
