import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, COLUMNS } from '@citrus/shared';

const matchupRoutes = new Hono<Env>();

matchupRoutes.use('*', authMiddleware);

// ── League-scoped routes (membership verified via :leagueId) ─────────

// GET /api/matchups/league/:leagueId — Get all matchups for a league
matchupRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const week = c.req.query('week');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { matchups, error } = await service.getLeagueMatchups(
    leagueId,
    week ? parseInt(week, 10) : undefined,
  );

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
    .select('team1_id, team2_id, team1_score, team2_score, status')
    .eq('league_id', leagueId)
    .in('status', ['completed', 'in_progress'])
    .or(`team1_id.eq.${safeTeamId},team2_id.eq.${safeTeamId}`);

  if (error) {
    return handleError(c, error, 'Failed to fetch team record');
  }

  let wins = 0;
  let losses = 0;

  interface MatchupRecord {
    team1_id: string;
    team2_id: string;
    team1_score: number | string | null;
    team2_score: number | string | null;
    status: string;
  }

  (matchups || []).forEach((m: MatchupRecord) => {
    if (m.status !== 'completed') return;
    const isTeam1 = m.team1_id === teamId;
    const myScore = parseFloat(String(isTeam1 ? m.team1_score : m.team2_score)) || 0;
    const oppScore = parseFloat(String(isTeam1 ? m.team2_score : m.team1_score)) || 0;
    if (myScore > oppScore) wins++;
    else if (oppScore > myScore) losses++;
  });

  return ok(c, { wins, losses });
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
    return handleError(c, error, 'Failed to fetch simulations');
  }

  return ok(c, data || []);
});

// GET /api/matchups/league/:leagueId/brier-score — Get Brier score for a league
matchupRoutes.get('/league/:leagueId/brier-score', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const season = parseInt(c.req.query('season') || '2025', 10);
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

// POST /api/matchups/league/:leagueId/generate — Generate matchups (commissioner only)
matchupRoutes.post('/league/:leagueId/generate', commissionerMiddleware, validateBody(schemas.matchupGenerate), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.matchupGenerate>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { error } = await service.generateMatchupsForLeague(
    leagueId,
    body.teams as Array<{ id: string }>,
    body.fantasyWeeks as Array<{ week_number: number; start_date: string; end_date: string }>,
    body.forceRegenerate,
  );

  if (error) {
    return handleError(c, error, 'Failed to generate matchups');
  }

  return ok(c, { success: true });
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

  // Auto-ensure rosters for AI teams (owner_id = NULL, RLS-blocked)
  try {
    await service.ensureMatchupRosters(matchupId);
  } catch (err) {
    logger.debug('[matchups] ensureMatchupRosters non-fatal error:', err);
  }

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
matchupRoutes.post('/:matchupId/ensure-rosters', validateBody(schemas.matchupEnsureRosters), async (c) => {
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
matchupRoutes.post('/auto-complete', validateBody(schemas.matchupAutoComplete), async (c) => {
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
matchupRoutes.post('/lock-completed-days', validateBody(schemas.matchupLockCompletedDays), async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { lockedCount, error } = await service.lockCompletedDays();
  if (error) {
    return handleError(c, error, 'Failed to lock completed days');
  }

  return ok(c, { lockedCount });
});

// GET /api/matchups/job-status — Get matchup score job status
matchupRoutes.get('/job-status', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const status = await service.getJobStatus();
  return ok(c, status);
});

export { matchupRoutes };
