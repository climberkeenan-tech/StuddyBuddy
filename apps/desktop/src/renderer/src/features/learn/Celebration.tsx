import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/cn';

/** Colors sampled from the brand tokens for the confetti burst. */
const PARTICLES = Array.from({ length: 26 });

export interface CelebrationProps {
  /** Increment this to fire a fresh burst. */
  trigger: number;
}

/**
 * A lightweight, reduced-motion-aware confetti burst. Renders nothing until
 * `trigger` changes; then it drops a short-lived layer of falling particles.
 * Respects the app's reduced-motion setting (renders nothing when set).
 */
export function Celebration({ trigger }: CelebrationProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (trigger === 0) return;
    if (prefersReducedMotion()) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), 1400);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
      aria-hidden
      data-testid="celebration"
    >
      {PARTICLES.map((_, i) => {
        const left = (i * 37) % 100;
        const delay = (i % 6) * 60;
        const duration = 900 + (i % 5) * 160;
        const tone = i % 3 === 0 ? 'bg-primary' : i % 3 === 1 ? 'bg-accent' : 'bg-gold';
        const size = 6 + (i % 3) * 3;
        return (
          <span
            key={i}
            className={cn('absolute top-[-6%] rounded-[2px]', tone)}
            style={{
              left: `${left}%`,
              width: size,
              height: size * 1.6,
              animation: `sb-confetti ${duration}ms cubic-bezier(0.2,0.7,0.3,1) ${delay}ms forwards`,
              transform: `rotate(${i * 33}deg)`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes sb-confetti {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          100% { opacity: 0; transform: translateY(108vh) rotate(540deg); }
        }
      `}</style>
    </div>
  );
}
