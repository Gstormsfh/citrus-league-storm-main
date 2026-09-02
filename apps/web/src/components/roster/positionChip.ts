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
 */
import { cn } from '@/lib/utils';
import { resolveFantasyPosition } from '@/utils/rosterUtils';

export const posColor: Record<string, string> = {
  LW: 'bg-pastel-sage-soft text-pastel-forest',
  C: 'bg-pastel-sage text-pastel-forest',
  RW: 'bg-pastel-orange text-white',
  D: 'bg-white/10 text-pastel-cream',
  G: 'bg-pastel-sage/15 text-pastel-cream',
  UTIL: 'bg-pastel-sage text-pastel-forest',
  F: 'bg-emerald-600 text-white',
};

export const posRingColor: Record<string, string> = {
  LW: 'ring-pastel-sage-soft/30',
  C: 'ring-pastel-sage/30',
  RW: 'ring-pastel-orange/30',
  D: 'ring-white/30',
  G: 'ring-pastel-sage/50',
  UTIL: 'ring-pastel-sage/30',
  F: 'ring-emerald-600/30',
};

/**
 * Geometry and type of the chip. No `text-*` here — posColor owns the text
 * colour so it can never disagree with its own background (see the map).
 */
export const POSITION_CHIP_BASE =
  'w-8 h-8 flex-shrink-0 rounded-md flex items-center justify-center font-varsity text-[11px] font-black tracking-wide ring-1';

/**
 * 2026-08-19: the fallback chip was bg-white/40 (mid-grey once composited on
 * the dark page) with pastel-forest text — the one combination in this map
 * that failed its own rule above.
 */
export const POSITION_CHIP_FALLBACK = 'bg-white/15 text-pastel-cream';
export const POSITION_RING_FALLBACK = 'ring-white/20';

/**
 * A slot that is not a position: the bench (BN) and the total row (TOT / DAY).
 * Neutral on purpose — a bench row has no position colour to claim, and the
 * chip's job there is to say "does not count" without shouting.
 */
export const NEUTRAL_CHIP = 'bg-white/10 text-white/55 ring-white/20';

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
