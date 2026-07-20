import { useEffect, useRef, useState } from 'react';

/**
 * A lightweight stopwatch. Ticks ~4×/s while `running` is true and pauses
 * otherwise; `reset()` zeroes the accumulated time. Used by the games' timers.
 */
export function useElapsed(running: boolean): { elapsedMs: number; reset: () => void } {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const baseRef = useRef(0);

  useEffect(() => {
    if (!running) {
      if (startRef.current !== null) {
        baseRef.current += Date.now() - startRef.current;
        startRef.current = null;
      }
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsedMs(baseRef.current + (Date.now() - startRef.current));
      }
    }, 250);
    return () => {
      if (startRef.current !== null) {
        baseRef.current += Date.now() - startRef.current;
        startRef.current = null;
      }
      clearInterval(id);
    };
  }, [running]);

  const reset = () => {
    baseRef.current = 0;
    startRef.current = running ? Date.now() : null;
    setElapsedMs(0);
  };

  return { elapsedMs, reset };
}
