import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export type IconButtonVariant = 'ghost' | 'surface' | 'primary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — describes the action, e.g. "Close dialog". */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-t2 hover:bg-overlay hover:text-t1',
  surface: 'bg-surface border border-stroke text-t2 hover:text-t1 hover:border-primary/40',
  primary: 'bg-gradient-primary text-white shadow-soft hover:shadow-glow',
};

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-xl',
};

/** A square, icon-only button. `label` is mandatory and becomes its aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'focus-ring inline-flex items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
