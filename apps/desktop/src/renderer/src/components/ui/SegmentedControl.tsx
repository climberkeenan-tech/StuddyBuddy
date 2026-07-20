import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { springSnappy } from '@renderer/lib/motion';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * A pill group where the selected option's background slides between segments
 * via a shared `layoutId`. Good for compact 2–4 way switches (theme, view mode).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-1 rounded-xl border border-stroke bg-surface p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring relative inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active ? 'text-t1' : 'text-t3 hover:text-t2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${groupId}`}
                transition={springSnappy}
                className="absolute inset-0 rounded-lg border border-stroke bg-overlay shadow-soft"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
