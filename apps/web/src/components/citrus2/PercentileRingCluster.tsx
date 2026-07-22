/**
 * PercentileRingCluster — three independent ring gauges stacked vertically,
 * one per metric category (OFF / DEF / ST). Component-scale only — never
 * the hero (the rink is the hero, per locked Concept 3).
 *
 * Per the mockup re-examination, the data-zone middle tile renders three
 * SEPARATE rings stacked vertically, each with its own percentile value
 * centered, not nested-concentric. Each ring is sage / butter / orange
 * depending on category, sized at ~80px diameter, with a thin gap between
 * primary fill and the muted secondary ring (Vercel Gauge convention).
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: Vercel-style Gauge (similarity 1.209 from
 *   mcp__21st-magic__21st_magic_component_inspiration "percentile ring gauge
 *   dashboard"). Adapted as a single internal Ring component reusing the
 *   Vercel math (gap-percent, primary/secondary stroke pair, equal-arc-priority
 *   philosophy, animated stroke-dashoffset) but reduced API surface for the
 *   tighter Citrus use case (no equal-mode, no indeterminate, no slider).
 * - Design principle referenced: "Systematic Patterns — Use scientific visual
 *   language: Repeating patterns, Perfect shapes, Dense accumulation of marks,
 *   Layered elements, Patient repetition rewards sustained viewing." — from
 *   canvas-design-system.md §4 Systematic Patterns. Three identical-construction
 *   rings stacked vertically IS the systematic pattern; same geometry, only
 *   color and value vary.
 * - Matched mockup section: data zone middle tile in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg — three
 *   vertically-stacked rings at ~80px each (sage 84% / butter 62% / orange 91%)
 *   with values centered in JBMono and "OFF · DEF · ST GAR PERCENTILES" caps
 *   eyebrow below.
 */

import { useId } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export type RingCategory = 'offense' | 'defense' | 'special' | 'neutral';

export interface RingMetric {
  /** Category drives the ring color — orange/sage/butter/cream. */
  category: RingCategory;
  /** Short label below the value (e.g. "OFF", "DEF", "ST"). */
  label?: string;
  /** Percentile [0-100]. Drives the fill arc. */
  percentile: number;
  /** Optional sample size — drives low-sample treatment when below threshold. */
  sampleSize?: number | null;
}

interface PercentileRingClusterProps {
  /** The ring data — typically 3 metrics. Order is render order top-to-bottom. */
  metrics: RingMetric[];
  /** Ring diameter in px. Default 80 — mockup-scale for the data zone. */
  ringSize?: number;
  /** Caption rendered below the cluster (e.g. "OFF · DEF · ST GAR PERCENTILES"). */
  caption?: string;
  /** Sample-size threshold below which ring rendering goes muted. */
  lowSampleThreshold?: number;
  /** Loading state — three skeleton rings shimmer. */
  isLoading?: boolean;
  /** Layout direction. Default 'vertical' (stacked) per the mockup. */
  layout?: 'vertical' | 'horizontal';
  className?: string;
}

// ── Color tokens (per design spec §2.4 color vocabulary) ────────────

const CATEGORY_PRIMARY: Record<RingCategory, string> = {
  offense: '#FF6B1A',  // pastel-orange
  defense: '#84A57D',  // pastel-sage
  special: '#F4E5B8',  // pastel-butter
  neutral: '#FFF8F0',  // pastel-cream
};

// Secondary ring (muted track) uses category color at low opacity.
const CATEGORY_SECONDARY: Record<RingCategory, string> = {
  offense: 'rgba(255,107,26,0.18)',
  defense: 'rgba(132,165,125,0.18)',
  special: 'rgba(244,229,184,0.18)',
  neutral: 'rgba(255,248,240,0.14)',
};

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

// ── Internal Ring component (Vercel Gauge adapted) ──────────────────
// Reuses the Vercel math: circumference = 2πr, primary stroke-dasharray
// covers `value%` minus a gap on each side; secondary covers the rest.
// Single SVG, two <circle> elements (secondary base + primary overlay).

interface RingProps {
  value: number;
  size: number;
  category: RingCategory;
  label?: string;
  isLowSample?: boolean;
  isLoading?: boolean;
  showValue?: boolean;
}

const RING_VIEWBOX = 100;
const STROKE_WIDTH = 11; // proportional to viewBox; ~9% of diameter
const GAP_PERCENT = 4;   // gap between primary fill and secondary track ends

function Ring({ value, size, category, label, isLowSample, isLoading, showValue = true }: RingProps) {
  const safeValue = clamp(value);
  const radius = (RING_VIEWBOX - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentToPx = circumference / 100;
  const percentToDeg = 360 / 100;

  const primaryColor = CATEGORY_PRIMARY[category];
  const secondaryColor = CATEGORY_SECONDARY[category];

  // Primary arc covers `safeValue%` of circumference. Subtract gap so the
  // primary doesn't touch the secondary at the boundary.
  const primaryDash = Math.max(0, safeValue - GAP_PERCENT) * percentToPx;
  const primaryDashArray = `${primaryDash} ${circumference}`;

  // Secondary track fills the remaining circumference minus a gap on each side.
  const secondaryDash = Math.max(0, (100 - safeValue - GAP_PERCENT) * percentToPx);
  const secondaryDashArray = `${secondaryDash} ${circumference}`;

  // Rotate primary so it starts at 12 o'clock + half-gap offset.
  const primaryRotation = -90 + (GAP_PERCENT / 2) * percentToDeg;
  const secondaryRotation = 360 - 90 - (GAP_PERCENT / 2) * percentToDeg;

  const valueOpacity = isLowSample ? 0.45 : 1;
  const ringOpacity = isLowSample ? 0.5 : 1;

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label={label ? `Loading ${label} percentile` : 'Loading percentile ring'}
        className="flex flex-col items-center gap-1.5"
        style={{ width: size }}
      >
        <div
          className="rounded-full bg-pastel-surface-high animate-pulse"
          style={{ width: size, height: size }}
        />
        {label && (
          <div className="font-jbmono uppercase tracking-[0.22em] text-[9px] font-bold text-white/30 h-3 w-8 bg-white/10 rounded animate-pulse" />
        )}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={
        label
          ? `${label}: ${Math.round(safeValue)}th percentile${isLowSample ? ', limited sample' : ''}`
          : `${Math.round(safeValue)}th percentile`
      }
      className="flex flex-col items-center gap-1.5"
      style={{ width: size }}
    >
      <div className="relative" style={{ width: size, height: size, opacity: ringOpacity }}>
        <svg
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          width={size}
          height={size}
          fill="none"
          aria-hidden="true"
          style={{ overflow: 'visible' }}
        >
          {/* Secondary (background track) */}
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={radius}
            stroke={secondaryColor}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={secondaryDashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: `rotate(${secondaryRotation}deg) scaleY(-1)`,
              transformOrigin: '50% 50%',
              transition: 'stroke-dashoffset 600ms ease-out, transform 600ms ease-out',
            }}
          />
          {/* Primary (filled arc) */}
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={radius}
            stroke={primaryColor}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={primaryDashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: `rotate(${primaryRotation}deg)`,
              transformOrigin: '50% 50%',
              transition: 'stroke-dashoffset 600ms ease-out, transform 600ms ease-out',
            }}
          />
        </svg>

        {/* Centered value */}
        {showValue && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ opacity: valueOpacity }}
          >
            <span
              className={cn(
                'font-jbmono font-bold tabular-nums tracking-tight',
                'text-pastel-cream',
              )}
              style={{ fontSize: size * 0.22 }}
            >
              {Math.round(safeValue)}%
            </span>
          </div>
        )}
      </div>

      {label && (
        <div className="font-jbmono uppercase tracking-[0.22em] text-[9px] font-bold text-white/55 leading-none">
          {label}
        </div>
      )}
    </div>
  );
}

// ── Main composer ───────────────────────────────────────────────────

export function PercentileRingCluster({
  metrics,
  ringSize = 80,
  caption,
  lowSampleThreshold = 20,
  isLoading = false,
  layout = 'vertical',
  className,
}: PercentileRingClusterProps) {
  const clusterId = useId();

  return (
    <div
      role="group"
      aria-label={caption || 'Percentile rings'}
      aria-describedby={caption ? `${clusterId}-caption` : undefined}
      className={cn('flex flex-col items-center gap-4', className)}
    >
      <div
        className={cn(
          'flex items-center justify-center',
          layout === 'vertical' ? 'flex-col gap-5' : 'flex-row gap-6',
        )}
      >
        {metrics.map((metric, idx) => {
          const isLowSample =
            metric.sampleSize != null && metric.sampleSize < lowSampleThreshold;
          return (
            <Ring
              key={`${idx}-${metric.label ?? metric.category}`}
              value={metric.percentile}
              size={ringSize}
              category={metric.category}
              label={metric.label}
              isLowSample={isLowSample}
              isLoading={isLoading}
            />
          );
        })}
      </div>

      {caption && (
        <div
          id={`${clusterId}-caption`}
          className="font-jbmono uppercase tracking-[0.22em] text-[9px] sm:text-[10px] font-bold text-white/45 text-center"
        >
          {caption}
        </div>
      )}
    </div>
  );
}
