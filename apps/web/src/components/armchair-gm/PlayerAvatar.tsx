import { cn } from '@/lib/utils';
import { Mug, type MugSize } from '@/components/roster/Mug';
import {
  posRingColor,
  POSITION_RING_FALLBACK,
  positionChipKey,
} from '@/components/roster/positionChip';

/**
 * THE ARMCHAIR GM FACE (2026-09-03 headshot audit).
 *
 * This component used to BE the founder's complaint. It drew a gradient
 * disc, the player's initials and a jersey number, and it accepted no image
 * prop at all: there was no code path anywhere in /armchair-gm where a face
 * could appear. That page is reachable from the main nav, the mobile menu,
 * the homepage hero CTA and the footer, so it was the loudest surviving
 * instance of "little dots with initials" in the product.
 *
 * It is now a thin adapter onto `roster/Mug`, the one headshot component the
 * roster, matchup, free-agent and draft rows already wear. Not a fourth
 * fallback chain: `Mug` owns headshot -> team crest -> initials, remembers a
 * failed URL per URL so a later enrichment gets its own try, keeps a fixed
 * box per size so a 40-card cap sheet never reflows, and never leaves a
 * broken <img> in the DOM.
 *
 * WHAT SURVIVED THE SWAP, AND WHAT DID NOT
 *
 *   * The position colour survived, as a ring. It is the `posRingColor` map
 *     from the shared chip vocabulary rather than this file's old private
 *     `positionColors`, so the cap sheet cannot drift from the roster on
 *     what colour a centre is.
 *   * The jersey number did not. `Mug` has one box and one picture in it,
 *     and a face beats a number that every one of these call sites already
 *     prints beside the name (CapPlayerCard) or does not need
 *     (BuyoutCalculator's header, which carries name, position and age).
 *
 * WHERE THE PICTURE COMES FROM, AND WHY IT IS A CREST TODAY
 *
 * `image` and `team` are threaded from `PlayerContract`. `team` is always a
 * real NHL abbreviation in that data, so every call site draws at least the
 * team crest instead of initials. `PlayerContract.headshot` is DECLARED but
 * never populated: the cap sheet is served from the static
 * `data/nhlContracts.ts`, whose `c()` constructor writes `playerId: 0` and
 * no headshot, and `NHLCapService` then overwrites `playerId` with the
 * player's array index. There is no NHL player id in that dataset, and an
 * NHL mug URL needs one. The moment `headshot` is populated upstream, every
 * call site here starts drawing a face with no further change.
 */

interface PlayerAvatarProps {
  name: string;
  position: string;
  /** NHL headshot URL when the caller has one. */
  image?: string | null;
  /** Team abbreviation ("TOR"), the crest behind a missing headshot. */
  team?: string | null;
  size?: MugSize;
  className?: string;
}

export default function PlayerAvatar({
  name,
  position,
  image,
  team,
  size = 'md',
  className,
}: PlayerAvatarProps) {
  const ring = posRingColor[positionChipKey(position)] || POSITION_RING_FALLBACK;

  return (
    <Mug
      p={{ name, image: image ?? null, team: team ?? null }}
      size={size}
      crest
      className={cn('rounded-full ring-2', ring, className)}
    />
  );
}
