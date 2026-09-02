import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { CitrusLogo } from '@/components/icons/CitrusIcons';
import {
  KIND_ICON,
  KIND_ICON_CLASSES,
  STATUS_PILL_BASE,
  STATUS_TONE_CLASSES,
  SWAP_GLYPH,
  TOAST_MOTION_CLASSES,
  TOAST_SWIPE_CLASSES,
  isStatusCardKind,
  prefersReducedMotion,
  relativeTime,
  resolveKind,
  type GenericNotificationKind,
  type NotificationKind,
  type ToastStatus,
} from './notificationKind';

/**
 * The Citrus notification surface — a top-of-screen status card, not the
 * stock shadcn rectangle.
 *
 * WHY THIS EXISTS (phone audit at 393x852, 2026-09-02). `ui/toaster.tsx` is
 * the untouched shadcn scaffold: a bordered box painted `bg-background
 * text-foreground` from the CREAM-era tokens, bottom-right on desktop and
 * top on mobile. Sleeper — the bar we are measured against — shows a
 * full-width card at the top of the screen carrying a player mug, the
 * player's name, a meta line, a status pill, a timestamp and its own app
 * mark. Nothing in our toaster matched any of that. This is one of three
 * named Citrus-vs-Sleeper gaps on mobile.
 *
 * Built on the Radix primitives DIRECTLY rather than on `@/components/ui/
 * toast`, because those wrappers carry the cream-era `bg-background` /
 * `border` variants this component exists to replace, and `ui/` is vendored
 * scaffold other branches depend on staying byte-identical.
 *
 * The card is ADDITIVE. `kind` defaults to 'info' (see resolveKind), so
 * every existing `toast({ title, description })` call site renders a title
 * and a description exactly as it did — pinned by
 * __tests__/CitrusToaster.test.tsx, which is the test that protects them.
 */

/** The subset of a `ToasterToast` this file actually paints. */
interface CitrusToastCardProps {
  kind: NotificationKind;
  title?: React.ReactNode;
  description?: React.ReactNode;
  meta?: string;
  status?: ToastStatus;
  at?: number;
  player?: MugPlayer;
}

/**
 * A 36px rail that matches the Mug's `sm` box exactly (`w-9 h-9`, the same
 * ring and sage wash), so a `move` card and a `player` card stacked in the
 * same viewport line their text up on the same x. A different-sized glyph
 * tile would make the column jitter as cards replace each other.
 */
function SwapRail() {
  return (
    <div
      data-testid="citrus-toast-swap"
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pastel-sage/10 text-[15px] leading-none text-pastel-sage ring-1 ring-white/15"
    >
      {SWAP_GLYPH}
    </div>
  );
}

/**
 * The Citrus wordmark, bottom-right of a status card. Sleeper prints its own
 * mark on every notification; ours has to be present but must not compete
 * with the player's name, hence 10px, /55 white and letter-spaced.
 */
function CitrusMark() {
  return (
    <span
      data-testid="citrus-toast-mark"
      className="ml-auto flex shrink-0 items-center gap-1 font-jbmono text-[10px] uppercase tracking-[0.18em] text-white/55"
    >
      <CitrusLogo className="h-3 w-3" />
      Citrus
    </span>
  );
}

function StatusPill({ status }: { status: ToastStatus }) {
  return (
    <span
      data-testid="citrus-toast-status"
      data-tone={status.tone}
      className={cn(STATUS_PILL_BASE, STATUS_TONE_CLASSES[status.tone])}
    >
      {status.label}
    </span>
  );
}

function CitrusToastCard({
  kind,
  title,
  description,
  meta,
  status,
  at,
  player,
}: CitrusToastCardProps) {
  // A card that was handed no `at` still gets a timestamp, because a status
  // card without one is not the Sleeper shape. The honest value is the
  // moment the card appeared — captured once in a ref so a re-render (a
  // swipe, a hover) cannot make "now" drift to "1m" under the user's thumb.
  const appearedAt = React.useRef(Date.now());
  const statusCard = isStatusCardKind(kind);
  const stamp = at ?? (statusCard ? appearedAt.current : undefined);

  // The player card's headline is the player's name. Call sites pass it as
  // `title`; falling back to `player.name` means a caller that supplies only
  // the player still gets a named card rather than a blank row.
  const headline = title ?? (kind === 'player' ? player?.name : undefined);
  // On a status card the meta line IS the description slot — one line, kept
  // to a single row so a long "Goal, 2 assists · 3rd period" truncates
  // instead of pushing the pill off a 393px screen.
  const secondary = statusCard ? (meta ?? description) : description;

  if (statusCard) {
    return (
      <div className="flex items-start gap-3">
        {kind === 'player' && player ? <Mug p={player} size="sm" crest /> : <SwapRail />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {headline != null && (
              <ToastPrimitives.Title className="min-w-0 flex-1 truncate font-varsity text-[15px] font-black leading-tight text-pastel-cream">
                {headline}
              </ToastPrimitives.Title>
            )}
            {stamp != null && (
              <time
                data-testid="citrus-toast-time"
                // The machine-readable instant beside the human "2m". Guarded
                // because a caller can hand us a NaN and Date#toISOString
                // throws on one — a bad `at` must cost a timestamp, not the
                // whole notification.
                dateTime={Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined}
                className="shrink-0 font-jbmono text-[12px] leading-none tabular-nums text-white/55"
              >
                {relativeTime(stamp)}
              </time>
            )}
          </div>
          {secondary != null && (
            <ToastPrimitives.Description className="mt-1 truncate text-[12px] leading-snug text-white/55">
              {secondary}
            </ToastPrimitives.Description>
          )}
          <div className="mt-2 flex items-center gap-2">
            {status && <StatusPill status={status} />}
            {/* The mark rides on `move` as well as `player`: the two kinds
                appear in the same stream, and a footer that comes and goes
                between consecutive cards reads as a rendering bug. */}
            <CitrusMark />
          </div>
        </div>
      </div>
    );
  }

  const generic = kind as GenericNotificationKind;
  const Icon = KIND_ICON[generic];
  return (
    <div className="flex items-start gap-3">
      <Icon
        data-testid="citrus-toast-icon"
        data-kind={generic}
        aria-hidden="true"
        className={cn('mt-0.5 h-5 w-5 shrink-0', KIND_ICON_CLASSES[generic])}
      />
      <div className="min-w-0 flex-1">
        {title != null && (
          <ToastPrimitives.Title className="text-[15px] font-semibold leading-tight text-pastel-cream">
            {title}
          </ToastPrimitives.Title>
        )}
        {description != null && (
          <ToastPrimitives.Description className="mt-1 text-[13px] leading-snug text-white/55">
            {description}
          </ToastPrimitives.Description>
        )}
      </div>
    </div>
  );
}

export function CitrusToaster() {
  const { toasts } = useToast();

  // Read once. The toaster mounts at the App root and never unmounts, so a
  // per-render read would cost a matchMedia call on every toast for a
  // setting that effectively never changes mid-session.
  const reduced = React.useMemo(() => prefersReducedMotion(), []);

  return (
    // swipeDirection="up" — the card is at the TOP of the screen, so the
    // dismiss gesture has to travel off the nearest edge. Radix then emits
    // --radix-toast-swipe-*-y, which is why TOAST_SWIPE_CLASSES translates
    // on Y where the shadcn scaffold translates on X.
    <ToastPrimitives.Provider swipeDirection="up">
      {toasts.map(({ id, title, description, action, kind, player, meta, status, at, variant, className, ...props }) => {
        const resolved = resolveKind(kind, variant);
        return (
          <ToastPrimitives.Root
            key={id}
            data-testid="citrus-toast"
            data-kind={resolved}
            className={cn(
              // Glass tile. bg-pastel-surface-tile/95 + backdrop-blur over
              // border-white/10 — NOT bg-white/40..84, which composites to a
              // mid-grey on #0F1F15 where neither cream nor dark text reaches
              // 4.5:1 (darkThemeContrastGuard pins that range).
              'pointer-events-auto relative w-full overflow-hidden rounded-2xl border border-white/10',
              'bg-pastel-surface-tile/95 p-3 pr-9 backdrop-blur',
              'shadow-[0_18px_50px_-20px_rgba(0,0,0,0.75)] transition-all',
              TOAST_SWIPE_CLASSES,
              // Reduced motion drops the enter/exit classes ENTIRELY rather
              // than overriding them in the cascade — see prefersReducedMotion.
              !reduced && TOAST_MOTION_CLASSES,
              // A destructive toast keeps the glass tile and states its
              // failure on the rim; re-painting the whole surface red is the
              // cream-era `bg-destructive` habit this card replaces.
              resolved === 'error' && 'border-fantasy-grapefruit-red/40',
              className,
            )}
            {...props}
          >
            <CitrusToastCard
              kind={resolved}
              title={title}
              description={description}
              meta={meta}
              status={status}
              at={at}
              player={player}
            />
            {action}
            <ToastPrimitives.Close
              // The scaffold's close was an unlabelled icon button that only
              // appeared on hover — unreachable on a phone, unnameable to a
              // screen reader. Always visible, always named.
              aria-label="Dismiss notification"
              className="absolute right-2 top-2 rounded-md p-1 text-white/55 transition-colors hover:bg-pastel-surface-high hover:text-pastel-cream focus:outline-none focus:ring-2 focus:ring-pastel-sage/60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </ToastPrimitives.Close>
          </ToastPrimitives.Root>
        );
      })}
      <ToastPrimitives.Viewport
        data-testid="citrus-toast-viewport"
        className={cn(
          // TOP of the screen, full width on a phone.
          //
          // z-[10000], not the scaffold's z-[100]: the roster sheets that
          // FIRE the `move` toasts (SlotPickerMenu, FillSlotSheet,
          // AutoLineupSheet) are z-[9999], and page chrome sits at z-40
          // (FreeAgents' sticky header) through z-[80] (the nav scrim). A
          // notification hidden behind the sheet that produced it is not a
          // notification.
          //
          // pt is calc(env() + 0.5rem), not the `pt-safe` utility: pt-safe is
          // a bare `padding-top: env(safe-area-inset-top)`, which resolves to
          // 0 on every non-notch phone and in the browser — it would beat the
          // container padding and leave the card flush against the top edge.
          'fixed inset-x-0 top-0 z-[10000] flex w-full flex-col gap-2 px-3 pb-3 outline-none',
          'pt-[calc(env(safe-area-inset-top)+0.5rem)]',
          // sm: and up, centre it at 420px rather than top-right. Top-right
          // is taken twice over: <Sonner position="top-right" /> is mounted
          // beside this in App.tsx, and the desktop Free Agents grid
          // (lg:grid-cols-[200px_1fr_260px]) puts the page's own
          // notifications rail against the right edge. Centre is the only
          // top anchor nothing else claims.
          'sm:left-1/2 sm:right-auto sm:w-[420px] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2',
        )}
      />
    </ToastPrimitives.Provider>
  );
}

export default CitrusToaster;
