/**
 * The 32px position/slot chip — one definition for every row that carries it.
 *
 * Lifted out of MobileRosterList (2026-09-01) so the mobile Matchup rows can
 * wear the SAME chip in their centre column instead of inventing a second
 * palette. A pure module rather than a named export from the list component:
 * a file that exports both a component and plain values breaks react-refresh,
 * so editing the list during dev would force a full reload instead of a hot
 * swap (the same reason slotLabel.ts stands alone).
 *
 * CONTRAST (2026-08-13) — text colour travels WITH the background.
 *
 * The base chip class used to hard-code `text-white`, but three of these
 * backgrounds are light. Measured on the live roster:
 *
 *   LW  bg-pastel-sage-soft #C8DCC4 + white .... 1.45:1  invisible
 *   C   bg-pastel-sage      #84A57D + white .... 2.75:1  marginal
 *   UTIL same as C ............................. 2.75:1  marginal
 *   D   bg-white/10 + cream ................... ~13:1    fine
 *
 * A background and the text that survives on it are one decision, not two.
 * Pairing them here makes an unreadable combination impossible to introduce
 * by editing a single map entry. `pastel-forest` (#1B3022) is the design
 * system's documented "deep forest text" for light surfaces — ~5:1 on sage,
 * ~9:1 on sage-soft.
 *
 * SURFACE (2026-09-02) — a chip has to separate from the tile it sits ON,
 * not only from its own text. D shipped as `bg-[#1A2A20]`, which is the
 * EXACT value of `pastel-surface-tile`. On the phone roster (rows on
 * #0F1F15) that reads as a faint outline; on the new Free Agents row,
 * whose card IS #1A2A20, the fill vanishes entirely and D is the only
 * position with no visible chip — measured in the 393x852 harness, where
 * every other position reads as a filled badge and D reads as an empty
 * box. `bg-white/10` composites to ~#232F27 on the page and ~#2C3A31 on
 * the tile: lighter than both grounds, still the "no colour" identity
 * that distinguishes D from the sage/orange forwards, and well clear of
 * the bg-white/40..84 dead zone the contrast guard forbids. It also
 * retires the last hex literal in this map.
 *
 * RW (#FF6B1A + white, 2.85:1) is deliberately UNCHANGED: it is a brand
 * accent, it is legible at this weight, and inverting it would be a visual
 * redesign rather than a legibility fix. Flagged, not touched.
 *
 * MobileRosterList.positionRing.test.tsx parses these maps out of this file's
 * source, so keep the `const name: Record<string, string> = {` shape and one
 * `KEY: 'classes',` entry per line.
 *
 * ── COLOUR RESTRAINT (2026-09-04, Press Box direction 1a) ──────────────────
 *
 * Every entry above is now the same neutral pair. The maps survive, and so
 * does the shape the test parses, but they no longer VARY -- which is the
 * point.
 *
 * The reasoning, from the design review that produced this direction: five
 * saturated position fills down a roster read as decoration, and decoration
 * competes with the one thing on the screen that has to be unmissable. In
 * Press Box, orange `#FF6B1A` is the only saturated colour and it means
 * "you / your pick / the primary action", one per screen region. A sage LW
 * chip and an orange RW chip beside a manager's orange win-probability bar
 * are three saturated things fighting over the same glance, and the RW chip
 * -- which means nothing about ownership -- was winning.
 *
 * The LETTER carries the position. It always did; the fill was never doing
 * that work. What the fill was doing was making the row look busy and making
 * `RW` look like it meant something the others did not.
 *
 * The maps are deliberately NOT collapsed into a single constant. Keeping
 * one entry per key means the next person who wants a coloured position has
 * to edit six lines and stare at six identical values while doing it, and
 * `darkThemeContrastGuard` fails them if they do. A lone constant would make
 * the same regression a one-word change.
 *
 * The contrast argument in the block above is now moot rather than wrong:
 * `bg-white/10` composites to ~#232F27 on the page and ~#2C3A31 on a tile,
 * and `#F3EFE6` on either is well past 12:1. The old measurements are kept
 * because they are why this file exists.
 */
import { cn } from '@/lib/utils';
import { resolveFantasyPosition } from '@/utils/rosterUtils';

export const posColor: Record<string, string> = {
  LW: 'bg-white/10 text-pressbox-text',
  C: 'bg-white/10 text-pressbox-text',
  RW: 'bg-white/10 text-pressbox-text',
  D: 'bg-white/10 text-pressbox-text',
  G: 'bg-white/10 text-pressbox-text',
  UTIL: 'bg-white/10 text-pressbox-text',
  F: 'bg-white/10 text-pressbox-text',
};

export const posRingColor: Record<string, string> = {
  LW: 'ring-white/16',
  C: 'ring-white/16',
  RW: 'ring-white/16',
  D: 'ring-white/16',
  G: 'ring-white/16',
  UTIL: 'ring-white/16',
  F: 'ring-white/16',
};

/**
 * Geometry and type of the chip. No `text-*` here — posColor owns the text
 * colour so it can never disagree with its own background (see the map).
 */
export const POSITION_CHIP_BASE =
  'w-[30px] h-[30px] flex-shrink-0 rounded-md flex items-center justify-center font-condensed text-[11px] font-extrabold tracking-wide ring-1';

/**
 * 2026-08-19: the fallback chip was bg-white/40 (mid-grey once composited on
 * the dark page) with pastel-forest text — the one combination in this map
 * that failed its own rule above.
 */
export const POSITION_CHIP_FALLBACK = 'bg-white/10 text-pressbox-text';
export const POSITION_RING_FALLBACK = 'ring-white/16';

/**
 * A slot that is not a position: the bench (BN) and the total row (TOT / DAY).
 * Neutral on purpose — a bench row has no position colour to claim, and the
 * chip's job there is to say "does not count" without shouting.
 */
export const NEUTRAL_CHIP = 'bg-white/10 text-white/55 ring-white/16';

/**
 * Raw position or slot string -> the key the maps above understand.
 *
 * 'Goalie' -> 'G', 'Left Wing' -> 'LW', 'utility' -> 'UTIL', 'F' -> 'F'.
 * Anything unrecognised passes through as its first two letters, upper-cased:
 * a slot scheme this does not know about should render something wrong-looking
 * that can be reported, not a blank chip. Empty input stays empty.
 */
export function positionChipKey(position: string | null | undefined): string {
  const raw = (position ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'UTILITY') return 'UTIL';
  if (Object.prototype.hasOwnProperty.call(posColor, raw)) return raw;
  const resolved = resolveFantasyPosition(raw);
  if (resolved !== 'OTHER') return resolved;
  return raw.slice(0, 2);
}

/** Full class list for a position chip keyed by `positionChipKey`. */
export function positionChipClasses(key: string): string {
  return cn(
    POSITION_CHIP_BASE,
    posColor[key] || POSITION_CHIP_FALLBACK,
    posRingColor[key] || POSITION_RING_FALLBACK,
  );
}
