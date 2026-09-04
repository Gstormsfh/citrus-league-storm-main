import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Percentile bullet chart — Citrus's answer to JFresh's flat percentile
 * bars. A bullet chart with median reference, category-tinted fill,
 * pattern overlay at low percentiles (for color-not-only accessibility),
 * and a tabular-numerics readout. Always shows the raw value when
 * provided, so the metric is interpretable without the percentile
 * frame alone.
 *
 * Categories drive the accent palette:
 *   offense      → pastel-orange (the team-color of "look here")
 *   defense      → pastel-sage   (trust/calm)
 *   special      → pastel-butter (electric, special teams)
 *   neutral      → cream/white   (no semantic loading)
 *
 * Use a `<PercentileBullet />` cluster anywhere JFresh would have
 * stacked horizontal bars — model decomposition, position-percentile
 * rows, comparison drawers.
 *
 * REFINEMENT (Component 7 of 7) — Concept 3 mockup alignment.
 * Day 1 implementation predated the locked Spatial Hero direction.
 * Per the data-zone Modern Tech precision spec (§2.2: hairline 1px
 * dividers, no decoration, surface tints for hierarchy) and the
 * canvas-design-system §Second Pass discipline (Don't add more
 * graphics. Refine what exists. Make extremely crisp. Polish rather
 * than expand.), the track is thinned from a 28px chrome rail to a
 * hairline pill, floor markers / bullet-head / shadow-glow / track
 * ring all dropped, median tick softened to white/12. The 4-category
 * color vocabulary survives unchanged; the API is unchanged. Only
 * the surface treatment shifts — subtraction, not redesign.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: kept hand-built. Prior session research
 *   surfaced Vercel SegmentedProgress + Modern Vertical Progress as
 *   alternatives, but the 4-category Citrus vocabulary is already
 *   locked and in-use across 3+ embedding contexts. A swap would
 *   cascade. Refine, don't replace.
 * - Design principle referenced: "Second Pass (Critical) — Don't add
 *   more graphics. Refine what exists. Make extremely crisp. Respect
 *   minimalism philosophy. Polish rather than expand." — from
 *   canvas-design-system.md §Refinement Process. Plus the data-zone
 *   spec from PLAYER_DASHBOARD_DESIGN_SPEC.md §2.2: "hairline 1px
 *   dividers, no decoration, surface tints for hierarchy."
 * - Matched mockup section: SHOT BREAKDOWN tile in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg —
 *   five rows where each shows label LEFT + caption/value RIGHT,
 *   below them a hairline track (~2-3px) with solid category fill
 *   to the percentile position and a dim track continuation to the
 *   right edge. No median tick visible, no bullet-head pill, no
 *   floor markers, no glow.
 */

export type PercentileCategory = 'offense' | 'defense' | 'special' | 'neutral';
export type PercentileSize = 'sm' | 'md';

interface PercentileBulletProps {
  /** Short metric label (e.g. "xG/60", "EVO GAR"). */
  label: string;
  /** Optional sublabel (e.g. "5v5", "PP1"). Single inline caption. */
  context?: string;
  /** 0–100 percentile. Null/undefined = no-data state. */
  percentile?: number | null;
  /** Raw metric value (e.g. 3.42). Optional — we'll render whatever you pass. */
  rawValue?: string | number | null;
  /** Optional unit suffix on the raw value (e.g. "/60", "%"). */
  rawUnit?: string;
  /** Sample size (e.g. games played). Drives low-sample styling at <20. */
  sampleSize?: number | null;
  /** Override low-sample threshold (default 20). */
  lowSampleThreshold?: number;
  /** Category drives the accent color. */
  category?: PercentileCategory;
  /** Size preset. */
  size?: PercentileSize;
  /** Skeleton shimmer state. */
  isLoading?: boolean;
  /** Compact mode hides the raw value (use when stacking many bullets vertically). */
  compact?: boolean;
  className?: string;
}

const CATEGORY_FILL: Record<PercentileCategory, string> = {
  offense: '#FF6B1A',  // pastel-orange
  defense: '#84A57D',  // pastel-sage
  special: '#F4E5B8',  // pastel-butter
  neutral: '#FFF8F0',  // pastel-cream
};

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function PercentileBullet({
  label,
  context,
  percentile,
  rawValue,
  rawUnit,
  sampleSize,
  lowSampleThreshold = 20,
  category = 'neutral',
  size = 'md',
  isLoading = false,
  compact = false,
  className,
}: PercentileBulletProps) {
  const patternId = useId();

  const hasPercentile = percentile !== null && percentile !== undefined && !Number.isNaN(percentile);
  const pct = hasPercentile ? clamp(percentile as number) : 0;
  const isLowSample = sampleSize != null && sampleSize < lowSampleThreshold;
  const isBelowMedian = hasPercentile && pct < 50;
  const usePattern = hasPercentile && pct < 30;

  // Refinement (Component 7) — track thinned from chrome rail to hairline pill
  // per Concept 3 mockup. md = 8px (h-2), sm = 6px (h-1.5).
  const trackHeight = size === 'md' ? 'h-2' : 'h-1.5';
  const labelSize = size === 'md' ? 'text-[12px]' : 'text-[11px]';
  const valueSize = size === 'md' ? 'text-[15px]' : 'text-[13px]';
  const captionSize = 'text-[10px]';

  const accentColor = CATEGORY_FILL[category];
  // isBelowMedian retained for ARIA + future variants; the visual
  // distinction lives in fill width itself (subtraction over decoration).
  void isBelowMedian;

  const ariaLabel = useMemo(() => {
    if (isLoading) return `Loading ${label}`;
    if (!hasPercentile) return `${label}: not charted yet`;
    const ordinal = `${Math.round(pct)}${ordinalSuffix(Math.round(pct))} percentile`;
    const rawText = rawValue != null && rawValue !== ''
      ? `, value ${rawValue}${rawUnit ?? ''}`
      : '';
    const sampleText = isLowSample ? `, limited sample (${sampleSize} games)` : '';
    return `${label}${context ? ` ${context}` : ''}: ${ordinal}${rawText}${sampleText}`;
  }, [isLoading, hasPercentile, label, context, pct, rawValue, rawUnit, isLowSample, sampleSize]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        className={cn('flex flex-col gap-1.5', className)}
      >
        <div className="flex justify-between gap-2">
          <div className="h-3 w-24 rounded bg-pastel-surface-high animate-pulse" />
          <div className="h-3 w-12 rounded bg-pastel-surface-high animate-pulse" />
        </div>
        <div className={cn(trackHeight, 'rounded-full bg-pastel-surface-high animate-pulse')} />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn('group flex flex-col gap-1.5', className)}
    >
      {/* Label row — metric name + raw value */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={cn('font-sans font-semibold text-pastel-cream truncate', labelSize)}>
            {label}
          </span>
          {context && (
            <span className={cn('font-jbmono uppercase tracking-wider text-white/55 truncate', captionSize)}>
              {context}
            </span>
          )}
        </div>
        {!compact && (
          <div className="flex items-baseline gap-2 flex-shrink-0">
            {isLowSample && (
              <span
                className="font-jbmono font-bold uppercase tracking-wider text-[8px] text-pastel-butter/85 leading-none"
                title={`Limited sample (${sampleSize} GP)`}
              >
                LOW SAMPLE
              </span>
            )}
            {rawValue != null && rawValue !== '' && (
              <span className={cn('font-jbmono font-bold tabular-nums text-pastel-cream', valueSize)}>
                {rawValue}
                {rawUnit && <span className="text-white/55 font-medium ml-0.5">{rawUnit}</span>}
              </span>
            )}
            {hasPercentile && (
              <span
                className={cn(
                  'font-jbmono font-bold tabular-nums uppercase tracking-wider',
                  captionSize,
                  pct >= 75 ? 'text-pastel-orange-soft' :
                  pct >= 50 ? 'text-pastel-sage-soft' :
                  pct >= 25 ? 'text-white/55' :
                              'text-white/55',
                )}
              >
                {Math.round(pct)}{ordinalSuffix(Math.round(pct))}
              </span>
            )}
            {!hasPercentile && (
              <span
                className={cn(
                  'font-jbmono uppercase tracking-wider text-white/55',
                  captionSize,
                )}
              >
                Not charted
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bullet track — refined to a hairline pill per Concept 3 mockup.
          Track ring + bullet-head + floor markers + shadow glow all dropped.
          Solid fill (no gradient). Median tick softened from white/30 to
          white/12 — kept because it's the JFresh-killer comparator. Pattern
          fill below 30% retained as functional accessibility. */}
      <div
        className={cn(
          trackHeight,
          'relative w-full rounded-full bg-white/[0.04] overflow-hidden',
        )}
      >
        {/* SVG pattern definition for low-percentile color-not-only encoding */}
        {usePattern && (
          <svg className="absolute inset-0 w-0 h-0" aria-hidden="true">
            <defs>
              <pattern
                id={patternId}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="3" height="6" fill="rgba(255,255,255,0.2)" />
              </pattern>
            </defs>
          </svg>
        )}

        {/* No-data state — caption rendered inline in the readout row.
            Track stays as an empty rail (no fill) when percentile is null. */}

        {/* Median reference tick at 50% — softened to white/12 per mockup. */}
        {hasPercentile && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/[0.12]"
            style={{ left: '50%' }}
          />
        )}

        {/* The bullet fill — solid category color, transitions on width. */}
        {hasPercentile && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 left-0 transition-[width] duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: usePattern
                ? `url(#${patternId}), ${accentColor}`
                : accentColor,
              opacity: isLowSample ? 0.5 : 1,
            }}
          />
        )}
      </div>
    </div>
  );
}
