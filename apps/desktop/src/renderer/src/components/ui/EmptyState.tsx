import { type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  /** Primary call-to-action (usually a Button). */
  action?: ReactNode;
  className?: string;
  /** Compact variant for inline/empty list rows. */
  compact?: boolean;
}

/**
 * The friendly "nothing here yet" panel. Always give a real, encouraging
 * `title` and, where possible, an `action` that moves the student forward.
 */
export function EmptyState({ icon, title, hint, action, className, compact = false }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-8' : 'gap-3 py-16',
        className,
      )}
    >
      {icon && (
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl border border-stroke bg-gradient-primary-soft text-primary">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-t1">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-t3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
