import { motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { springSnappy } from '@renderer/lib/motion';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label — required when no visible label is associated. */
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** An accessible on/off toggle with a spring-animated knob. */
export function Switch({ checked, onChange, label, disabled, className, id }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-transparent bg-gradient-primary' : 'border-stroke-strong bg-overlay',
        className,
      )}
    >
      <motion.span
        layout
        transition={springSnappy}
        className={cn('block h-4 w-4 rounded-full bg-white shadow-soft', checked ? 'ml-6' : 'ml-1')}
      />
    </button>
  );
}
