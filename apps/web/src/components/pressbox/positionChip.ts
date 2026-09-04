/**
 * THE PRESS BOX POSITION CHIP — 30px, neutral, one definition (2026-09-04).
 *
 * The Press Box re-skin of `src/components/roster/positionChip.ts`. That
 * module keeps its sage/orange maps and its 32px geometry for the screens
 * still wearing the old styling; this one ships beside the Press Box screens
 * and is what they compose from. See `rowScale.ts` for why the fork exists
 * and when it collapses.
 *
 * WHY THE COLOUR COMES OUT. From the design review that produced direction
 * 1a: five saturated position fills down a roster read as decoration, and
 * decoration competes with the one element on the screen that has to be
 * unmissable. In Press Box, orange #FF6B1A is the ONLY saturated colour and
 * it means "you / your pick / the primary action", one per screen region. A
 * sage LW chip and an orange RW chip sitting beside a manager's orange
 * win-probability bar are three saturated things fighting over the same
 * glance — and the RW chip, which means nothing about ownership, was winning.
 *
 * THE LETTER CARRIES THE POSITION. It always did. The fill was never doing
 * that work; what it was doing was making the row look busy and making `RW`
 * look like it meant something the others did not.
 *
 * THE MAPS ARE DELIBERATELY NOT COLLAPSED into a single constant, even though
 * every entry is now identical. Keeping one entry per key means the next
 * person who wants a coloured position has to edit six lines and stare at six
 * identical values while doing it, and `darkThemeContrastGuard` fails them if
 * they do. A lone constant would make the same regression a one-word change.
 *
 * CONTRAST. `bg-white/10` composites to ~#232F27 on the page (#0C1811) and
 * ~#2C3A31 on a tile (#16241B); #F3EFE6 on either is past 12:1. It is also
 * well clear of the bg-white/40..84 dead zone the contrast guard forbids. The
 * measurements that produced the OLD map are kept in the legacy file — they
 * are why that file exists, and they are the reason a coloured chip is a
 * contrast question and not merely a taste one.
 *
 * 30px rather than 32px: the spec's roster row is 56-58px against the legacy
 * 62-64px, and the chip is the tallest fixed element in the row's left
 * cluster. Two pixels off the chip is two pixels off the row's floor without
 * touching either rung a manager reads.
 *
 * Keep the `const name: Record<string, string> = {` shape and one
 * `KEY: 'classes',` entry per line — `darkThemeContrastGuard` parses these
 * maps out of this file's source.
 */
import { cn } from '@/lib/utils';

import { positionChipKey } from '@/components/roster/positionChip';

/**
 * Re-exported rather than reimplemented. `positionChipKey` is pure string
 * normalisation ('Goalie' -> 'G', 'utility' -> 'UTIL') with no styling in it
 * at all, so there is nothing about it for the re-skin to change, and two
 * copies of a mapping table is how the two skins would eventually disagree
 * about what a slot is called.
 */
export { positionChipKey };

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
 * Geometry and type. No `text-*` here — `posColor` owns the text colour so it
 * can never disagree with its own background.
 */
export const PB_POSITION_CHIP_BASE =
  'w-[30px] h-[30px] flex-shrink-0 rounded-md flex items-center justify-center font-condensed text-[11px] font-extrabold tracking-wide ring-1';

/** An unrecognised slot renders something wrong-looking that can be reported. */
export const PB_POSITION_CHIP_FALLBACK = 'bg-white/10 text-pressbox-text';
export const PB_POSITION_RING_FALLBACK = 'ring-white/16';

/**
 * A slot that is not a position: the bench (BN) and the total row (TOT / DAY).
 * Dimmer text on the same fill — a bench row has no position to claim, and
 * the chip's job there is to say "does not count" without shouting.
 */
export const PB_NEUTRAL_CHIP = 'bg-white/10 text-white/55 ring-white/16';

/** Full class list for a Press Box position chip keyed by `positionChipKey`. */
export function pressBoxPositionChipClasses(key: string): string {
  return cn(
    PB_POSITION_CHIP_BASE,
    posColor[key] || PB_POSITION_CHIP_FALLBACK,
    posRingColor[key] || PB_POSITION_RING_FALLBACK,
  );
}
