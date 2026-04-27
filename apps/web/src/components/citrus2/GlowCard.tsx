import type { ReactNode } from 'react';
import { ACCENT_CLASSES, type AccentName } from './tokens';

const GLOW_COLOR: Record<AccentName, string> = {
  orange: 'rgba(255, 107, 26, 0.35)',
  sage: 'rgba(132, 165, 125, 0.30)',
  butter: 'rgba(244, 229, 184, 0.25)',
  peach: 'rgba(255, 181, 145, 0.30)',
};

const RING_COLOR: Record<AccentName, string> = {
  orange: 'hover:border-pastel-orange/60',
  sage: 'hover:border-pastel-sage/60',
  butter: 'hover:border-[#F4E5B8]/60',
  peach: 'hover:border-pastel-peach/60',
};

/**
 * Wrapper that adds Sleeper-style ambient glow and lift to any card content.
 * The glow color matches the card's accent so a 4-color row of cards lights
 * up with their respective accents on hover.
 *
 * Pattern (per 21st Magic Highlight Card reference):
 * - Multi-layer drop shadows on hover (color + black for depth)
 * - Subtle border tint shift to accent
 * - Scale lift -1px
 * - Animated shine sweep across the card on hover
 * - Persistent ambient inner glow at low opacity
 *
 * Wrap any card content: <GlowCard accent="orange"><content /></GlowCard>
 */
export function GlowCard({
  children,
  accent = 'orange',
  className = '',
  withShine = true,
}: {
  children: ReactNode;
  accent?: AccentName;
  className?: string;
  /** Animated diagonal shine sweep on hover */
  withShine?: boolean;
}) {
  const glow = GLOW_COLOR[accent];
  const ring = RING_COLOR[accent];

  return (
    <div
      className={`group relative bg-[#1A2A20] border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1 ${ring} ${className}`}
      style={{
        boxShadow: '0 0 0 0 transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 24px 60px -20px ${glow}, 0 0 40px -10px ${glow}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 0 transparent';
      }}
    >
      {/* Persistent ambient glow — barely visible until hover */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${glow}, transparent 60%)`,
        }}
      />

      {/* Diagonal shine sweep on hover */}
      {withShine && (
        <div
          aria-hidden="true"
          className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out pointer-events-none"
          style={{
            background: `linear-gradient(110deg, transparent 40%, ${glow.replace('0.35', '0.15').replace('0.30', '0.12').replace('0.25', '0.10')}, transparent 60%)`,
          }}
        />
      )}

      {/* Content sits above the glow layers */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
