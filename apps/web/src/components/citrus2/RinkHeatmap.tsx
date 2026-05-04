/**
 * RinkHeatmap — the Spatial Hero (locked Concept 3) primary visualization.
 *
 * Shows where a player generates value spatially — a freeform shot-density
 * scatter over an offensive-zone hockey rink outline, with mode switching
 * between 5v5 / PP / xG / G−xG. The player identity (jersey watermark,
 * name, eyebrow) is composed AT the rink, not above it.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built rink SVG + dot layer (no 21st.dev primitive
 *   matched — hockey-specific geometry; visx HeatmapCircle is grid-based, not
 *   freeform). The segmented mode control adapts the Vercel-style Switch pattern
 *   from 21st.dev (Root + Control children, value-driven state).
 * - Design principle: "Information lives in design, not paragraphs. Express
 *   ideas through: Color zones and fields, Geometric precision, Spatial
 *   relationships, Visual weight and tension, Form and structure." — from
 *   canvas-design-system.md §1 (Visual Communication First).
 * - Matched mockup section: full upper-hero rink composition in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg — outline rink
 *   + ~80-dot shot density + jersey #97 watermark + A. PRIMA name + Stormy
 *   verdict tile top-right + 5V5/PP/xG/G−xG segmented control bottom-right
 *   with the single page-wide ambient orange glow on the active option.
 */

import { useMemo, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export type RinkMode = '5v5' | 'pp' | 'pk' | 'xg' | 'g-xg' | 'shots';

export interface ShotEvent {
  /** Normalized x position [0, 1] — 0 = right boards, 1 = left boards. */
  x: number;
  /** Normalized y position [0, 1] — 0 = goal-line, 1 = blue-line. */
  y: number;
  /** xG value [0, 1]. Drives color encoding. */
  xg_value?: number | null;
  /** Whether the shot resulted in a goal. */
  is_goal?: boolean;
  /** Optional id for keying. */
  id?: string | number;
}

export interface RinkModeOption {
  value: RinkMode;
  label: string;
}

interface RinkHeatmapProps {
  /** Shot events to render. Empty array → empty-state. */
  shots: ShotEvent[];
  /** Currently-active mode. Drives the segmented control highlight. */
  mode?: RinkMode;
  /** Mode-change handler. Optional — when omitted the control becomes display-only. */
  onModeChange?: (mode: RinkMode) => void;
  /** Available mode options for the control. */
  modes?: RinkModeOption[];

  /** Player name composed AT the rink (bottom-left, layered with watermark). */
  playerName?: string;
  /** Caps eyebrow line above the player name. */
  eyebrow?: string;
  /** Jersey number rendered as massive architectural watermark behind the name. */
  jerseyNumber?: string | number;

  /** Stormy verdict floating tile (top-right). When omitted the tile is hidden. */
  verdict?: ReactNode;
  /** Verdict eyebrow label, default "STORMY VERDICT". */
  verdictEyebrow?: string;

  /** Loading state — shimmer rink + dot constellation. */
  isLoading?: boolean;
  /** Sample-size threshold below which the low-sample treatment renders. */
  lowSampleThreshold?: number;

  /** Caption rendered along the bottom edge of the rink (e.g. attempt count). */
  caption?: string;

  className?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_MODES: RinkModeOption[] = [
  { value: '5v5', label: '5V5' },
  { value: 'pp', label: 'PP' },
  { value: 'xg', label: 'xG' },
  { value: 'g-xg', label: 'G−xG' },
];

// Color buckets for xG encoding — surgical orange (high) → butter (med) → sage (low).
// Per spec: every color encodes meaning, no color-as-decoration.
const XG_COLOR = {
  high: '#FF6B1A', // pastel-orange — top quartile xG
  med: '#F4E5B8',  // pastel-butter — middle 50%
  low: '#84A57D',  // pastel-sage — bottom quartile
} as const;

function xgColor(xg: number | null | undefined): string {
  if (xg == null) return XG_COLOR.low;
  if (xg >= 0.15) return XG_COLOR.high;  // ~top quartile of NHL shot xG
  if (xg >= 0.06) return XG_COLOR.med;
  return XG_COLOR.low;
}

// Ambient pulse on the single hottest spot — find the highest-xG shot.
function findHottestShot(shots: ShotEvent[]): number {
  if (!shots.length) return -1;
  let maxIdx = 0;
  let maxXg = shots[0].xg_value ?? 0;
  for (let i = 1; i < shots.length; i++) {
    const xg = shots[i].xg_value ?? 0;
    if (xg > maxXg) {
      maxXg = xg;
      maxIdx = i;
    }
  }
  return maxXg > 0.15 ? maxIdx : -1; // only pulse if it's actually hot
}

// ── RinkOutline — pure SVG geometry ─────────────────────────────────
// Renders an offensive-zone hockey rink in outline form only. Goal at TOP,
// blue line at BOTTOM. Coordinate system: viewBox 0 0 100 85 (NHL half-rink
// proportions: 100ft long × 85ft wide). All paths use 30% white opacity per
// the mockup spec (functional canvas, not decorative).

function RinkOutline({ className }: { className?: string }) {
  const stroke = 'rgba(255,255,255,0.30)';
  const strokeWidth = 0.4;

  return (
    <svg
      viewBox="0 0 100 85"
      preserveAspectRatio="xMidYMid meet"
      className={cn('w-full h-full', className)}
      aria-hidden="true"
    >
      {/* Boards (perimeter with rounded corners) */}
      <path
        d="M 6 0 L 94 0 L 94 0 Q 100 0 100 6 L 100 79 Q 100 85 94 85 L 6 85 Q 0 85 0 79 L 0 6 Q 0 0 6 0 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      {/* Goal line (top) */}
      <line x1="0" y1="11" x2="100" y2="11" stroke={stroke} strokeWidth={strokeWidth * 0.6} />

      {/* Goal crease (small half-circle at top-center) */}
      <path
        d="M 44 11 A 6 6 0 0 0 56 11"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth * 1.2}
      />

      {/* Goal posts (tiny rectangles inside the crease) */}
      <line x1="46" y1="11" x2="46" y2="9.5" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="54" y1="11" x2="54" y2="9.5" stroke={stroke} strokeWidth={strokeWidth} />

      {/* Two large faceoff circles (offensive deep zone) */}
      {/* Left circle */}
      <circle cx="31" cy="31" r="9" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      <circle cx="31" cy="31" r="0.6" fill={stroke} />
      {/* Hashmarks on left circle */}
      <line x1="29" y1="22.4" x2="29" y2="20.4" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="33" y1="22.4" x2="33" y2="20.4" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="29" y1="39.6" x2="29" y2="41.6" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="33" y1="39.6" x2="33" y2="41.6" stroke={stroke} strokeWidth={strokeWidth} />

      {/* Right circle */}
      <circle cx="69" cy="31" r="9" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      <circle cx="69" cy="31" r="0.6" fill={stroke} />
      {/* Hashmarks on right circle */}
      <line x1="67" y1="22.4" x2="67" y2="20.4" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="71" y1="22.4" x2="71" y2="20.4" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="67" y1="39.6" x2="67" y2="41.6" stroke={stroke} strokeWidth={strokeWidth} />
      <line x1="71" y1="39.6" x2="71" y2="41.6" stroke={stroke} strokeWidth={strokeWidth} />

      {/* Small reference dot near goal-line center */}
      <circle cx="50" cy="20" r="0.6" fill={stroke} />

      {/* Blue line at bottom (entrance to offensive zone) */}
      <line x1="0" y1="80" x2="100" y2="80" stroke={stroke} strokeWidth={strokeWidth * 0.6} />
    </svg>
  );
}

// ── ShotDots — freeform scatter with color/size encoding + hot-spot pulse ──

function ShotDots({
  shots,
  hottestIndex,
  pulseId,
}: {
  shots: ShotEvent[];
  hottestIndex: number;
  pulseId: string;
}) {
  return (
    <svg
      viewBox="0 0 100 85"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        {/* Single ambient glow filter — applied only to the hottest dot */}
        <filter id={pulseId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {shots.map((shot, idx) => {
        // Map shot.x [0..1] → 4..96 (inset from boards), shot.y [0..1] → 78..14 (top to bottom)
        const cx = 4 + shot.x * 92;
        const cy = 78 - shot.y * 64;
        const r = (shot.xg_value ?? 0.05) > 0.15 ? 1.4 : (shot.xg_value ?? 0.05) > 0.06 ? 1.0 : 0.7;
        const fill = xgColor(shot.xg_value);
        const isHottest = idx === hottestIndex;

        if (isHottest) {
          return (
            <g key={shot.id ?? idx}>
              {/* Ambient pulse halo — the SINGLE animated dot on the rink */}
              <circle
                cx={cx}
                cy={cy}
                r={r * 2.4}
                fill={fill}
                opacity={0.25}
                filter={`url(#${pulseId})`}
              >
                <animate
                  attributeName="r"
                  values={`${r * 2.0};${r * 3.2};${r * 2.0}`}
                  dur="1.6s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.25;0.45;0.25"
                  dur="1.6s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx={cx} cy={cy} r={r * 1.4} fill={fill} />
            </g>
          );
        }

        // Goals are rendered with a thin cream ring to differentiate without color noise
        return (
          <circle
            key={shot.id ?? idx}
            cx={cx}
            cy={cy}
            r={r}
            fill={fill}
            stroke={shot.is_goal ? '#FFF8F0' : 'none'}
            strokeWidth={shot.is_goal ? 0.3 : 0}
          />
        );
      })}
    </svg>
  );
}

// ── RinkModeControl — segmented control (adapts Vercel Switch pattern) ──

function RinkModeControl({
  modes,
  active,
  onChange,
}: {
  modes: RinkModeOption[];
  active: RinkMode;
  onChange?: (mode: RinkMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Rink view mode"
      className={cn(
        'inline-flex items-center gap-0.5',
        'bg-pastel-surface-tile/70 backdrop-blur-md',
        'ring-1 ring-white/10 rounded-md p-0.5',
      )}
    >
      {modes.map((mode) => {
        const isActive = mode.value === active;
        return (
          <button
            key={mode.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(mode.value)}
            disabled={!onChange}
            className={cn(
              'relative px-2.5 py-1 rounded-[5px]',
              'font-jbmono uppercase tracking-[0.18em] text-[10px] font-bold',
              'transition-colors duration-150 ease-in-out',
              'disabled:cursor-default',
              isActive
                ? 'text-pastel-cream bg-pastel-cream/[0.08]'
                : 'text-white/45 hover:text-white/65',
            )}
          >
            {/* Single ambient glow — ONLY on the active option, ONLY one per page */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-[5px] pointer-events-none"
                style={{
                  boxShadow: '0 0 16px -2px rgba(255,107,26,0.55), inset 0 0 0 1px rgba(255,107,26,0.4)',
                }}
              />
            )}
            <span className="relative z-10">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Empty / loading / low-sample treatments ─────────────────────────

function RinkSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] text-white/35 animate-pulse">
        Loading rink…
      </div>
    </div>
  );
}

function RinkEmpty() {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div className="text-center">
        <div className="font-jbmono uppercase tracking-[0.22em] text-[10px] text-white/45 font-bold mb-1">
          No shots in this view
        </div>
        <div className="font-sans text-[12px] text-white/30 max-w-[240px]">
          Switch view modes or check back when more games have been played.
        </div>
      </div>
    </div>
  );
}

// ── Main composer ───────────────────────────────────────────────────

export function RinkHeatmap({
  shots,
  mode = '5v5',
  onModeChange,
  modes = DEFAULT_MODES,
  playerName,
  eyebrow,
  jerseyNumber,
  verdict,
  verdictEyebrow = 'Stormy verdict',
  isLoading = false,
  lowSampleThreshold = 50,
  caption,
  className,
}: RinkHeatmapProps) {
  const pulseId = useId();
  const isLowSample = !isLoading && shots.length > 0 && shots.length < lowSampleThreshold;
  const isEmpty = !isLoading && shots.length === 0;

  const hottestIndex = useMemo(
    () => (isEmpty || isLoading ? -1 : findHottestShot(shots)),
    [shots, isEmpty, isLoading],
  );

  return (
    <section
      aria-label={
        playerName
          ? `Shot heatmap for ${playerName} — ${shots.length} shots in ${mode} view`
          : `Shot heatmap — ${shots.length} shots in ${mode} view`
      }
      className={cn(
        'relative w-full overflow-hidden',
        'bg-pastel-surface ring-1 ring-white/10 rounded-2xl',
        // Aspect ratio approximates the half-rink + room for player name composition.
        // On mobile the rink stays landscape — design contract notes a future
        // vertical-rink variant; out of scope for v1.
        'aspect-[100/85]',
        className,
      )}
    >
      {/* Rink outline — geometry layer */}
      <RinkOutline className={cn(isLoading && 'opacity-40')} />

      {/* Shot dots overlay */}
      {!isLoading && !isEmpty && (
        <ShotDots shots={shots} hottestIndex={hottestIndex} pulseId={pulseId} />
      )}

      {/* Loading / empty fallbacks */}
      {isLoading && <RinkSkeleton />}
      {isEmpty && <RinkEmpty />}

      {/* Bottom-left composition: jersey watermark + eyebrow + name (only when supplied) */}
      {(jerseyNumber || playerName || eyebrow) && (
        <div className="absolute left-6 sm:left-10 bottom-6 sm:bottom-8 max-w-[55%] pointer-events-none">
          {/* Jersey watermark — sits BEHIND the name. Architectural anchor. */}
          {jerseyNumber !== undefined && jerseyNumber !== null && jerseyNumber !== '' && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -bottom-2 left-0',
                'font-sans font-black text-pastel-cream/[0.07]',
                'text-[180px] sm:text-[220px] md:text-[260px]',
                'leading-none tracking-tighter',
                'select-none pointer-events-none',
              )}
            >
              {jerseyNumber}
            </span>
          )}
          <div className="relative z-10">
            {eyebrow && (
              <div className="font-jbmono uppercase tracking-[0.22em] text-[11px] sm:text-[12px] font-bold text-white/55 mb-1.5">
                {eyebrow}
              </div>
            )}
            {playerName && (
              <div
                className={cn(
                  'font-sans font-black text-pastel-cream',
                  'text-[44px] sm:text-[64px] md:text-[80px]',
                  'leading-[0.92] tracking-[-0.04em]',
                )}
              >
                {playerName}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top-right floating Stormy verdict tile (composable) */}
      {verdict && (
        <div
          className={cn(
            'absolute right-4 sm:right-6 top-4 sm:top-6',
            'max-w-[280px] sm:max-w-[320px]',
            'p-3.5 rounded-xl',
            'bg-pastel-surface-tile/85 backdrop-blur-md',
            'ring-1 ring-white/10',
            'shadow-[0_8px_32px_-4px_rgba(0,0,0,0.4)]',
          )}
        >
          {verdictEyebrow && (
            <div className="font-jbmono uppercase tracking-[0.22em] text-[9px] font-bold text-white/45 mb-1">
              {verdictEyebrow}
            </div>
          )}
          <div className="font-sans italic text-[13px] sm:text-[14px] leading-snug text-pastel-orange-soft">
            {verdict}
          </div>
        </div>
      )}

      {/* Bottom-right segmented mode control — carries the SINGLE page-wide ambient glow */}
      {!isEmpty && !isLoading && (
        <div className="absolute right-4 sm:right-6 bottom-4 sm:bottom-6">
          <RinkModeControl modes={modes} active={mode} onChange={onModeChange} />
        </div>
      )}

      {/* Optional caption + low-sample badge along bottom */}
      {(caption || isLowSample) && (
        <div className="absolute left-6 sm:left-10 bottom-2 right-44 flex items-center gap-2 pointer-events-none">
          {isLowSample && (
            <span
              className={cn(
                'font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold',
                'bg-pastel-butter/15 text-pastel-butter ring-1 ring-pastel-butter/40',
                'rounded px-1.5 py-0.5',
              )}
            >
              SS · {shots.length} shots
            </span>
          )}
          {caption && (
            <span className="font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold text-white/45 truncate">
              {caption}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
