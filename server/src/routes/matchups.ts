import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, COLUMNS, getCurrentSeason, countsTowardRecord, toMatchupScore, getTodayMST } from '@citrus/shared';

const matchupRoutes = new Hono<Env>();

matchupRoutes.use('*', authMiddleware);

// ── League-scoped routes (membership verified via :leagueId) ─────────

// GET /api/matchups/league/:leagueId — Get all matchups for a league
//
// With ?week=N this is the league scoreboard (audit M7): every row also
// carries team1_projected_total / team2_projected_total, the projected
// final per side, computed server-side from the same tables the matchup
// page reads (MatchupService.getLeagueScoreboard). Without a week it is the
// season-wide list standings and the timeline read, and no projection is
// computed. The wire shape is LeagueScoreboardMatchup in @citrus/shared.
matchupRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const week = c.req.query('week');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const weekNumber = week ? parseInt(week, 10) : undefined;
  const { matchups, error } = weekNumber !== undefined && Number.isFinite(weekNumber)
    ? await service.getLeagueScoreboard(leagueId, weekNumber)
    : await service.getLeagueMatchups(leagueId, weekNumber);

  if (error) {
    return handleError(c, error, 'Failed to fetch matchups');
  }

  return ok(c, matchups);
});

// GET /api/matchups/league/:leagueId/user — Get user's matchup for a week
matchupRoutes.get('/league/:leagueId/user', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const week = parseInt(c.req.query('week') || '1', 10);
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { matchup, error } = await service.getUserMatchup(leagueId, userId, week);
  if (error) {
    return handleError(c, error, 'Failed to fetch user matchup');
  }

  return ok(c, matchup);
});

// GET /api/matchups/league/:leagueId/history — Get matchup history between two teams
matchupRoutes.get('/league/:leagueId/history', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const team1Id = c.req.query('team1');
  const team2Id = c.req.query('team2') || null;
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  if (!team1Id) {
    return fail(c, AppError.badRequest('team1 query parameter required'));
  }

  const { matchups } = await service.getMatchupHistory(leagueId, team1Id, team2Id);
  return ok(c, matchups);
});

// GET /api/matchups/league/:leagueId/playoffs — Get playoff bracket
matchupRoutes.get('/league/:leagueId/playoffs', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const result = await service.getPlayoffBracket(leagueId);
  return ok(c, result);
});

// GET /api/matchups/league/:leagueId/team-record/:teamId — Get team W-L record
matchupRoutes.get('/league/:leagueId/team-record/:teamId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));

  // Sanitize teamId for use in .or() filter string
  const safeTeamId = teamId.replace(/[^a-zA-Z0-9\-_]/g, '');
  const { data: matchups, error } = await supabase
    .from('matchups')
    .select(COLUMNS.MATCHUP_SLIM)
    .eq('league_id', leagueId)
    .in('status', ['completed', 'in_progress'])
    .or(`team1_id.eq.${safeTeamId},team2_id.eq.${safeTeamId}`);

  if (error) {
    return handleError(c, error, 'Failed to fetch team record');
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;

  interface MatchupRecord {
    week_number: number;
    team1_id: string;
    team2_id: string | null;
    team1_score: number | string | null;
    team2_score: number | string | null;
    status: string;
    week_end_date: string | null;
  }

  // THE RULE IS NOT WRITTEN HERE (2026-09-04 post-draft audit).
  // `countsTowardRecord` in @citrus/shared is the one implementation of
  // "does this week count", and LeagueService.getStandings +
  // apps/web StandingsService already call it. This endpoint feeds the
  // record under the team names on the Matchup ScoreCard, and it used to
  // carry its own rule: `status === 'completed'` only, and no tie bucket.
  // Two disagreements followed from that, both visible on one screen:
  //   1. A week that is fully scored but not yet stamped 'completed' by
  //      auto_complete_matchups (it runs on a schedule) counted on the
  //      Standings page and not here.
  //   2. A real tie was silently dropped by both counters, so a 4-3-1 team
  //      read "4-3" here and "4-3-1" on Standings.
  // A second implementation of this rule is how the "1-1-18 phantom ties"
  // bug happened; see packages/shared/src/utils/standings.ts.
  const todayStr = getTodayMST();
  ((matchups || []) as unknown as MatchupRecord[]).forEach((m) => {
    if (!countsTowardRecord(m, todayStr)) return;
    const isTeam1 = m.team1_id === teamId;
    const myScore = toMatchupScore(isTeam1 ? m.team1_score : m.team2_score);
    const oppScore = toMatchupScore(isTeam1 ? m.team2_score : m.team1_score);
    if (myScore > oppScore) wins++;
    else if (oppScore > myScore) losses++;
    else ties++;
  });

  return ok(c, { wins, losses, ties });
});

// GET /api/matchups/league/:leagueId/simulations — Get simulation data for a league week
matchupRoutes.get('/league/:leagueId/simulations', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const weekNumber = c.req.query('week');
  const supabase = createUserClient(c.get('userToken'));

  let query = supabase
    .from('matchup_simulations')
    .select(COLUMNS.MATCHUP_SIMULATION)
    .eq('league_id', leagueId)
    .order('simulated_at', { ascending: false });

  if (weekNumber) {
    const parsedWeek = parseInt(weekNumber, 10);
    if (!isNaN(parsedWeek)) {
      query = query.eq('week_number', parsedWeek);
    }
  }

  const { data, error } = await query;
  if (error) {
    // 42P01 = relation does not exist. matchup_simulations has no migration
    // and no scheduled writer (simulate_matchups.py is CATEGORY: UTILITY,
    // manual), so as of 2026-09-03 this route 500'd on every call. An empty
    // array is the honest answer the client already handles: no simulations.
    // Any other error is still a failure.
    if ((error as { code?: string }).code === '42P01') return ok(c, []);
    return handleError(c, error, 'Failed to fetch simulations');
  }

  return ok(c, data || []);
});

// GET /api/matchups/league/:leagueId/brier-score — Get Brier score for a league
matchupRoutes.get('/league/:leagueId/brier-score', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  // Derived — the prior '2025' literal default would have returned last
  // season's Brier score forever after 2026-10-01 for any caller that
  // omits the ?season= query param.
  const season = parseInt(c.req.query('season') || String(getCurrentSeason()), 10);
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .rpc('get_league_brier_score', {
      p_league_id: leagueId,
      p_season: season,
    });

  if (error) {
    return handleError(c, error, 'Failed to fetch Brier score');
  }

  return ok(c, data || []);
});

// DELETE /api/matchups/league/:leagueId — Delete all matchups (commissioner only)
matchupRoutes.delete('/league/:leagueId', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { error } = await service.deleteAllMatchupsForLeague(leagueId);
  if (error) {
    return handleError(c, error, 'Failed to delete matchups');
  }

  return ok(c, { success: true });
});

// POST /api/matchups/league/:leagueId/generate — Generate matchups
//
// WHO MAY CALL THIS, AND WHY IT IS NO LONGER COMMISSIONER-ONLY (2026-09-04).
//
// The season schedule is built lazily. Nothing creates it when a draft ends:
// the v2 engine's `draft_completed` trigger syncs rosters and stops, and the
// only other caller of MatchupService.generateMatchupsForLeague is the v1
// client pick path, which the v2 draft room never touches. So for a league
// that has just drafted, THIS ROUTE is the only thing in the product that
// ever writes a schedule, and Matchup.tsx reaches it by noticing the void and
// asking for one.
//
// While it was commissioner-only, the first eleven managers of a twelve-team
// league to open the Matchup tab after their draft hit a dead end: the
// generate call 403'd, Matchup.tsx surfaced it as a full-page error reading
// "Access denied: Commissioner privileges required", and there they stayed
// until the commissioner happened to open that same tab. Verified against
// production: league "Test at golf" finished a clean 252-pick draft with 252
// roster rows across 12 teams, and 0 matchups.
//
// A member may now fill that void, under three conditions that together make
// his schedule the same one the commissioner would have produced:
//   1. the league must currently hold NO matchups. A member can create a
//      schedule where none exists; he can never edit or extend one.
//   2. every team id in the body must belong to this league, so a foreign
//      team cannot be smuggled into the round robin.
//   3. forceRegenerate is forced to false for a member. It DELETES the
//      schedule, and that is not a repair, it is an act of authority. Note
//      that REFUSING the flag would have been wrong: Matchup.tsx computes it
//      as `!hasAnyMatchups`, so the empty league this route exists to serve
//      is precisely the one whose client asks to force. Normalizing it costs
//      the member nothing (there is nothing to delete) and closes the path
//      permanently.
// The write then goes through the admin client on purpose: the sole INSERT
// policy on `matchups` is "Commissioners can manage matchups", so RLS would
// refuse the member's own token even after these checks pass.
//
// The commissioner's path is unchanged in every respect - his own token, his
// own client, forceRegenerate available.
matchupRoutes.post('/league/:leagueId/generate', membershipMiddleware, validateBody(schemas.matchupGenerate), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.matchupGenerate>>(c);
  const userId = c.get('userId') as string;

  const userClient = createUserClient(c.get('userToken'));
  const { isCommissioner } = await new LeagueMembershipService(userClient)
    .checkMembership(leagueId, userId);

  let supabase = userClient;

  if (!isCommissioner) {
    const admin = getSupabaseAdmin();

    const { count: existingMatchups, error: countError } = await admin
      .from('matchups')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    if (countError) {
      return handleError(c, countError, 'Failed to generate matchups');
    }

    if ((existingMatchups ?? 0) > 0) {
      return fail(c, AppError.forbidden('Access denied: Commissioner privileges required'));
    }

    const { data: leagueTeams, error: teamsError } = await admin
      .from('teams')
      .select('id')
      .eq('league_id', leagueId);

    if (teamsError) {
      return handleError(c, teamsError, 'Failed to generate matchups');
    }

    const ownTeams = new Set((leagueTeams ?? []).map((t) => (t as { id: string }).id));
    const requested = (body.teams as Array<{ id: string }>).map((t) => t.id);

    if (requested.length === 0 || requested.some((id) => !ownTeams.has(id))) {
      return fail(c, AppError.forbidden('A schedule must be built from this league\'s own teams'));
    }

    supabase = admin;
  }

  const service = new MatchupService(supabase);

  const { error } = await service.generateMatchupsForLeague(
    leagueId,
    body.teams as Array<{ id: string }>,
    body.fantasyWeeks as Array<{ week_number: number; start_date: string; end_date: string }>,
    // A member's request is NORMALIZED, not merely refused. Matchup.tsx sets
    // forceRegenerate from `!hasAnyMatchups` - so in exactly the empty-league
    // case this route exists to unblock, the client asks to force. Refusing
    // the flag would have 403'd every one of those managers and left the fix
    // doing nothing at all. The emptiness check above already proves there is
    // nothing to delete; pinning the flag to false as well means a member
    // cannot reach the DELETE inside generateMatchupsForLeague by any route,
    // even if that check is later loosened or the client starts sending the
    // flag for a different reason.
    isCommissioner ? body.forceRegenerate : false,
  );

  if (error) {
    return handleError(c, error, 'Failed to generate matchups');
  }

  return ok(c, { success: true });
});

// GET /api/matchups/job-status — Get matchup score job status
//
// MUST stay above `GET /:matchupId`. It was registered at the bottom of
// this file until the 2026-08-18 launch audit, which meant the param
// route swallowed it: a request for /api/matchups/job-status bound
// matchupId="job-status", missed in the DB, and returned a 404 from the
// wrong handler — getJobStatus was unreachable. Same ordering discipline
// as routes/players.ts, where every literal precedes /:playerId.
//
// NOTE for future edits: the other literal paths in this file
// (/update-scores, /auto-complete, /roto-standings, …) are safe ONLY
// because they are POST and /:matchupId is GET. Any new single-segment
// GET added below this line will be silently shadowed.
matchupRoutes.get('/job-status', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const status = await service.getJobStatus();
  return ok(c, status);
});

// ── Matchup-by-ID routes ─────────────────────────────────────────────
// RLS on the matchups table ensures users can only access matchups from
// leagues they belong to. Auth middleware validates the JWT.

// GET /api/matchups/:matchupId — Get a specific matchup with lines
matchupRoutes.get('/:matchupId', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { matchup, lines, error } = await service.getMatchupWithLines(matchupId);
  if (error || !matchup) {
    return fail(c, AppError.notFound('Matchup'));
  }

  return ok(c, { ...matchup, lines });
});

// GET /api/matchups/:matchupId/scores — Get matchup scores
matchupRoutes.get('/:matchupId/scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { scores, error } = await service.getMatchupScores(matchupId);
  if (error) {
    return handleError(c, error, 'Failed to fetch scores');
  }

  return ok(c, scores);
});

// GET /api/matchups/:matchupId/daily-scores — Calculate daily matchup scores
matchupRoutes.get('/:matchupId/daily-scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  // PERF (2026-09-01): this route used to run ensureMatchupRosters here
  // AND calculateDailyMatchupScores below — but the calculator already
  // backfills fantasy_daily_rosters for both teams itself, so the ensure
  // ran the whole lineup/roster existence dance twice per request (~9
  // extra Supabase round trips). Measured at 834ms mean / 2.9s max on
  // prod. One layer owns the backfill: the calculator.
  const { data, error } = await service.calculateDailyMatchupScores(matchupId);
  if (error) {
    return handleError(c, error, 'Failed to calculate scores');
  }

  return ok(c, data);
});

// GET /api/matchups/:matchupId/lines — Get matchup lines (player stats)
matchupRoutes.get('/:matchupId/lines', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { lines, error } = await service.getMatchupWithLines(matchupId);
  if (error) {
    return handleError(c, error, 'Failed to fetch matchup lines');
  }

  return ok(c, lines);
});

// ── Matchup-scoped reads that bypass RLS ────────────────────────────────
/**
 * IDOR guard for the matchup routes that read through the service-role client.
 *
 * MatchupService.getDailyLineup and getFrozenRoster both call getSupabaseAdmin()
 * so that AI-team rows stay visible, which bypasses RLS on
 * fantasy_daily_rosters entirely. Both routes take `teamId` from the query
 * string. Without this check any signed-in user could read any team's frozen
 * lineup for any matchup just by supplying the two UUIDs — including leagues
 * they have never belonged to, and leagues they were removed from (RLS would
 * deny them now, but the admin client never consults it).
 *
 * The lookup below deliberately uses the CALLER's token, not the admin client,
 * so the `matchups` SELECT policy ("Users can view matchups in their leagues")
 * is the gate: a caller outside the league gets no row back. The team check
 * then pins the request to the two teams actually in that matchup, so
 * membership in one league cannot be traded for a read of another league's
 * team by pairing a visible matchupId with a foreign teamId.
 */
async function assertMatchupTeamVisible(
  supabase: ReturnType<typeof createUserClient>,
  matchupId: string,
  teamId: string,
): Promise<AppError | null> {
  const { data, error } = await supabase
    .from('matchups')
    .select('team1_id, team2_id')
    .eq('id', matchupId)
    .maybeSingle();

  if (error || !data) return AppError.notFound('Matchup');
  if (teamId !== data.team1_id && teamId !== data.team2_id) {
    return AppError.forbidden('That team is not in this matchup');
  }
  return null;
}

// GET /api/matchups/:matchupId/daily-lineup — Get frozen daily lineup
matchupRoutes.get('/:matchupId/daily-lineup', async (c) => {
  const matchupId = c.req.param('matchupId');
  const teamId = c.req.query('teamId');
  const date = c.req.query('date');

  if (!teamId || !date) {
    return fail(c, AppError.badRequest('teamId and date query parameters required'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const denied = await assertMatchupTeamVisible(supabase, matchupId, teamId);
  if (denied) return fail(c, denied);

  const { lineup, error } = await service.getDailyLineup(teamId, matchupId, date);
  if (error) {
    return handleError(c, error, 'Failed to fetch daily lineup');
  }

  return ok(c, lineup);
});

// GET /api/matchups/:matchupId/frozen-roster — Get frozen roster entries
matchupRoutes.get('/:matchupId/frozen-roster', async (c) => {
  const matchupId = c.req.param('matchupId');
  const teamId = c.req.query('teamId');
  const date = c.req.query('date');

  if (!teamId || !date) {
    return fail(c, AppError.badRequest('teamId and date query parameters required'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const denied = await assertMatchupTeamVisible(supabase, matchupId, teamId);
  if (denied) return fail(c, denied);

  const { roster, error } = await service.getFrozenRoster(teamId, matchupId, date);
  if (error) {
    return handleError(c, error, 'Failed to fetch frozen roster');
  }

  return ok(c, roster);
});

// POST /api/matchups/:matchupId/frozen-roster-batch — Get frozen roster entries for multiple dates
matchupRoutes.post('/:matchupId/frozen-roster-batch', validateBody(schemas.matchupFrozenRosterBatch), async (c) => {
  const matchupId = c.req.param('matchupId');
  const body = getValidatedBody<z.infer<typeof schemas.matchupFrozenRosterBatch>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { entries, error } = await service.getFrozenRosterBatch(matchupId, body.dates);
  if (error) {
    return handleError(c, error, 'Failed to fetch frozen roster batch');
  }

  return ok(c, entries);
});

// POST /api/matchups/:matchupId/ensure-rosters — Ensure both teams have rosters
matchupRoutes.post('/:matchupId/ensure-rosters', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  try {
    const result = await service.ensureMatchupRosters(matchupId);
    return ok(c, result);
  } catch (err) {
    logger.error('[ensure-rosters] Error:', err);
    return handleError(c, err, 'Failed to ensure rosters');
  }
});

// GET /api/matchups/:matchupId/simulation — Get simulation for a single matchup
matchupRoutes.get('/:matchupId/simulation', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .rpc('get_matchup_simulation', { p_matchup_id: matchupId });

  if (error) {
    return handleError(c, error, 'Failed to fetch simulation');
  }

  return ok(c, data || []);
});

// ── Batch / global operations ────────────────────────────────────────

// POST /api/matchups/projections/daily — Get daily projections for players
matchupRoutes.post('/projections/daily', validateBody(schemas.matchupPlayerIds), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupPlayerIds>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { projMap, error } = await service.getDailyProjections(body.playerIds, body.date);
  if (error) {
    return handleError(c, error, 'Failed to fetch projections');
  }

  const projections: Record<string, unknown> = {};
  projMap.forEach((value, key) => {
    projections[String(key)] = value;
  });

  return ok(c, projections);
});

// POST /api/matchups/update-scores — Update all matchup scores
matchupRoutes.post('/update-scores', validateBody(schemas.matchupUpdateScores), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupUpdateScores>>(c);
  const userId = c.get('userId');

  const supabase = createUserClient(c.get('userToken'));

  // Verify league membership before allowing score mutation
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(body.leagueId, userId);
  if (!memberCheck.isMember) {
    return fail(c, AppError.forbidden('Not a member of this league'));
  }

  const service = new MatchupService(supabase);

  const { data, error } = await service.updateMatchupScores(body.leagueId);
  if (error) {
    return handleError(c, error, 'Failed to update scores');
  }

  return ok(c, data);
});

// POST /api/matchups/daily-game-stats — Get daily game stats for players
matchupRoutes.post('/daily-game-stats', validateBody(schemas.matchupPlayerIds), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupPlayerIds>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { stats, error } = await service.getDailyGameStats(body.playerIds, body.date);
  if (error) {
    return handleError(c, error, 'Failed to fetch daily game stats');
  }

  return ok(c, stats);
});

// POST /api/matchups/player-game-log — one player's per-game stats over a range.
// Replaces up to 82 per-date calls from the Player Stats modal with one.
matchupRoutes.post('/player-game-log', validateBody(schemas.playerGameLogRange), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.playerGameLogRange>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const [logResult, projResult] = await Promise.all([
    service.getPlayerGameLog(body.playerId, body.startDate, body.endDate),
    service.getPlayerProjectionLog(body.playerId, body.startDate, body.endDate),
  ]);

  if (logResult.error) {
    return handleError(c, logResult.error, 'Failed to fetch player game log');
  }
  // Projections are supplementary — a player with none still has a game log.
  if (projResult.error) {
    return ok(c, { games: logResult.games, projections: [] });
  }

  return ok(c, { games: logResult.games, projections: projResult.projections });
});

// POST /api/matchups/matchup-stats — Get weekly matchup stats for players
matchupRoutes.post('/matchup-stats', validateBody(schemas.matchupPlayerIdsRange), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupPlayerIdsRange>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { statsMap, error } = await service.getMatchupStats(body.playerIds, body.startDate, body.endDate);
  if (error) {
    return handleError(c, error, 'Failed to fetch matchup stats');
  }

  const stats: Record<string, unknown> = {};
  statsMap.forEach((value, key) => {
    stats[String(key)] = value;
  });

  return ok(c, stats);
});

// POST /api/matchups/auto-complete — Auto-complete matchups
matchupRoutes.post('/auto-complete', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { success, error } = await service.autoCompleteMatchups();
  if (error) {
    return handleError(c, error, 'Failed to auto-complete matchups');
  }

  return ok(c, { success });
});

// POST /api/matchups/h2h-category-results — Calculate H2H category matchup
matchupRoutes.post('/h2h-category-results', validateBody(schemas.matchupH2HCategoryResults), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupH2HCategoryResults>>(c);
  const userId = c.get('userId');

  const supabase = createUserClient(c.get('userToken'));

  // Verify league membership
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(body.leagueId, userId);
  if (!memberCheck.isMember) {
    return fail(c, AppError.forbidden('Not a member of this league'));
  }

  const service = new MatchupService(supabase);

  const { results, error } = await service.getH2HCategoryResults(
    body.leagueId, body.matchupId,
    body.team1Id, body.team2Id,
    body.weekStart, body.weekEnd,
    body.categories,
  );

  if (error) {
    return handleError(c, error, 'Failed to calculate H2H results');
  }

  return ok(c, results);
});

// POST /api/matchups/roto-standings — Calculate Roto standings
matchupRoutes.post('/roto-standings', validateBody(schemas.matchupRotoStandings), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupRotoStandings>>(c);
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Verify league membership
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(body.leagueId, userId);
  if (!memberCheck.isMember) {
    return fail(c, AppError.forbidden('Not a member of this league'));
  }

  const service = new MatchupService(supabase);

  const { standings, error } = await service.getRotoStandings(
    body.leagueId, body.categories, body.throughWeek
  );

  if (error) {
    return handleError(c, error, 'Failed to calculate Roto standings');
  }

  return ok(c, standings);
});

// POST /api/matchups/ppg-standings — Calculate PPG standings
matchupRoutes.post('/ppg-standings', validateBody(schemas.matchupPPGStandings), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.matchupPPGStandings>>(c);
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Verify league membership
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(body.leagueId, userId);
  if (!memberCheck.isMember) {
    return fail(c, AppError.forbidden('Not a member of this league'));
  }

  const service = new MatchupService(supabase);

  const { standings, error } = await service.getPPGStandings(
    body.leagueId, body.throughWeek
  );

  if (error) {
    return handleError(c, error, 'Failed to calculate PPG standings');
  }

  return ok(c, standings);
});

// POST /api/matchups/lock-completed-days — Lock completed roster days
matchupRoutes.post('/lock-completed-days', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { lockedCount, error } = await service.lockCompletedDays();
  if (error) {
    return handleError(c, error, 'Failed to lock completed days');
  }

  return ok(c, { lockedCount });
});

// (GET /job-status moved above /:matchupId — see the note there.)

export { matchupRoutes };
