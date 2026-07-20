import { type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** Renders a keyboard key/shortcut, e.g. `<Kbd>⌘K</Kbd>`. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md border border-stroke-strong bg-surface px-1.5 font-sans text-[11px] font-semibold text-t2 shadow-sm',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
