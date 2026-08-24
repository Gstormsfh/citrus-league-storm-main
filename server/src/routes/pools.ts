import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { PoolService } from '../services/PoolService';
import { ok, handleError } from '../lib/responses';

const poolRoutes = new Hono<Env>();

poolRoutes.use('*', authMiddleware);

// ── Validation Schemas ───────────────────────────────────────────────

const pickemPicksSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  picks: z.array(z.object({
    game_id: z.string().min(1),
    picked_team: z.string().min(1),
    spread_value: z.number().optional(),
  })).min(1, 'At least one pick is required'),
});

const survivorPickSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  pickedTeam: z.string().min(1),
});

const confidencePicksSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  picks: z.array(z.object({
    game_id: z.string().min(1),
    picked_team: z.string().min(1),
    confidence_points: z.number().int().min(1),
  })).min(1, 'At least one pick is required'),
});

const scorePickemSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    winning_team: z.string().min(1),
  })),
});

const scorePickemATSSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    home_team: z.string().min(1),
    away_team: z.string().min(1),
    home_score: z.number(),
    away_score: z.number(),
    status: z.string(),
  })),
});

const scoreSurvivorSchema = z.object({
  weekNumber: z.number().int().min(1),
  teamResults: z.array(z.object({
    team: z.string().min(1),
    won: z.boolean(),
  })),
});

const scoreConfidenceSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    winning_team: z.string().min(1),
  })),
});

// ── Shared Helper ────────────────────────────────────────────────────

function createPoolService(c: { get(key: 'userToken'): string }) {
  return new PoolService(createUserClient(c.get('userToken')));
}

// ── Week Info ────────────────────────────────────────────────────────

// GET /api/pools/current-week
poolRoutes.get('/current-week', (c) => {
  const service = createPoolService(c);
  return ok(c, { week: service.getCurrentWeek() });
});

// GET /api/pools/team-records — Records + H2H, all in one call
poolRoutes.get('/team-records', async (c) => {
  try {
    const weekParam = c.req.query('week');
    const weekNumber = weekParam ? parseInt(weekParam, 10) : 0;
    const supabase = createUserClient(c.get('userToken'));

    // Fetch ALL final season games (4 columns only, ~1200 rows)
    const { data: games, error } = await supabase
      .from('nhl_games')
      .select('home_team, away_team, home_score, away_score, period, game_date')
      .eq('status', 'final')
      .eq('season', 2025)
      .order('game_date', { ascending: false })
      .range(0, 1999);

    if (error) throw error;

    // Build W-L-OTL records + streaks
    const records: Record<string, { w: number; l: number; otl: number; streak: string }> = {};
    const streakTracker: Record<string, { first?: boolean; count: number }> = {};

    for (const g of (games || [])) {
      if (!records[g.home_team]) records[g.home_team] = { w: 0, l: 0, otl: 0, streak: '' };
      if (!records[g.away_team]) records[g.away_team] = { w: 0, l: 0, otl: 0, streak: '' };
      const homeWon = g.home_score > g.away_score;
      const isOT = g.period === 'OT' || g.period === 'SO';
      if (homeWon) {
        records[g.home_team].w++;
        if (isOT) records[g.away_team].otl++; else records[g.away_team].l++;
      } else {
        records[g.away_team].w++;
        if (isOT) records[g.home_team].otl++; else records[g.home_team].l++;
      }
      for (const [team, won] of [[g.home_team, homeWon], [g.away_team, !homeWon]] as [string, boolean][]) {
        if (!streakTracker[team]) { streakTracker[team] = { first: won, count: 1 }; }
        else if (streakTracker[team].count > 0 && streakTracker[team].first === won) { streakTracker[team].count++; }
        else if (streakTracker[team].count > 0) { streakTracker[team].count = -1; }
      }
    }
    for (const [team, st] of Object.entries(streakTracker)) {
      if (records[team] && st.count > 0) records[team].streak = `${st.first ? 'W' : 'L'}${st.count}`;
    }

    // Build H2H for this week's matchups (if week provided)
    const h2h: Record<string, { awayWins: number; homeWins: number; games: number }> = {};
    if (weekNumber > 0) {
      try {
        const service = createPoolService(c);
        const weekGames = await service.getGamesForWeek(weekNumber);
        // Get unique pairs
        const seen = new Set<string>();
        for (const wg of weekGames) {
          const key = [wg.away_team, wg.home_team].sort().join('-');
          if (seen.has(key)) continue;
          seen.add(key);
          // Count wins from ALL season games
          let awayWins = 0, homeWins = 0, total = 0;
          for (const sg of (games || [])) {
            const isMatch = (sg.home_team === wg.away_team && sg.away_team === wg.home_team) ||
                           (sg.home_team === wg.home_team && sg.away_team === wg.away_team);
            if (!isMatch) continue;
            total++;
            const winner = sg.home_score > sg.away_score ? sg.home_team : sg.away_team;
            if (winner === wg.away_team) awayWins++;
            else homeWins++;
          }
          h2h[key] = { awayWins, homeWins, games: total };
        }
      } catch { /* h2h is supplementary */ }
    }

    return ok(c, { records, h2h });
  } catch (err) {
    return handleError(c, err, 'Failed to fetch team records');
  }
});

// GET /api/pools/h2h — Head-to-head records for ALL matchups in a given week
poolRoutes.get('/h2h', async (c) => {
  try {
    const weekNumber = parseInt(c.req.query('week') || '0', 10);
    const supabase = createUserClient(c.get('userToken'));
    const service = createPoolService(c);

    // Get all games for the week to know which team pairs to check
    const weekGames = weekNumber > 0 ? await service.getGamesForWeek(weekNumber) : [];

    // Get all unique team pairs from this week's games
    const pairs = new Set<string>();
    const pairTeams: Array<[string, string]> = [];
    for (const g of weekGames) {
      const key = [g.home_team, g.away_team].sort().join('-');
      if (!pairs.has(key)) {
        pairs.add(key);
        pairTeams.push([g.away_team, g.home_team]);
      }
    }

    if (pairTeams.length === 0) return ok(c, {});

    // Fetch ALL final season games (small payload: 4 columns, ~1200 rows)
    const { data: games } = await supabase
      .from('nhl_games')
      .select('home_team, away_team, home_score, away_score')
      .eq('status', 'final')
      .eq('season', 2025)
      .range(0, 1999);

    // Build H2H for each pair
    const result: Record<string, { awayWins: number; homeWins: number; games: number }> = {};
    for (const [away, home] of pairTeams) {
      const key = [away, home].sort().join('-');
      const matchups = (games || []).filter(g =>
        (g.home_team === away && g.away_team === home) ||
        (g.home_team === home && g.away_team === away)
      );
      let awayWins = 0, homeWins = 0;
      for (const g of matchups) {
        const winner = g.home_score > g.away_score ? g.home_team : g.away_team;
        if (winner === away) awayWins++;
        else homeWins++;
      }
      result[key] = { awayWins, homeWins, games: matchups.length };
    }

    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch H2H');
  }
});

// GET /api/pools/week/:weekNumber/games
poolRoutes.get('/week/:weekNumber/games', async (c) => {
  try {
    const weekNumber = parseInt(c.req.param('weekNumber'), 10);
    if (isNaN(weekNumber) || weekNumber < 1) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid week number' } }, 400);
    }
    const service = createPoolService(c);
    const games = await service.getGamesForWeek(weekNumber);
    return ok(c, games);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch week games');
  }
});

// ── Pick'em Routes ───────────────────────────────────────────────────

// POST /api/pools/pickem/picks — Submit/update Pick'em picks
poolRoutes.post('/pickem/picks', validateBody(pickemPicksSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof pickemPicksSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitPickemPicks(body.leagueId, userId, body.weekNumber, body.picks as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit picks');
  }
});

// GET /api/pools/pickem/:leagueId/picks?week=N
poolRoutes.get('/pickem/:leagueId/picks', membershipMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const leagueId = c.req.param('leagueId');
    const week = parseInt(c.req.query('week') || '0', 10);
    if (!week) return c.json({ error: { code: 'BAD_REQUEST', message: 'week query param required' } }, 400);
    const service = createPoolService(c);
    const picks = await service.getPickemPicks(leagueId, userId, week);
    return ok(c, picks);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch picks');
  }
});

// GET /api/pools/pickem/:leagueId/standings
poolRoutes.get('/pickem/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const service = createPoolService(c);
    const leagueId = c.req.param('leagueId');
    const standings = await service.getPickemStandings(leagueId, c.get('userId'));
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch standings');
  }
});

// POST /api/pools/pickem/:leagueId/score — Score a week (admin/scoring pipeline)
poolRoutes.post('/pickem/:leagueId/score', membershipMiddleware, validateBody(scorePickemSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scorePickemSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scorePickemWeek(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score picks');
  }
});

// POST /api/pools/pickem/:leagueId/score-ats — Score ATS picks
poolRoutes.post('/pickem/:leagueId/score-ats', membershipMiddleware, validateBody(scorePickemATSSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scorePickemATSSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scorePickemWeekATS(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score ATS picks');
  }
});

// ── Survivor Routes ──────────────────────────────────────────────────

// POST /api/pools/survivor/pick — Submit a survivor pick
poolRoutes.post('/survivor/pick', validateBody(survivorPickSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof survivorPickSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitSurvivorPick(body.leagueId, userId, body.weekNumber, body.pickedTeam);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit survivor pick');
  }
});

// GET /api/pools/survivor/:leagueId/standings
poolRoutes.get('/survivor/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const service = createPoolService(c);
    const standings = await service.getSurvivorStandings(leagueId);
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch survivor standings');
  }
});

// GET /api/pools/survivor/:leagueId/history?userId=X
poolRoutes.get('/survivor/:leagueId/history', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const history = await service.getSurvivorPickHistory(leagueId, userId);
    return ok(c, history);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch survivor history');
  }
});

// GET /api/pools/survivor/:leagueId/used-teams?userId=X
poolRoutes.get('/survivor/:leagueId/used-teams', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const teams = await service.getSurvivorUsedTeams(leagueId, userId);
    return ok(c, teams);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch used teams');
  }
});

// GET /api/pools/survivor/:leagueId/eliminated?userId=X
poolRoutes.get('/survivor/:leagueId/eliminated', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const eliminated = await service.checkSurvivorEliminated(leagueId, userId);
    return ok(c, { eliminated });
  } catch (err) {
    return handleError(c, err, 'Failed to check elimination status');
  }
});

// POST /api/pools/survivor/:leagueId/score — Score a week
poolRoutes.post('/survivor/:leagueId/score', membershipMiddleware, validateBody(scoreSurvivorSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scoreSurvivorSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scoreSurvivorWeek(leagueId, body.weekNumber, body.teamResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score survivor picks');
  }
});

// ── Confidence Routes ────────────────────────────────────────────────

// POST /api/pools/confidence/picks — Submit confidence picks
poolRoutes.post('/confidence/picks', validateBody(confidencePicksSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof confidencePicksSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitConfidencePicks(body.leagueId, userId, body.weekNumber, body.picks as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit confidence picks');
  }
});

// GET /api/pools/confidence/:leagueId/picks?week=N
poolRoutes.get('/confidence/:leagueId/picks', membershipMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const leagueId = c.req.param('leagueId');
    const week = parseInt(c.req.query('week') || '0', 10);
    if (!week) return c.json({ error: { code: 'BAD_REQUEST', message: 'week query param required' } }, 400);
    const service = createPoolService(c);
    const picks = await service.getConfidencePicks(leagueId, userId, week);
    return ok(c, picks);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch confidence picks');
  }
});

// GET /api/pools/confidence/:leagueId/standings
poolRoutes.get('/confidence/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const service = createPoolService(c);
    const standings = await service.getConfidenceStandings(leagueId);
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch confidence standings');
  }
});

// POST /api/pools/confidence/:leagueId/score — Score a week
poolRoutes.post('/confidence/:leagueId/score', membershipMiddleware, validateBody(scoreConfidenceSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scoreConfidenceSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scoreConfidenceWeek(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score confidence picks');
  }
});

// ── Commissioner: Declare Pool Winner ─────────────────────────────

poolRoutes.post('/:leagueId/declare-winner', async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId');
    const body = await c.req.json();
    const winnerId = body.winnerId;
    if (!winnerId) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'winnerId is required' } }, 400);
    }
    const supabase = createUserClient(c.get('userToken'));

    // Verify commissioner
    const { data: league } = await supabase
      .from('leagues')
      .select('commissioner_id')
      .eq('id', leagueId)
      .single();
    if (!league || league.commissioner_id !== userId) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Only the commissioner can declare a winner' } }, 403);
    }

    const { error } = await supabase
      .from('leagues')
      .update({
        pool_status: 'completed',
        pool_winner_id: winnerId,
        pool_winner_declared_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (error) throw error;
    return ok(c, { success: true, winnerId });
  } catch (err) {
    return handleError(c, err, 'Failed to declare winner');
  }
});

// ── Weekly Standings (all pool types) ─────────────────────────────

poolRoutes.get('/pickem/:leagueId/standings/weekly', async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const weekNumber = parseInt(c.req.query('week') || '0', 10);
    const supabase = createUserClient(c.get('userToken'));

    const query = supabase
      .from('pool_picks')
      .select('user_id, is_correct')
      .eq('league_id', leagueId);

    if (weekNumber > 0) {
      query.eq('week_number', weekNumber);
    }

    const { data: picks, error } = await query;
    if (error) throw error;

    // Aggregate by user
    const map = new Map<string, { correct: number; total: number }>();
    for (const p of (picks ?? [])) {
      if (!map.has(p.user_id)) map.set(p.user_id, { correct: 0, total: 0 });
      const e = map.get(p.user_id)!;
      e.total++;
      if (p.is_correct === true) e.correct++;
    }

    // Get display names
    const userIds = [...map.keys()];
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('id, username, first_name, last_name').in('id', userIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown']));

    const standings = [...map.entries()]
      .map(([uid, stats]) => ({
        user_id: uid,
        display_name: nameMap.get(uid) || 'Unknown',
        correct_picks: stats.correct,
        total_picks: stats.total,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
      }))
      .sort((a, b) => b.correct_picks - a.correct_picks || b.accuracy - a.accuracy);

    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch weekly standings');
  }
});

export { poolRoutes };
