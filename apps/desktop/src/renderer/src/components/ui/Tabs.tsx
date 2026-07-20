import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Accessible label for the tablist. */
  'aria-label'?: string;
}

/**
 * A horizontal tab bar with an animated underline that slides between the
 * active tab via a shared `layoutId`. Follows the ARIA tabs pattern with
 * arrow-key navigation.
 */
export function Tabs({ items, value, onChange, className, 'aria-label': ariaLabel }: TabsProps) {
  const groupId = useId();

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = items[(index + dir + items.length) % items.length];
    if (next) onChange(next.value);
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex items-center gap-1 border-b border-stroke', className)}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(item.value)}
            className={cn(
              'focus-ring relative inline-flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition-colors duration-150',
              active ? 'text-t1' : 'text-t3 hover:text-t2',
            )}
          >
            {item.icon}
            {item.label}
            {active && (
              <motion.span
                layoutId={`tab-underline-${groupId}`}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-primary"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
