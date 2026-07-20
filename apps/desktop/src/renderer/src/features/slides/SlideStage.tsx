import { Suspense, lazy, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { icons as lucideIcons, Quote as QuoteIcon, type LucideIcon } from 'lucide-react';
import type { Slide } from '@studdybuddy/shared';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import { MermaidDiagram } from './MermaidDiagram';

const SlideChart = lazy(() => import('./SlideChart'));

export interface SlideStageProps {
  slide: Slide;
  /** Deck-level accent used when a slide doesn't specify its own. */
  deckAccent: string;
  /** Dark background (affects diagram/chart theming). */
  dark: boolean;
  className?: string;
}

/** kebab-case (`flask-conical`) → PascalCase (`FlaskConical`) for lucide lookup. */
function iconFor(name?: string): LucideIcon | null {
  if (!name) return null;
  const pascal = name
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return (lucideIcons as Record<string, LucideIcon>)[pascal] ?? null;
}

/**
 * Renders one {@link Slide} onto a full-bleed 16:9 stage, choosing a layout by
 * `slide.layout`. Content animates in with a subtle stagger (respecting reduced
 * motion via the shared motion variants). Diagrams and charts are lazily loaded.
 */
export function SlideStage({ slide, deckAccent, dark, className }: SlideStageProps) {
  const accent = slide.accent ?? deckAccent;
  const Icon = iconFor(slide.icon);
  const accentStyle: CSSProperties = { color: accent };

  return (
    <motion.div
      // Remount on slide change so the entrance animation replays.
      key={slide.id}
      variants={staggerChildren}
      initial="hidden"
      animate="show"
      className={cn('flex h-full w-full flex-col justify-center px-[6%] py-[6%]', className)}
    >
      {renderBody()}
    </motion.div>
  );

  function renderBody() {
    switch (slide.layout) {
      case 'title':
        return (
          <div className="flex flex-col items-center text-center">
            {Icon && (
              <motion.span
                variants={fadeSlideUp}
                className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl"
                style={{ backgroundColor: `${accent}1f`, boxShadow: `inset 0 0 0 1px ${accent}44` }}
              >
                <Icon size={40} style={accentStyle} strokeWidth={1.9} />
              </motion.span>
            )}
            <motion.h1
              variants={fadeSlideUp}
              className="text-gradient font-display text-5xl font-bold leading-tight md:text-6xl"
            >
              {slide.title}
            </motion.h1>
            {slide.subtitle && (
              <motion.p variants={fadeSlideUp} className="mt-5 max-w-2xl text-xl text-t2">
                {slide.subtitle}
              </motion.p>
            )}
          </div>
        );

      case 'section':
        return (
          <div className="flex flex-col">
            <motion.span
              variants={fadeSlideUp}
              className="mb-4 text-sm font-semibold uppercase tracking-[0.2em]"
              style={accentStyle}
            >
              Section
            </motion.span>
            <motion.h2
              variants={fadeSlideUp}
              className="font-display text-5xl font-bold leading-tight text-t1 md:text-6xl"
            >
              {slide.title}
            </motion.h2>
            {slide.subtitle && (
              <motion.p variants={fadeSlideUp} className="mt-5 max-w-2xl text-xl text-t2">
                {slide.subtitle}
              </motion.p>
            )}
          </div>
        );

      case 'bullets':
        return (
          <div>
            <SlideTitle title={slide.title} subtitle={slide.subtitle} />
            <ul className="mt-8 space-y-4">
              {(slide.bullets ?? []).map((b, i) => (
                <motion.li key={i} variants={fadeSlideUp} className="flex items-start gap-4 text-2xl text-t1">
                  <span
                    className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                  <span className="leading-snug">{b}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        );

      case 'diagram':
        return (
          <div className="flex h-full flex-col">
            <SlideTitle title={slide.title} subtitle={slide.subtitle} />
            <motion.div variants={fadeSlideUp} className="mt-6 min-h-0 flex-1">
              {slide.mermaid ? (
                <MermaidDiagram source={slide.mermaid} dark={dark} className="h-full w-full" />
              ) : (
                <p className="text-t3">No diagram for this slide.</p>
              )}
            </motion.div>
          </div>
        );

      case 'chart':
        return (
          <div className="flex h-full flex-col">
            <SlideTitle title={slide.title} subtitle={slide.subtitle} />
            <motion.div variants={fadeSlideUp} className="relative mt-6 min-h-0 flex-1">
              {slide.chart ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-t3">
                      <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-stroke border-t-primary" />
                    </div>
                  }
                >
                  <div className="absolute inset-0">
                    <SlideChart spec={slide.chart} dark={dark} />
                  </div>
                </Suspense>
              ) : (
                <p className="text-t3">No chart data for this slide.</p>
              )}
            </motion.div>
          </div>
        );

      case 'timeline':
        return (
          <div>
            <SlideTitle title={slide.title} subtitle={slide.subtitle} />
            <ol className="relative mt-8 space-y-7 pl-8">
              <span
                className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-0.5 rounded-full"
                style={{ background: `linear-gradient(${accent}, transparent)` }}
                aria-hidden
              />
              {(slide.timeline ?? []).map((ev, i) => (
                <motion.li key={i} variants={fadeSlideUp} className="relative">
                  <span
                    className="absolute -left-8 top-1.5 h-4 w-4 rounded-full ring-4 ring-bg"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                  <p className="font-display text-xl font-semibold text-t1">{ev.label}</p>
                  <p className="mt-1 text-lg text-t2">{ev.description}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        );

      case 'quote':
        return (
          <figure className="flex flex-col items-center text-center">
            <QuoteIcon size={48} className="mb-6" style={{ color: `${accent}` }} aria-hidden />
            <motion.blockquote
              variants={fadeSlideUp}
              className="max-w-3xl font-display text-4xl font-semibold leading-snug text-t1 md:text-5xl"
            >
              {slide.quote?.text ?? slide.title}
            </motion.blockquote>
            {slide.quote?.attribution && (
              <motion.figcaption variants={fadeSlideUp} className="mt-6 text-lg text-t2">
                — {slide.quote.attribution}
              </motion.figcaption>
            )}
          </figure>
        );

      case 'two-column':
        return (
          <div>
            <SlideTitle title={slide.title} subtitle={slide.subtitle} />
            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
              {(slide.columns ?? []).map((col, i) => (
                <motion.div
                  key={i}
                  variants={fadeSlideUp}
                  className="rounded-panel border border-stroke bg-surface/60 p-6"
                >
                  <h3 className="font-display text-2xl font-semibold" style={accentStyle}>
                    {col.heading}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {col.bullets.map((b, j) => (
                      <li key={j} className="flex items-start gap-3 text-lg text-t1">
                        <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
                        <span className="leading-snug">{b}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </div>
        );

      default:
        return <SlideTitle title={slide.title} subtitle={slide.subtitle} />;
    }
  }
}

function SlideTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <motion.h2 variants={fadeSlideUp} className="font-display text-4xl font-bold leading-tight text-t1">
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p variants={fadeSlideUp} className="mt-2 text-xl text-t2">
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}
