/**
 * KEEPERS IN THE V2 DRAFT (2026-09-05).
 *
 * Until today keepers locked in the database (`lock_keepers_for_season`)
 * and the draft engine never heard of them: a kept player sat in the pool
 * for anyone to take, and no round was consumed. This module decides, from
 * the locked designations and the league's penalty rule, which draft slot
 * each keeper occupies. The engine then makes that pick itself the moment
 * the slot comes up, so the keeper lands on the board in the round he
 * cost, `draft_picks_v2` carries him like any pick, and the roster sync at
 * completion seats him with everyone else. Nothing in `submit_pick_v2`
 * changes: picks stay sequential and on-clock.
 *
 * THE ROUND A KEEPER COSTS
 *   round-cost        the round he was drafted in last year
 *   round-escalation  that round minus the years kept, floor 1
 *   none              no round cost. The engine has no way to seat a player
 *                     without a pick, so a free keeper takes the team's
 *                     LAST pick (round N, then N-1, ...): the cheapest slot
 *                     the team owns. The settings copy says so.
 *
 * Two keepers landing on the same round for one team: the second takes the
 * next later round, wrapping to earlier rounds only when the draft runs
 * out. A round past the draft's length moves up to the last round.
 */
export interface LockedKeeper {
  teamId: string;
  playerId: number;
  /** `get_keeper_draft_costs.effective_round`; null for the 'none' penalty. */
  effectiveRound: number | null;
}

export interface KeeperSlot {
  teamId: string;
  playerId: number;
  round: number;
}

export function assignKeeperSlots(keepers: readonly LockedKeeper[], draftRounds: number): KeeperSlot[] {
  if (draftRounds <= 0) return [];
  const taken = new Map<string, Set<number>>();
  const out: KeeperSlot[] = [];
  const claim = (teamId: string, round: number): number | null => {
    const set = taken.get(teamId) ?? new Set<number>();
    taken.set(teamId, set);
    // Later rounds first from the wanted round, then earlier ones.
    for (let r = round; r <= draftRounds; r++) {
      if (!set.has(r)) {
        set.add(r);
        return r;
      }
    }
    for (let r = Math.min(round, draftRounds) - 1; r >= 1; r--) {
      if (!set.has(r)) {
        set.add(r);
        return r;
      }
    }
    return null;
  };
  const claimFromEnd = (teamId: string): number | null => {
    const set = taken.get(teamId) ?? new Set<number>();
    taken.set(teamId, set);
    for (let r = draftRounds; r >= 1; r--) {
      if (!set.has(r)) {
        set.add(r);
        return r;
      }
    }
    return null;
  };

  // Costed keepers first, most expensive (earliest) round first, so a
  // collision pushes the cheaper keeper, never the dearer one. Free
  // keepers take what is left from the end.
  const costed = keepers
    .filter((k) => k.effectiveRound != null && k.effectiveRound > 0)
    .sort((a, b) => (a.effectiveRound as number) - (b.effectiveRound as number) || a.playerId - b.playerId);
  const free = keepers.filter((k) => !(k.effectiveRound != null && k.effectiveRound > 0)).sort((a, b) => a.playerId - b.playerId);

  for (const k of costed) {
    const round = claim(k.teamId, Math.min(k.effectiveRound as number, draftRounds));
    if (round != null) out.push({ teamId: k.teamId, playerId: k.playerId, round });
  }
  for (const k of free) {
    const round = claimFromEnd(k.teamId);
    if (round != null) out.push({ teamId: k.teamId, playerId: k.playerId, round });
  }
  return out;
}

/** `${teamId}:${round}` — the key the engine indexes slots by. */
export function keeperSlotKey(teamId: string, round: number): string {
  return `${teamId}:${round}`;
}

/**
 * The round a locked keeper costs, mirroring `get_keeper_draft_costs`
 * (the SQL the keeper panel reads) so the engine and the panel show the
 * same round. Null is "free" (penalty none or unknown).
 */
export function keeperEffectiveRound(
  penalty: string | null | undefined,
  originalDraftRound: number | null | undefined,
  yearsKept: number | null | undefined,
): number | null {
  const original = originalDraftRound ?? 1;
  switch (penalty) {
    case 'round-cost':
      return Math.max(1, original);
    case 'round-escalation':
      return Math.max(1, original - (yearsKept ?? 0));
    default:
      return null;
  }
}
