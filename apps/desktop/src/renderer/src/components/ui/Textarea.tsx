import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

/** A labeled multi-line text field matching {@link Input}'s styling. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="text-[13px] font-medium text-t2">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'focus-ring w-full resize-y rounded-xl border bg-surface px-3 py-2.5 text-sm text-t1 placeholder:text-t3 transition-colors duration-150',
          error ? 'border-rose/60' : 'border-stroke-strong hover:border-primary/40 focus:border-primary/60',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-err`} className="text-xs text-rose">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-t3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
