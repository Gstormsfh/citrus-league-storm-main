/**
 * WrappedChapter — full-bleed editorial chapter container (Component 5 of 7).
 *
 * The SHARE-zone signature. One chapter = one massive visual + one massive
 * number, screenshot-ready. Spotify Wrapped's "one big thing per slide"
 * applied to a player profile section. Each chapter is OG-image-ready —
 * crop at 1200×630 and the chapter still reads.
 *
 * API is children-based so each chapter type can slot in a different
 * visualization (KDE distribution for "Position vs League", future support
 * for shot-zone heatmap, career arc line, etc.). The chapter chrome
 * (eyebrow divider, callout column, subtitle caption) is the universal
 * frame; the viz is the variable.
 *
 * Includes a hand-built KDEDistribution child for the Web Summit launch
 * chapter (POSITION VS LEAGUE). KDE = kernel density estimate, rendered
 * here as a smooth bell curve via Catmull-Rom spline through 50 sampled
 * points of a gaussian-on-a-sample-array. No axis labels, no legend —
 * Modern Tech precision applied to chart chrome.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built. Three queries fired (full bleed section
 *   hero / stat callout large number / chapter break section). The first
 *   returned a generic SaaS landing-page hero with logos marquee — wrong
 *   DNA. The other two overflowed (95KB / 63KB) before any chapter-numbered
 *   editorial primitive surfaced. WrappedChapter is ~120 lines of typography
 *   composition + a full-bleed wrapper; pulling the marketing Hero would
 *   import marquee/button/logo chrome we'd immediately strip.
 * - Design principle referenced: "Concrete Poetry — Communication through
 *   monumental form and bold geometry. Massive color blocks. Sculptural
 *   typography (huge words, tiny labels). Brutalist spatial divisions.
 *   Polish poster energy meets Le Corbusier. Ideas through visual weight
 *   and spatial tension. Text as rare, powerful gesture." — from
 *   canvas-design-system.md §Concrete Poetry. The +4.21 in Inter Black
 *   96px is "huge word, tiny label" rendered literally.
 *   Plus PLAYER_DASHBOARD_DESIGN_SPEC.md §2.4 zone contract: "SHARE ZONE —
 *   Wrapped Chapters. Movement: Wrapped-style storytelling (one massive
 *   number per chapter, screenshot-shareable per chapter)." Plus §8.3
 *   refinement: "the +4.21 value should be Inter Black 96px (was 48px in
 *   mockup). This is the chapter's monumental moment."
 * - Matched mockup section: bottom of
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg —
 *   hairline divider above with centered eyebrow "CHAPTER 1 · POSITION VS
 *   LEAGUE", two-column grid (left: KDE distribution with sage area fill +
 *   orange player marker deep in the right tail; right: monumental "+4.21"
 *   in cream Inter Black with "vs league avg" caps eyebrow above and
 *   "Top 1% · 9 of 906" caps support below), and "OFFENSIVE GAR · ALL
 *   CENTERS · 906 PLAYERS" caption beneath the curve.
 */

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export type WrappedChapterVariant = 'default' | 'share';
export type WrappedAccent = 'orange' | 'sage' | 'butter' | 'cream';

interface WrappedChapterProps {
  /** Chapter index — rendered as "CHAPTER N" in the eyebrow. */
  chapterNumber: number;
  /** Chapter title — rendered after the chapter number in the eyebrow. */
  title: string;
  /** Subtitle caption rendered below the visualization (JBMono caps). */
  subtitle?: string;
  /** The right-column monumental callout — one big value, tiny label. */
  callout?: {
    value: string;
    /** Caps eyebrow ABOVE the value (e.g. "vs league avg"). */
    label?: string;
    /** Optional supporting line BELOW the value (e.g. "Top 1% · 9 of 906"). */
    support?: string;
    /** Accent color for the value. */
    accent?: WrappedAccent;
  };
  /** Visualization slot — the variable per-chapter content (KDE, scatter, line, etc.). */
  children?: ReactNode;
  /** Variant. share = extra padding tuned for clean 1200×630 OG screenshot crop. */
  variant?: WrappedChapterVariant;
  /** Loading skeleton state. */
  isLoading?: boolean;
  /** Empty state message — overrides children. */
  emptyText?: string;
  className?: string;
}

// ── Tokens ───────────────────────────────────────────────────────────

const ACCENT_TEXT_CLASS: Record<WrappedAccent, string> = {
  orange: 'text-pastel-orange-soft',
  sage: 'text-pastel-sage-soft',
  butter: 'text-pastel-butter',
  cream: 'text-pastel-cream',
};

// Per-variant outer padding. share gets generous padding so the OG crop
// at 1200×630 has comfortable breathing room around the content.
const VARIANT_PADDING: Record<WrappedChapterVariant, string> = {
  default: 'py-10 sm:py-14',
  share: 'py-16 sm:py-24',
};

// ── KDEDistribution — gaussian density curve with player marker ─────

export interface KDEDistributionProps {
  /** Sample values — used to estimate the density curve. Pass either this OR `density`. */
  samples?: number[];
  /** Pre-computed density points [{ x, y }, ...]. Skips KDE estimation. */
  density?: { x: number; y: number }[];
  /** The player's value — drives the marker position on the x-axis. */
  playerValue: number;
  /** Min/max of the x-axis. Defaults to data extent. */
  domain?: [number, number];
  /** Accent color for the player marker. Default 'orange'. */
  accent?: WrappedAccent;
  /** Show quartile gridlines. Default true. */
  showGridlines?: boolean;
  /** Optional formatted value rendered next to the marker (e.g. "+4.21"). */
  markerValueLabel?: string;
  /** Height in pixels. Default 220 — full-bleed chapter scale. */
  height?: number;
  className?: string;
}

const KDE_VIEWBOX = { w: 1000, h: 220 };

const ACCENT_STROKE: Record<WrappedAccent, string> = {
  orange: '#FF6B1A',
  sage: '#84A57D',
  butter: '#F4E5B8',
  cream: '#FFF8F0',
};

function gaussianKernel(u: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * u * u);
}

// Silverman's rule-of-thumb bandwidth — adequate for a single-chapter viz.
function silverman(samples: number[]): number {
  const n = samples.length;
  if (n < 2) return 1;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return 1.06 * sd * Math.pow(n, -1 / 5);
}

function estimateDensity(
  samples: number[],
  domain: [number, number],
  steps = 60,
): { x: number; y: number }[] {
  const h = silverman(samples) || 1;
  const [min, max] = domain;
  const span = max - min;
  return Array.from({ length: steps }, (_, i) => {
    const x = min + (i / (steps - 1)) * span;
    const y =
      samples.reduce((acc, s) => acc + gaussianKernel((x - s) / h), 0) /
      (samples.length * h);
    return { x, y };
  });
}

// Catmull-Rom → cubic Bézier path for smooth curves through density points.
function catmullRomPath(points: { x: number; y: number }[], tension = 0.5): string {
  if (points.length < 2) return '';
  const t = tension;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * t;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * t;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * t;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * t;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function KDEDistribution({
  samples,
  density: providedDensity,
  playerValue,
  domain,
  accent = 'orange',
  showGridlines = true,
  markerValueLabel,
  height = 220,
  className,
}: KDEDistributionProps) {
  const id = useId();
  const accentColor = ACCENT_STROKE[accent];

  // Derive domain from samples or density if not explicit.
  const sortedSamples = samples ? [...samples].sort((a, b) => a - b) : null;
  const resolvedDomain: [number, number] =
    domain ??
    (providedDensity
      ? [providedDensity[0].x, providedDensity[providedDensity.length - 1].x]
      : sortedSamples
        ? [sortedSamples[0], sortedSamples[sortedSamples.length - 1]]
        : [0, 1]);

  const density = providedDensity ?? (samples ? estimateDensity(samples, resolvedDomain) : []);

  if (density.length === 0) return null;

  const maxY = density.reduce((m, p) => Math.max(m, p.y), 0);
  const xSpan = resolvedDomain[1] - resolvedDomain[0] || 1;
  const padX = 32;
  const padY = 18;
  const innerW = KDE_VIEWBOX.w - padX * 2;
  const innerH = KDE_VIEWBOX.h - padY * 2;

  const toScreenX = (x: number) => padX + ((x - resolvedDomain[0]) / xSpan) * innerW;
  const toScreenY = (y: number) => padY + innerH - (y / maxY) * innerH;

  const screenPoints = density.map((p) => ({ x: toScreenX(p.x), y: toScreenY(p.y) }));
  const linePath = catmullRomPath(screenPoints, 0.5);
  const areaPath =
    `${linePath} L ${screenPoints[screenPoints.length - 1].x.toFixed(2)} ${(padY + innerH).toFixed(2)}` +
    ` L ${screenPoints[0].x.toFixed(2)} ${(padY + innerH).toFixed(2)} Z`;

  // Quartile gridlines (Q1, median, Q3) when we have samples.
  const quartiles = sortedSamples
    ? [
        quantile(sortedSamples, 0.25),
        quantile(sortedSamples, 0.5),
        quantile(sortedSamples, 0.75),
      ]
    : null;

  const playerX = toScreenX(playerValue);
  const playerY = toScreenY(
    density.reduce(
      (closest, p) =>
        Math.abs(p.x - playerValue) < Math.abs(closest.x - playerValue) ? p : closest,
      density[0],
    ).y,
  );

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${KDE_VIEWBOX.w} ${KDE_VIEWBOX.h}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Density distribution; player sits at ${playerValue.toFixed(2)}${markerValueLabel ? ` (${markerValueLabel})` : ''}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#84A57D" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#84A57D" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Quartile gridlines — hairline, very subtle */}
        {showGridlines && quartiles &&
          quartiles.map((q, idx) => {
            const x = toScreenX(q);
            const isMedian = idx === 1;
            return (
              <line
                key={`q-${idx}`}
                x1={x}
                x2={x}
                y1={padY}
                y2={padY + innerH}
                stroke="rgba(255,248,240,0.06)"
                strokeWidth={isMedian ? 1.2 : 0.6}
                strokeDasharray={isMedian ? undefined : '3 4'}
              />
            );
          })}

        {/* Baseline */}
        <line
          x1={padX}
          x2={KDE_VIEWBOX.w - padX}
          y1={padY + innerH}
          y2={padY + innerH}
          stroke="rgba(255,248,240,0.10)"
          strokeWidth={0.8}
        />

        {/* Area fill below curve */}
        <path d={areaPath} fill={`url(#${id}-fill)`} />

        {/* Curve stroke — sage, hairline */}
        <path
          d={linePath}
          fill="none"
          stroke="rgba(132,165,125,0.55)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Player marker — vertical line + dot at curve y */}
        <line
          x1={playerX}
          x2={playerX}
          y1={playerY - 4}
          y2={padY + innerH}
          stroke={accentColor}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={playerX} cy={playerY} r={6} fill={accentColor} />
        <circle
          cx={playerX}
          cy={playerY}
          r={11}
          fill="none"
          stroke={accentColor}
          strokeOpacity="0.35"
          strokeWidth={1.5}
        />

        {/* Marker value label — JBMono, just above the dot */}
        {markerValueLabel && (
          <text
            x={playerX}
            y={playerY - 16}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="11"
            fontWeight="700"
            letterSpacing="0.18em"
            fill={accentColor}
            style={{ textTransform: 'uppercase' }}
          >
            {markerValueLabel}
          </text>
        )}
      </svg>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────

function ChapterSkeleton({ variant }: { variant: WrappedChapterVariant }) {
  return (
    <div role="status" aria-label="Loading chapter" className={cn('animate-pulse', VARIANT_PADDING[variant])}>
      <div className="h-3 w-64 mx-auto rounded bg-white/10 mb-10" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
        <div className="h-[220px] rounded-xl bg-white/5" />
        <div className="flex flex-col items-end gap-3 lg:min-w-[280px]">
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="h-20 w-48 rounded bg-white/10" />
          <div className="h-3 w-40 rounded bg-white/10" />
        </div>
      </div>
      <div className="h-3 w-72 mx-auto rounded bg-white/10 mt-8" />
    </div>
  );
}

// ── Main composer ───────────────────────────────────────────────────

export function WrappedChapter({
  chapterNumber,
  title,
  subtitle,
  callout,
  children,
  variant = 'default',
  isLoading = false,
  emptyText,
  className,
}: WrappedChapterProps) {
  const calloutAccent = callout?.accent ?? 'cream';
  const eyebrowText = `Chapter ${chapterNumber} · ${title}`;

  return (
    <section
      role="region"
      aria-label={eyebrowText}
      className={cn(
        // Full-bleed within its parent — no horizontal padding here; let the
        // parent set page margins. Vertical padding is variant-controlled.
        'relative w-full border-t border-white/[0.08]',
        VARIANT_PADDING[variant],
        className,
      )}
    >
      {/* Eyebrow — centered hairline-divider companion */}
      <div className="text-center mb-10">
        <div
          className="font-jbmono uppercase tracking-[0.32em] text-[11px] sm:text-[12px] font-bold text-white/55"
        >
          {eyebrowText}
        </div>
      </div>

      {isLoading ? (
        <ChapterSkeleton variant={variant} />
      ) : emptyText ? (
        <div className="flex items-center justify-center min-h-[220px]">
          <div className="font-jbmono uppercase tracking-[0.22em] text-[11px] font-bold text-white/55">
            {emptyText}
          </div>
        </div>
      ) : (
        <>
          {/* Two-column grid: viz LEFT, callout RIGHT.
              On mobile collapses to single column with viz on top. */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 lg:gap-12 items-center">
            <div className="min-w-0">{children}</div>

            {callout && (
              <div className="flex flex-col items-start lg:items-end lg:text-right lg:min-w-[280px]">
                {callout.label && (
                  <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/55 mb-3">
                    {callout.label}
                  </div>
                )}
                <div
                  className={cn(
                    // Concrete Poetry — Inter Black, monumental scale. §8.3
                    // bumped to 96px on desktop. Tabular-nums to keep the +/-
                    // sign stable.
                    'font-sans font-black tabular-nums leading-[0.85] tracking-[-0.04em]',
                    'text-[64px] sm:text-[80px] lg:text-[96px]',
                    ACCENT_TEXT_CLASS[calloutAccent],
                  )}
                >
                  {callout.value}
                </div>
                {callout.support && (
                  <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/55 mt-4">
                    {callout.support}
                  </div>
                )}
              </div>
            )}
          </div>

          {subtitle && (
            <div className="mt-8 text-center font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/55">
              {subtitle}
            </div>
          )}
        </>
      )}
    </section>
  );
}
