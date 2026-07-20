import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { springSoft } from '@renderer/lib/motion';
import { useToastStore, type Toast } from './toast-store';
import { AchievementToast } from './AchievementToast';

const ICONS = {
  success: <CheckCircle2 size={18} className="text-success" />,
  error: <XCircle size={18} className="text-rose" />,
  info: <Info size={18} className="text-sky" />,
};

const ACCENT = {
  success: 'border-success/30',
  error: 'border-rose/30',
  info: 'border-sky/30',
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (toast.duration <= 0) return;
    const id = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(id);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <motion.div
      layout
      role={toast.variant === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={springSoft}
      className={cn('glass-panel pointer-events-auto flex w-80 items-start gap-3 border bg-panel/95 p-3.5', ACCENT[toast.variant])}
    >
      <span className="mt-0.5 shrink-0">{ICONS[toast.variant]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-t1">{toast.title}</p>
        {toast.description && <p className="mt-0.5 break-words text-xs text-t3">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
            className="focus-ring mt-2 rounded-md text-xs font-semibold text-primary hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="focus-ring -mr-1 -mt-1 rounded-md p-1 text-t3 hover:text-t1">
        <X size={15} />
      </button>
    </motion.div>
  );
}

/**
 * Renders the live toast stack and any achievement celebrations. Mount once,
 * high in the tree (App). Toasts are pushed via {@link useToast} or the store.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const celebrations = useToastStore((s) => s.celebrations);

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2.5">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastRow key={t.id} toast={t} />
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-6 z-[70] flex flex-col items-center gap-3">
        <AnimatePresence>
          {celebrations.map((c) => (
            <AchievementToast key={c.id} celebration={c} />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
