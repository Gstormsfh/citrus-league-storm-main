import { Context, Next } from 'hono';
import { z, ZodSchema, ZodError } from 'zod';
import { DRAFT_STATUSES } from '@citrus/shared';

/**
 * Request validation middleware using Zod schemas.
 */

/** Type-safe accessor for validated body set by validateBody middleware */
export function getValidatedBody<T>(c: Context): T {
  return (c as unknown as { get(key: 'validatedBody'): T }).get('validatedBody');
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

/** Validate JSON request body against a Zod schema. Sets `validatedBody` on context. */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: formatZodError(result.error) } }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context doesn't support custom keys natively
    (c as any).set('validatedBody', result.data);
    await next();
  };
}

/** Validate query parameters against a Zod schema. Sets `validatedQuery` on context. */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    const query: Record<string, string> = {};
    const url = new URL(c.req.url);
    url.searchParams.forEach((value, key) => { query[key] = value; });

    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: formatZodError(result.error) } }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context doesn't support custom keys natively
    (c as any).set('validatedQuery', result.data);
    await next();
  };
}

// ── Shared validation schemas for mutations ──────────────────────────

export const schemas = {
  createLeague: z.object({
    name: z.string().min(1, 'League name is required').max(100),
    roster_size: z.number().int().min(0).max(30).optional(),
    draft_rounds: z.number().int().min(0).max(30).optional(),
    settings: z.record(z.unknown()).optional(),
    scoring_settings: z.record(z.unknown()).optional(),
    waiver_settings: z.record(z.unknown()).optional(),
  }),

  joinLeague: z.object({
    joinCode: z.string().min(1, 'Join code is required'),
    teamName: z.string().min(1).max(100).optional(),
  }),

  makeDraftPick: z.object({
    playerId: z.string().min(1, 'playerId is required'),
    teamId: z.union([z.string(), z.number()]),
    pickNumber: z.number().int().optional(),
    roundNumber: z.number().int().optional(),
    draftSessionId: z.string().optional(),
    teamsCount: z.number().int().optional(),
  }),

  createTrade: z.object({
    fromTeamId: z.union([z.string(), z.number()]),
    toTeamId: z.union([z.string(), z.number()]),
    offeredPlayerIds: z.array(z.string()).min(1, 'Must offer at least one player'),
    requestedPlayerIds: z.array(z.string()).min(1, 'Must request at least one player'),
    message: z.string().max(500).optional(),
  }),

  submitWaiverClaim: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  submitFAABBid: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    bidAmount: z.number().int().min(0, 'Bid amount must be non-negative'),
    dropPlayerId: z.string().nullable().optional(),
    isConditionalDrop: z.boolean().optional(),
  }),

  addFreeAgent: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  stormyChat: z.object({
    message: z.string().min(1, 'Message is required').max(2000),
    leagueId: z.string().optional(),
    context: z.record(z.unknown()).optional(),
  }),

  tradeVote: z.object({
    voterTeamId: z.union([z.string(), z.number()]),
    vote: z.enum(['approve', 'veto']),
  }),

  commissionerDecision: z.object({
    leagueId: z.string().min(1),
    decision: z.enum(['approve', 'veto']),
  }),

  tradeReviewSettings: z.object({
    trade_review_type: z.enum(['none', 'commissioner', 'league_vote']),
    trade_review_period_hours: z.number().int().min(1).max(168),
    trade_veto_threshold: z.number().min(0.01).max(1),
  }),

  // Auction schemas
  auctionInitialize: z.object({
    sessionId: z.string().min(1, 'sessionId is required'),
    teamIds: z.array(z.string()).min(1, 'At least one team required'),
    budget: z.number().int().min(1).optional(),
    minBid: z.number().int().min(0).optional(),
  }),

  auctionNominate: z.object({
    sessionId: z.string().min(1, 'sessionId is required'),
    teamId: z.string().min(1, 'teamId is required'),
    playerId: z.union([z.string(), z.number()]).transform(String),
    playerName: z.string().min(1, 'playerName is required'),
    openingBid: z.number().int().min(0),
    timerSeconds: z.number().int().min(1).optional(),
  }),

  auctionBid: z.object({
    nominationId: z.string().min(1, 'nominationId is required'),
    teamId: z.string().min(1, 'teamId is required'),
    bidAmount: z.number().int().min(0, 'Bid must be non-negative'),
  }),

  auctionCloseNomination: z.object({
    sessionId: z.string().min(1, 'sessionId is required'),
    nominationId: z.string().min(1, 'nominationId is required'),
  }),

  // Keeper schemas
  designateKeeper: z.object({
    teamId: z.string().min(1, 'teamId is required'),
    playerId: z.union([z.string(), z.number()]).transform(String),
    seasonYear: z.number().int().min(2000).max(2100),
    originalDraftRound: z.number().int().min(1).optional(),
  }),

  releaseKeeper: z.object({
    teamId: z.string().min(1, 'teamId is required'),
  }),

  lockKeepers: z.object({
    seasonYear: z.number().int().min(2000).max(2100),
  }),

  // Playoff schemas
  generateBracket: z.object({
    consolationEnabled: z.boolean().optional(),
    twoWeekMatchups: z.boolean().optional(),
    reseedEachRound: z.boolean().optional(),
    seedingMethod: z.string().optional(),
    format: z.string().optional(),
    numTeams: z.number().int().min(2).max(32).optional(),
    seriesLength: z.number().int().min(1).max(7).optional(),
  }),

  // Waiver drop schema
  dropPlayer: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.union([z.string(), z.number()]),
  }),

  // Matchup body-param schemas
  matchupRotoStandings: z.object({
    leagueId: z.string().min(1, 'leagueId is required'),
    categories: z.array(z.string()).min(1),
    throughWeek: z.number().int().optional(),
  }),

  matchupPPGStandings: z.object({
    leagueId: z.string().min(1, 'leagueId is required'),
    throughWeek: z.number().int().optional(),
  }),

  matchupH2HCategoryResults: z.object({
    leagueId: z.string().min(1, 'leagueId is required'),
    matchupId: z.string().min(1, 'matchupId is required'),
    team1Id: z.string().min(1),
    team2Id: z.string().min(1),
    weekStart: z.string().min(1),
    weekEnd: z.string().min(1),
    categories: z.array(z.string()).min(1),
  }),

  // Account schemas
  recordConsent: z.object({
    policyType: z.string().min(1, 'policyType is required'),
    version: z.string().min(1, 'version is required'),
  }),

  auditLog: z.object({
    eventType: z.string().min(1, 'eventType is required'),
    leagueId: z.string().nullable().optional(),
    details: z.record(z.unknown()).optional().default({}),
    severity: z.enum(['INFO', 'WARN', 'ERROR', 'CRITICAL']).optional().default('INFO'),
  }),

  // Best ball schemas
  bestballOptimize: z.object({
    date: z.string().optional(),
  }),

  bestballOptimizeWeek: z.object({
    weekStartDate: z.string().min(1, 'weekStartDate is required'),
    weekEndDate: z.string().min(1, 'weekEndDate is required'),
  }),

  bestballWeeklyData: z.object({
    teamId: z.union([z.string(), z.number()]).transform(String),
    weekNumber: z.number().int().min(1),
  }),

  // Draft additional schemas
  initializeDraftOrder: z.object({
    teams: z.array(z.object({ id: z.string() })).min(1, 'At least one team required'),
    totalRounds: z.number().int().min(1).max(30),
    customTeamOrder: z.array(z.string()).optional(),
    draftType: z.string().min(1, 'draftType is required'),
  }),

  draftAutopick: z.object({
    teamId: z.string().min(1, 'teamId is required'),
    sessionId: z.string().min(1, 'sessionId is required'),
    roundNumber: z.number().int().min(1),
    pickNumber: z.number().int().min(1),
  }),

  draftSnapshot: z.object({
    draftSessionId: z.string().min(1, 'draftSessionId is required'),
    snapshotData: z.unknown(),
  }),

  draftRankings: z.object({
    teamId: z.string().min(1, 'teamId is required'),
    rankings: z.array(z.object({
      playerId: z.number().int(),
      rank: z.number().int(),
      positionCode: z.string(),
    })).min(1, 'At least one ranking required'),
  }),

  // League settings schemas (commissioner-only)
  leagueSettings: z.object({
    settings: z.record(z.unknown()).optional(),
    scoring_settings: z.record(z.unknown()).optional(),
  }),

  waiverSettings: z.object({
    waiver_process_time: z.string().optional(),
    waiver_period_hours: z.number().int().min(0).optional(),
    waiver_game_lock: z.boolean().optional(),
    waiver_type: z.enum(['rolling', 'reverse_draft_order', 'faab', 'reverse_standings']).optional(),
    allow_trades_during_games: z.boolean().optional(),
  }),

  scoringSettings: z.object({
    skater: z.record(z.number()).optional(),
    goalie: z.record(z.number()).optional(),
  }),

  draftSettings: z.object({
    draft_rounds: z.number().int().min(1).max(30).optional(),
    // Chunk 11g.10 sub-step 10c-2 batch 1 (item 3): clamp pickTimeLimit
    // to the UI dropdown's allowed range (30..300 seconds). Prior
    // `.min(0)` accepted `0` — which would produce a 1-second RPC
    // deadline window per submit_pick_v2 (§B.9 `now + 0s + 1s pad`) —
    // and had no upper bound, so a scripted caller could bypass the UI
    // and set unreasonable values. See pick-clock audit Q6 findings in
    // PROJECT_PLAN.md Decision Log for the full narrative.
    pickTimeLimit: z.number().int().min(30).max(300).optional(),
    draft_status: z.enum(DRAFT_STATUSES).optional(),
    scheduled_draft_time: z.string().optional(),
    teams_count: z.number().int().min(2).max(20).optional(),
  }),

  rosterSlots: z.object({
    rosterSlots: z.record(z.number().int().min(0)),
  }),

  // Matchup additional schemas
  matchupGenerate: z.object({
    teams: z.array(z.object({ id: z.string() })).min(1, 'At least one team required'),
    fantasyWeeks: z.array(z.object({
      week_number: z.number().int(),
      start_date: z.string(),
      end_date: z.string(),
    })).min(1, 'At least one week required'),
    forceRegenerate: z.boolean().optional(),
  }),

  matchupFrozenRosterBatch: z.object({
    dates: z.array(z.string()).min(1, 'At least one date required'),
  }),

  matchupPlayerIds: z.object({
    playerIds: z.array(z.number().int()).min(1, 'At least one playerId required'),
    date: z.string().min(1, 'date is required'),
  }),

  matchupPlayerIdsRange: z.object({
    playerIds: z.array(z.number().int()).min(1, 'At least one playerId required'),
    startDate: z.string().min(1, 'startDate is required'),
    endDate: z.string().min(1, 'endDate is required'),
  }),

  matchupUpdateScores: z.object({
    leagueId: z.string().optional(),
  }),

  // Roster lineup schema
  rosterLineup: z.object({
    starters: z.array(z.union([z.string(), z.number()])).optional(),
    bench: z.array(z.union([z.string(), z.number()])).optional(),
    ir: z.array(z.union([z.string(), z.number()])).optional(),
    slot_assignments: z.record(z.string(), z.string()).optional(),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    allow_player_removal: z.boolean().optional(),
  }),

  // Trade respond schema
  tradeRespond: z.object({
    action: z.enum(['accept', 'reject', 'counter']),
  }),

  // Keeper settings schema
  keeperSettings: z.object({
    keeperEnabled: z.boolean(),
    keeperCount: z.number().int().min(0),
    keeperPenalty: z.string(),
    dynastyMode: z.boolean(),
  }),

  // Account schemas (no-body mutations)
  accountExport: z.object({}).strict(),
  accountDelete: z.object({}).strict(),

  // Notification chat schema
  notificationChat: z.object({
    leagueId: z.string().min(1, 'leagueId is required'),
    message: z.string().min(1, 'Message is required').max(2000),
    senderName: z.string().max(100).nullable().optional(),
  }),

  // Admin recalculate scores schema
  adminRecalculateScores: z.object({
    leagueId: z.string().min(1, 'leagueId is required'),
    week: z.number().int().min(1).optional(),
  }),

  // Matchup background operation schemas (no-body)
  matchupEnsureRosters: z.object({}).strict(),
  matchupAutoComplete: z.object({}).strict(),
  matchupLockCompletedDays: z.object({}).strict(),
};
