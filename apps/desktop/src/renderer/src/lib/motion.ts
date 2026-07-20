import type { Transition, Variants } from 'framer-motion';

/**
 * Shared Framer Motion vocabulary. App.tsx wraps the tree in
 * `<MotionConfig reducedMotion={…}>`, which neutralizes the transform/layout
 * portions of these variants whenever the user (OS or settings) asks for
 * reduced motion — individual components don't need their own checks.
 */

/** Soft spring for playful moments (pills, toasts, dialogs). */
export const springSoft: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 };

/** Snappier spring for small UI (switch knobs, segmented pills). */
export const springSnappy: Transition = { type: 'spring', stiffness: 640, damping: 38, mass: 0.7 };

/** Route-level page transition (used by AppShell's AnimatePresence). */
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.21, 0.47, 0.32, 0.98] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.13, ease: 'easeIn' } },
};

/** Standard entrance for cards/rows. Pair with `staggerChildren` on a parent. */
export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.21, 0.47, 0.32, 0.98] } },
};

/** Parent container that staggers `fadeSlideUp`/`scaleIn` children. */
export const staggerChildren: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};

/** Springy pop-in for badges, dialogs, and celebratory chrome. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: springSoft },
};

/**
 * True when nonessential animation should be skipped right now — either the
 * app set `data-reduce-motion` on <html> (settings) or the OS prefers it.
 * Use for imperative animation (timers, confetti); declarative motion is
 * already covered by MotionConfig + the CSS motion policy.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && 'reduceMotion' in document.documentElement.dataset) {
    return true;
  }
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
