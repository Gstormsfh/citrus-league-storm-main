import { type ReactNode, type ButtonHTMLAttributes, type AnchorHTMLAttributes, forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CitrusButton — the canonical action primitive for Citrus 2.0.
 *
 * Three sizes (height/padding standardized so buttons line up across pages):
 *   - lg: 48px tall, px-6
 *   - md: 40px tall, px-5
 *   - sm: 32px tall, px-4
 *
 * Three variants:
 *   - primary: filled pastel-orange CTA. The single-most-important action on a page.
 *   - secondary: ghost ring. Sits next to a primary.
 *   - ghost: borderless text-only. Use sparingly for utility actions.
 *
 * Renders as <button> by default. Pass `to="/path"` to render as a react-router Link.
 * Pass `href="..."` to render as an external anchor.
 * Pass `arrow` to auto-append an animated ArrowRight icon (with hover-translate).
 *
 * Active states + disabled states + loading states are baked in.
 */

type Size = 'lg' | 'md' | 'sm';
type Variant = 'primary' | 'secondary' | 'ghost';

const SIZE: Record<Size, string> = {
  lg: 'h-12 px-6 text-[14px]',
  md: 'h-10 px-5 text-[13px]',
  sm: 'h-8 px-4 text-[12px]',
};

const VARIANT: Record<Variant, string> = {
  primary: cn(
    'bg-pastel-orange text-[#581E00] shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)]',
    'hover:bg-pastel-orange-soft hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-6px_rgba(255,107,26,0.6)]',
  ),
  secondary: cn(
    'bg-white/5 text-pastel-cream ring-1 ring-white/15',
    'hover:bg-white/10 hover:ring-pastel-orange/40 hover:text-pastel-cream',
  ),
  ghost: cn(
    'bg-transparent text-pastel-cream',
    'hover:bg-white/5 hover:text-pastel-orange-soft',
  ),
};

interface CommonProps {
  children: ReactNode;
  size?: Size;
  variant?: Variant;
  arrow?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export interface CitrusButtonProps extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  to?: never;
  href?: never;
}

export interface CitrusLinkButtonProps extends CommonProps {
  to: string;
  href?: never;
  target?: never;
}

export interface CitrusAnchorButtonProps extends CommonProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> {
  href: string;
  to?: never;
}

const baseClasses = cn(
  'inline-flex items-center justify-center gap-2',
  'font-bold tracking-tight rounded-md',
  // Entry 25 U3 (2026-08-09) — transition-duration standardized to
  // the "citrus-normal" tier (200ms) for state transitions per
  // DESIGN_DIRECTION.md interaction tiers.
  'transition-all duration-citrus-normal ease-out',
  'active:scale-[0.97] active:translate-y-0',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:translate-y-0',
  // Focus ring per DESIGN_DIRECTION.md rule 4: peach family, 2px
  // offset 2, never suppressed. Warm peach-deep reads on both light
  // and dark surfaces; pastel-surface offset matches the citrus2 page bg.
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pastel-peach-deep focus-visible:ring-offset-2 focus-visible:ring-offset-pastel-surface',
  'whitespace-nowrap',
);

function ButtonContent({ children, arrow, loading }: { children: ReactNode; arrow?: boolean; loading?: boolean }) {
  return (
    <>
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {/* inline-flex: Tailwind's preflight makes every svg a block, so an
          icon passed as a child stacked above its label (Auth, 2026-09-05). */}
      <span className="inline-flex items-center gap-2">{children}</span>
      {arrow && (
        <ArrowRight
          className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
          strokeWidth={2.5}
          aria-hidden="true"
        />
      )}
    </>
  );
}

export const CitrusButton = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  CitrusButtonProps | CitrusLinkButtonProps | CitrusAnchorButtonProps
>((props, ref) => {
  const {
    children,
    size = 'lg',
    variant = 'primary',
    arrow = false,
    loading = false,
    fullWidth = false,
    className,
    ...rest
  } = props;

  const classes = cn(
    'group',
    baseClasses,
    SIZE[size],
    VARIANT[variant],
    fullWidth && 'w-full',
    className,
  );

  // Internal route — react-router Link
  if ('to' in props && props.to) {
    const { to } = props as CitrusLinkButtonProps;
    return (
      <Link to={to} ref={ref as React.Ref<HTMLAnchorElement>} className={classes}>
        <ButtonContent arrow={arrow} loading={loading}>{children}</ButtonContent>
      </Link>
    );
  }

  // External anchor
  if ('href' in props && props.href) {
    const anchorProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a {...anchorProps} ref={ref as React.Ref<HTMLAnchorElement>} className={classes}>
        <ButtonContent arrow={arrow} loading={loading}>{children}</ButtonContent>
      </a>
    );
  }

  // Default button
  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...buttonProps} ref={ref as React.Ref<HTMLButtonElement>} className={classes} disabled={loading || buttonProps.disabled}>
      <ButtonContent arrow={arrow} loading={loading}>{children}</ButtonContent>
    </button>
  );
});

CitrusButton.displayName = 'CitrusButton';
