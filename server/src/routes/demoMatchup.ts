/**
 * Demo matchup payload — GET /api/demo/matchup[?week=N]
 *
 * Chunk 11g.9 (2026-08-24): ported from the `demo-matchup-cache`
 * Supabase Edge Function, which is now retired.
 *
 * Serves the whole guest Matchup page payload from one warm in-process
 * cache (5-min TTL) so an unauthenticated visitor costs one cached JSON
 * read instead of a fan-out of queries.
 *
 * ── WHY THIS IS BETTER ON THE SERVER THAN AT THE EDGE ──────────────
 *
 * The Edge Function's in-memory cache was per-isolate. Supabase spins
 * up isolates per region and recycles them aggressively, so N isolates
 * meant N independent cold caches and N duplicate payload builds — the
 * cache hit rate was structurally worse than it looked. The API server
 * runs on Cloud Run with `--min-instances=1 --no-cpu-throttling`
 * (see .github/workflows/production-deploy.yml), so this cache is warm,
 * shared across every request that instance serves, and survives
 * between requests instead of being rebuilt per isolate.
 *
 * ── BUG FIXED IN THE PORT ──────────────────────────────────────────
 *
 * The Edge Function selected `id` and `status` from `player_directory`.
 * That table has NEITHER — it is keyed (season, player_id) and has no
 * status column (verified against production 2026-08-24). PostgREST
 * rejected the whole select with 42703, so `players` came back `[]` on
 * every single request since the function was deployed.
 *
 * Impact was nil, because the client never reads `payload.players` —
 * `Matchup.tsx` calls `PlayerService.getAllPlayers()` separately and
 * builds rosters through `MatchupService.getMatchupRosters`. The field
 * is fixed here rather than removed so the declared `DemoMatchupPayload`
 * contract keeps its shape.
 *
 * FOLLOW-UP worth taking: `players` and `playerStats` have no consumer.
 * Dropping both from the payload would cut real bytes and two queries
 * per cache miss on the highest-traffic unauthenticated path in the
 * product. Left in place here because changing a response contract is a
 * separate decision from fixing a broken query.
 *
 * Auth: none. This is public, guest-facing data for a single fixed demo
 * league. It is still covered by the `/api/*` standardRateLimit.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { supabaseAdmin } from '../lib/supabase';
import { ok, fail } from '../lib/responses';
import { AppError } from '../lib/errors';

const demoMatchupRoutes = new Hono<Env>();

const DEMO_LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_WEEKS = 5;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

/**
 * Process-wide cache, keyed by week. Module scope on purpose: it must
 * outlive the request, and on min-instances=1 it stays warm.
 */
const cache = new Map<number, CacheEntry>();

/** Exported for tests — lets a suite start from a known-cold cache. */
export function __clearDemoMatchupCache(): void {
  cache.clear();
}

demoMatchupRoutes.get('/matchup', async (c) => {
  try {
    const weekParam = c.req.query('week');
    const requestedWeek = weekParam ? Number.parseInt(weekParam, 10) : NaN;

    let week = Number.isFinite(requestedWeek) && requestedWeek > 0 ? requestedWeek : null;

    if (week === null) {
      const { data: latestMatchup } = await supabaseAdmin
        .from('matchups')
        .select('week_number')
        .eq('league_id', DEMO_LEAGUE_ID)
        .order('week_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      week = (latestMatchup?.week_number as number | undefined) ?? 1;
    }

    const cached = cache.get(week);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      c.header('Cache-Control', 'public, max-age=300');
      c.header('X-Cache', 'HIT');
      return ok(c, cached.data);
    }

    const payload = await buildDemoPayload(week);
    cache.set(week, { data: payload, timestamp: Date.now() });

    // Evict the oldest entry beyond the cap.
    if (cache.size > MAX_CACHED_WEEKS) {
      let oldestKey: number | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, val] of cache.entries()) {
        if (val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) cache.delete(oldestKey);
    }

    c.header('Cache-Control', 'public, max-age=300');
    c.header('X-Cache', 'MISS');
    return ok(c, payload);
  } catch (err) {
    console.error('[demo-matchup] Error:', err);
    return fail(c, AppError.serviceUnavailable('Failed to build demo payload'));
  }
});

/**
 * Build the full demo matchup payload — everything the guest Matchup
 * page needs in a single response.
 */
async function buildDemoPayload(week: number) {
  const { data: league, error: leagueError } = await supabaseAdmin
    .from('leagues')
    .select(
      'id, name, commissioner_id, draft_status, roster_size, draft_rounds, settings, scoring_settings, scheduled_draft_time, created_at, updated_at',
    )
    .eq('id', DEMO_LEAGUE_ID)
    .single();

  if (leagueError || !league) {
    throw new Error(`Demo league not found: ${leagueError?.message}`);
  }

  const { data: weekMatchups, error: matchupsError } = await supabaseAdmin
    .from('matchups')
    .select(
      'id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date, created_at, updated_at',
    )
    .eq('league_id', DEMO_LEAGUE_ID)
    .eq('week_number', week)
    .order('created_at', { ascending: true });

  if (matchupsError || !weekMatchups?.length) {
    throw new Error(`No matchups for week ${week}: ${matchupsError?.message}`);
  }

  const primaryMatchup = weekMatchups[0] as Record<string, any>;

  const teamCols = 'id, league_id, owner_id, team_name, created_at, updated_at';
  const [team1Result, team2Result] = await Promise.all([
    supabaseAdmin.from('teams').select(teamCols).eq('id', primaryMatchup.team1_id).single(),
    primaryMatchup.team2_id
      ? supabaseAdmin.from('teams').select(teamCols).eq('id', primaryMatchup.team2_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (team1Result.error) {
    throw new Error(`Team1 fetch failed: ${team1Result.error.message}`);
  }

  const lineupCols = 'starters, bench, ir, slot_assignments';
  const [team1Lineup, team2Lineup] = await Promise.all([
    supabaseAdmin
      .from('team_lineups')
      .select(lineupCols)
      .eq('team_id', primaryMatchup.team1_id)
      .eq('league_id', DEMO_LEAGUE_ID)
      .maybeSingle(),
    primaryMatchup.team2_id
      ? supabaseAdmin
          .from('team_lineups')
          .select(lineupCols)
          .eq('team_id', primaryMatchup.team2_id)
          .eq('league_id', DEMO_LEAGUE_ID)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Collect every rostered player id across both lineups.
  const allPlayerIds = new Set<string>();
  for (const lineup of [team1Lineup.data, team2Lineup.data]) {
    if (!lineup) continue;
    const l = lineup as Record<string, unknown>;
    for (const arr of [l.starters, l.bench, l.ir]) {
      if (Array.isArray(arr)) {
        for (const id of arr) if (id) allPlayerIds.add(String(id));
      }
    }
  }

  const playerIds = Array.from(allPlayerIds);
  let players: Record<string, unknown>[] = [];
  let playerStats: Record<string, unknown>[] = [];

  if (playerIds.length > 0) {
    // player_directory keys on player_id (NOT id) and has no status
    // column. Numeric coercion because lineup arrays store ids as
    // strings while the column is an integer.
    const numericIds = playerIds
      .map((id) => Number.parseInt(id, 10))
      .filter((n) => Number.isFinite(n));

    const [playersResult, statsResult] = await Promise.all([
      supabaseAdmin
        .from('player_directory')
        .select('player_id, season, full_name, position_code, team_abbrev, jersey_number, headshot_url')
        .in('player_id', numericIds.length ? numericIds : [-1]),
      supabaseAdmin
        .from('player_season_stats')
        .select(
          'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, total_projected_points',
        )
        .in('player_id', playerIds),
    ]);

    // player_directory is keyed (season, player_id) and carries a row
    // for the upcoming season too — collapse to the newest row per
    // player so the payload has one entry each, and expose `id`
    // alongside `player_id` so either key works for a consumer.
    const newestByPlayer = new Map<number, Record<string, unknown>>();
    for (const row of (playersResult.data ?? []) as Array<Record<string, unknown>>) {
      const pid = row.player_id as number;
      const prev = newestByPlayer.get(pid);
      if (!prev || (row.season as number) > (prev.season as number)) {
        newestByPlayer.set(pid, row);
      }
    }
    players = Array.from(newestByPlayer.values()).map((row) => ({ ...row, id: row.player_id }));
    playerStats = (statsResult.data ?? []) as Record<string, unknown>[];
  }

  // Daily scores for both teams.
  let team1DailyScores: unknown[] = [];
  let team2DailyScores: unknown[] = [];

  if (primaryMatchup.week_start_date && primaryMatchup.week_end_date) {
    const dailyScorePromises = [
      supabaseAdmin.rpc('calculate_daily_matchup_scores', {
        p_matchup_id: primaryMatchup.id,
        p_team_id: primaryMatchup.team1_id,
        p_week_start: primaryMatchup.week_start_date,
        p_week_end: primaryMatchup.week_end_date,
      }),
    ];

    if (primaryMatchup.team2_id) {
      dailyScorePromises.push(
        supabaseAdmin.rpc('calculate_daily_matchup_scores', {
          p_matchup_id: primaryMatchup.id,
          p_team_id: primaryMatchup.team2_id,
          p_week_start: primaryMatchup.week_start_date,
          p_week_end: primaryMatchup.week_end_date,
        }),
      );
    }

    const [t1Scores, t2Scores] = await Promise.all(dailyScorePromises);
    team1DailyScores = (t1Scores as { data?: unknown[] })?.data ?? [];
    team2DailyScores = (t2Scores as { data?: unknown[] } | undefined)?.data ?? [];
  }

  const { data: allWeeksData } = await supabaseAdmin
    .from('matchups')
    .select('week_number')
    .eq('league_id', DEMO_LEAGUE_ID)
    .order('week_number', { ascending: true });

  const availableWeeks = [
    ...new Set(((allWeeksData ?? []) as Array<{ week_number: number }>).map((m) => m.week_number)),
  ];

  return {
    league,
    matchup: primaryMatchup,
    allWeekMatchups: weekMatchups,
    team1: team1Result.data,
    team2: team2Result.data,
    team1Lineup: team1Lineup.data,
    team2Lineup: team2Lineup.data,
    players,
    playerStats,
    team1DailyScores,
    team2DailyScores,
    availableWeeks,
    week,
    cachedAt: new Date().toISOString(),
  };
}

export { demoMatchupRoutes };
