import { useId, type CSSProperties } from 'react';
import { cn } from '@renderer/lib/cn';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  /** Renders the current value (or a formatted version) to the right of the label. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * A styled range slider using the `.sb-range` recipe. The filled portion tracks
 * the value via a CSS custom property, so it works without JS layout math.
 */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, formatValue, disabled, className, id }: SliderProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {(label || formatValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <label htmlFor={fieldId} className="text-[13px] font-medium text-t2">
              {label}
            </label>
          )}
          {formatValue && <span className="text-xs font-semibold text-t1">{formatValue(value)}</span>}
        </div>
      )}
      <input
        id={fieldId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('sb-range focus-ring', disabled && 'cursor-not-allowed opacity-50')}
        style={{ '--sb-range-fill': `${fill}%` } as CSSProperties}
      />
    </div>
  );
}
