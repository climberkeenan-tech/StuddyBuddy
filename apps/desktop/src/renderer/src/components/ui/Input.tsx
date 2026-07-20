import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

/**
 * A labeled text field with optional leading icon, trailing slot, hint, and
 * error state. Wire `label` for an associated `<label>`; errors are announced
 * via `aria-invalid` + `aria-describedby`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftIcon, rightSlot, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-t2">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && <span className="pointer-events-none absolute left-3 text-t3">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'focus-ring h-10 w-full rounded-xl border bg-surface text-sm text-t1 placeholder:text-t3',
            'transition-colors duration-150',
            leftIcon ? 'pl-9 pr-3' : 'px-3',
            rightSlot && 'pr-10',
            error ? 'border-rose/60' : 'border-stroke-strong hover:border-primary/40 focus:border-primary/60',
            className,
          )}
          {...rest}
        />
        {rightSlot && <span className="absolute right-2 flex items-center">{rightSlot}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-err`} className="text-xs text-rose">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-t3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
