/**
 * WHOSE NOMINATION IS IT (2026-09-05). One rule, used by the auction panel
 * and by the pool's row action, so the two can never disagree about whose
 * turn it is: the rotation is round 1 of the draft order (the same source
 * the engine and the server route read), the pointer is the number of
 * lots resolved so far, and nobody nominates while a lot is on the block
 * or the auction is paused. Pure, so it is pinned by a test.
 */
import type { DerivedAuctionState } from './deriveAuctionState';
import type { DraftOrderSlot } from './fetchDraftOrderMatrix';

export interface RotationTeam {
  id: string;
}

export function auctionRotation(
  matrix: ReadonlyArray<DraftOrderSlot> | null,
  teams: ReadonlyArray<RotationTeam>,
): string[] {
  if (matrix && matrix.length > 0) {
    return matrix.filter((s) => s.round === 1).map((s) => s.teamId);
  }
  return teams.map((t) => t.id);
}

/** The team whose turn it is to nominate next, or null with no rotation. */
export function auctionNominatorTeamId(
  auction: Pick<DerivedAuctionState, 'nominationsCompleted'> | null,
  matrix: ReadonlyArray<DraftOrderSlot> | null,
  teams: ReadonlyArray<RotationTeam>,
): string | null {
  if (!auction) return null;
  const rotation = auctionRotation(matrix, teams);
  if (rotation.length === 0) return null;
  return rotation[auction.nominationsCompleted % rotation.length];
}

/** True when the caller's team should be nominating right now. */
export function isMyNomination(
  auction: Pick<DerivedAuctionState, 'nominationsCompleted' | 'currentNomination' | 'paused'> | null,
  matrix: ReadonlyArray<DraftOrderSlot> | null,
  teams: ReadonlyArray<RotationTeam>,
  myTeamId: string | null,
): boolean {
  if (!auction || myTeamId === null) return false;
  if (auction.currentNomination !== null || auction.paused) return false;
  return auctionNominatorTeamId(auction, matrix, teams) === myTeamId;
}
