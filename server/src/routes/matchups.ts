import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';

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
  const supabase = createUserClient(c.get('userToken'));
  const service = new MatchupService(supabase);

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

export { matchupRoutes };
