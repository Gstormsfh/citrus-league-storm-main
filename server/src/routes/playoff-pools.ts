/**
 * Playoff Pool routes — bracket pickem, confidence, roster pools.
 *
 * All scoring uses ScoringCalculator with the league's scoring_settings,
 * giving commissioners full control over how points are awarded (goals only,
 * full fantasy, hits/blocks only, classic 2-1, anything they want).
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { ok, fail, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';

const playoffPoolRoutes = new Hono<Env>();
playoffPoolRoutes.use('*', authMiddleware);

// ─── BRACKET PICKEM ──────────────────────────────────────────────────────────

// POST /api/playoff-pools/bracket-pickem/picks
// Body: { leagueId, picks: [{ series_slot, picked_team_id, predicted_games }] }
playoffPoolRoutes.post('/bracket-pickem/picks', async (c) => {
  const body = await c.req.json();
  const { leagueId, picks } = body as { leagueId: string; picks: Array<{ series_slot: number; picked_team_id: number; predicted_games?: number }> };
  const userId = c.get('userId');

  if (!leagueId || !Array.isArray(picks) || picks.length === 0) {
    return fail(c, AppError.badRequest('leagueId and picks[] required'));
  }

  const supabase = createUserClient(c.get('userToken'));

  try {
    // Lock-mode contract: server must agree with the frontend's pickMode
    // gating logic (see PoolPlayoffBracket.tsx:166-171). When they
    // disagree, the UI accepts picks the server then rejects.
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();
    if (leagueErr || !league) {
      return fail(c, AppError.notFound('League'));
    }
    const settings = (league.settings as Record<string, unknown>) || {};
    const pickMode = (settings.playoffBracketPickMode as string) || 'round-by-round';
    const lockDeadline = settings.playoffRosterLockedAt as string | undefined;
    const isGloballyLocked =
      pickMode === 'full-bracket' &&
      !!lockDeadline &&
      new Date(lockDeadline) <= new Date();

    // Full-bracket pre-deadline: nothing is locked. Industry standard —
    // Yahoo, ESPN, CBS bracket pools all use deadline-only locking.
    // Full-bracket post-deadline OR round-by-round: anything not pending is locked.
    const lockedSeries =
      pickMode === 'full-bracket' && !isGloballyLocked
        ? []
        : (await supabaseAdmin
            .from('nhl_playoff_series')
            .select('bracket_slot')
            .neq('series_status', 'pending')).data ?? [];

    const lockedSlots = new Set((lockedSeries || []).map(s => s.bracket_slot));
    const allowedPicks = picks.filter(p => !lockedSlots.has(p.series_slot));
    if (allowedPicks.length === 0) {
      return fail(c, AppError.badRequest('All selected series are locked'));
    }

    const rows = allowedPicks.map(p => ({
      league_id: leagueId,
      user_id: userId,
      series_slot: p.series_slot,
      picked_team_id: p.picked_team_id,
      predicted_games: p.predicted_games ?? null,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('playoff_bracket_picks')
      .upsert(rows, { onConflict: 'league_id,user_id,series_slot' })
      .select();

    if (error) return handleError(c, error, 'Failed to save picks');
    return ok(c, { picks: data });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to save bracket picks');
  }
});

// ─── CONFIDENCE PICKS ────────────────────────────────────────────────────────

// POST /api/playoff-pools/confidence/picks
// Body: { leagueId, picks: [{ series_slot, picked_team_id, confidence_value }] }
playoffPoolRoutes.post('/confidence/picks', async (c) => {
  const body = await c.req.json();
  const { leagueId, picks } = body as { leagueId: string; picks: Array<{ series_slot: number; picked_team_id: number; confidence_value: number }> };
  const userId = c.get('userId');

  if (!leagueId || !Array.isArray(picks) || picks.length === 0) {
    return fail(c, AppError.badRequest('leagueId and picks[] required'));
  }

  // Validate confidence values are unique within the submission (server-side defense)
  const values = picks.map(p => p.confidence_value);
  if (new Set(values).size !== values.length) {
    return fail(c, AppError.badRequest('Confidence values must be unique'));
  }

  const supabase = createUserClient(c.get('userToken'));

  try {
    const rows = picks.map(p => ({
      league_id: leagueId,
      user_id: userId,
      series_slot: p.series_slot,
      picked_team_id: p.picked_team_id,
      confidence_value: p.confidence_value,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('playoff_confidence_picks')
      .upsert(rows, { onConflict: 'league_id,user_id,series_slot' })
      .select();

    if (error) return handleError(c, error, 'Failed to save confidence picks');
    return ok(c, { picks: data });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to save confidence picks');
  }
});

// ─── ROSTER POOL ─────────────────────────────────────────────────────────────

// POST /api/playoff-pools/roster
// Body: { leagueId, picks: [{ player_id, position_slot }] }
// NOTE: Multiple users CAN pick the same player. This is industry-standard for
// playoff pools (OfficePools, IrishHockeyPool). Each user picks INDEPENDENTLY.
playoffPoolRoutes.post('/roster', async (c) => {
  const body = await c.req.json();
  const { leagueId, picks } = body as { leagueId: string; picks: Array<{ player_id: number; position_slot: string }> };
  const userId = c.get('userId');

  if (!leagueId || !Array.isArray(picks) || picks.length === 0) {
    return fail(c, AppError.badRequest('leagueId and picks[] required'));
  }

  const supabase = createUserClient(c.get('userToken'));

  try {
    // Replace user's roster atomically: delete existing, insert new
    const { error: delError } = await supabase
      .from('playoff_roster_picks')
      .delete()
      .eq('league_id', leagueId)
      .eq('user_id', userId);
    if (delError) return handleError(c, delError, 'Failed to clear existing roster');

    const rows = picks.map(p => ({
      league_id: leagueId,
      user_id: userId,
      player_id: p.player_id,
      position_slot: p.position_slot,
    }));

    const { data, error } = await supabase
      .from('playoff_roster_picks')
      .insert(rows)
      .select();

    if (error) return handleError(c, error, 'Failed to save roster');
    return ok(c, { picks: data });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to save roster');
  }
});

// ─── STANDINGS ───────────────────────────────────────────────────────────────

// GET /api/playoff-pools/:leagueId/standings — leaderboard for a league
playoffPoolRoutes.get('/:leagueId/standings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  try {
    const { data, error } = await supabase
      .from('playoff_pool_standings')
      .select('user_id, total_points, correct_picks, current_rank, last_updated')
      .eq('league_id', leagueId)
      .order('current_rank', { ascending: true });

    if (error) return handleError(c, error, 'Failed to fetch standings');
    return ok(c, { standings: data || [] });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch standings');
  }
});

// GET /api/playoff-pools/:leagueId/picks?type=bracket|confidence|roster — fetch own + visible picks
playoffPoolRoutes.get('/:leagueId/picks', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const type = c.req.query('type') || 'bracket';
  const supabase = createUserClient(c.get('userToken'));

  const tableMap: Record<string, string> = {
    bracket: 'playoff_bracket_picks',
    confidence: 'playoff_confidence_picks',
    roster: 'playoff_roster_picks',
  };
  const table = tableMap[type];
  if (!table) return fail(c, AppError.badRequest('Invalid pick type'));

  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('league_id', leagueId);

    if (error) return handleError(c, error, 'Failed to fetch picks');
    return ok(c, { picks: data || [] });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch picks');
  }
});

export { playoffPoolRoutes };
