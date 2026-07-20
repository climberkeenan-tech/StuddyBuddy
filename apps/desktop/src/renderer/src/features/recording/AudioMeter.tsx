import { useEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/cn';

export interface AudioMeterProps {
  /** Current rolling RMS level, 0..1. */
  level: number;
  /** Whether audio is actively flowing (false → bars settle to a flat idle line). */
  active: boolean;
  /** Number of bars in the waveform. */
  bars?: number;
  className?: string;
}

/**
 * A live scrolling waveform driven by a single `level` scalar. Each status tick
 * pushes the newest level onto a fixed-length history, so the bars animate from
 * right to left like a real level meter. Purely decorative — labelled elsewhere.
 */
export function AudioMeter({ level, active, bars = 48, className }: AudioMeterProps) {
  const [history, setHistory] = useState<number[]>(() => new Array(bars).fill(0));
  const framePendingRef = useRef(false);

  useEffect(() => {
    // Coalesce rapid status ticks into a single state update per frame.
    if (framePendingRef.current) return;
    framePendingRef.current = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    raf(() => {
      framePendingRef.current = false;
      setHistory((prev) => {
        const next = prev.slice(1);
        next.push(active ? Math.max(0, Math.min(1, level)) : 0);
        return next;
      });
    });
  }, [level, active, bars]);

  return (
    <div
      className={cn('flex h-20 items-center justify-center gap-[3px]', className)}
      aria-hidden="true"
    >
      {history.map((value, i) => {
        // A gentle center-weighted envelope so the meter reads as a waveform.
        const envelope = 0.55 + 0.45 * Math.sin((i / (bars - 1)) * Math.PI);
        const heightPct = active ? Math.max(6, value * envelope * 100) : 6;
        return (
          <span
            key={i}
            className={cn(
              'w-[3px] rounded-full transition-[height,background-color] duration-100 ease-out',
              active ? 'bg-gradient-to-t from-primary to-accent' : 'bg-stroke-strong',
            )}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}
