import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-primary text-white shadow-soft hover:shadow-glow hover:brightness-[1.05] active:brightness-95 border border-transparent',
  secondary:
    'bg-surface text-t1 border border-stroke-strong hover:bg-overlay hover:border-primary/40 active:bg-overlay',
  ghost: 'bg-transparent text-t2 hover:bg-overlay hover:text-t1 active:bg-overlay border border-transparent',
  danger: 'bg-rose text-white shadow-soft hover:brightness-105 active:brightness-95 border border-transparent',
  outline: 'bg-transparent text-primary border border-primary/50 hover:bg-primary/10 active:bg-primary/15',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
};

/**
 * The primary action control. Five variants (gradient primary, secondary,
 * ghost, danger, outline), three sizes, optional icons, and a loading state
 * that keeps its width while showing a spinner.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'focus-ring relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,box-shadow,filter,border-color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size={size === 'sm' ? 14 : 16} className="absolute" />}
      <span className={cn('inline-flex items-center', size === 'sm' ? 'gap-1.5' : 'gap-2', loading && 'opacity-0')}>
        {leftIcon && <span className="shrink-0">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </span>
    </button>
  );
});
