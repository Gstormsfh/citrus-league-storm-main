/**
 * Draft Engine v2 — auction action endpoints (2026-08-24 launch build).
 *
 *   POST /api/draft/v2/league/:leagueId/nominate
 *   POST /api/draft/v2/league/:leagueId/bid
 *
 * These are the USER transport for the v2 auction state machine. The
 * engine (server/src/draft) owns timers and auto-nomination; users act
 * over the same HTTP → RPC → NOTIFY rail that snake/linear picks use
 * (see draftV2Pick.ts). The engine's live external-apply path arms the
 * bid/nomination windows when these events land (LobbyManager.
 * armAuctionTimersAfterLiveApply).
 *
 * TRUST MODEL. `nominate_player_v2` / `place_bid_v2` are SECURITY
 * DEFINER, service_role-only, trusted-executor RPCs (ADR-004 §5): they
 * validate auction STATE (pause, active nomination, bid > leading,
 * tier increments, anti-snipe) but NOT authorization or game-legality
 * that requires roster/budget context. This route therefore owns:
 *
 *   nominate: caller owns team_id · league is an in-progress auction ·
 *             caller's team is the on-clock nominator (rotation) ·
 *             player not already won/on the block · opening bid within
 *             [min bid, max affordable] under the reserve rule
 *   bid:      caller owns team_id · bid within max affordable under
 *             the reserve rule (bid-vs-leading + increments enforced
 *             by the RPC)
 *
 * Reserve rule (mirrors LobbyManager.processNominate/processPlaceBid):
 * a team must always be able to pay $minBid for each unfilled roster
 * slot, so maxAffordable = remaining − (slotsRemaining − 1) × minBid.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { supabaseAdmin } from '../lib/supabase';
import { DraftServiceV2 } from '../services/DraftServiceV2';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';
import {
  DEFAULT_BID_INCREMENT_TIERS,
  validateBidIncrementTiers,
} from '../draft/auctionBidIncrement';

const draftV2AuctionRoutes = new Hono<Env>();

draftV2AuctionRoutes.use('*', authMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NominateBodySchema = z.object({
  team_id: z.string().regex(UUID_RE, 'team_id must be a UUID'),
  player_id: z.string().min(1).max(32),
  player_name: z.string().min(1).max(120),
  opening_bid: z.number().finite().positive(),
});

const BidBodySchema = z.object({
  team_id: z.string().regex(UUID_RE, 'team_id must be a UUID'),
  nomination_id: z.string().regex(UUID_RE, 'nomination_id must be a UUID'),
  bid_amount: z.number().finite().positive(),
});

interface AuctionLeagueContext {
  settings: {
    draftType?: string;
    auctionBudget?: number;
    auctionMinBid?: number;
    auctionBidWindowSeconds?: number;
    auctionAntiSnipeThresholdSeconds?: number;
    auctionAntiSnipeExtensionSeconds?: number;
    auctionMinBidIncrementTiers?: unknown;
  };
  draftStatus: string;
  draftRounds: number;
}

/** Load and gate the league: must exist, be an auction, be drafting. */
async function loadAuctionLeague(leagueId: string): Promise<AuctionLeagueContext> {
  const { data: league, error } = await supabaseAdmin
    .from('leagues')
    .select('settings, draft_status, draft_rounds, roster_size')
    .eq('id', leagueId)
    .single();
  if (error || !league) {
    throw AppError.notFound('League not found');
  }
  const settings = (league.settings ?? {}) as AuctionLeagueContext['settings'];
  if (settings.draftType !== 'auction') {
    throw AppError.badRequest('wrong_format_for_action: league is not an auction draft');
  }
  if (league.draft_status !== 'in_progress') {
    throw AppError.badRequest(`illegal_state: draft is ${league.draft_status}, not in_progress`);
  }
  const draftRounds = (league.draft_rounds as number) ?? (league.roster_size as number) ?? 0;
  if (draftRounds <= 0) {
    throw AppError.badRequest('illegal_state: league has no draft rounds configured');
  }
  return { settings, draftStatus: league.draft_status as string, draftRounds };
}

/** Verify the calling user owns the acting team in this league. */
async function verifyTeamOwnership(leagueId: string, teamId: string, userId: string): Promise<void> {
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, owner_id')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .maybeSingle();
  if (!team) {
    throw AppError.forbidden('Team not found in this league');
  }
  if (team.owner_id !== userId) {
    throw AppError.forbidden('unauthorized: you do not own this team');
  }
}

/**
 * Budget + reserve check. Returns maxAffordable for the team.
 * Budget row is authoritative when present; otherwise the league's
 * configured starting budget (engine hydrates the same way).
 */
async function computeMaxAffordable(
  leagueId: string,
  teamId: string,
  ctx: AuctionLeagueContext,
): Promise<{ remaining: number; playersWon: number; maxAffordable: number; minBid: number }> {
  const minBid = typeof ctx.settings.auctionMinBid === 'number' ? ctx.settings.auctionMinBid : 1;
  const startingBudget =
    typeof ctx.settings.auctionBudget === 'number' ? ctx.settings.auctionBudget : 200;

  const { data: budgetRow } = await supabaseAdmin
    .from('auction_budgets')
    .select('remaining_budget, players_won')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .maybeSingle();

  const remaining = budgetRow ? Number(budgetRow.remaining_budget) : startingBudget;
  const playersWon = budgetRow ? Number(budgetRow.players_won) : 0;
  const slotsRemaining = Math.max(0, ctx.draftRounds - playersWon);
  if (slotsRemaining === 0) {
    throw AppError.badRequest('illegal_state: roster is already full for this team');
  }
  const reserve = (slotsRemaining - 1) * minBid;
  const maxAffordable = remaining - reserve;
  return { remaining, playersWon, maxAffordable, minBid };
}

// ── POST /league/:leagueId/nominate ─────────────────────────────────
draftV2AuctionRoutes.post(
  '/league/:leagueId/nominate',
  membershipMiddleware,
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId');

    const idempotencyKey = c.req.header('X-Idempotency-Key');
    const correlationId = c.req.header('X-Correlation-Id') ?? null;
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      return handleError(
        c,
        new AppError('X-Idempotency-Key header is required and must be a UUID', 400, 'BAD_REQUEST'),
        'Missing or invalid X-Idempotency-Key',
      );
    }
    if (correlationId !== null && !UUID_RE.test(correlationId)) {
      return handleError(
        c,
        new AppError('X-Correlation-Id, when present, must be a UUID', 400, 'BAD_REQUEST'),
        'Invalid X-Correlation-Id',
      );
    }

    let body: z.infer<typeof NominateBodySchema>;
    try {
      body = NominateBodySchema.parse(await c.req.json());
    } catch (err) {
      return handleError(
        c,
        new AppError(
          'invalid_event_payload: body validation failed',
          400,
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : String(err),
        ),
        'Nominate body validation failed',
      );
    }

    try {
      const ctx = await loadAuctionLeague(leagueId);
      await verifyTeamOwnership(leagueId, body.team_id, userId);

      // Rotation: the on-clock nominator is round-1 draft_order
      // team_order[(completed nominations) % teamCount]. Completed =
      // closed + expired + skipped events (matches the engine's
      // nominationsCompleted counter).
      const { data: round1 } = await supabaseAdmin
        .from('draft_order')
        .select('team_order')
        .eq('league_id', leagueId)
        .eq('round_number', 1)
        .single();
      const rotation = (round1?.team_order ?? []) as string[];
      if (rotation.length === 0) {
        throw AppError.badRequest('illegal_state: league has no draft order (start the draft first)');
      }
      const { count: completedCount } = await supabaseAdmin
        .from('draft_events')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .in('event_type', [
          'auction_nomination_closed',
          'auction_nomination_expired',
          'auction_nomination_skipped',
        ]);
      const onClockTeamId = rotation[(completedCount ?? 0) % rotation.length];
      if (onClockTeamId !== body.team_id) {
        throw AppError.badRequest('not_on_clock: it is not your turn to nominate');
      }

      // Player availability: no prior nomination for this player that
      // ended in a sale, and no currently-active nomination for them
      // (the RPC also rejects when ANY nomination is active).
      const { data: priorNoms } = await supabaseAdmin
        .from('auction_nominations')
        .select('id, status')
        .eq('league_id', leagueId)
        .eq('player_id', body.player_id)
        .in('status', ['active', 'closed']);
      if ((priorNoms ?? []).length > 0) {
        throw AppError.badRequest('player_taken: that player has already been nominated or won');
      }

      const { maxAffordable, minBid } = await computeMaxAffordable(leagueId, body.team_id, ctx);
      if (body.opening_bid < minBid) {
        throw AppError.badRequest(`bid_too_low: opening bid must be at least $${minBid}`);
      }
      if (body.opening_bid > maxAffordable) {
        throw AppError.badRequest(
          `insufficient_budget: max affordable opening bid is $${maxAffordable} ` +
            `(reserve $${minBid} per remaining roster slot)`,
        );
      }

      const clockSeconds =
        typeof ctx.settings.auctionBidWindowSeconds === 'number'
          ? ctx.settings.auctionBidWindowSeconds
          : 30;

      const service = new DraftServiceV2(supabaseAdmin);
      const sessionId = c.get('requestId');
      const result = await service.nominatePlayer({
        leagueId,
        teamId: body.team_id,
        playerId: body.player_id,
        playerName: body.player_name,
        openingBid: body.opening_bid,
        sessionId,
        idempotencyKey,
        actor: { kind: 'user', id: userId, session_id: sessionId },
        correlationId,
        clockSeconds,
      });

      c.header('Cache-Control', 'no-store');
      return ok(c, result);
    } catch (e) {
      return handleError(c, e, 'Failed to nominate player');
    }
  },
);

// ── POST /league/:leagueId/bid ──────────────────────────────────────
draftV2AuctionRoutes.post(
  '/league/:leagueId/bid',
  membershipMiddleware,
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId');

    const idempotencyKey = c.req.header('X-Idempotency-Key');
    const correlationId = c.req.header('X-Correlation-Id') ?? null;
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      return handleError(
        c,
        new AppError('X-Idempotency-Key header is required and must be a UUID', 400, 'BAD_REQUEST'),
        'Missing or invalid X-Idempotency-Key',
      );
    }
    if (correlationId !== null && !UUID_RE.test(correlationId)) {
      return handleError(
        c,
        new AppError('X-Correlation-Id, when present, must be a UUID', 400, 'BAD_REQUEST'),
        'Invalid X-Correlation-Id',
      );
    }

    let body: z.infer<typeof BidBodySchema>;
    try {
      body = BidBodySchema.parse(await c.req.json());
    } catch (err) {
      return handleError(
        c,
        new AppError(
          'invalid_event_payload: body validation failed',
          400,
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : String(err),
        ),
        'Bid body validation failed',
      );
    }

    try {
      const ctx = await loadAuctionLeague(leagueId);
      await verifyTeamOwnership(leagueId, body.team_id, userId);

      const { maxAffordable } = await computeMaxAffordable(leagueId, body.team_id, ctx);
      if (body.bid_amount > maxAffordable) {
        throw AppError.badRequest(
          `insufficient_budget: max affordable bid is $${maxAffordable} ` +
            `(reserve rule: every open roster slot must stay fundable)`,
        );
      }

      const antiSnipeThresholdSeconds =
        typeof ctx.settings.auctionAntiSnipeThresholdSeconds === 'number'
          ? ctx.settings.auctionAntiSnipeThresholdSeconds
          : 30;
      const antiSnipeExtensionSeconds =
        typeof ctx.settings.auctionAntiSnipeExtensionSeconds === 'number'
          ? ctx.settings.auctionAntiSnipeExtensionSeconds
          : 30;
      const rawTiers =
        ctx.settings.auctionMinBidIncrementTiers !== undefined
          ? ctx.settings.auctionMinBidIncrementTiers
          : DEFAULT_BID_INCREMENT_TIERS;
      const minBidIncrementTiers = validateBidIncrementTiers(rawTiers);

      const service = new DraftServiceV2(supabaseAdmin);
      const sessionId = c.get('requestId');
      const result = await service.placeBid({
        leagueId,
        teamId: body.team_id,
        nominationId: body.nomination_id,
        bidAmount: body.bid_amount,
        sessionId,
        idempotencyKey,
        actor: { kind: 'user', id: userId, session_id: sessionId },
        correlationId,
        antiSnipeThresholdSeconds,
        antiSnipeExtensionSeconds,
        minBidIncrementTiers,
      });

      c.header('Cache-Control', 'no-store');
      return ok(c, result);
    } catch (e) {
      return handleError(c, e, 'Failed to place bid');
    }
  },
);

export { draftV2AuctionRoutes };
