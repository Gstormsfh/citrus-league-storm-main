/**
 * VerdictTile — editorial Stormy verdict primitive (Component 4 of 7).
 *
 * Reusable extraction of the inline floating-tile pattern from RinkHeatmap
 * + the embedded right-column tile from the data zone of concept-3. One
 * component, two variants:
 *
 *   <VerdictTile variant="floating" /> — for the rink hero overlay
 *   <VerdictTile variant="embedded" /> — for the data-zone right column
 *
 * The embedded variant supports a dropcap on the first body letter for
 * the longer-form editorial Stormy paragraphs. Both variants share the
 * caps eyebrow + italic body + accent color vocabulary.
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built. Two queries (callout quote tile +
 *   editorial verdict card) returned no editorial-verdict primitive — the
 *   library's "card" matches were generic Feature blocks and Customer
 *   tables (similarity 2.052 / 0.983 / 0.213, none hitting). The pattern
 *   needed here is ~80 lines of typography composition; 21st.dev's card
 *   primitives would add chrome we strip.
 * - Design principle referenced: "Minimal Text Integration — Text as
 *   rare, powerful gesture: Never paragraphs. Only essential words.
 *   Integrated into visual architecture. Small labels, huge impact.
 *   Typography as visual element." — from canvas-design-system.md §2.
 *   The verdict is the rare exception where prose is allowed on a data
 *   surface; treated as visual element via italic + accent + framed
 *   surrounding architecture (tile + eyebrow + signature).
 *   Plus: "Subtle Reference Integration — Embed conceptual DNA without
 *   announcing. Like jazz musician quoting another song. Sophisticated,
 *   never literal." Italic + caps-eyebrow + dropcap quote The Athletic
 *   / NYT magazine pull-quote convention without copying it.
 * - Matched mockup section: two appearances of the Stormy verdict in
 *   apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg —
 *   (1) floating tile top-right of the rink hero (~320×140, backdrop-
 *       blur, italic body in pastel-orange-soft)
 *   (2) embedded data-zone right column (~360 wide, dropcap on first
 *       letter, "STORMY · ASSISTANT GM" caps signature line below body)
 */

import { type ReactNode, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────

export type VerdictVariant = 'embedded' | 'floating';
export type VerdictSize = 'sm' | 'md' | 'lg';
export type VerdictAccent = 'orange' | 'sage' | 'butter' | 'cream';

interface VerdictTileProps {
  /** Body text — the verdict itself. String OR ReactNode for inline emphasis. */
  body: ReactNode;
  /** Caps eyebrow above the body (default "Stormy verdict"). */
  eyebrow?: string;
  /** Optional signature line below body (e.g., "Stormy · Assistant GM"). */
  signature?: string;
  /** Visual variant. floating = backdrop-blur overlay; embedded = solid tile. */
  variant?: VerdictVariant;
  /** Size preset. */
  size?: VerdictSize;
  /** Accent color for the italic body. */
  accent?: VerdictAccent;
  /** Apply dropcap on first body letter (only valid when body is a string). */
  dropcap?: boolean;
  /** Loading skeleton state. */
  isLoading?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ── Tokens ───────────────────────────────────────────────────────────

const ACCENT_TEXT_CLASS: Record<VerdictAccent, string> = {
  orange: 'text-pastel-orange-soft',
  sage: 'text-pastel-sage-soft',
  butter: 'text-pastel-butter',
  cream: 'text-pastel-cream',
};

// Per-size padding + body type scale.
const SIZE_TILE: Record<VerdictSize, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

const SIZE_EYEBROW: Record<VerdictSize, string> = {
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-[10px]',
};

const SIZE_BODY: Record<VerdictSize, string> = {
  sm: 'text-[13px] leading-snug',
  md: 'text-[14px] sm:text-[15px] leading-snug',
  lg: 'text-[15px] sm:text-[16px] leading-snug',
};

const SIZE_DROPCAP: Record<VerdictSize, string> = {
  sm: 'text-[32px] leading-[28px] mr-1.5',
  md: 'text-[40px] leading-[34px] mr-2',
  lg: 'text-[48px] leading-[40px] mr-2',
};

const SIZE_SIGNATURE: Record<VerdictSize, string> = {
  sm: 'text-[8px] mt-2',
  md: 'text-[9px] mt-3',
  lg: 'text-[9px] mt-4',
};

// Variant-specific surface treatment.
const VARIANT_SURFACE: Record<VerdictVariant, string> = {
  embedded: 'bg-pastel-surface-tile ring-1 ring-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
  floating: 'bg-pastel-surface-tile/85 backdrop-blur-md ring-1 ring-white/15 shadow-[0_8px_32px_-4px_rgba(0,0,0,0.4)]',
};

// ── Internal pieces ─────────────────────────────────────────────────

function VerdictSkeleton({ size, hasSignature }: { size: VerdictSize; hasSignature: boolean }) {
  return (
    <div role="status" aria-label="Loading verdict" className="flex flex-col gap-2 animate-pulse">
      <div className={cn('h-2.5 rounded bg-white/10 w-24', size === 'sm' && 'h-2 w-20')} />
      <div className="space-y-1.5">
        <div className="h-3 rounded bg-white/10 w-full" />
        <div className="h-3 rounded bg-white/10 w-[88%]" />
        {size !== 'sm' && <div className="h-3 rounded bg-white/10 w-[72%]" />}
      </div>
      {hasSignature && <div className="h-2 rounded bg-white/10 w-32 mt-1" />}
    </div>
  );
}

// Render body with optional dropcap. Dropcap only applies when body is a
// plain string (we extract the first character). For ReactNode bodies, the
// dropcap prop is ignored.
function BodyContent({
  body,
  size,
  accent,
  dropcap,
}: {
  body: ReactNode;
  size: VerdictSize;
  accent: VerdictAccent;
  dropcap: boolean;
}) {
  const accentClass = ACCENT_TEXT_CLASS[accent];

  if (dropcap && typeof body === 'string' && body.length > 0) {
    const firstChar = body[0];
    const rest = body.slice(1);
    return (
      <p
        className={cn(
          'font-sans italic',
          SIZE_BODY[size],
          accentClass,
        )}
      >
        <span
          className={cn(
            'float-left font-sans font-black not-italic',
            SIZE_DROPCAP[size],
            accentClass,
          )}
          aria-hidden="true"
        >
          {firstChar}
        </span>
        <span className="sr-only">{firstChar}</span>
        {rest}
      </p>
    );
  }

  return (
    <p
      className={cn(
        'font-sans italic',
        SIZE_BODY[size],
        accentClass,
      )}
    >
      {body}
    </p>
  );
}

// ── Main composer ───────────────────────────────────────────────────

export function VerdictTile({
  body,
  eyebrow = 'Stormy verdict',
  signature,
  variant = 'embedded',
  size = 'md',
  accent = 'orange',
  dropcap = false,
  isLoading = false,
  className,
  style,
}: VerdictTileProps) {
  return (
    <aside
      role="note"
      aria-label={typeof body === 'string' ? `${eyebrow}: ${body}` : eyebrow}
      className={cn(
        'rounded-xl',
        VARIANT_SURFACE[variant],
        SIZE_TILE[size],
        className,
      )}
      style={style}
    >
      {isLoading ? (
        <VerdictSkeleton size={size} hasSignature={!!signature} />
      ) : (
        <>
          {eyebrow && (
            <div
              className={cn(
                'font-jbmono uppercase tracking-[0.22em] font-bold text-white/55 mb-2',
                SIZE_EYEBROW[size],
              )}
            >
              {eyebrow}
            </div>
          )}

          <BodyContent body={body} size={size} accent={accent} dropcap={dropcap} />

          {signature && (
            <div
              className={cn(
                'font-jbmono uppercase tracking-[0.22em] font-bold text-white/45',
                SIZE_SIGNATURE[size],
              )}
            >
              {signature}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
