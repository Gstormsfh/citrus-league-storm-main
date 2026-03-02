import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const matchupRoutes = new Hono<Env>();

matchupRoutes.use('*', authMiddleware);

// GET /api/matchups/league/:leagueId — Get all matchups for a league
matchupRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const week = c.req.query('week');
  const supabase = createUserClient(c.get('userToken'));

  let query = supabase
    .from('matchups')
    .select(COLUMNS.MATCHUP)
    .eq('league_id', leagueId)
    .order('week_number', { ascending: true });

  if (week) {
    query = query.eq('week_number', parseInt(week, 10));
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/matchups/:matchupId — Get a specific matchup with lines
matchupRoutes.get('/:matchupId', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));

  const { data: matchup, error: matchupError } = await supabase
    .from('matchups')
    .select(COLUMNS.MATCHUP)
    .eq('id', matchupId)
    .single();

  if (matchupError) {
    return c.json({ error: 'Matchup not found' }, 404);
  }

  const { data: lines, error: linesError } = await supabase
    .from('fantasy_matchup_lines')
    .select(COLUMNS.MATCHUP_LINES)
    .eq('matchup_id', matchupId);

  if (linesError) {
    return c.json({ error: linesError.message }, 500);
  }

  return c.json({ data: Object.assign({}, matchup, { lines: lines || [] }) });
});

// GET /api/matchups/:matchupId/scores — Get matchup scores
matchupRoutes.get('/:matchupId/scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('fantasy_matchup_lines')
    .select(COLUMNS.MATCHUP_LINES)
    .eq('matchup_id', matchupId)
    .order('total_points', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

export { matchupRoutes };
