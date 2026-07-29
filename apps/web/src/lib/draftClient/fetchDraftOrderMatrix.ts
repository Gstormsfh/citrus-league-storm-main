// DR-1 chunk (2026-07-28) — draft-order matrix fetcher.
//
// Fetches the ACTUAL round-by-round `draft_order` rows via the
// existing v1 route `GET /api/draft/league/:leagueId/order/:roundNumber`
// (server/src/routes/draft.ts:87, membershipMiddleware-gated). Consumed
// by `deriveDraftState.ts` as the authoritative "who's on the clock at
// pick N" lookup table.
//
// Why fetched, not derived: the engine reads real `draft_order` rows
// per round; client-side snake derivation would silently diverge for
// any league that ever carries a custom (non-pure-snake) round order.
// Architect ratification 2026-07-28 F1: kill the divergence class
// before it exists.
//
// Fetch pattern (architect-ratified): round 1 first (its `.length`
// tells us teamCount; totalRounds derives from `totalPicks / teamCount`),
// then rounds 2..R fetched in parallel via Promise.all. If a future
// server route exposes an all-rounds variant, drop this to one call
// and update the LEDGER row in PROJECT_PLAN.md.
//
// Failure mode (architect-ratified): non-fatal. Caller sees `null` for
// the matrix; `deriveDraftState` falls back to "picks-made + rosters
// rendered, on-clock/next-pick shows '—' until matrix arrives". Retry
// with backoff is the caller's responsibility.

// Dynamic import (same pattern as `defaultFetchDiscovery` in runner.ts)
// keeps test paths that stub `@/api/client` via vi.mock from tripping
// on the module's top-level Supabase env-var check.

/**
 * A row in the fetched draft_order matrix. Mirrors the server's
 * `DraftOrderSlot` shape (round + pickNumber + teamId), 1-indexed to
 * match the wire event fields.
 */
export interface DraftOrderSlot {
  round: number;
  pickNumber: number;
  teamId: string;
}

/**
 * Fetch draft_order for a specific round. Returns the raw
 * v1-route array of `{ team_id: string }` entries (or whatever the
 * server returns), narrowed here to `string[]` of teamIds.
 *
 * The server returns the `team_order` JSONB array for the round.
 * Wire shape from `DraftService.getDraftOrder` is the row itself; we
 * pull `team_order` out. Any shape drift here throws a diagnostic
 * error so the caller can surface it (rather than silently proceeding
 * with a bogus matrix).
 */
type ApiClientLike = {
  get<T>(path: string): Promise<{ data?: T; error?: string }>;
};

async function fetchRoundOrder(
  apiClient: ApiClientLike,
  leagueId: string,
  roundNumber: number,
): Promise<string[]> {
  const response = await apiClient.get<
    { team_order?: unknown } | ReadonlyArray<{ team_order?: unknown }>
  >(
    `/api/draft/league/${encodeURIComponent(leagueId)}/order/${roundNumber}`,
  );
  if (response.error) {
    throw new Error(
      `fetchRoundOrder(round=${roundNumber}) failed: ${response.error}`,
    );
  }
  // Accept both top-level payload and enveloped {data} shape — same
  // hedge as `defaultFetchDiscovery` / `defaultFetchSnapshot` per the
  // F3 fix (2026-07-28 Decision Log).
  const raw = response.data ?? (response as unknown as { team_order?: unknown });
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object' || !('team_order' in row)) {
    throw new Error(
      `fetchRoundOrder(round=${roundNumber}): response missing team_order field`,
    );
  }
  const teamOrder = (row as { team_order?: unknown }).team_order;
  if (!Array.isArray(teamOrder)) {
    throw new Error(
      `fetchRoundOrder(round=${roundNumber}): team_order is not an array`,
    );
  }
  for (const t of teamOrder) {
    if (typeof t !== 'string') {
      throw new Error(
        `fetchRoundOrder(round=${roundNumber}): team_order contains non-string entry`,
      );
    }
  }
  return teamOrder as string[];
}

/**
 * Fetch the full draft-order matrix as a flat pickNumber-indexed list.
 * Round 1 first (to establish teamCount + totalRounds), then rounds
 * 2..R in parallel. Returns `null` on any failure — caller falls back
 * to picks-made + rosters rendering.
 *
 * `totalPicks` is the snapshot's `stateSnapshot.totalPicks` — the
 * authoritative draft length. Both server (draftOrder.length at
 * LobbyManager construction) and this fetcher derive the total from
 * the same source (draft_order rows), so any divergence would be a
 * server bug worth surfacing rather than silently reconciling.
 */
export async function fetchDraftOrderMatrix(
  leagueId: string,
  totalPicks: number,
): Promise<DraftOrderSlot[] | null> {
  if (totalPicks <= 0) {
    // Not-yet-configured league — no matrix to fetch. Caller renders
    // the 4400 waiting-room copy per DR-4.
    return null;
  }
  try {
    // Single dynamic-import site avoids the vi.mock race under
    // Promise.all-driven concurrent invocations.
    const { apiClient } = await import('@/api/client');
    const round1 = await fetchRoundOrder(apiClient, leagueId, 1);
    const teamCount = round1.length;
    if (teamCount === 0) {
      throw new Error(
        `fetchDraftOrderMatrix: round 1 team_order is empty for leagueId=${leagueId}`,
      );
    }
    if (totalPicks % teamCount !== 0) {
      throw new Error(
        `fetchDraftOrderMatrix: totalPicks=${totalPicks} is not divisible by ` +
          `round-1 teamCount=${teamCount} for leagueId=${leagueId} ` +
          `(implies commissioner reordered mid-draft or v1 fixture is malformed)`,
      );
    }
    const totalRounds = totalPicks / teamCount;
    const laterRounds =
      totalRounds > 1
        ? await Promise.all(
            Array.from({ length: totalRounds - 1 }, (_, i) =>
              fetchRoundOrder(apiClient, leagueId, i + 2),
            ),
          )
        : [];
    // Flatten the per-round arrays into a monotonically-numbered slot list.
    // Same shape as `LobbyManager.draftOrder` — same pickNumber semantic.
    const allRounds = [round1, ...laterRounds];
    const slots: DraftOrderSlot[] = [];
    let pickNumber = 1;
    for (let roundIdx = 0; roundIdx < allRounds.length; roundIdx++) {
      const round = roundIdx + 1;
      const teamsThisRound = allRounds[roundIdx];
      if (teamsThisRound.length !== teamCount) {
        throw new Error(
          `fetchDraftOrderMatrix: round ${round} has ${teamsThisRound.length} teams; ` +
            `expected ${teamCount} (round-1 count). Mid-draft team-count change is not supported.`,
        );
      }
      for (const teamId of teamsThisRound) {
        slots.push({ round, pickNumber, teamId });
        pickNumber++;
      }
    }
    return slots;
  } catch (err) {
    // Non-fatal per architect ratification (2026-07-28 DR-1 F1).
    // Caller retries with backoff; board renders picks-made + rosters
    // while on-clock/next-pick shows '—' until the matrix lands.
    void err;
    return null;
  }
}
