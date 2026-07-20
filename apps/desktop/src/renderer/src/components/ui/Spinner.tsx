import { cn } from '@renderer/lib/cn';

export interface SpinnerProps {
  /** Diameter in pixels. */
  size?: number;
  className?: string;
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

/** A minimal, theme-aware loading spinner. */
export function Spinner({ size = 18, className, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em]', className)}
      style={{ width: size, height: size }}
    />
  );
}
