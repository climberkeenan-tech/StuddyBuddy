import type { Config } from 'tailwindcss';

/**
 * StuddyBuddy design system — Tailwind theme.
 *
 * Every color maps to a CSS variable defined in `src/renderer/src/styles/index.css`,
 * where both the dark (default) and light palettes live. Features must use these
 * token utilities (bg-surface, text-t1, border-stroke, bg-primary, …) rather than
 * raw hex values so both themes stay in sync.
 */

/** Helper: token color that still supports Tailwind's `/opacity` modifier. */
const rgbVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        display: ['"Sora Variable"', 'system-ui', 'sans-serif'],
      },
      colors: {
        /** App background (page). */
        bg: rgbVar('--sb-bg'),
        /** Raised card / list-row background. */
        surface: rgbVar('--sb-surface'),
        /** Panel background used by glass surfaces (pair with /opacity). */
        panel: rgbVar('--sb-panel'),
        /** Highest elevation: dropdowns, popovers, tooltips. */
        overlay: rgbVar('--sb-overlay'),
        /** Hairline borders. `stroke` = subtle, `stroke-strong` = emphasized. */
        stroke: {
          DEFAULT: 'var(--sb-stroke)',
          strong: 'var(--sb-stroke-strong)',
        },
        /** Text ramp: t1 = high emphasis, t2 = secondary, t3 = faint. */
        t1: rgbVar('--sb-t1'),
        t2: rgbVar('--sb-t2'),
        t3: rgbVar('--sb-t3'),
        /** Brand violet. */
        primary: {
          DEFAULT: rgbVar('--sb-primary'),
          hover: rgbVar('--sb-primary-hover'),
          active: rgbVar('--sb-primary-active'),
        },
        /** Brand cyan (the far end of the violet→cyan gradient). */
        accent: rgbVar('--sb-accent'),
        /** Semantic accents. */
        success: rgbVar('--sb-success'),
        amber: rgbVar('--sb-amber'),
        rose: rgbVar('--sb-rose'),
        sky: rgbVar('--sb-sky'),
        /** Achievement tier colors. */
        bronze: rgbVar('--sb-bronze'),
        silver: rgbVar('--sb-silver'),
        gold: rgbVar('--sb-gold'),
      },
      backgroundImage: {
        /** Signature violet→cyan gradient (buttons, wordmark, rings). */
        'gradient-primary':
          'linear-gradient(135deg, rgb(var(--sb-primary)) 0%, rgb(var(--sb-accent)) 100%)',
        /** Very soft version for tinted fills. */
        'gradient-primary-soft':
          'linear-gradient(135deg, rgb(var(--sb-primary) / 0.18) 0%, rgb(var(--sb-accent) / 0.12) 100%)',
        'gradient-bronze':
          'linear-gradient(135deg, rgb(var(--sb-bronze)) 0%, rgb(var(--sb-amber) / 0.75) 100%)',
        'gradient-silver':
          'linear-gradient(135deg, rgb(var(--sb-silver)) 0%, rgb(var(--sb-sky) / 0.7) 100%)',
        'gradient-gold':
          'linear-gradient(135deg, rgb(var(--sb-gold)) 0%, rgb(var(--sb-rose) / 0.7) 100%)',
      },
      boxShadow: {
        soft: 'var(--sb-shadow-soft)',
        pop: 'var(--sb-shadow-pop)',
        glow: 'var(--sb-shadow-glow)',
      },
      borderRadius: {
        /** Default panel radius used across the app. */
        panel: '1rem',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.72)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        'spin-slow': 'spin-slow 2.4s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
