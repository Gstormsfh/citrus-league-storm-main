// Phase 4.5 chunk 11g.4 step 6a — pure utility for generating
// snake / linear draft order in memory.
//
// **Not on the production path.** The persistent engine's
// `LobbyManager` consumes pre-stored `DraftOrderSlot[]` rows loaded
// from `public.draft_order` (the v1 table that `submit_pick_v2`
// already validates against — see migration
// `20260425140000_draft_engine_v2_rpcs.sql:783`). Re-generating in-
// memory creates a divergence risk if commissioners pass a
// `customTeamOrder` to `DraftService.initializeDraftOrder` (per
// `server/src/services/DraftService.ts:317-353`); the DB-loaded
// path eliminates that risk by construction.
//
// This utility exists for:
//   - Unit-test fixtures that need a known-good draft order without
//     spinning up a database.
//   - Future reference: documents the snake/linear semantic that
//     the v1 `DraftService.initializeDraftOrder` produces.
//
// Snake semantic mirrors `DraftService.initializeDraftOrder:336-338`:
//   even rounds reverse the team order; odd rounds use forward.
//   First round is round 1 (forward).

import type { DraftFormat, DraftOrderSlot } from './types';

/**
 * Generate a flat `DraftOrderSlot[]` for snake or linear formats.
 *
 * Pick numbers are 1-indexed and monotonically increasing across the
 * entire draft (round 1 pick 1 → round R pick R*N, where N is the
 * team count). Each team appears exactly `totalRounds` times.
 *
 * Snake: round 1 picks teams in order 1..N, round 2 picks teams in
 * order N..1, round 3 forward, round 4 reverse, etc.
 * Linear: every round picks teams in order 1..N.
 * Auction: throws — auction has nominations rather than slot-based
 * order. Chunk 11g.6 will introduce auction-specific state (per
 * ADR-002 §3 — auction state machine).
 *
 * @throws Error if `format === 'auction'` (chunk 11g.6 territory).
 * @throws Error if `teamIds` is empty or `totalRounds <= 0`.
 */
export function generateDraftOrder(
  teamIds: ReadonlyArray<string>,
  totalRounds: number,
  format: DraftFormat,
): DraftOrderSlot[] {
  if (format === 'auction') {
    throw new Error(
      'auction format does not use deterministic pick order; ' +
        'use auction state machine (chunk 11g.6 / ADR-002 §3)',
    );
  }
  if (teamIds.length === 0) {
    throw new Error('generateDraftOrder: teamIds must be non-empty');
  }
  if (!Number.isInteger(totalRounds) || totalRounds <= 0) {
    throw new Error(
      `generateDraftOrder: totalRounds must be a positive integer (got ${totalRounds})`,
    );
  }

  const slots: DraftOrderSlot[] = [];
  let pickNumber = 1;

  for (let round = 1; round <= totalRounds; round++) {
    // Snake: even rounds reverse. Linear: every round forward.
    const reverse = format === 'snake' && round % 2 === 0;
    const orderedTeams = reverse ? [...teamIds].reverse() : [...teamIds];

    for (const teamId of orderedTeams) {
      slots.push({ round, pickNumber, teamId });
      pickNumber++;
    }
  }

  return slots;
}
