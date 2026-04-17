/**
 * NHL Playoff Bracket public API
 *
 * Public endpoints (no auth) for the NHL playoff bracket — drives top-of-funnel
 * signups by exposing a live bracket viewer to anyone. Pool features (picks,
 * standings) live in playoff-pools.ts and require auth.
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { supabaseAdmin } from '../lib/supabase';
import { ok, handleError } from '../lib/responses';
import { CURRENT_SEASON } from '@citrus/shared';

const nhlPlayoffsRoutes = new Hono<Env>();

// Public — no authMiddleware

// GET /api/nhl-playoffs/bracket?season=2025 — full bracket state
nhlPlayoffsRoutes.get('/bracket', async (c) => {
  const seasonParam = c.req.query('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : CURRENT_SEASON;

  try {
    const [seedsRes, seriesRes] = await Promise.all([
      supabaseAdmin
        .from('nhl_playoff_seeds')
        .select('id, season, conference, division, seed, team_id, team_abbrev, wins, losses, ot_losses, points, row_wins')
        .eq('season', season)
        .order('conference', { ascending: true })
        .order('seed', { ascending: true }),
      supabaseAdmin
        .from('nhl_playoff_series')
        .select('series_id, season, round, conference, bracket_slot, parent_slot_a, parent_slot_b, high_seed_team_id, low_seed_team_id, high_seed_wins, low_seed_wins, winner_team_id, games_played, series_status, starts_at, updated_at')
        .eq('season', season)
        .order('round', { ascending: true })
        .order('bracket_slot', { ascending: true }),
    ]);

    if (seedsRes.error) return handleError(c, seedsRes.error, 'Failed to fetch seeds');
    if (seriesRes.error) return handleError(c, seriesRes.error, 'Failed to fetch series');

    // Cache 30s — fresh enough for live viewing, lightens DB during traffic spikes
    c.header('Cache-Control', 'public, max-age=30');
    return ok(c, { season, seeds: seedsRes.data || [], series: seriesRes.data || [] });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch bracket');
  }
});

// GET /api/nhl-playoffs/series/:slot?season=2025 — single series detail with games
nhlPlayoffsRoutes.get('/series/:slot', async (c) => {
  const slot = parseInt(c.req.param('slot'), 10);
  const seasonParam = c.req.query('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : CURRENT_SEASON;

  try {
    const seriesRes = await supabaseAdmin
      .from('nhl_playoff_series')
      .select('*')
      .eq('season', season)
      .eq('bracket_slot', slot)
      .maybeSingle();

    if (seriesRes.error) return handleError(c, seriesRes.error, 'Failed to fetch series');
    if (!seriesRes.data) return c.json({ error: 'Series not found' }, 404);

    const gamesRes = await supabaseAdmin
      .from('nhl_games')
      .select('game_id, game_date, home_team, away_team, home_score, away_score, status, period, game_type, series_game_number')
      .eq('series_id', seriesRes.data.series_id)
      .order('series_game_number', { ascending: true });

    return ok(c, { series: seriesRes.data, games: gamesRes.data || [] });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch series');
  }
});

// GET /api/nhl-playoffs/h2h?season=2025 — Season H2H record for every playoff matchup
// Returns { [slot]: { high_wins, low_wins, games, high_abbrev, low_abbrev } }
nhlPlayoffsRoutes.get('/h2h', async (c) => {
  const seasonParam = c.req.query('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : CURRENT_SEASON;

  try {
    // Get all playoff series with both teams known
    const { data: seriesRows } = await supabaseAdmin
      .from('nhl_playoff_series')
      .select('bracket_slot, high_seed_team_id, low_seed_team_id')
      .eq('season', season)
      .not('high_seed_team_id', 'is', null)
      .not('low_seed_team_id', 'is', null);

    if (!seriesRows || seriesRows.length === 0) {
      return ok(c, { h2h: {} });
    }

    // Get team_id → abbrev lookup
    const { data: teams } = await supabaseAdmin
      .from('nhl_teams')
      .select('team_id, abbreviation');
    const idToAbbrev = new Map((teams || []).map(t => [t.team_id, t.abbreviation]));

    // Collect unique team pairs
    const pairs = new Set<string>();
    const slotPairs = new Map<number, { high: string; low: string }>();
    for (const s of seriesRows) {
      const hi = idToAbbrev.get(s.high_seed_team_id);
      const lo = idToAbbrev.get(s.low_seed_team_id);
      if (!hi || !lo) continue;
      pairs.add([hi, lo].sort().join('|'));
      slotPairs.set(s.bracket_slot, { high: hi, low: lo });
    }

    // Single query — all regular-season head-to-head games between any playoff teams
    const allAbbrevs = Array.from(new Set(Array.from(slotPairs.values()).flatMap(p => [p.high, p.low])));
    const { data: games } = await supabaseAdmin
      .from('nhl_games')
      .select('home_team, away_team, home_score, away_score')
      .eq('status', 'final')
      .eq('season', season)
      .eq('game_type', 'regular')
      .in('home_team', allAbbrevs)
      .in('away_team', allAbbrevs)
      .range(0, 4999);

    // Build H2H per slot
    const h2h: Record<number, { high_wins: number; low_wins: number; games: number; high_abbrev: string; low_abbrev: string }> = {};
    for (const [slot, pair] of slotPairs) {
      let highWins = 0, lowWins = 0, total = 0;
      for (const g of games || []) {
        const hiInvolved = g.home_team === pair.high || g.away_team === pair.high;
        const loInvolved = g.home_team === pair.low || g.away_team === pair.low;
        if (!hiInvolved || !loInvolved) continue;
        total++;
        const winner = g.home_score > g.away_score ? g.home_team : g.away_team;
        if (winner === pair.high) highWins++;
        else if (winner === pair.low) lowWins++;
      }
      h2h[slot] = { high_wins: highWins, low_wins: lowWins, games: total, high_abbrev: pair.high, low_abbrev: pair.low };
    }

    c.header('Cache-Control', 'public, max-age=300'); // 5 min
    return ok(c, { h2h });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch H2H');
  }
});

// GET /api/nhl-playoffs/meta — data freshness for stale-data UI badge
nhlPlayoffsRoutes.get('/meta', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nhl_pipeline_meta')
      .select('key, last_refresh');

    if (error) return handleError(c, error, 'Failed to fetch meta');

    const meta: Record<string, string> = {};
    let oldestRefresh: string | null = null;
    for (const row of data || []) {
      meta[row.key] = row.last_refresh;
      if (!oldestRefresh || row.last_refresh < oldestRefresh) {
        oldestRefresh = row.last_refresh;
      }
    }
    return ok(c, { meta, oldest_refresh: oldestRefresh });
  } catch (err) {
    return handleError(c, err as Error, 'Failed to fetch meta');
  }
});

export { nhlPlayoffsRoutes };
