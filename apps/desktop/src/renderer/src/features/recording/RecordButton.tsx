import { motion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { Spinner } from '@renderer/components/ui';

export interface RecordButtonProps {
  /** Whether a session is currently live (recording or paused). */
  recording: boolean;
  /** Whether the session is paused (pauses the pulse ring). */
  paused?: boolean;
  /** Busy state while start/stop is in flight. */
  busy?: boolean;
  onClick: () => void;
  /** Current audio level 0..1 — subtly scales the glow while recording. */
  level?: number;
}

/**
 * The app's signature control: a large circular record button. Idle shows a red
 * mic orb; while recording it emits a soft pulsing ring (audio-reactive, and
 * silenced under reduced motion) and switches to a stop glyph.
 */
export function RecordButton({
  recording,
  paused = false,
  busy = false,
  onClick,
  level = 0,
}: RecordButtonProps) {
  const animateRing = recording && !paused;

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      {/* Pulsing rings while actively recording. */}
      {animateRing && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full bg-rose/20"
            initial={{ opacity: 0.5, scale: 0.9 }}
            animate={{ opacity: [0.5, 0, 0.5], scale: [0.9, 1.35, 0.9] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute inset-2 rounded-full bg-rose/25"
            initial={{ opacity: 0.6, scale: 0.95 }}
            animate={{ opacity: [0.6, 0, 0.6], scale: [0.95, 1.22, 0.95] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
        </>
      )}

      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={cn(
          'focus-ring relative flex h-28 w-28 items-center justify-center rounded-full text-white transition-transform duration-200',
          'shadow-pop active:scale-95 disabled:cursor-not-allowed disabled:opacity-80',
          recording
            ? 'bg-rose hover:scale-[1.03]'
            : 'bg-gradient-to-br from-rose to-[#ff4d6d] hover:scale-[1.04]',
        )}
        style={
          recording
            ? { boxShadow: `0 0 ${18 + level * 36}px rgb(var(--sb-rose) / ${0.35 + level * 0.4})` }
            : undefined
        }
      >
        {busy ? (
          <Spinner size={30} />
        ) : recording ? (
          <Square size={34} fill="currentColor" strokeWidth={0} />
        ) : (
          <Mic size={40} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
