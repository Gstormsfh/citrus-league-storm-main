import { Hono } from 'hono';
import type { Env } from '../app';
import { getSupabaseAdmin } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, COLUMNS } from '@citrus/shared';

/**
 * Public routes — no authentication required.
 * Restricted to read-only access on the demo league only.
 *
 * These endpoints allow guest users to view the demo matchup page
 * without signing in. All queries use the admin client (bypasses RLS)
 * but are hard-gated to the DEMO_LEAGUE_ID.
 */

const DEMO_LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

const publicRoutes = new Hono<Env>();

function isDemoLeague(leagueId: string): boolean {
  return leagueId === DEMO_LEAGUE_ID;
}

// GET /api/public/matchups/league/:leagueId — Demo league matchups
publicRoutes.get('/matchups/league/:leagueId', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const week = c.req.query('week');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  const { matchups, error } = await service.getLeagueMatchups(
    leagueId,
    week ? parseInt(week, 10) : undefined,
  );

  if (error) {
    return handleError(c, error, 'Failed to fetch demo matchups');
  }

  return ok(c, matchups);
});

// GET /api/public/leagues/:leagueId — Demo league info
publicRoutes.get('/leagues/:leagueId', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('leagues')
    .select(COLUMNS.LEAGUE)
    .eq('id', leagueId)
    .single();

  if (error) {
    return handleError(c, error, 'Failed to fetch demo league');
  }

  return ok(c, data);
});

// GET /api/public/leagues/:leagueId/teams — Demo league teams
publicRoutes.get('/leagues/:leagueId/teams', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('teams')
    .select(COLUMNS.TEAM)
    .eq('league_id', leagueId);

  if (error) {
    return handleError(c, error, 'Failed to fetch demo teams');
  }

  return ok(c, data || []);
});

// GET /api/public/leagues/:leagueId/teams/:teamId/player-ids — Demo team roster player IDs
publicRoutes.get('/leagues/:leagueId/teams/:teamId/player-ids', async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    if (!isDemoLeague(leagueId)) {
      return fail(c, AppError.forbidden('Public access is only available for the demo league'));
    }

    const teamId = c.req.param('teamId');
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId);

    if (error) {
      return handleError(c, error, 'Failed to fetch demo roster');
    }

    const playerIds = (data || []).map((r: { player_id: string }) => r.player_id);
    return ok(c, playerIds);
  } catch (err) {
    logger.error('[public] player-ids error:', err);
    return handleError(c, err, 'Failed to fetch player IDs');
  }
});

// GET /api/public/matchups/:matchupId/daily-scores — Demo matchup daily scores
publicRoutes.get('/matchups/:matchupId/daily-scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  // Verify this matchup belongs to the demo league
  const { matchup, error: matchupError } = await service.getMatchup(matchupId);
  if (matchupError || !matchup) {
    return fail(c, AppError.notFound('Matchup'));
  }
  if (!isDemoLeague((matchup as any).league_id)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  // Auto-ensure rosters for AI teams
  try {
    await service.ensureMatchupRosters(matchupId);
  } catch (err) {
    logger.debug('[public] ensureMatchupRosters non-fatal error:', err);
  }

  const { data, error } = await service.calculateDailyMatchupScores(matchupId);
  if (error) {
    return handleError(c, error, 'Failed to calculate demo scores');
  }

  return ok(c, data);
});

// GET /api/public/matchups/:matchupId — Demo matchup with lines
publicRoutes.get('/matchups/:matchupId', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  const { matchup, lines, error } = await service.getMatchupWithLines(matchupId);
  if (error || !matchup) {
    return fail(c, AppError.notFound('Matchup'));
  }
  if (!isDemoLeague((matchup as any).league_id)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  return ok(c, { ...matchup, lines });
});

// POST /api/public/matchups/matchup-stats — Get weekly matchup stats (demo league only)
publicRoutes.post('/matchups/matchup-stats', async (c) => {
  let body: { playerIds?: number[]; startDate?: string; endDate?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  if (!body.playerIds?.length || !body.startDate || !body.endDate) {
    return fail(c, AppError.badRequest('playerIds, startDate, and endDate are required'));
  }

  const supabase = getSupabaseAdmin();
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

// POST /api/public/waitlist — Add email to waitlist (no auth required)
/** Bounded, plain-object payload for a lead-gen source (2026-09-09). */
function cleanMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = JSON.stringify(raw);
  if (text.length > 4000) return null;
  return JSON.parse(text) as Record<string, unknown>;
}

publicRoutes.post('/waitlist', async (c) => {
  let body: { email?: string; source?: string; metadata?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(c, AppError.badRequest('Please enter a valid email address'));
  }
  const source = (body.source || 'landing_page').slice(0, 64);
  const metadata = cleanMetadata(body.metadata);

  const supabase = getSupabaseAdmin();

  // 2026-09-09: a source that carries a payload (the Opening Night pick'em,
  // Bring Your League) must work for someone already on the list, so it
  // merges into the existing row instead of bouncing off UNIQUE(email).
  if (metadata) {
    const { data: existing } = await supabase.from('waitlist').select('id, metadata').eq('email', email).maybeSingle();
    const merged = { ...((existing?.metadata as Record<string, unknown> | null) ?? {}), [source]: { ...metadata, at: new Date().toISOString() } };
    const { error } = existing
      ? await supabase.from('waitlist').update({ metadata: merged, updated_at: new Date().toISOString() }).eq('id', existing.id)
      : await supabase.from('waitlist').insert({ email, source, metadata: merged });
    if (error) return handleError(c, error, 'Failed to save your entry');
    return ok(c, { success: true, message: existing ? "You're in. We've saved your entry." : "You're in. We'll email you the moment the app is live." });
  }

  const { error } = await supabase
    .from('waitlist')
    .insert({ email, source });

  if (error) {
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      return c.json({ data: { success: false, message: 'This email is already on the waitlist!' } });
    }
    return handleError(c, error, 'Failed to add to waitlist');
  }

  return ok(c, { success: true, message: "Successfully added to waitlist! We'll notify you when we launch." });
});

/**
 * GET /api/public/schedule/opening-night (2026-09-09): the first date on or
 * after today with scheduled games, and those games. The Opening Night
 * pick'em page draws from this so nothing about the date is hardcoded; when
 * the schedule is not loaded yet it answers { date: null, games: [] } and
 * the page falls back to plain email capture.
 */
publicRoutes.get('/schedule/opening-night', async (c) => {
  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const { data: first, error: e1 } = await supabase
    .from('nhl_games')
    .select('game_date')
    .gte('game_date', today)
    .eq('status', 'scheduled')
    .order('game_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (e1) return handleError(c, e1, 'Failed to fetch the schedule');
  if (!first?.game_date) return ok(c, { date: null, games: [] });
  const { data: games, error: e2 } = await supabase
    .from('nhl_games')
    .select('game_id, game_time, home_team, away_team, venue')
    .eq('game_date', first.game_date)
    .eq('status', 'scheduled')
    .order('game_time', { ascending: true });
  if (e2) return handleError(c, e2, 'Failed to fetch the schedule');
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  return ok(c, { date: first.game_date, games: games ?? [] });
});

// GET /api/public/schedule/games — Public game schedule (for GameLockService)
publicRoutes.get('/schedule/games', async (c) => {
  const date = c.req.query('date');
  const teams = c.req.query('teams');
  if (!date) {
    return fail(c, AppError.badRequest('date query parameter required'));
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('nhl_games')
    .select('game_time, status, home_team, away_team, game_date')
    .eq('game_date', date)
    .in('status', ['scheduled', 'live', 'final']);

  if (teams) {
    const teamList = teams.split(',');
    const orConditions = teamList
      .map(team => `home_team.eq.${team},away_team.eq.${team}`)
      .join(',');
    query = query.or(orConditions);
  }

  const { data, error } = await query;
  if (error) {
    return handleError(c, error, 'Failed to fetch games');
  }

  return ok(c, data || []);
});

export { publicRoutes };
