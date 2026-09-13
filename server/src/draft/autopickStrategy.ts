import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger, coerceToNumericPlayerId, ScoringCalculator, projectionFor, projectionSettings } from '@citrus/shared';
import { PlayerDashboardService } from '../services/PlayerDashboardService';

/**
 * Roster-shape caps used when a league has not configured its own
 * `settings.rosterSlots` (E118). Mirrors DEFAULT_ROSTER_SLOTS in
 * packages/shared, collapsed to the positions a drafted player can
 * actually occupy. UTIL/BN/IR are intentionally excluded from the
 * per-position ceiling: they are flex seats, and counting them as
 * position caps would let a roster fill with one position anyway.
 * The ceiling below is "starting slots + flex headroom", chosen so
 * the guard shapes an absent manager's roster without ever making
 * the draft unable to proceed.
 */
const DEFAULT_POSITION_CAPS: Readonly<Record<string, number>> = {
  C: 4,
  LW: 4,
  RW: 4,
  D: 6,
  G: 2,
};

/**
 * Positions the guard understands. Anything a player maps to outside
 * this set is uncapped (defensive: a future position code must never
 * make autopick refuse to pick).
 */
const CAPPED_POSITIONS = Object.keys(DEFAULT_POSITION_CAPS);

/** Input to every autopick strategy. */
export interface AutopickInput {
  leagueId: string;
  teamId: string;
  /**
   * Supabase client for read-only queries (player projections,
   * already-drafted player lookup). The engine's admin-client
   * path (`getSupabaseAdmin()`) is the canonical caller; user-
   * scoped clients also work because the projection table has
   * a "Public can view" RLS policy.
   */
  supabase: SupabaseClient;
  /**
   * KEEPERS (2026-09-05): players no strategy may return. Kept players are
   * not in draft_picks_v2 until their own slot comes up, so the drafted-set
   * read alone would hand one to another team.
   */
  excludePlayerIds?: ReadonlySet<number>;
}

/**
 * Result of a single strategy call. `ok: true` means the strategy
 * picked a player; `ok: false` means the strategy has no eligible
 * pick to suggest, and the chain should try the next strategy. The
 * top-level `selectAutopickPlayer` returns `{ ok: false, reason:
 * 'no_eligible_players' }` only when EVERY strategy in the chain
 * has returned `ok: false`.
 */
export type AutopickResult =
  | { ok: true; playerId: number; source: string }
  | { ok: false; reason: 'no_eligible_players' };

/**
 * Pluggable autopick strategy. Implements one selection heuristic
 * (queue, projections, positional, etc.). Returns `ok: true` with
 * a `playerId` and a human-readable `source` string used for logs
 * and audit, or `ok: false` to defer to the next strategy.
 */
export type AutopickStrategy = (input: AutopickInput) => Promise<AutopickResult>;

/**
 * Walk the strategy chain in order. First `ok: true` wins. If every
 * strategy returns `ok: false`, return `no_eligible_players` —
 * caller (`LobbyManager.handleAutopickTimeout`) treats this as a
 * stuck-draft condition and surfaces an error log for ops alerting
 * (chunk 11g.7).
 *
 * Strategies receive the same `input`; they're independent and
 * stateless. Adding strategies is a single-line array push at the
 * call site (or accept a custom array via the second parameter for
 * tests / commissioner overrides).
 */
export async function selectAutopickPlayer(
  input: AutopickInput,
  strategies: ReadonlyArray<AutopickStrategy> = DEFAULT_STRATEGIES,
): Promise<AutopickResult> {
  for (const strategy of strategies) {
    const result = await strategy(input);
    if (result.ok) {
      return result;
    }
  }
  return { ok: false, reason: 'no_eligible_players' };
}

/**
 * Map a directory position code onto the guard's vocabulary
 * (E118). Returns null when the code is absent or unrecognised —
 * callers treat null as "uncapped", never as "ineligible".
 */
function normalizePosition(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length === 0) return null;
  // Directory codes are already C/LW/RW/D/G; take the first token of
  // any multi-position string (e.g. "LW/RW") as the primary.
  const primary = code.split(/[\/,\s]+/)[0];
  return CAPPED_POSITIONS.includes(primary) ? primary : null;
}

export const projectionsStrategy: AutopickStrategy = async ({
  leagueId,
  teamId,
  supabase,
  excludePlayerIds,
}) => {
  // Step 1: load already-drafted player_ids for this league.
  const { data: draftedRows, error: draftedErr } = await supabase
    .from('draft_picks_v2')
    .select('player_id')
    .eq('league_id', leagueId);
  if (draftedErr) {
    structuredLogger.error(
      'autopick.projections.draft_picks_read_failed',
      { leagueId, message: draftedErr.message ?? null },
      draftedErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }
  // KI-042 / task #61 (2026-08-08 T5): draft_picks.player_id is
  // mixed-domain (numeric NHL-id strings for real leagues, uuid
  // strings for demo leagues). Real-league autopick pathway
  // requires numeric-domain player_ids; demo-domain rows are
  // silently dropped from the drafted-set (never hits real-league
  // projections join). Uses shared coerceToNumericPlayerId
  // (packages/shared/src/utils/playerIdDomain.ts) — returns null
  // for uuid/invalid, real number for numeric.
  const draftedSet = new Set<number>(excludePlayerIds ?? []);
  for (const r of (draftedRows ?? []) as Array<{ player_id: number | string }>) {
    const coerced = coerceToNumericPlayerId(r.player_id);
    if (coerced !== null) draftedSet.add(coerced);
  }

  // Use the same published, revision-checked workload and current identities
  // as the draft room. Stored benchmark points and last season's games never
  // supply a forecast. In particular, goalie components already contain their
  // projected appearance workload and must not be multiplied by games again.
  const [index, leagueResult] = await Promise.all([
    new PlayerDashboardService(supabase).getDashboardIndex(),
    supabase.from('leagues').select('settings,scoring_settings').eq('id', leagueId).maybeSingle(),
  ]);
  if (index.error || leagueResult.error || !leagueResult.data) {
    structuredLogger.error('autopick.projections.context_read_failed', { leagueId });
    return { ok: false, reason: 'no_eligible_players' };
  }
  const scoring = projectionSettings(leagueResult.data.scoring_settings);
  const scorer = new ScoringCalculator(scoring);
  const players = new Map(index.players.map(player => [player.id, player]));
  const configured = leagueResult.data.settings?.rosterSlots;
  const positionCaps: Record<string, number> = {};
  if (configured && typeof configured === 'object') {
    for (const [slot, count] of Object.entries(configured)) {
      if (['C', 'LW', 'RW', 'F', 'D', 'G'].includes(slot.toUpperCase()) &&
          typeof count === 'number' && Number.isFinite(count) && count >= 0) {
        positionCaps[slot.toUpperCase()] = count;
      }
    }
  }
  if (Object.keys(positionCaps).length === 0) Object.assign(positionCaps, DEFAULT_POSITION_CAPS);
  const positionKey = (position: string): string | null => {
    const pos = normalizePosition(position);
    return pos && ['C', 'LW', 'RW'].includes(pos) && positionCaps.F !== undefined &&
      !['C', 'LW', 'RW'].some(key => positionCaps[key] !== undefined) ? 'F' : pos;
  };
  const { data: teamPicks, error: teamError } = await supabase.from('draft_picks_v2')
    .select('player_id').eq('league_id', leagueId).eq('team_id', teamId);
  if (teamError) return { ok: false, reason: 'no_eligible_players' };
  const held = new Map<string, number>();
  const ownedIds = new Set((teamPicks ?? []).map(row => coerceToNumericPlayerId(row.player_id)));
  for (const id of ownedIds) {
    const player = id == null ? undefined : players.get(id);
    const key = player ? positionKey(player.position) : null;
    if (key) held.set(key, (held.get(key) ?? 0) + 1);
  }
  const board = [...players.values()]
    .filter(player => player.team?.trim() && !draftedSet.has(player.id))
    .map(player => {
      const context = player.canonical_context;
      const published = context?.status === 'projected' &&
        context.run_id === player.projection_run_id && context.revision === player.projection_revision;
      const forecast = published ? projectionFor(player, scorer, scoring)?.total ?? null : null;
      // Match the room's separate historical ordering for unavailable forecasts.
      // This measured-season score is never presented or used as a forecast.
      const actual = scorer.calculatePoints(player.is_goalie ? {
        wins: player.wins, saves: player.saves, shutouts: player.shutouts, goals_against: player.goals_against,
      } : {
        goals: player.goals, assists: player.assists, shots: player.sog, blocks: player.blocks,
        hits: player.hits, pim: player.pim, ppp: player.ppp, shp: player.shp, plus_minus: player.plus_minus,
      }, player.is_goalie);
      return { playerId: player.id, position: positionKey(player.position), forecast, actual };
    })
    .sort((a, b) => {
      if ((a.forecast !== null) !== (b.forecast !== null)) return a.forecast !== null ? -1 : 1;
      return (a.forecast !== null && b.forecast !== null ? b.forecast - a.forecast : b.actual - a.actual) ||
        a.playerId - b.playerId;
    });
  const underCap = board.find(player => !player.position || positionCaps[player.position] === undefined ||
    (held.get(player.position) ?? 0) < positionCaps[player.position]);
  const selected = underCap ?? board[0];
  structuredLogger.info('autopick.published_board.selected', { leagueId, teamId,
    candidates: board.length, forecastCandidates: board.filter(player => player.forecast !== null).length,
    playerId: selected?.playerId ?? null, forecastAvailable: selected?.forecast != null,
  });
  return selected ? { ok: true, playerId: selected.playerId,
    source: underCap ? 'draft_value' : 'draft_value_caps_exhausted' } :
    { ok: false, reason: 'no_eligible_players' };
};

/**
 * QUEUE (2026-08-12) — the manager's own ranking, consulted first.
 *
 * Until today the draft queue was a lie of omission. `DraftQueue.tsx`
 * wrote `localStorage['draft-queue-<leagueId>']` and **nothing on the
 * server ever read it**. `draft_queues` existed, with correct RLS, and
 * held zero rows. So the one moment a queue is FOR — the manager is
 * away, their clock expires, autopick fires — was the one moment it did
 * nothing. They got best-available instead of their guy.
 *
 * This is why the strategy chain exists, and the note above called it:
 * "adding `queueStrategy` to the front of the array is a single line of
 * code rather than a refactor." That held.
 *
 * ── Design decisions worth stating, because each could have gone the
 *    other way ──
 *
 * 1. NO POSITION CAPS HERE. `projectionsStrategy` shapes an ABSENT
 *    manager's roster with a G<=2-style guard, because a value ranking
 *    left alone will hand someone twelve goalies. A queue is the
 *    opposite situation: it is an explicit, ordered instruction the
 *    manager typed in themselves. Overriding it with a cap would mean
 *    silently not drafting the player they ranked #1. Yahoo, ESPN and
 *    Sleeper all honour the queue as stated; so do we.
 *
 * 2. IT NEVER THROWS. Every failure path returns `ok: false`, which
 *    hands control to `projectionsStrategy`. A malformed queue, an RLS
 *    surprise, a dropped connection to Postgres — none of them may be
 *    the reason a draft stalls. Degrading to best-available is a worse
 *    pick; throwing is a dead clock, and a dead clock is how twelve
 *    people end up standing around.
 *
 * 3. THE DRAFTED CHECK IS NOT OPTIONAL. A queue built before the draft
 *    is stale within minutes — the top of it is exactly what everyone
 *    else is also taking. Walking past already-drafted entries is the
 *    common case, not an edge case.
 *
 * 4. It reads `draft_picks_v2` (the trigger-maintained projection), the
 *    same source `projectionsStrategy` uses for its drafted set, so the
 *    two strategies can never disagree about who is still available.
 */
export const queueStrategy: AutopickStrategy = async ({
  leagueId,
  teamId,
  supabase,
  excludePlayerIds,
}) => {
  const defer = (): AutopickResult => ({
    ok: false,
    reason: 'no_eligible_players',
  });

  try {
    const { data: queueRows, error: queueErr } = await supabase
      .from('draft_queues')
      .select('player_id, position')
      .eq('team_id', teamId)
      .order('position', { ascending: true });

    if (queueErr) {
      // Logged at warn, not error: falling through to projections is a
      // correct, complete outcome — the draft still advances on time.
      structuredLogger.warn('autopick.queue.read_failed', {
        leagueId,
        teamId,
        message: queueErr.message ?? null,
      });
      return defer();
    }

    const queued = (queueRows ?? []) as Array<{
      player_id: number;
      position: number;
    }>;
    if (queued.length === 0) {
      // Overwhelmingly the common case. Deliberately not logged — on a
      // 12-team board most managers never build a queue, and a log line
      // per autopick per empty queue is noise that would bury the real
      // events on draft night.
      return defer();
    }

    const { data: draftedRows, error: draftedErr } = await supabase
      .from('draft_picks_v2')
      .select('player_id')
      .eq('league_id', leagueId);

    if (draftedErr) {
      // Fail CLOSED for the queue specifically. Without a reliable
      // drafted set we could hand back a player already on someone
      // else's roster; submit_pick_v2 would reject it as `player_taken`
      // and the autopick would fail outright. Deferring to projections,
      // which does its own drafted lookup, is strictly safer.
      structuredLogger.warn('autopick.queue.drafted_lookup_failed', {
        leagueId,
        teamId,
        message: draftedErr.message ?? null,
      });
      return defer();
    }

    const drafted = new Set<number>(excludePlayerIds ?? []);
    for (const row of (draftedRows ?? []) as Array<{ player_id: number }>) {
      const id = coerceToNumericPlayerId(row.player_id);
      if (id !== null) drafted.add(id);
    }

    for (const entry of queued) {
      const playerId = coerceToNumericPlayerId(entry.player_id);
      if (playerId === null) continue;
      if (drafted.has(playerId)) continue;

      structuredLogger.info('autopick.queue.hit', {
        leagueId,
        teamId,
        playerId,
        queuePosition: entry.position,
        queueLength: queued.length,
      });
      return { ok: true, playerId, source: 'queue' };
    }

    // The manager had a queue and every player in it is gone. Worth a
    // log line — it is the signal that their prep was consumed, and on
    // draft night it explains to them afterwards why they got a
    // projections pick despite having queued.
    structuredLogger.info('autopick.queue.exhausted', {
      leagueId,
      teamId,
      queueLength: queued.length,
    });
    return defer();
  } catch (err) {
    structuredLogger.warn('autopick.queue.unexpected_error', {
      leagueId,
      teamId,
      message: err instanceof Error ? err.message : String(err),
    });
    return defer();
  }
};

/**
 * The live chain. `queueStrategy` first — a manager's stated ranking
 * outranks any model we have. `projectionsStrategy` catches everyone
 * who did not queue, which on a real board is most of them.
 *
 * Still open for a future tail (see the chain-of-strategies note at the
 * top of this file):
 *   - `positionalStrategy` — roster-aware fallback once projections
 *     exhaust. Not needed today: projectionsStrategy already carries a
 *     roster-shape guard (E118).
 */
export const DEFAULT_STRATEGIES: ReadonlyArray<AutopickStrategy> = [
  queueStrategy,
  projectionsStrategy,
];
