/**
 * Everything about a Citrus notification that is NOT JSX: the kind union, the
 * tone→class maps, the icon table and the relative-time formatter.
 *
 * A separate module rather than named exports from CitrusToaster.tsx for the
 * reason positionChip.ts and headshot.ts already give: a file that exports a
 * component AND plain values breaks react-refresh, so editing the toaster
 * during dev would force a full page reload instead of a hot swap. It also
 * lets the formatter and the maps be unit-tested without rendering a toast,
 * which matters here because a toast needs a Radix provider and a viewport
 * before it will render at all.
 */
import { CircleAlert, CircleCheckBig, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

/**
 * `player` and `move` are the Sleeper-parity status cards — a mug (or the
 * swap glyph), a name, a meta line, a time. The other four are the plain
 * notice the 292 existing `toast({...})` call sites want.
 */
export type NotificationKind = 'player' | 'move' | 'success' | 'info' | 'warning' | 'error';

/** The four kinds that draw a leading lucide icon rather than a face. */
export type GenericNotificationKind = Extract<
  NotificationKind,
  'success' | 'info' | 'warning' | 'error'
>;

/**
 * What a status pill MEANS, not what colour it is. Call sites name the
 * meaning; this module owns the paint, so a colour can be re-tuned in one
 * place without a sweep through 35 files.
 *
 * `neutral` (2026-09-03) is for a state that is a fact and not a verdict: a
 * drop, a lineup lock. Painting those sage would say "good for you" and
 * orange would say "act now", and a card that asserts a valence the event
 * does not have is the leak the matchup's identity-vs-standing rule exists
 * to stop (StickyScoreBar.tsx: orange is YOU, sage is AHEAD, nothing else).
 */
export type StatusTone = 'good' | 'attention' | 'bad' | 'neutral';

export interface ToastStatus {
  label: string;
  tone: StatusTone;
}

/**
 * The swap glyph. Copied — not re-invented — from MobileRosterList's position
 * chip (audit R2), which is where a user learns what it means. Two glyphs for
 * one gesture would be two vocabularies.
 */
export const SWAP_GLYPH = '⇄';

/**
 * Pill background + the text colour that survives ON it, as one entry.
 *
 * Same rule as positionChip.ts: a background and its text are one decision.
 * Splitting them into two maps is how an unreadable pair gets introduced by
 * editing a single line. Measured on the pill fill itself (not the tile):
 *
 *   good      #84A57D + #1B3022 (pastel-forest) ......... 5.03:1  pass
 *   attention #FF6B1A + #581E00 (premium-orange-deep) ... 4.65:1  pass
 *   bad       #FF6F80 + #1B3022 (pastel-forest) ......... 5.29:1  pass
 *
 * `text-premium-orange-deep` IS #581E00 — the token exists in
 * tailwind.config.ts, so the brief's `text-[#581E00]` is spelled here as a
 * token instead of a hex literal.
 */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  good: 'bg-pastel-sage text-pastel-forest',
  attention: 'bg-pastel-orange text-premium-orange-deep',
  bad: 'bg-fantasy-grapefruit-red text-pastel-forest',
  // `sage-soft` is the token tailwind.config.ts labels "pale sage for
  // chips/borders" -- the sanctioned chip fill. Computed with the WCAG 2.x
  // formula from the config hexes (2026-09-03), not photographed:
  //   neutral   #C8DCC4 + #1B3022 (pastel-forest) ......... 9.71:1  pass
  // The dark surface tokens were tried first and rejected: every one of
  // them sits at 1.0-1.3:1 against the #1A2A20 tile, which is not a pill,
  // it is the tile.
  neutral: 'bg-pastel-sage-soft text-pastel-forest',
};

/** Geometry and type of the pill. No `text-*` here — the tone map owns it. */
export const STATUS_PILL_BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 font-jbmono text-[10px] font-bold uppercase tracking-[0.12em] leading-none';

/**
 * Leading icon per generic kind.
 *
 * NOTE the token names: `citrus-grapefruit-red` does not exist in
 * tailwind.config.ts — the #FF6F80 ruby is `fantasy-grapefruit-red`. A
 * `text-citrus-grapefruit-red` class would be silently dropped by Tailwind
 * and the icon would inherit cream, which is exactly the failure the
 * double-alpha guard in darkThemeContrastGuard.test.ts was written for.
 *
 * Measured on the #1A2A20 tile:
 *   success #C8DCC4 .. 10.4:1   info #FFF8F0 .. 15.9:1
 *   warning #FF6B1A ..  5.30:1  error #FF6F80 ..  5.66:1
 */
export const KIND_ICON: Record<GenericNotificationKind, LucideIcon> = {
  success: CircleCheckBig,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

export const KIND_ICON_CLASSES: Record<GenericNotificationKind, string> = {
  success: 'text-pastel-sage-soft',
  info: 'text-pastel-cream',
  warning: 'text-pastel-orange',
  error: 'text-fantasy-grapefruit-red',
};

/** True when the card should draw a face/glyph rail instead of an icon. */
export function isStatusCardKind(kind: NotificationKind): kind is 'player' | 'move' {
  return kind === 'player' || kind === 'move';
}

/**
 * The kind a toast actually renders as.
 *
 * `kind` is additive and optional, so the default has to be the one that
 * changes nothing: 'info'. The one exception is the 166 call sites that
 * already pass `variant: 'destructive'` — they have declared "this is a
 * failure" in the only vocabulary the old scaffold had, and rendering them
 * as neutral info would LOSE information the codebase already carries. An
 * explicit `kind` always wins over the inferred one.
 */
export function resolveKind(
  kind: NotificationKind | undefined,
  variant?: string | null,
): NotificationKind {
  if (kind) return kind;
  if (variant === 'destructive') return 'error';
  return 'info';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "now" / "2m" / "1h" / "3d" — the timestamp on a Sleeper status card.
 *
 * Pure and exported so the boundaries can be tested without mounting a
 * Radix provider. Deliberate choices:
 *   * anything under a minute is "now", including a FUTURE timestamp. A
 *     server clock a few seconds ahead of the phone is normal, and "-1m"
 *     on a notification that just arrived reads as a bug.
 *   * floor, not round: at 119s the event happened "1m" ago, not "2m".
 *   * a non-finite input degrades to "now" rather than "NaNm".
 */
export function relativeTime(at: number, now: number = Date.now()): string {
  const elapsed = now - at;
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

/**
 * Enter/exit animation for the card, kept OUT of the component so a test can
 * assert on the exact string the reduced-motion path drops.
 *
 * Swipe translates are on the Y axis to match `swipeDirection="up"` on the
 * provider — the shadcn scaffold wires the X axis, and a Y swipe against X
 * translate classes drags the card sideways while dismissing it upward.
 */
export const TOAST_MOTION_CLASSES =
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-top-full ' +
  'data-[swipe=end]:animate-out';

export const TOAST_SWIPE_CLASSES =
  'data-[swipe=cancel]:translate-y-0 ' +
  'data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none ' +
  'data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)]';

/**
 * Reduced motion, read through matchMedia rather than a `motion-reduce:`
 * Tailwind variant.
 *
 * The variant would be less code, but it leaves `animate-in` in the class
 * list and only neutralises it in the cascade — and jsdom has no cascade, so
 * there would be nothing a test could assert. Reading the query lets the
 * component omit the classes outright, which is a contract the DOM shows.
 * Guarded because jsdom ships without matchMedia (see useIsMobile's tests).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
