import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'amber'
  | 'rose'
  | 'sky'
  | 'bronze'
  | 'silver'
  | 'gold';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Solid tier badges (bronze/silver/gold) use the tier gradient. */
  solid?: boolean;
  leftIcon?: ReactNode;
}

const SOFT: Record<BadgeVariant, string> = {
  neutral: 'bg-overlay text-t2 border-stroke',
  primary: 'bg-primary/12 text-primary border-primary/25',
  success: 'bg-success/12 text-success border-success/25',
  amber: 'bg-amber/12 text-amber border-amber/25',
  rose: 'bg-rose/12 text-rose border-rose/25',
  sky: 'bg-sky/12 text-sky border-sky/25',
  bronze: 'bg-bronze/15 text-bronze border-bronze/30',
  silver: 'bg-silver/15 text-silver border-silver/30',
  gold: 'bg-gold/15 text-gold border-gold/30',
};

const SOLID: Partial<Record<BadgeVariant, string>> = {
  bronze: 'bg-gradient-bronze text-white border-transparent',
  silver: 'bg-gradient-silver text-white border-transparent',
  gold: 'bg-gradient-gold text-white border-transparent',
  primary: 'bg-gradient-primary text-white border-transparent',
};

/**
 * A compact status/label pill. Semantic variants plus achievement tiers
 * (bronze/silver/gold); pass `solid` for the celebratory gradient treatment.
 */
export function Badge({ variant = 'neutral', solid = false, leftIcon, className, children, ...rest }: BadgeProps) {
  const style = solid && SOLID[variant] ? SOLID[variant] : SOFT[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
        style,
        className,
      )}
      {...rest}
    >
      {leftIcon && <span className="-ml-0.5 shrink-0">{leftIcon}</span>}
      {children}
    </span>
  );
}
