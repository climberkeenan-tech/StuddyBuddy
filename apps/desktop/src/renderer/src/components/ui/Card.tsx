import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover elevation + border highlight; use for clickable cards. */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PAD = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-7' } as const;

/**
 * A solid raised surface for lists and grids. Pair with `interactive` for
 * clickable rows/tiles — it gains hover lift and a primary-tinted border.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, padding = 'md', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-panel border border-stroke bg-surface shadow-soft',
        PAD[padding],
        interactive &&
          'cursor-pointer transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop focus-within:border-primary/50',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
