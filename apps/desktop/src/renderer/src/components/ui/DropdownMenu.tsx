import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';

export interface DropdownItem {
  /** Unique key + label. Omit `onSelect` for a non-interactive header. */
  label: ReactNode;
  key: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export type DropdownEntry = DropdownItem | { separator: true; key: string };

export interface DropdownMenuProps {
  /** The clickable trigger element (a Button/IconButton). */
  trigger: ReactElement;
  items: DropdownEntry[];
  align?: 'start' | 'end';
  className?: string;
}

function isSeparator(e: DropdownEntry): e is { separator: true; key: string } {
  return 'separator' in e;
}

/**
 * An accessible popover menu. Opens on trigger click, closes on outside click,
 * Escape, or item selection, and supports arrow-key navigation between items.
 */
export function DropdownMenu({ trigger, items, align = 'end', className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % nodes.length : (idx - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const triggerEl = cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      (trigger.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      setOpen((v) => !v);
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
  } as Partial<React.HTMLAttributes<HTMLElement>>);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {triggerEl}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -2 }}
            transition={{ duration: 0.13 }}
            onKeyDown={onMenuKeyDown}
            className={cn(
              'absolute top-full z-50 mt-1.5 min-w-[11rem] overflow-hidden rounded-xl border border-stroke bg-overlay p-1 shadow-pop',
              align === 'end' ? 'right-0' : 'left-0',
              className,
            )}
          >
            {items.map((item) =>
              isSeparator(item) ? (
                <div key={item.key} role="separator" className="my-1 h-px bg-stroke" />
              ) : (
                <button
                  key={item.key}
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onSelect?.();
                    setOpen(false);
                  }}
                  className={cn(
                    'focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-100 disabled:opacity-50',
                    item.danger ? 'text-rose hover:bg-rose/10' : 'text-t2 hover:bg-surface hover:text-t1',
                  )}
                >
                  {item.icon && <span className="shrink-0">{item.icon}</span>}
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
