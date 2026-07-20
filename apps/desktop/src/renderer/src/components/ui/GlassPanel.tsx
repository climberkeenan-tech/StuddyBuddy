import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Inner padding preset. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PAD = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' } as const;

/**
 * The signature translucent surface: blurred background, hairline border, soft
 * inner highlight and drop shadow. Use for cards, side panels, and overlays.
 */
export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { padding = 'md', className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('glass-panel', PAD[padding], className)} {...rest}>
      {children}
    </div>
  );
});
