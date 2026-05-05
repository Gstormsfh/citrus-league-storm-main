/**
 * SparklineMicroChart — minimal trend visualization for the data zone.
 *
 * Iteration #3: game-level depth via tick layer, event markers, inline
 * editorial annotation, and hover tooltip. The Trend + Verdict Pair
 * signature applied to the chart itself — GitHub contribution-graph
 * tick density meets The Athletic editorial annotation, without
 * sacrificing the iter #2 minimalism (gradient fill, endpoint pill,
 * tile hairline, no axes, no grid).
 *
 * Earns informational depth without falling into the JFresh trap of
 * stacked horizontal bars: each new layer (tick / event / annotation /
 * tooltip) earns its place. Ticks are minimal, events are 1-3 max,
 * annotation is 1 max, tooltip only on interaction.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built. 21st.dev API returned schema-validation
 *   errors on all 3 inspiration queries. Recharts is installed at ^2.12.7
 *   but carries chrome we explicitly strip. Adapts the Stripe/Linear
 *   minimal-sparkline pattern by reference + GitHub contribution-graph
 *   tick density + The Athletic editorial annotation pattern.
 * - Design principle referenced: "Subtle Reference Integration — Embed
 *   conceptual DNA without announcing. Niche reference woven invisibly.
 *   Those who know feel it intuitively. Others experience masterful
 *   abstract composition." — from canvas-design-system.md §Implementation
 *   Guidelines. The tick density quotes GitHub; the inline annotation
 *   quotes The Athletic; both invisible to the casual viewer, deliberate
 *   to the data-fluent.
 *   Plus the iter #2 reference: "Second Pass (Critical) — Don't add more
 *   graphics. Refine what exists." Iter #3 doesn't add chrome — it adds
 *   data layers that ARE the data.
 * - Matched mockup section: "LAST 30 DAYS · xG/60" wide tile in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg, extended
 *   beyond literal mockup geometry per Garrett's iter #3 directive. The
 *   Trend + Verdict Pair signature from PLAYER_DASHBOARD_DESIGN_SPEC.md §3
 *   table row 6 lives here.
 */

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export type SparklineEventKind = 'hat_trick' | 'return_from_injury' | 'milestone';

export interface SparklinePoint {
  x: number | string;
  y: number;
  high?: number;
  low?: number;
  /** Display date for hover tooltip (e.g. "MAR 12"). */
  gameDate?: string;
  /** Opponent abbrev for hover tooltip (e.g. "PIT"). */
  opponent?: string;
  /** Event kind — drives marker color + qualifies for inline annotation. */
  event?: SparklineEventKind;
  /** Override label for the inline annotation (e.g. "HAT TRICK"). */
  eventLabel?: string;
}

export type SparklineAccent = 'orange' | 'sage' | 'butter' | 'cream';

interface SparklineMicroChartProps {
  data: SparklinePoint[];
  eyebrow?: string;
  endpointValue?: string | number;
  endpointUnit?: string;
  accent?: SparklineAccent;
  lineColor?: SparklineAccent;
  showConfidenceBand?: boolean;
  /** Render game-level tick marks at the baseline. Default true. */
  showTicks?: boolean;
  /** Format the y value for tooltip display. Defaults to 2-decimal toFixed. */
  formatTooltipValue?: (y: number) => string;
  /** Optional unit suffix on tooltip values (defaults to endpointUnit). */
  tooltipUnit?: string;
  height?: number;
  isLoading?: boolean;
  emptyText?: string;
  className?: string;
}

// ── Event token mapping ─────────────────────────────────────────────

const EVENT_LABEL_DEFAULT: Record<SparklineEventKind, string> = {
  hat_trick: 'Hat trick',
  return_from_injury: 'Return',
  milestone: 'Milestone',
};

const EVENT_COLOR_KEY: Record<SparklineEventKind, SparklineAccent> = {
  hat_trick: 'orange',
  return_from_injury: 'butter',
  milestone: 'orange',
};

// ── Color tokens ────────────────────────────────────────────────────

const ACCENT_HEX: Record<SparklineAccent, string> = {
  orange: '#FF6B1A',
  sage: '#84A57D',
  butter: '#F4E5B8',
  cream: '#FFF8F0',
};

// Confidence-band fill tokens (used by the area path between high/low).
const BAND_FILL: Record<SparklineAccent, string> = {
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
): { points: NormalizedPoint[]; minY: number; maxY: number; baselineY: number } {
  if (!data.length) return { points: [], minY: 0, maxY: 0, baselineY: height - pad };

  let minY = Infinity;
  let maxY = -Infinity;
  for (const d of data) {
    minY = Math.min(minY, d.low ?? d.y, d.y);
    maxY = Math.max(maxY, d.high ?? d.y, d.y);
  }
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

  return { points, minY, maxY, baselineY: height - pad };
}

function buildLinePath(points: NormalizedPoint[]): string {
  if (!points.length) return '';
  const cmds: string[] = [`M ${points[0].cx.toFixed(2)} ${points[0].cy.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L ${points[i].cx.toFixed(2)} ${points[i].cy.toFixed(2)}`);
  }
  return cmds.join(' ');
}

// Build closed area path from line to baseline (for gradient fill below).
function buildAreaPath(points: NormalizedPoint[], baselineY: number): string {
  if (!points.length) return '';
  const cmds: string[] = [
    `M ${points[0].cx.toFixed(2)} ${baselineY.toFixed(2)}`,
    `L ${points[0].cx.toFixed(2)} ${points[0].cy.toFixed(2)}`,
  ];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L ${points[i].cx.toFixed(2)} ${points[i].cy.toFixed(2)}`);
  }
  cmds.push(`L ${points[points.length - 1].cx.toFixed(2)} ${baselineY.toFixed(2)}`);
  cmds.push('Z');
  return cmds.join(' ');
}

function buildBandPath(points: NormalizedPoint[]): string {
  if (!points.length) return '';
  const valid = points.every((p) => p.high != null && p.low != null);
  if (!valid) return '';

  const cmds: string[] = [`M ${points[0].cx.toFixed(2)} ${points[0].high!.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L ${points[i].cx.toFixed(2)} ${points[i].high!.toFixed(2)}`);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    cmds.push(`L ${points[i].cx.toFixed(2)} ${points[i].low!.toFixed(2)}`);
  }
  cmds.push('Z');
  return cmds.join(' ');
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
  showTicks = true,
  formatTooltipValue,
  tooltipUnit,
  height = 140,
  isLoading = false,
  emptyText = 'Not enough data yet',
  className,
}: SparklineMicroChartProps) {
  const reactId = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const isEmpty = !isLoading && data.length === 0;
  const accentHex = ACCENT_HEX[accent];
  const lineHex = ACCENT_HEX[lineColor];
  const bandFill = BAND_FILL[lineColor];

  // First event index — used for the single inline annotation
  const annotationIdx = useMemo(
    () => data.findIndex((d) => !!d.event),
    [data],
  );

  const formatValue = formatTooltipValue ?? ((y: number) =>
    Number.isInteger(y) ? String(y) : y.toFixed(2));
  const tooltipUnitText = tooltipUnit ?? endpointUnit ?? '';

  const displayEndpoint = useMemo(() => {
    if (endpointValue !== undefined && endpointValue !== null && endpointValue !== '') {
      return String(endpointValue);
    }
    if (!data.length) return null;
    const last = data[data.length - 1].y;
    return Number.isInteger(last) ? String(last) : last.toFixed(2);
  }, [endpointValue, data]);

  const VIEW_W = 1000;
  const VIEW_H = height;
  const PAD = 12;
  const { points, baselineY } = useMemo(
    () => normalizePoints(data, VIEW_W, VIEW_H, PAD),
    [data, VIEW_H],
  );

  const linePath = useMemo(() => buildLinePath(points), [points]);
  const areaPath = useMemo(() => buildAreaPath(points, baselineY), [points, baselineY]);
  const bandPath = useMemo(
    () => (showConfidenceBand ? buildBandPath(points) : ''),
    [points, showConfidenceBand],
  );

  const lastPoint = points[points.length - 1];
  // Iter #2 fix #5: position value label proximal to endpoint dot.
  // Compute pixel-relative position from viewBox coords.
  // SVG uses preserveAspectRatio="none", so y maps linearly across container height.
  const endpointXPct = lastPoint ? (lastPoint.cx / VIEW_W) * 100 : 100;
  const endpointYPct = lastPoint ? (lastPoint.cy / VIEW_H) * 100 : 50;

  // Unique gradient ids per instance (multiple sparklines on same page).
  const gradientId = `${reactId}-grad`;
  const lineGradId = `${reactId}-line-grad`;

  return (
    <section
      aria-label={
        eyebrow
          ? `${eyebrow}${displayEndpoint ? `: ${displayEndpoint}${endpointUnit ?? ''}` : ''}`
          : `Trend chart${displayEndpoint ? `: ${displayEndpoint}${endpointUnit ?? ''}` : ''}`
      }
      className={cn(
        'relative w-full overflow-hidden',
        // Iter #2 fix #6: tile ring at 8% white (was 10%, was reading too sharp).
        // Plus subtle inset highlight via the ring + surface tint stack.
        'bg-pastel-surface-tile ring-1 ring-white/[0.08] rounded-2xl',
        // Subtle inner top-edge highlight — a 1px bright line at the top of the tile
        // gives it presence vs sitting flat. Standard premium-tile move.
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
        // Iter #3: extra bottom padding when an inline annotation will render
        // so it stays inside the rounded corners.
        annotationIdx >= 0 ? 'pt-5 px-5 pb-9' : 'p-5',
        className,
      )}
      style={{ minHeight: height + (annotationIdx >= 0 ? 84 : 64) }}
    >
      {/* Eyebrow row — caption only. Endpoint value moved into the chart area
          near the dot per iter #2 fix #5. */}
      {eyebrow && (
        <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/45 truncate mb-2">
          {eyebrow}
        </div>
      )}

      {/* Chart area — relative wrapper so we can absolute-position the value label */}
      <div className="relative w-full" style={{ height }}>
        {!isEmpty && !isLoading && (
          <>
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              aria-hidden="true"
            >
              <defs>
                {/* Iter #2 fix #1: gradient fill below line, accent at 12% opacity
                    at the line's position → fully transparent at the baseline.
                    Vertical gradient (top of line = strongest, bottom = transparent). */}
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineHex} stopOpacity="0.18" />
                  <stop offset="60%" stopColor={lineHex} stopOpacity="0.06" />
                  <stop offset="100%" stopColor={lineHex} stopOpacity="0" />
                </linearGradient>
                {/* Subtle gradient on the line stroke itself — adds depth without
                    breaking the single-color encoding rule (color = meaning).
                    Goes from slightly-dimmer at left to full saturation at right
                    (the endpoint = the freshest data, brightest). */}
                <linearGradient id={lineGradId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={lineHex} stopOpacity="0.7" />
                  <stop offset="100%" stopColor={lineHex} stopOpacity="1" />
                </linearGradient>
              </defs>

              {/* Confidence band (behind everything) */}
              {bandPath && (
                <path d={bandPath} fill={bandFill} />
              )}

              {/* Iter #2 fix #1: gradient area fill below line */}
              <path d={areaPath} fill={`url(#${gradientId})`} />

              {/* Iter #2 fix #3: endpoint accent column — 1px vertical hairline
                  from dot to baseline at 5% accent opacity. Anchors the
                  endpoint visually without competing with the line. */}
              {lastPoint && (
                <line
                  x1={lastPoint.cx}
                  y1={lastPoint.cy}
                  x2={lastPoint.cx}
                  y2={baselineY}
                  stroke={accentHex}
                  strokeOpacity="0.18"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Iter #2 fix #4: line stroke bumped 2.5 → 3px, with the
                  left-to-right opacity gradient defined above. */}
              <path
                d={linePath}
                fill="none"
                stroke={`url(#${lineGradId})`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Iter #2 fix #2: endpoint upgrade — 9px solid dot + 18px halo
                  + 28px outer aura at 30% accent opacity. The dot now actually
                  punctuates instead of sitting as a 4px afterthought. */}
              {lastPoint && (
                <g>
                  {/* Outer aura — softest */}
                  <circle
                    cx={lastPoint.cx}
                    cy={lastPoint.cy}
                    r="14"
                    fill={accentHex}
                    opacity="0.12"
                  />
                  {/* Halo */}
                  <circle
                    cx={lastPoint.cx}
                    cy={lastPoint.cy}
                    r="9"
                    fill={accentHex}
                    opacity="0.30"
                  />
                  {/* Solid dot */}
                  <circle
                    cx={lastPoint.cx}
                    cy={lastPoint.cy}
                    r="4.5"
                    fill={accentHex}
                  />
                </g>
              )}

              {/* Iter #3 fix #1+2: game ticks layer at baseline.
                  Standard ticks at 18% white opacity. Event-flagged points
                  get a slightly larger marker in the event's color. Hit area
                  is wider (12px) for easier hover. */}
              {showTicks && points.map((p, i) => {
                const datum = data[i];
                const isEvent = !!datum.event;
                const isLast = i === points.length - 1;
                if (isLast) return null; // last point = endpoint dot, don't double-mark

                const eventColor = datum.event
                  ? ACCENT_HEX[EVENT_COLOR_KEY[datum.event]]
                  : null;
                const isHovered = hoveredIdx === i;

                return (
                  <g key={`tick-${i}`}>
                    {/* Standard tick OR event marker */}
                    {isEvent ? (
                      <>
                        <line
                          x1={p.cx}
                          y1={baselineY}
                          x2={p.cx}
                          y2={baselineY + 6}
                          stroke={eventColor ?? '#fff'}
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          cx={p.cx}
                          cy={baselineY + 7}
                          r="2"
                          fill={eventColor ?? '#fff'}
                        />
                      </>
                    ) : (
                      <line
                        x1={p.cx}
                        y1={baselineY}
                        x2={p.cx}
                        y2={baselineY + 4}
                        stroke="rgba(255,255,255,0.18)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        opacity={isHovered ? 0.5 : 1}
                      />
                    )}
                    {/* Invisible hit area for hover (12px wide x 16px tall) */}
                    <rect
                      x={p.cx - 6}
                      y={baselineY - 4}
                      width="12"
                      height="20"
                      fill="transparent"
                      style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() =>
                        setHoveredIdx((curr) => (curr === i ? null : curr))
                      }
                    />
                  </g>
                );
              })}
            </svg>

            {/* Iter #2 fix #5: endpoint value composed with the dot.
                Floats above-left of the endpoint position, anchored via
                the percentage coords from viewBox. */}
            {displayEndpoint && lastPoint && (
              <div
                className="absolute pointer-events-none"
                style={{
                  // Position to the LEFT of the endpoint so the label trails
                  // the dot without overlapping. Translate up so it sits
                  // ABOVE the dot.
                  left: `min(calc(${endpointXPct}% - 8px), calc(100% - 88px))`,
                  top: `calc(${endpointYPct}% - 38px)`,
                  transform: 'translateX(-100%)',
                }}
              >
                <div className="flex items-baseline gap-0.5 px-2 py-1 rounded-md bg-pastel-surface/80 backdrop-blur-sm ring-1 ring-white/10">
                  <span className="font-jbmono font-bold tabular-nums text-pastel-cream text-[18px] sm:text-[20px] leading-none">
                    {displayEndpoint}
                  </span>
                  {endpointUnit && (
                    <span className="font-jbmono text-white/55 font-medium text-[12px] leading-none">
                      {endpointUnit}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Iter #3 fix #4: hover tooltip on game ticks.
                Floats above the hovered tick. Single-line JBMono caps. */}
            {hoveredIdx != null && hoveredIdx !== points.length - 1 && data[hoveredIdx] && (
              <div
                className="absolute pointer-events-none z-10"
                style={{
                  left: `${(points[hoveredIdx].cx / VIEW_W) * 100}%`,
                  top: `calc(${(points[hoveredIdx].cy / VIEW_H) * 100}% - 32px)`,
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-pastel-surface ring-1 ring-white/15 shadow-[0_4px_16px_-2px_rgba(0,0,0,0.4)] whitespace-nowrap">
                  <span className="font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold text-white/55">
                    {data[hoveredIdx].gameDate ?? `Game ${hoveredIdx + 1}`}
                  </span>
                  {data[hoveredIdx].opponent && (
                    <span className="font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold text-white/45">
                      vs {data[hoveredIdx].opponent}
                    </span>
                  )}
                  <span className="font-jbmono font-bold tabular-nums text-pastel-cream text-[10px]">
                    {formatValue(data[hoveredIdx].y)}{tooltipUnitText}
                  </span>
                </div>
              </div>
            )}

            {/* Iter #3 fix #3: inline editorial annotation for ONE event per chart.
                Sits just below the chart, anchored to the event's x position
                via the chart-container's percentage coords. Italic caps eyebrow
                style. The section's padding-bottom is bumped when an annotation
                renders, keeping it inside the rounded corners. */}
            {annotationIdx >= 0 && data[annotationIdx] && (
              <div
                className="absolute pointer-events-none z-10"
                style={{
                  left: `${(points[annotationIdx].cx / VIEW_W) * 100}%`,
                  bottom: '-26px',
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="flex items-center gap-1 font-jbmono uppercase tracking-[0.22em] text-[9px] font-bold text-white/55 italic whitespace-nowrap">
                  <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
                    <line
                      x1="3"
                      y1="0"
                      x2="3"
                      y2="6"
                      stroke="rgba(255,255,255,0.30)"
                      strokeWidth="1"
                    />
                  </svg>
                  {data[annotationIdx].gameDate && (
                    <>
                      <span>{data[annotationIdx].gameDate}</span>
                      <span className="text-white/35">·</span>
                    </>
                  )}
                  <span>
                    {data[annotationIdx].eventLabel ??
                      EVENT_LABEL_DEFAULT[data[annotationIdx].event!]}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {isLoading && <SparklineSkeleton />}
        {isEmpty && <SparklineEmpty text={emptyText} />}
      </div>

      {/* Hidden screen-reader summary */}
      <span id={`${reactId}-sr`} className="sr-only">
        {data.length > 0 && `${data.length} data points trending to ${displayEndpoint}${endpointUnit ?? ''}`}
      </span>
    </section>
  );
}
