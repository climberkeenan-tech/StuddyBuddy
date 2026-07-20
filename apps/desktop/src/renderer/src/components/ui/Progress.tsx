import { type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface ProgressProps {
  /** 0..1 fraction. Values outside the range are clamped. */
  value: number;
  className?: string;
  /** Height of the track. */
  size?: 'sm' | 'md';
  /** Use a flat solid fill instead of the brand gradient. */
  variant?: 'gradient' | 'solid';
  'aria-label'?: string;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** A horizontal determinate progress bar. */
export function Progress({ value, className, size = 'md', variant = 'gradient', 'aria-label': ariaLabel }: ProgressProps) {
  const pct = clamp(value) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={ariaLabel}
      className={cn('w-full overflow-hidden rounded-full bg-overlay', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', variant === 'gradient' ? 'bg-gradient-primary' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export interface ProgressRingProps {
  /** 0..1 fraction. */
  value: number;
  /** Outer diameter in px. */
  size?: number;
  /** Stroke width in px. */
  thickness?: number;
  className?: string;
  /** Centered content, e.g. a level number or percentage. */
  children?: ReactNode;
  'aria-label'?: string;
}

/**
 * A circular SVG progress ring with a violet→cyan gradient stroke. Place a
 * label via `children` (level number, percentage, small icon).
 */
export function ProgressRing({ value, size = 44, thickness = 4, className, children, 'aria-label': ariaLabel }: ProgressRingProps) {
  const pct = clamp(value);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gradId = `ring-grad-${size}-${thickness}`;
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-label={ariaLabel}
        className="-rotate-90"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgb(var(--sb-primary))" />
            <stop offset="100%" stopColor="rgb(var(--sb-accent))" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sb-stroke-strong)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children != null && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </div>
  );
}
