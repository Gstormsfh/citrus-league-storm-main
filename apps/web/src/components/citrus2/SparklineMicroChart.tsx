/**
 * SparklineMicroChart — minimal trend visualization for the data zone.
 *
 * The sparkline is what survives the canvas-design-system "Second Pass"
 * discipline: line, endpoint accent dot, value, eyebrow caption — nothing
 * else. No axes, no grid, no legends, no tooltips on hover (the value
 * IS the hover-equivalent — always visible at the right edge).
 *
 * Used for the "LAST 30 DAYS · xG/60" wide tile and any other small trend
 * surface in the data zone. Optional confidence band fill below the line
 * for projections / probability ranges.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built — 21st.dev API returned schema-validation
 *   errors on all 3 inspiration queries (sparkline / trend-line-no-axis /
 *   small-line-with-value). Recharts was the alternative (already installed
 *   at ^2.12.7) but carries chrome we explicitly strip; a chrome-less
 *   sparkline is ~30 lines of raw SVG. Hand-built saves the bundle weight
 *   and gives full control over the Modern Tech precision aesthetic.
 * - Design principle referenced: "Second Pass (Critical) — Don't add more
 *   graphics. Refine what exists. Make extremely crisp. Respect minimalism
 *   philosophy. Polish rather than expand." — from canvas-design-system.md
 *   §Refinement Process. Plus spec §2.2 Data Zone: "Tabular numerics in
 *   JetBrains Mono for every number, hairline 1px rgba(255,255,255,0.10)
 *   dividers, no decoration."
 * - Matched mockup section: "LAST 30 DAYS · xG/60" wide tile in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg — caps
 *   eyebrow upper-left, sage horizontal line with gentle waves, no axis
 *   labels, no grid, single orange dot at most-recent point, "3.42" value
 *   in JBMono tabular-nums at right edge.
 */

import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export interface SparklinePoint {
  /** X-axis value (date timestamp, day index, or any monotonic key). */
  x: number | string;
  /** Y-axis value — the metric being trended. */
  y: number;
  /** Optional upper bound for confidence band. */
  high?: number;
  /** Optional lower bound for confidence band. */
  low?: number;
}

export type SparklineAccent = 'orange' | 'sage' | 'butter' | 'cream';

interface SparklineMicroChartProps {
  /** Time-series data, in chronological order (oldest first). */
  data: SparklinePoint[];
  /** Caps eyebrow caption (e.g., "LAST 30 DAYS · xG/60"). */
  eyebrow?: string;
  /** Endpoint value — overrides the auto-computed last data.y when supplied. */
  endpointValue?: string | number;
  /** Optional unit suffix on endpoint (e.g., "/60", "%"). */
  endpointUnit?: string;
  /** Accent color for the trailing dot (orange = recency punctuation). */
  accent?: SparklineAccent;
  /** Stroke color for the line itself. Default sage. */
  lineColor?: SparklineAccent;
  /** Render confidence band below line (uses point.high / point.low). */
  showConfidenceBand?: boolean;
  /** Tile height in px. Default 140 — mockup-scale for the data zone. */
  height?: number;
  /** Loading state. */
  isLoading?: boolean;
  /** Empty state caption override (default: "Not enough data yet"). */
  emptyText?: string;
  className?: string;
}

// ── Color tokens ────────────────────────────────────────────────────

const ACCENT_COLOR: Record<SparklineAccent, string> = {
  orange: '#FF6B1A',
  sage: '#84A57D',
  butter: '#F4E5B8',
  cream: '#FFF8F0',
};

const ACCENT_FILL: Record<SparklineAccent, string> = {
  orange: 'rgba(255,107,26,0.12)',
  sage: 'rgba(132,165,125,0.12)',
  butter: 'rgba(244,229,184,0.12)',
  cream: 'rgba(255,248,240,0.10)',
};

// ── Path generators ─────────────────────────────────────────────────

interface NormalizedPoint {
  cx: number;
  cy: number;
  high?: number;
  low?: number;
}

function normalizePoints(
  data: SparklinePoint[],
  width: number,
  height: number,
  pad: number,
): { points: NormalizedPoint[]; minY: number; maxY: number } {
  if (!data.length) return { points: [], minY: 0, maxY: 0 };

  // Compute full y-range including confidence band when present.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const d of data) {
    minY = Math.min(minY, d.low ?? d.y, d.y);
    maxY = Math.max(maxY, d.high ?? d.y, d.y);
  }
  // Padding the y-range so the line doesn't sit flush against the edges
  const range = maxY - minY || 1;
  const yPad = range * 0.12;
  minY -= yPad;
  maxY += yPad;

  const drawW = width - 2 * pad;
  const drawH = height - 2 * pad;
  const yScale = (v: number) => height - pad - ((v - minY) / (maxY - minY)) * drawH;

  const points = data.map((d, idx) => ({
    cx: pad + (data.length === 1 ? drawW / 2 : (idx / (data.length - 1)) * drawW),
    cy: yScale(d.y),
    high: d.high != null ? yScale(d.high) : undefined,
    low: d.low != null ? yScale(d.low) : undefined,
  }));

  return { points, minY, maxY };
}

function buildLinePath(points: NormalizedPoint[]): string {
  if (!points.length) return '';
  const cmds: string[] = [`M ${points[0].cx.toFixed(2)} ${points[0].cy.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L ${points[i].cx.toFixed(2)} ${points[i].cy.toFixed(2)}`);
  }
  return cmds.join(' ');
}

function buildBandPath(points: NormalizedPoint[]): string {
  // Only valid if every point has high + low values.
  if (!points.length) return '';
  const valid = points.every((p) => p.high != null && p.low != null);
  if (!valid) return '';

  const upper: string[] = [`M ${points[0].cx.toFixed(2)} ${points[0].high!.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    upper.push(`L ${points[i].cx.toFixed(2)} ${points[i].high!.toFixed(2)}`);
  }
  // Walk back along the lower bound to close the area
  for (let i = points.length - 1; i >= 0; i--) {
    upper.push(`L ${points[i].cx.toFixed(2)} ${points[i].low!.toFixed(2)}`);
  }
  upper.push('Z');
  return upper.join(' ');
}

// ── Empty / loading treatments ──────────────────────────────────────

function SparklineEmpty({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] font-bold text-white/35">
        {text}
      </div>
    </div>
  );
}

function SparklineSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center px-6">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
    </div>
  );
}

// ── Main composer ───────────────────────────────────────────────────

export function SparklineMicroChart({
  data,
  eyebrow,
  endpointValue,
  endpointUnit,
  accent = 'orange',
  lineColor = 'sage',
  showConfidenceBand = false,
  height = 140,
  isLoading = false,
  emptyText = 'Not enough data yet',
  className,
}: SparklineMicroChartProps) {
  const reactId = useId();
  const isEmpty = !isLoading && data.length === 0;
  const accentColor = ACCENT_COLOR[accent];
  const lineStroke = ACCENT_COLOR[lineColor];
  const bandFill = ACCENT_FILL[lineColor];

  // Endpoint value display — derived from data when not explicitly provided
  const displayEndpoint = useMemo(() => {
    if (endpointValue !== undefined && endpointValue !== null && endpointValue !== '') {
      return String(endpointValue);
    }
    if (!data.length) return null;
    const last = data[data.length - 1].y;
    // Smart format: integers stay as ints; floats rounded to 2 decimals.
    return Number.isInteger(last) ? String(last) : last.toFixed(2);
  }, [endpointValue, data]);

  // Use an internal viewBox so coordinate math is independent of rendered px size.
  const VIEW_W = 1000;
  const VIEW_H = height;
  const PAD = 12;
  const { points } = useMemo(
    () => normalizePoints(data, VIEW_W, VIEW_H, PAD),
    [data, VIEW_H],
  );

  const linePath = useMemo(() => buildLinePath(points), [points]);
  const bandPath = useMemo(
    () => (showConfidenceBand ? buildBandPath(points) : ''),
    [points, showConfidenceBand],
  );

  const lastPoint = points[points.length - 1];

  return (
    <section
      aria-label={
        eyebrow
          ? `${eyebrow}${displayEndpoint ? `: ${displayEndpoint}${endpointUnit ?? ''}` : ''}`
          : `Trend chart${displayEndpoint ? `: ${displayEndpoint}${endpointUnit ?? ''}` : ''}`
      }
      className={cn(
        'relative w-full overflow-hidden',
        'bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl',
        'p-5',
        className,
      )}
      style={{ minHeight: height + 64 }}
    >
      {/* Eyebrow + endpoint value row */}
      <div className="flex items-baseline justify-between gap-4 mb-2">
        {eyebrow && (
          <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/45 truncate">
            {eyebrow}
          </div>
        )}
        {displayEndpoint && !isLoading && !isEmpty && (
          <div className="font-jbmono font-bold tabular-nums text-pastel-cream text-[20px] sm:text-[22px] flex-shrink-0 leading-none">
            {displayEndpoint}
            {endpointUnit && (
              <span className="text-white/55 font-medium ml-0.5 text-[14px] sm:text-[15px]">
                {endpointUnit}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div
        className="relative w-full"
        style={{ height }}
      >
        {!isEmpty && !isLoading && (
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            {/* Confidence band (optional, behind line) */}
            {bandPath && (
              <path
                d={bandPath}
                fill={bandFill}
              />
            )}

            {/* Single midline hairline — the only "grid" allowed per spec */}
            <line
              x1={PAD}
              y1={VIEW_H / 2}
              x2={VIEW_W - PAD}
              y2={VIEW_H / 2}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
              strokeDasharray="2 4"
            />

            {/* Trend line */}
            <path
              d={linePath}
              fill="none"
              stroke={lineStroke}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* Endpoint accent dot — the recency punctuation */}
            {lastPoint && (
              <g>
                <circle
                  cx={lastPoint.cx}
                  cy={lastPoint.cy}
                  r="6"
                  fill={accentColor}
                  opacity="0.25"
                />
                <circle
                  cx={lastPoint.cx}
                  cy={lastPoint.cy}
                  r="3.5"
                  fill={accentColor}
                />
              </g>
            )}
          </svg>
        )}

        {isLoading && <SparklineSkeleton />}
        {isEmpty && <SparklineEmpty text={emptyText} />}
      </div>

      {/* Hidden id reference for future tooltip hookup if added */}
      <span id={`${reactId}-sr`} className="sr-only">
        {data.length > 0 && `${data.length} data points trending to ${displayEndpoint}${endpointUnit ?? ''}`}
      </span>
    </section>
  );
}
