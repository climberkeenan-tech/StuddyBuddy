import { type ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Signed change vs. a prior period; sign drives color + arrow. */
  delta?: { value: string; direction?: 'up' | 'down' };
  icon?: ReactNode;
  /** Series of 0..1 values rendered as a tiny inline sparkline. */
  sparkline?: number[];
  className?: string;
}

/**
 * A compact metric tile: label, large value, optional delta chip and a
 * dependency-free SVG sparkline. Used across the dashboard header row.
 */
export function StatCard({ label, value, delta, icon, sparkline, className }: StatCardProps) {
  const up = delta?.direction !== 'down';
  return (
    <div className={cn('rounded-panel border border-stroke bg-surface p-4 shadow-soft', className)}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-t3">{label}</span>
        {icon && <span className="text-t3">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="font-display text-2xl font-semibold leading-none text-t1">{value}</span>
        {delta && (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', up ? 'text-success' : 'text-rose')}>
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {delta.value}
          </span>
        )}
      </div>
      {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-7 w-full overflow-visible" aria-hidden>
      <polyline points={points} fill="none" stroke="rgb(var(--sb-primary))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
