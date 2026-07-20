import { z } from 'zod';

/**
 * Zod schemas for the *raw* slide deck an LLM is asked to emit, before the
 * {@link SlidesService} stamps the bits a model cannot know (entity ids, the
 * persisted {@link import('@studdybuddy/shared').SlideDeck} envelope).
 *
 * The design goal is resilience: models return sloppy JSON, so wherever a value
 * can be salvaged we clamp/`catch` it (over-long bullets are truncated, extra
 * bullets dropped, an unknown accent or chart kind falls back to a default)
 * instead of failing the whole deck. Only genuinely unrenderable slides — a
 * `diagram` with no Mermaid, a `chart` with no data — are rejected so the
 * structured generator's repair loop can ask the model to try again.
 */

/** Accent color tokens the slideshow renderer and exporters understand. */
export const SLIDE_ACCENT_TOKENS = ['primary', 'amber', 'rose', 'emerald', 'sky'] as const;
export type SlideAccentToken = (typeof SLIDE_ACCENT_TOKENS)[number];

/** The eight slide layouts, mirroring shared's {@link import('@studdybuddy/shared').SlideLayout}. */
export const SLIDE_LAYOUTS = [
  'title',
  'section',
  'bullets',
  'diagram',
  'chart',
  'timeline',
  'quote',
  'two-column',
] as const;

const MAX_BULLET_CHARS = 110;
const MAX_BULLETS = 6;

/** An accent that silently falls back to `primary` when the model invents a token. */
const AccentSchema = z.enum(SLIDE_ACCENT_TOKENS).catch('primary');

/** A single bullet, trimmed and hard-capped at {@link MAX_BULLET_CHARS} characters. */
const BulletSchema = z
  .string()
  .min(1)
  .transform((s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > MAX_BULLET_CHARS ? `${t.slice(0, MAX_BULLET_CHARS - 1).trimEnd()}…` : t;
  });

/** A bullet list capped at {@link MAX_BULLETS} items (extras are dropped, not rejected). */
const BulletsSchema = z.array(BulletSchema).transform((arr) => arr.slice(0, MAX_BULLETS));

export const RawSlideChartSchema = z.object({
  kind: z.enum(['bar', 'line', 'pie', 'doughnut']).catch('bar'),
  labels: z.array(z.string().min(1)).min(1),
  series: z
    .array(
      z.object({
        label: z.string().min(1),
        data: z.array(z.number()).min(1),
      }),
    )
    .min(1),
});

export const RawTimelineEventSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

export const RawColumnSchema = z.object({
  heading: z.string().min(1),
  bullets: z
    .array(BulletSchema)
    .min(1)
    .transform((arr) => arr.slice(0, MAX_BULLETS)),
});

export const RawQuoteSchema = z.object({
  text: z.string().min(1),
  attribution: z.string().optional(),
});

/**
 * One raw slide. Field transforms run first, then the {@link superRefine}
 * enforces the layout-specific invariant the renderer relies on — a `diagram`
 * needs Mermaid, a `chart` needs a spec, a `timeline` needs at least one event,
 * a `bullets`/`two-column` needs its list, a `quote` needs a quote — so a
 * malformed slide fails validation rather than rendering blank.
 */
export const RawSlideSchema = z
  .object({
    layout: z.enum(SLIDE_LAYOUTS),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    bullets: BulletsSchema.optional(),
    mermaid: z.string().optional(),
    chart: RawSlideChartSchema.optional(),
    timeline: z.array(RawTimelineEventSchema).optional(),
    quote: RawQuoteSchema.optional(),
    columns: z.array(RawColumnSchema).optional(),
    icon: z.string().optional(),
    accent: AccentSchema.optional(),
    speakerNotes: z.string().min(1),
  })
  .superRefine((slide, ctx) => {
    const require = (ok: boolean, field: string, message: string): void => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    };
    switch (slide.layout) {
      case 'diagram':
        require(
          typeof slide.mermaid === 'string' && slide.mermaid.trim().length > 0,
          'mermaid',
          'diagram slides require Mermaid source',
        );
        break;
      case 'chart':
        require(slide.chart != null, 'chart', 'chart slides require a chart spec');
        break;
      case 'timeline':
        require(
          Array.isArray(slide.timeline) && slide.timeline.length > 0,
          'timeline',
          'timeline slides require at least one event',
        );
        break;
      case 'bullets':
        require(
          Array.isArray(slide.bullets) && slide.bullets.length > 0,
          'bullets',
          'bullets slides require at least one bullet',
        );
        break;
      case 'two-column':
        require(
          Array.isArray(slide.columns) && slide.columns.length > 0,
          'columns',
          'two-column slides require at least one column',
        );
        break;
      case 'quote':
        require(slide.quote != null, 'quote', 'quote slides require a quote');
        break;
      default:
        break;
    }
  });

/** The full raw deck: a title plus at least one slide. */
export const RawDeckSchema = z.object({
  title: z.string().min(1),
  slides: z.array(RawSlideSchema).min(1),
});

export type RawSlideChart = z.infer<typeof RawSlideChartSchema>;
export type RawTimelineEvent = z.infer<typeof RawTimelineEventSchema>;
export type RawColumn = z.infer<typeof RawColumnSchema>;
export type RawQuote = z.infer<typeof RawQuoteSchema>;
export type RawSlide = z.infer<typeof RawSlideSchema>;
export type RawDeck = z.infer<typeof RawDeckSchema>;
