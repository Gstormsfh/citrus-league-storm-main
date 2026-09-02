// T13 architect Entry 13 (2026-08-09) — COMPLETION-MOMENT POLISH.
//
// Sleeper-gap 1 ("the moment the draft ends"). When the room enters
// completed state (rides F28's client-side deriveDraftState), this
// banner replaces the plain green box that shipped with DR-4.
//
// Design intent:
//   - Elevate the moment: scene-cup.webp centered, larger surface.
//   - One-time transition: gentle fade + rise on mount. CSS only,
//     no animation library.
//   - Respect prefers-reduced-motion: no animation, static render.
//   - Final board framed for screenshot: sub-copy invites screenshot,
//     controls stay disabled (surfacing test — see below).
//   - data-testid preserved: existing "completed-draft-banner" so any
//     DR-4-era test suite that references it continues to bind.
//
// KEY BEHAVIOR under test:
//   - Renders <img> art slot with a stable data-* marker so a swap to
//     a new bespoke render (scene-cup-completion.webp) is a one-line
//     filename change.
//   - Emits `data-completion-controls-disabled="true"` on the wrapper
//     so E2E can assert that the draft controls (pick/queue/etc.) are
//     out of the DOM once completion lands. NOTE: controls-disabled
//     is a CONTRACT here; parent (DraftRoomV2) removes those controls
//     from render when derived.draftStatus === 'completed'.

import { useEffect, useMemo, useState } from 'react';

export interface CompletionMomentBannerProps {
  /** Total picks committed at completion. */
  totalPicks: number;
  /**
   * Optional headline team — the winner of pick 1 overall, when
   * resolvable at completion time. Undefined → banner falls back to
   * a generic "Rosters set" tag line.
   */
  topPickTeamName?: string | null;
  /**
   * Optional headline player — the pick-1-overall player. Rendered
   * only if both `topPickTeamName` AND this are provided.
   */
  topPickPlayerName?: string | null;
  /**
   * Optional href for the roster button. Defaults to `/roster`. The
   * banner intentionally does NOT know about league routing; parent
   * passes the resolved link.
   */
  rosterHref?: string;
  /**
   * Skip animation regardless of prefers-reduced-motion. Test helper.
   */
  skipAnimationForTests?: boolean;
}

const DEFAULT_ROSTER_HREF = '/roster';

/**
 * Detect prefers-reduced-motion in a way that's safe in jsdom
 * (matchMedia may be undefined or return `false` unconditionally).
 * Returns `true` when the user has requested reduced motion.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function CompletionMomentBanner({
  totalPicks,
  topPickTeamName,
  topPickPlayerName,
  rosterHref = DEFAULT_ROSTER_HREF,
  skipAnimationForTests = false,
}: CompletionMomentBannerProps) {
  // One-time fade-in + rise. Starts at `hidden` opacity/translate,
  // flips to `shown` on next tick so the CSS transition triggers.
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const [shown, setShown] = useState(reduced || skipAnimationForTests);
  useEffect(() => {
    if (reduced || skipAnimationForTests) return;
    // rAF to guarantee the initial `hidden` frame renders before
    // flipping to `shown` (otherwise React batches both frames and
    // the transition never plays).
    const raf = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(raf);
  }, [reduced, skipAnimationForTests]);

  const showTopPickLine = !!topPickTeamName && !!topPickPlayerName;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="completed-draft-banner"
      data-completion-controls-disabled="true"
      className={[
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-br from-[#1A2A20] via-[#1E2E24] to-[#0F1F15]',
        'ring-1 ring-pastel-orange/25 shadow-[0_24px_60px_-20px_rgba(255,107,26,0.28)]',
        'p-6 sm:p-8',
        'transition-all duration-700 ease-out',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      ].join(' ')}
    >
      <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6">
        {/*
          Art slot — currently reuses scene-cup.webp. When the
          bespoke completion-moment render (scene-cup-completion.webp)
          lands, swap src + drop the file in public/mascots/. The
          data-* marker locks the swap point for auditors.
        */}
        <img
          src="/mascots/scene-cup.webp"
          alt=""
          aria-hidden="true"
          className="w-28 h-28 sm:w-32 sm:h-32 object-contain shrink-0 select-none"
          data-completion-art-slot="scene-cup"
          draggable={false}
        />

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
            Draft Complete
          </div>
          <h2 className="font-sans font-black tracking-[-0.02em] text-pastel-cream text-2xl sm:text-3xl leading-tight">
            {showTopPickLine
              ? `${topPickTeamName} took ${topPickPlayerName} #1 overall`
              : 'Rosters are set'}
          </h2>
          <p className="mt-2 text-sm text-white/70">
            All {totalPicks} picks are in. Screenshot the board. It's your league's opening-day photo.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-3">
            <a
              href={rosterHref}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-cream font-bold text-sm hover:bg-pastel-orange/30 transition-colors"
              data-testid="completion-roster-cta"
            >
              View your roster
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
