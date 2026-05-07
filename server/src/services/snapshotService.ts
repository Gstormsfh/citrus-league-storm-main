/**
 * Phase 4.5 chunk 11g.7 sub-step 7b — DraftSnapshot reconstruction
 * service for the HTTP snapshot endpoint.
 *
 * **Pure DB-driven reconstruction (Path A).** The HTTP snapshot
 * endpoint at `/api/drafts/:draftId/snapshot` lives in the main
 * Citrus API server (`server/src/routes/drafts.ts`). The main API
 * server does NOT have access to the draft engine's in-memory
 * `LobbyRegistry` — those live in a separate Node process. The
 * snapshot is therefore reconstructed from durable state by reading
 * the engine's projection tables: `draft_picks_v2` for snake/linear
 * picks, `auction_nominations` + `auction_budgets` for auction
 * lobbies, and `draft_events` for the recent-event ring buffer.
 *
 * **Staleness model**: snapshot reconstruction is a point-in-time DB
 * read. Events committed but not yet broadcast to clients (the
 * < 1 sec window between `INSERT draft_events` commit and
 * `LobbyManager.broadcast`) may be missed by the snapshot but are
 * caught by the client's WS resync flow on reconnect. The client
 * issues `resync(sinceSeq=snapshot.lastSeenSeq)` after reconnect
 * and receives any missing events. This is the canonical Citrus
 * pattern — event log is the source of truth; engine + snapshot
 * are derived views with bounded staleness. Decision Log
 * 2026-05-07.
 *
 * The reconstruction logic mirrors the engine's `bootstrap()` flow
 * in `server/src/draft/LobbyManager.ts` but is simpler because
 * snapshot purposes don't require seq contiguity validation —
 * inconsistencies in the durable log are the engine's problem to
 * detect; the snapshot just renders what the DB says.
 *
 * **Reusable in 7c**: `buildSnapshot` is intended to be reused by
 * chunk 11g.7 sub-step 7c (snapshot persistence) when the engine
 * snapshots its own state to a `draft_snapshots` projection table
 * for fast bootstrap.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AuctionStateSnapshot,
  BufferedDraftEvent,
  DraftFormat,
  DraftSnapshot,
  DraftStateSnapshot,
  LobbyStatus,
} from '@citrus/shared';
import { structuredLogger } from '@citrus/shared';

/** Maximum events returned in the snapshot's ring buffer. Mirrors
 *  the engine's `EVENT_BUFFER_CAPACITY` from `LobbyManager.ts`. */
const SNAPSHOT_EVENT_BUFFER_CAPACITY = 200;

/**
 * Build a `DraftSnapshot` for the given league by reading durable
 * state from Postgres. Used by the HTTP snapshot endpoint at
 * `/api/drafts/:draftId/snapshot`. Returns `null` if the league
 * doesn't exist or has no draft format configured.
 */
export async function buildSnapshot(
  leagueId: string,
  supabase: SupabaseClient,
): Promise<DraftSnapshot | null> {
  // Step 1: read league config — format, status, pick deadline.
  const { data: leagueRow, error: leagueErr } = await supabase
    .from('leagues')
    .select('id, settings, draft_state, pick_deadline')
    .eq('id', leagueId)
    .maybeSingle();
  if (leagueErr) {
    structuredLogger.error(
      'snapshot.league_lookup_failed',
      { leagueId },
      leagueErr,
    );
    throw leagueErr;
  }
  if (!leagueRow) {
    return null;
  }

  const settings = (leagueRow.settings ?? {}) as {
    draftType?: string;
    draftRounds?: number;
    rosterSize?: number;
  };
  const draftType = settings.draftType;
  if (
    draftType !== 'snake' &&
    draftType !== 'linear' &&
    draftType !== 'auction'
  ) {
    return null;
  }
  const format: DraftFormat = draftType;
  const draftStateRaw = (leagueRow.draft_state as string | null) ?? null;
  const draftStatus = mapDraftStateToLobbyStatus(draftStateRaw);

  // Step 2: read recent events for the ring buffer (200 most recent
  // in seq order). Reverse-sort then take 200; the engine's ring
  // buffer holds the LATEST 200, so we sort DESC and limit.
  const { data: eventRows, error: eventsErr } = await supabase
    .from('draft_events')
    .select(
      'id, seq, event_type, payload, idempotency_key, created_at',
    )
    .eq('league_id', leagueId)
    .order('seq', { ascending: false })
    .limit(SNAPSHOT_EVENT_BUFFER_CAPACITY);
  if (eventsErr) {
    structuredLogger.error(
      'snapshot.events_lookup_failed',
      { leagueId },
      eventsErr,
    );
    throw eventsErr;
  }
  // Reverse to chronological order (matches the engine's ring-buffer
  // exposure of `seq` ASC).
  const recentEvents: BufferedDraftEvent[] = (eventRows ?? [])
    .slice()
    .reverse()
    .map(translateEventRow)
    .filter((e): e is BufferedDraftEvent => e !== null);

  // Step 3: format-specific state reconstruction.
  if (format === 'auction') {
    const stateSnapshot = await buildAuctionStateSnapshot(
      leagueId,
      draftStatus,
      settings,
      supabase,
    );
    const auctionState = await buildAuctionFullState(
      leagueId,
      settings,
      supabase,
    );
    return {
      lobbyId: leagueId,
      format,
      recentEvents,
      stateSnapshot,
      auctionState,
    };
  }

  // Snake / linear.
  const stateSnapshot = await buildSnakeLinearStateSnapshot(
    leagueId,
    draftStatus,
    leagueRow.pick_deadline as string | null,
    settings,
    supabase,
  );
  return {
    lobbyId: leagueId,
    format,
    recentEvents,
    stateSnapshot,
  };
}

/**
 * Map raw `leagues.draft_state` text to the wire `LobbyStatus`
 * discriminator. Both 'queued' and 'pre_draft' map to
 * `'not_started'`; 'active' / 'in_progress' map to `'in_progress'`;
 * 'paused' is direct. 'completed' / 'cancelled' map directly.
 */
function mapDraftStateToLobbyStatus(state: string | null): LobbyStatus {
  switch (state) {
    case 'in_progress':
    case 'active':
      return 'in_progress';
    case 'paused':
      // 'paused' isn't a LobbyStatus value (snake/linear pause is a
      // pauseState side-channel; engine still treats lifecycle as
      // 'in_progress'). Map to 'in_progress' here.
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
    case 'pre_draft':
    default:
      return 'not_started';
  }
}

async function buildSnakeLinearStateSnapshot(
  leagueId: string,
  draftStatus: LobbyStatus,
  pickDeadline: string | null,
  settings: { draftRounds?: number; rosterSize?: number },
  supabase: SupabaseClient,
): Promise<DraftStateSnapshot> {
  // Read all picks-made for this league to compute on-clock pointer.
  const { data: pickRows, error: pickErr } = await supabase
    .from('draft_picks_v2')
    .select('pick_number, round, team_id')
    .eq('league_id', leagueId)
    .order('pick_number', { ascending: true });
  if (pickErr) {
    structuredLogger.error(
      'snapshot.picks_lookup_failed',
      { leagueId },
      pickErr,
    );
    throw pickErr;
  }
  const picksMade = (pickRows ?? []).length;

  // Read draft_order for total picks + on-clock teamId.
  const { data: orderRows, error: orderErr } = await supabase
    .from('draft_order')
    .select('round_number, team_order')
    .eq('league_id', leagueId)
    .order('round_number', { ascending: true });
  if (orderErr) {
    structuredLogger.error(
      'snapshot.draft_order_lookup_failed',
      { leagueId },
      orderErr,
    );
    throw orderErr;
  }
  const flatOrder: Array<{ round: number; pickNumber: number; teamId: string }> = [];
  let pn = 1;
  for (const row of orderRows ?? []) {
    const teamOrder = row.team_order as unknown;
    if (!Array.isArray(teamOrder)) continue;
    for (const teamId of teamOrder) {
      if (typeof teamId === 'string') {
        flatOrder.push({
          round: row.round_number as number,
          pickNumber: pn++,
          teamId,
        });
      }
    }
  }
  const totalPicks = flatOrder.length;
  const slot =
    draftStatus === 'in_progress' && picksMade < flatOrder.length
      ? flatOrder[picksMade]
      : null;

  return {
    currentPickNumber: slot ? slot.pickNumber : null,
    currentRoundNumber: slot ? slot.round : null,
    onClockTeamId: slot ? slot.teamId : null,
    totalPicks,
    picksMade,
    draftStatus,
    currentPickDeadline:
      draftStatus === 'in_progress' && pickDeadline ? pickDeadline : null,
  };
}

async function buildAuctionStateSnapshot(
  leagueId: string,
  draftStatus: LobbyStatus,
  settings: { draftRounds?: number; rosterSize?: number },
  supabase: SupabaseClient,
): Promise<DraftStateSnapshot> {
  // Read draft_order round-1 for nominator rotation.
  const { data: round1, error: round1Err } = await supabase
    .from('draft_order')
    .select('team_order')
    .eq('league_id', leagueId)
    .eq('round_number', 1)
    .maybeSingle();
  if (round1Err) {
    structuredLogger.error(
      'snapshot.auction_round1_lookup_failed',
      { leagueId },
      round1Err,
    );
    throw round1Err;
  }
  const teamCount =
    round1 && Array.isArray(round1.team_order)
      ? (round1.team_order as unknown[]).filter((t) => typeof t === 'string').length
      : 0;
  const draftRounds = settings.draftRounds ?? settings.rosterSize ?? 0;
  const totalPicks = teamCount * draftRounds;

  // Count nominations completed: status IN ('sold','no_sale','cancelled').
  const { count: closedCount, error: closedErr } = await supabase
    .from('auction_nominations')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .in('status', ['sold', 'no_sale', 'cancelled']);
  if (closedErr) {
    structuredLogger.error(
      'snapshot.auction_closed_count_failed',
      { leagueId },
      closedErr,
    );
    throw closedErr;
  }
  const nominationsCompleted = closedCount ?? 0;

  // Active nomination → currentPickDeadline.
  const { data: activeNom, error: activeErr } = await supabase
    .from('auction_nominations')
    .select('expires_at, nominated_by_team_id')
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeErr) {
    structuredLogger.error(
      'snapshot.auction_active_lookup_failed',
      { leagueId },
      activeErr,
    );
    throw activeErr;
  }

  const nominationOrder =
    round1 && Array.isArray(round1.team_order)
      ? (round1.team_order as unknown[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : [];
  const onClockTeamId =
    draftStatus === 'in_progress' && nominationOrder.length > 0
      ? nominationOrder[nominationsCompleted % nominationOrder.length] ?? null
      : null;
  const currentRoundNumber =
    draftStatus === 'in_progress' && nominationOrder.length > 0
      ? Math.floor(nominationsCompleted / nominationOrder.length) + 1
      : null;
  const currentPickNumber =
    draftStatus === 'in_progress' ? nominationsCompleted + 1 : null;

  return {
    currentPickNumber,
    currentRoundNumber,
    onClockTeamId,
    totalPicks,
    picksMade: nominationsCompleted,
    draftStatus,
    currentPickDeadline: activeNom
      ? (activeNom.expires_at as string)
      : null,
  };
}

async function buildAuctionFullState(
  leagueId: string,
  settings: { draftRounds?: number; rosterSize?: number },
  supabase: SupabaseClient,
): Promise<AuctionStateSnapshot> {
  const draftRounds = settings.draftRounds ?? settings.rosterSize ?? 0;

  // currentNomination — most recent active row.
  const { data: activeNom, error: activeErr } = await supabase
    .from('auction_nominations')
    .select(
      'id, player_id, nominated_by_team_id, current_high_bidder_team_id, current_high_bid, expires_at',
    )
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeErr) {
    throw activeErr;
  }

  // teamBudgets + teamRosterSlotsRemaining from auction_budgets.
  const { data: budgetRows, error: budgetErr } = await supabase
    .from('auction_budgets')
    .select('team_id, remaining_budget, players_won')
    .eq('league_id', leagueId);
  if (budgetErr) {
    throw budgetErr;
  }
  const teamBudgets: Record<string, number> = {};
  const teamRosterSlotsRemaining: Record<string, number> = {};
  for (const row of budgetRows ?? []) {
    const teamId = String(row.team_id);
    teamBudgets[teamId] = Number(row.remaining_budget);
    teamRosterSlotsRemaining[teamId] =
      draftRounds - Number(row.players_won ?? 0);
  }

  // Closed nominations count (sold/no_sale/cancelled).
  const { count: closedCount, error: closedErr } = await supabase
    .from('auction_nominations')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .in('status', ['sold', 'no_sale', 'cancelled']);
  if (closedErr) {
    throw closedErr;
  }
  const nominationsCompleted = closedCount ?? 0;

  return {
    currentNomination: activeNom
      ? {
          nominationId: String(activeNom.id),
          playerId: String(activeNom.player_id),
          nominatorTeamId: String(activeNom.nominated_by_team_id),
          leadingBidderId: String(
            activeNom.current_high_bidder_team_id ??
              activeNom.nominated_by_team_id,
          ),
          leadingBid: Number(activeNom.current_high_bid),
          clockDeadline: String(activeNom.expires_at),
        }
      : null,
    teamBudgets,
    teamRosterSlotsRemaining,
    nominationsCompleted,
  };
}

/**
 * Translate a raw `draft_events` row into the wire-format
 * `BufferedDraftEvent` discriminated union. Returns `null` for
 * unrecognized event types — they're skipped from the snapshot's
 * ring buffer (the client's resync flow will catch up on reconnect).
 *
 * Mirrors the per-event-type apply logic in `LobbyManager`'s
 * bootstrap handlers; the shape transformations here must agree
 * with the engine's broadcast-time emission.
 */
function translateEventRow(row: {
  id: number;
  seq: number;
  event_type: string;
  payload: unknown;
  idempotency_key: string | null;
  created_at: string;
}): BufferedDraftEvent | null {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const correlationId = row.idempotency_key ?? '';
  const timestamp = row.created_at;
  const seq = row.seq;

  switch (row.event_type) {
    case 'pick':
      return {
        kind: 'pick_submitted',
        seq,
        timestamp,
        correlationId,
        teamId: String(payload.team_id ?? ''),
        playerId: Number(payload.player_id ?? 0),
        roundNumber: Number(payload.round ?? 0),
        pickNumber: Number(payload.pick_number ?? 0),
        ...(payload.is_autopick === true ? { isAutopick: true } : {}),
      };
    case 'pick_undone':
      return {
        kind: 'pick_undone',
        seq,
        timestamp,
        correlationId,
        teamId: String(payload.team_id ?? ''),
        playerId: Number(payload.player_id ?? 0),
        roundNumber: Number(payload.round ?? 0),
        pickNumber: Number(payload.pick_number ?? 0),
        undoneSeq: Number(payload.undone_seq ?? 0),
      };
    case 'commissioner_override':
      return {
        kind: 'commissioner_override',
        seq,
        timestamp,
        correlationId,
        teamId: String(payload.team_id ?? ''),
        playerId: Number(payload.player_id ?? 0),
        roundNumber: Number(payload.round ?? 0),
        pickNumber: Number(payload.pick_number ?? 0),
        ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
      };
    case 'auction_nomination_started':
      return {
        kind: 'auction_nomination_started',
        seq,
        timestamp,
        correlationId,
        nominationId: String(payload.nomination_id ?? ''),
        playerId: String(payload.player_id ?? ''),
        playerName: String(payload.player_name ?? ''),
        nominatorTeamId: String(payload.nominator_team_id ?? ''),
        openingBid: Number(payload.opening_bid ?? 0),
        clockDeadline: String(payload.expires_at ?? ''),
      };
    case 'auction_bid_placed':
      return {
        kind: 'auction_bid_placed',
        seq,
        timestamp,
        correlationId,
        nominationId: String(payload.nomination_id ?? ''),
        bidderTeamId: String(payload.team_id ?? ''),
        bidAmount: Number(payload.bid_amount ?? 0),
        clockDeadline: String(payload.clock_deadline ?? ''),
      };
    case 'auction_bid_extends_timer':
      return {
        kind: 'auction_bid_extends_timer',
        seq,
        timestamp,
        correlationId,
        nominationId: String(payload.nomination_id ?? ''),
        priorClockDeadline: String(payload.prior_expires_at ?? ''),
        newClockDeadline: String(payload.new_expires_at ?? ''),
        triggeringBidId: Number(payload.triggering_bid_id ?? 0),
        triggeringBidderTeamId: String(payload.triggering_team_id ?? ''),
        triggeringBidAmount: Number(payload.triggering_bid_amount ?? 0),
      };
    case 'auction_nomination_closed':
      return {
        kind: 'auction_nomination_closed',
        seq,
        timestamp,
        nominationId: String(payload.nomination_id ?? ''),
        winnerTeamId: String(payload.winning_team_id ?? ''),
        finalAmount: Number(payload.final_amount ?? 0),
        totalBids: Number(payload.total_bids ?? 1),
        playerId: String(payload.player_id ?? ''),
      };
    case 'auction_nomination_expired': {
      const reasonRaw = String(payload.reason ?? 'no_bids');
      return {
        kind: 'auction_nomination_expired',
        seq,
        timestamp,
        nominationId: String(payload.nomination_id ?? ''),
        reason: reasonRaw === 'no_bids' ? 'no_bids' : 'no_bids',
      };
    }
    case 'auction_paused': {
      const pausedTimerKindRaw = payload.paused_timer_kind;
      const pausedTimerKind: 'bid_window' | 'nomination_window' =
        pausedTimerKindRaw === 'nomination_window'
          ? 'nomination_window'
          : 'bid_window';
      return {
        kind: 'auction_paused',
        seq,
        timestamp,
        correlationId,
        commissionerUserId:
          payload.commissioner_user_id == null
            ? null
            : String(payload.commissioner_user_id),
        reason: String(payload.reason ?? 'commissioner'),
        pausedAt: String(payload.paused_at ?? timestamp),
        ...(payload.paused_nomination_id != null
          ? { pausedNominationId: String(payload.paused_nomination_id) }
          : {}),
        ...(payload.captured_remaining_seconds != null
          ? {
              capturedRemainingSeconds: Number(payload.captured_remaining_seconds),
            }
          : {}),
        pausedTimerKind,
      };
    }
    case 'auction_resumed':
      return {
        kind: 'auction_resumed',
        seq,
        timestamp,
        correlationId,
        commissionerUserId:
          payload.commissioner_user_id == null
            ? null
            : String(payload.commissioner_user_id),
        resumedAt: String(payload.resumed_at ?? timestamp),
        priorPauseEventId: Number(payload.prior_pause_event_id ?? 0),
        ...(payload.restored_nomination_id != null
          ? { restoredNominationId: String(payload.restored_nomination_id) }
          : {}),
        ...(payload.new_expires_at != null
          ? { newClockDeadline: String(payload.new_expires_at) }
          : {}),
      };
    case 'auction_auto_nominated': {
      const fallbackSourceRaw = String(payload.fallback_source ?? 'projections');
      const fallbackSource: 'queue' | 'projections' | 'commissioner_preset' =
        fallbackSourceRaw === 'queue'
          ? 'queue'
          : fallbackSourceRaw === 'commissioner_preset'
            ? 'commissioner_preset'
            : 'projections';
      return {
        kind: 'auction_auto_nominated',
        seq,
        timestamp,
        correlationId,
        nominationId: String(payload.nomination_id ?? ''),
        playerId: String(payload.player_id ?? ''),
        playerName: String(payload.player_name ?? ''),
        nominatorTeamId: String(payload.nominator_team_id ?? ''),
        openingBid: Number(payload.opening_bid ?? 0),
        clockDeadline: String(payload.expires_at ?? ''),
        fallbackSource,
      };
    }
    case 'auction_nomination_skipped': {
      const reasonRaw = String(payload.reason ?? 'insufficient_budget');
      const reason: 'insufficient_budget' | 'no_eligible_players' =
        reasonRaw === 'no_eligible_players'
          ? 'no_eligible_players'
          : 'insufficient_budget';
      return {
        kind: 'auction_nomination_skipped',
        seq,
        timestamp,
        correlationId,
        skippedTeamId: String(payload.skipped_team_id ?? ''),
        reason,
      };
    }
    case 'auction_commissioner_override': {
      const overrideActionRaw = String(payload.override_action ?? '');
      const validActions = [
        'revert_bid',
        'force_close_nomination',
        'award_to_team',
        'adjust_opening_bid',
        'adjust_budget',
        'cancel_nomination',
        'extend_bid_window',
      ] as const;
      if (!validActions.includes(overrideActionRaw as never)) {
        return null;
      }
      return {
        kind: 'auction_commissioner_override',
        seq,
        timestamp,
        correlationId,
        commissionerUserId: String(payload.commissioner_user_id ?? ''),
        overrideAction: overrideActionRaw as
          | 'revert_bid'
          | 'force_close_nomination'
          | 'award_to_team'
          | 'adjust_opening_bid'
          | 'adjust_budget'
          | 'cancel_nomination'
          | 'extend_bid_window',
        priorState: (payload.prior_state ?? {}) as Record<string, unknown>,
        newState: (payload.new_state ?? {}) as Record<string, unknown>,
        ...(typeof payload.rationale === 'string'
          ? { rationale: payload.rationale }
          : {}),
      };
    }
    default:
      // Unrecognized event types (draft_paused/draft_resumed/etc. for
      // snake/linear; future variants) are skipped from the snapshot's
      // ring buffer. Client's resync flow catches up after reconnect.
      return null;
  }
}
