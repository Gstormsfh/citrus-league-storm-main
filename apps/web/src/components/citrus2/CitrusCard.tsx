import { type ReactNode, type CSSProperties, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * CitrusCard — the canonical surface primitive for Citrus 2.0.
 *
 * Replaces shadcn `<Card>` on every migrated page. Built-in:
 *  - Dark forest background tuned to sit on top of DarkLayout
 *  - Ring-based borders (no thick `border-2` shadcn defaults)
 *  - Optional accent glow (orange for action, sage for status, mono for chrome)
 *  - Three padding presets: tight (16px), default (24px), spacious (32px)
 *  - Optional `interactive` mode for hover lift + glow on cards that act as buttons/links
 *
 * Use `<CitrusCard interactive accent="orange">` for hero CTAs.
 * Use `<CitrusCard accent="sage">` for status/info surfaces.
 * Use `<CitrusCard accent="mono">` for chrome/list rows.
 */

type Accent = 'orange' | 'sage' | 'mono';
type Padding = 'tight' | 'default' | 'spacious' | 'none';

const ACCENT_RING: Record<Accent, string> = {
  orange: 'ring-pastel-orange/20 hover:ring-pastel-orange/40',
  sage: 'ring-pastel-sage/20 hover:ring-pastel-sage/40',
  mono: 'ring-white/10 hover:ring-white/20',
};

const ACCENT_GLOW: Record<Accent, string> = {
  orange: 'rgba(255, 107, 26, 0.35)',
  sage: 'rgba(132, 165, 125, 0.3)',
  mono: 'rgba(255, 255, 255, 0.1)',
};

const PADDING: Record<Padding, string> = {
  tight: 'p-4',
  default: 'p-6',
  spacious: 'p-8',
  none: '',
};

export interface CitrusCardProps {
  children: ReactNode;
  accent?: Accent;
  padding?: Padding;
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  as?: 'div' | 'article' | 'section' | 'button';
}

export const CitrusCard = forwardRef<HTMLDivElement, CitrusCardProps>(
  ({ children, accent = 'mono', padding = 'default', interactive = false, className, style, onClick, as = 'div' }, ref) => {
    const Component = as as 'div';
    const glow = ACCENT_GLOW[accent];

    return (
      <Component
        ref={ref}
        onClick={onClick}
        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
          if (!interactive) return;
          e.currentTarget.style.boxShadow = `0 24px 60px -20px ${glow}, 0 0 40px -10px ${glow}`;
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
          if (!interactive) return;
          e.currentTarget.style.boxShadow = '0 0 0 0 transparent';
        }}
        className={cn(
          'relative bg-[#1A2A20] rounded-2xl ring-1 transition-all duration-300 ease-out',
          ACCENT_RING[accent],
          PADDING[padding],
          interactive && 'cursor-pointer hover:-translate-y-0.5',
          className,
        )}
        style={style}
      >
        {children}
      </Component>
    );
  },
);

CitrusCard.displayName = 'CitrusCard';

/**
 * CitrusCardHeader / Title / Description / Body / Footer — composable
 * sub-components so callers don't need to remember spacing.
 */
export function CitrusCardEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2', className)}>
      {children}
    </div>
  );
}

export function CitrusCardTitle({ children, className, size = 'md' }: { children: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'text-[1.75rem] md:text-[2.25rem]' : size === 'md' ? 'text-[1.25rem] md:text-[1.5rem]' : 'text-[1rem] md:text-[1.125rem]';
  return (
    <h3 className={cn('font-sans font-black tracking-[-0.02em] text-pastel-cream leading-tight', sz, className)}>
      {children}
    </h3>
  );
}

export function CitrusCardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[14px] text-white/65 leading-relaxed', className)}>
      {children}
    </p>
  );
}
