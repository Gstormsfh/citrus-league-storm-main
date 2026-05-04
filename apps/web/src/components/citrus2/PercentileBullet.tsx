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

const CATEGORY_GLOW: Record<PercentileCategory, string> = {
  offense: 'shadow-[0_0_12px_-2px_rgba(255,107,26,0.45)]',
  defense: 'shadow-[0_0_12px_-2px_rgba(132,165,125,0.45)]',
  special: 'shadow-[0_0_12px_-2px_rgba(244,229,184,0.45)]',
  neutral: '',
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

  const trackHeight = size === 'md' ? 'h-7' : 'h-5';
  const labelSize = size === 'md' ? 'text-[12px]' : 'text-[11px]';
  const valueSize = size === 'md' ? 'text-[15px]' : 'text-[13px]';
  const captionSize = 'text-[10px]';

  const accentColor = CATEGORY_FILL[category];
  const glowClass = !isBelowMedian && !isLowSample ? CATEGORY_GLOW[category] : '';

  const ariaLabel = useMemo(() => {
    if (isLoading) return `Loading ${label}`;
    if (!hasPercentile) return `${label}: no data available`;
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
        <div className={cn(trackHeight, 'rounded-md bg-pastel-surface-high animate-pulse')} />
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
            <span className={cn('font-jbmono uppercase tracking-wider text-white/45 truncate', captionSize)}>
              {context}
            </span>
          )}
        </div>
        {!compact && (
          <div className="flex items-baseline gap-2 flex-shrink-0">
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
                              'text-white/45',
                )}
              >
                {Math.round(pct)}{ordinalSuffix(Math.round(pct))}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bullet track */}
      <div
        className={cn(
          trackHeight,
          'relative w-full rounded-md bg-white/5 ring-1 ring-white/10 overflow-hidden',
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

        {/* No-data state */}
        {!hasPercentile && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('font-jbmono uppercase tracking-wider text-white/35', captionSize)}>
              No data
            </span>
          </div>
        )}

        {/* Median reference tick at 50% */}
        {hasPercentile && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/30"
            style={{ left: '50%' }}
          />
        )}

        {/* The bullet fill */}
        {hasPercentile && (
          <div
            aria-hidden="true"
            className={cn(
              'absolute top-0 bottom-0 left-0 transition-[width] duration-500 ease-out',
              glowClass,
            )}
            style={{
              width: `${pct}%`,
              background: usePattern
                ? `url(#${patternId}), ${accentColor}`
                : `linear-gradient(90deg, ${accentColor}99 0%, ${accentColor} 100%)`,
              opacity: isLowSample ? 0.5 : 1,
            }}
          />
        )}

        {/* Bullet head marker — visible at the percentile position for tap target */}
        {hasPercentile && (
          <div
            aria-hidden="true"
            className="absolute top-1/2 -translate-y-1/2 w-1 h-full bg-pastel-cream/90 rounded-sm"
            style={{ left: `calc(${pct}% - 2px)` }}
          />
        )}

        {/* Low-sample badge — overlaid right edge */}
        {isLowSample && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute right-1.5 top-1/2 -translate-y-1/2',
              'font-jbmono font-bold text-[8px] tracking-tight',
              'bg-pastel-butter text-pastel-surface',
              'rounded px-1 py-px ring-1 ring-pastel-surface',
            )}
            title={`Limited sample (${sampleSize} GP)`}
          >
            SS
          </span>
        )}
      </div>

      {/* Ordinal scale floor markers — only render in md size to keep sm tight */}
      {size === 'md' && hasPercentile && (
        <div className="flex justify-between font-jbmono uppercase tracking-wider text-white/35 text-[9px] px-0.5">
          <span>0</span>
          <span>25</span>
          <span className="text-white/55">50</span>
          <span>75</span>
          <span>100</span>
        </div>
      )}
    </div>
  );
}
