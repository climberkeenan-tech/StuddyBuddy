import { type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons, menus). */
  actions?: ReactNode;
  /** Optional element rendered above the title (breadcrumb, back link). */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * The standard heading block at the top of every page: an optional eyebrow, a
 * display-font title, a subtitle, and a right-aligned actions cluster.
 */
export function PageHeader({ title, subtitle, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-t1">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-t3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
