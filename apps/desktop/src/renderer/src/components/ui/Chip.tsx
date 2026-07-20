import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

export interface ChipProps {
  children: ReactNode;
  /** Renders as a toggle button when set; highlights when `selected`. */
  onClick?: () => void;
  selected?: boolean;
  /** Shows a remove affordance; called on click of the ✕. */
  onRemove?: () => void;
  leftIcon?: ReactNode;
  className?: string;
}

/**
 * A small pill for filters, tags, and multi-select. Interactive when given
 * `onClick` (with a `selected` state) and dismissible via `onRemove`.
 */
export function Chip({ children, onClick, selected = false, onRemove, leftIcon, className }: ChipProps) {
  const interactive = Boolean(onClick);
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150',
    selected
      ? 'border-primary/50 bg-primary/15 text-primary'
      : 'border-stroke bg-surface text-t2',
    interactive && !selected && 'hover:border-primary/40 hover:text-t1',
    className,
  );

  const content = (
    <>
      {leftIcon && <span className="shrink-0">{leftIcon}</span>}
      {children}
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="focus-ring -mr-1 ml-0.5 inline-flex rounded-full p-0.5 text-t3 hover:text-rose"
        >
          <X size={12} />
        </span>
      )}
    </>
  );

  return interactive ? (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn('focus-ring', base)}>
      {content}
    </button>
  ) : (
    <span className={base}>{content}</span>
  );
}
