import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { logger } from '@citrus/shared';

const matchupRoutes = new Hono<Env>();

matchupRoutes.use('*', authMiddleware);

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
    return c.json({ error: error.message || 'Failed to fetch matchups' }, 500);
  }

  return c.json({ data: matchups });
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
    return c.json({ error: typeof error === 'string' ? error : error.message }, 500);
  }

  return c.json({ data: matchup });
});

// GET /api/matchups/league/:leagueId/history — Get matchup history between two teams
matchupRoutes.get('/league/:leagueId/history', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const team1Id = c.req.query('team1');
  const team2Id = c.req.query('team2') || null;
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  if (!team1Id) {
    return c.json({ error: 'team1 query parameter required' }, 400);
  }

  const { matchups } = await service.getMatchupHistory(leagueId, team1Id, team2Id);
  return c.json({ data: matchups });
});

// GET /api/matchups/league/:leagueId/playoffs — Get playoff bracket
matchupRoutes.get('/league/:leagueId/playoffs', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const result = await service.getPlayoffBracket(leagueId);
  return c.json({ data: result });
});

// GET /api/matchups/:matchupId — Get a specific matchup with lines
matchupRoutes.get('/:matchupId', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { matchup, lines, error } = await service.getMatchupWithLines(matchupId);
  if (error || !matchup) {
    return c.json({ error: 'Matchup not found' }, 404);
  }

  return c.json({ data: { ...matchup, lines } });
});

// GET /api/matchups/:matchupId/scores — Get matchup scores
matchupRoutes.get('/:matchupId/scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { scores, error } = await service.getMatchupScores(matchupId);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch scores' }, 500);
  }

  return c.json({ data: scores });
});

// GET /api/matchups/:matchupId/daily-scores — Calculate daily matchup scores
matchupRoutes.get('/:matchupId/daily-scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  console.log('[DAILY-SCORES] Called for matchup:', matchupId);
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  // Auto-ensure both teams have team_lineups + fantasy_daily_rosters before calculating scores.
  // This is critical for AI teams (owner_id = NULL) that can't be saved via frontend RLS.
  try {
    console.log('[DAILY-SCORES] Running ensureMatchupRosters...');
    const ensureResult = await service.ensureMatchupRosters(matchupId);
    console.log('[DAILY-SCORES] ensureMatchupRosters result:', JSON.stringify(ensureResult));
  } catch (err: any) {
    console.error('[DAILY-SCORES] ensure-rosters FAILED:', err?.message || err);
  }

  const { data, error } = await service.calculateDailyMatchupScores(matchupId);
  if (error) {
    return c.json({ error: error.message || 'Failed to calculate scores' }, 500);
  }

  return c.json({ data });
});

// POST /api/matchups/projections/daily — Get daily projections for a batch of players
matchupRoutes.post('/projections/daily', async (c) => {
  const body = await c.req.json<{ playerIds: number[]; date: string }>();

  if (!body.playerIds?.length || !body.date) {
    return c.json({ error: 'playerIds (number[]) and date (YYYY-MM-DD) are required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { projMap, error } = await service.getDailyProjections(body.playerIds, body.date);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch projections' }, 500);
  }

  // Convert Map to plain object for JSON serialization
  const projections: Record<string, any> = {};
  projMap.forEach((value, key) => {
    projections[String(key)] = value;
  });

  return c.json({ data: projections });
});

// POST /api/matchups/update-scores — Update all matchup scores
matchupRoutes.post('/update-scores', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { data, error } = await service.updateMatchupScores(body.leagueId);
  if (error) {
    return c.json({ error: error.message || 'Failed to update scores' }, 500);
  }

  return c.json({ data });
});

// POST /api/matchups/daily-game-stats — Get daily game stats for players
matchupRoutes.post('/daily-game-stats', async (c) => {
  const body = await c.req.json<{ playerIds: number[]; date: string }>();

  if (!body.playerIds?.length || !body.date) {
    return c.json({ error: 'playerIds (number[]) and date (YYYY-MM-DD) are required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { stats, error } = await service.getDailyGameStats(body.playerIds, body.date);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch daily game stats' }, 500);
  }

  return c.json({ data: stats });
});

// POST /api/matchups/matchup-stats — Get weekly matchup stats for players
matchupRoutes.post('/matchup-stats', async (c) => {
  const body = await c.req.json<{ playerIds: number[]; startDate: string; endDate: string }>();

  if (!body.playerIds?.length || !body.startDate || !body.endDate) {
    return c.json({ error: 'playerIds, startDate, endDate required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { statsMap, error } = await service.getMatchupStats(body.playerIds, body.startDate, body.endDate);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch matchup stats' }, 500);
  }

  // Convert Map to plain object for JSON serialization
  const stats: Record<string, any> = {};
  statsMap.forEach((value, key) => {
    stats[String(key)] = value;
  });

  return c.json({ data: stats });
});

// GET /api/matchups/:matchupId/daily-lineup — Get frozen daily lineup
matchupRoutes.get('/:matchupId/daily-lineup', async (c) => {
  const matchupId = c.req.param('matchupId');
  const teamId = c.req.query('teamId');
  const date = c.req.query('date');

  if (!teamId || !date) {
    return c.json({ error: 'teamId and date query parameters required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { lineup, error } = await service.getDailyLineup(teamId, matchupId, date);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch daily lineup' }, 500);
  }

  return c.json({ data: lineup });
});

// GET /api/matchups/:matchupId/frozen-roster — Get frozen roster entries for a team/date
matchupRoutes.get('/:matchupId/frozen-roster', async (c) => {
  const matchupId = c.req.param('matchupId');
  const teamId = c.req.query('teamId');
  const date = c.req.query('date');

  if (!teamId || !date) {
    return c.json({ error: 'teamId and date query parameters required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { roster, error } = await service.getFrozenRoster(teamId, matchupId, date);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch frozen roster' }, 500);
  }

  return c.json({ data: roster });
});

// POST /api/matchups/:matchupId/frozen-roster-batch — Get all frozen roster entries for multiple dates
matchupRoutes.post('/:matchupId/frozen-roster-batch', async (c) => {
  const matchupId = c.req.param('matchupId');
  const body = await c.req.json<{ dates: string[] }>();

  if (!body.dates?.length) {
    return c.json({ error: 'dates (string[]) required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { entries, error } = await service.getFrozenRosterBatch(matchupId, body.dates);
  if (error) {
    return c.json({ error: error.message || 'Failed to fetch frozen roster batch' }, 500);
  }

  return c.json({ data: entries });
});

// POST /api/matchups/:matchupId/ensure-rosters — Ensure both teams have team_lineups + fantasy_daily_rosters
// Must be called BEFORE loading roster data to handle AI teams (no owner, RLS-blocked)
matchupRoutes.post('/:matchupId/ensure-rosters', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  try {
    const result = await service.ensureMatchupRosters(matchupId);
    return c.json({ data: result });
  } catch (err) {
    logger.error('[ensure-rosters] Error:', err);
    return c.json({ error: 'Failed to ensure rosters' }, 500);
  }
});

// POST /api/matchups/auto-complete — Auto-complete matchups
matchupRoutes.post('/auto-complete', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { success, error } = await service.autoCompleteMatchups();
  if (error) {
    return c.json({ error }, 500);
  }

  return c.json({ data: { success } });
});

// POST /api/matchups/h2h-category-results — Calculate H2H category matchup
matchupRoutes.post('/h2h-category-results', async (c) => {
  const body = await c.req.json<{
    leagueId: string; matchupId: string;
    team1Id: string; team2Id: string;
    weekStart: string; weekEnd: string;
    categories: string[];
  }>();

  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { results, error } = await service.getH2HCategoryResults(
    body.leagueId, body.matchupId,
    body.team1Id, body.team2Id,
    body.weekStart, body.weekEnd,
    body.categories,
  );

  if (error) {
    return c.json({ error: error.message || 'Failed to calculate H2H results' }, 500);
  }

  return c.json({ data: results });
});

// POST /api/matchups/roto-standings — Calculate Roto standings
matchupRoutes.post('/roto-standings', async (c) => {
  const body = await c.req.json<{ leagueId: string; categories: string[]; throughWeek?: number }>();
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { standings, error } = await service.getRotoStandings(
    body.leagueId, body.categories, body.throughWeek
  );

  if (error) {
    return c.json({ error: error.message || 'Failed to calculate Roto standings' }, 500);
  }

  return c.json({ data: standings });
});

// POST /api/matchups/ppg-standings — Calculate PPG standings
matchupRoutes.post('/ppg-standings', async (c) => {
  const body = await c.req.json<{ leagueId: string; throughWeek?: number }>();
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { standings, error } = await service.getPPGStandings(
    body.leagueId, body.throughWeek
  );

  if (error) {
    return c.json({ error: error.message || 'Failed to calculate PPG standings' }, 500);
  }

  return c.json({ data: standings });
});

// POST /api/matchups/lock-completed-days — Lock completed roster days
matchupRoutes.post('/lock-completed-days', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const { lockedCount, error } = await service.lockCompletedDays();
  if (error) {
    return c.json({ error: error.message || 'Failed to lock completed days' }, 500);
  }

  return c.json({ data: { lockedCount } });
});

// GET /api/matchups/job-status — Get matchup score job status
matchupRoutes.get('/job-status', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

  const status = await service.getJobStatus();
  return c.json({ data: status });
});

export { matchupRoutes };
