import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * demo-matchup-cache — Edge Function that serves the full demo matchup payload
 * from an in-memory cache, reducing per-guest-visit queries from ~16 to 1.
 *
 * At 10,000 concurrent guests this avoids 160,000 DB queries and instead
 * serves a single pre-built JSON blob refreshed every 5 minutes.
 *
 * GET /demo-matchup-cache              — Current week matchup
 * GET /demo-matchup-cache?week=3       — Specific week matchup
 */

const DEMO_LEAGUE_ID = "750f4e1a-92ae-44cf-a798-2f3e06d0d5c9";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Allowed origins — restrict CORS to known deployment URLs only
const ALLOWED_ORIGINS = [
  "https://citrusfantasysports.com",
  "https://www.citrusfantasysports.com",
  "https://citrus-fantasy-sports.web.app",
  "https://citrus-fantasy-sports.firebaseapp.com",
  "https://citrus-fantasy-prod.web.app",
  "https://citrus-fantasy-prod.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsHeaders(origin: string): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

// In-memory cache: keyed by week number
const cache = new Map<number, { data: unknown; timestamp: number }>();

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const weekParam = url.searchParams.get("week");
    const requestedWeek = weekParam ? parseInt(weekParam, 10) : null;

    // Create Supabase client with service role for unrestricted reads
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine which week to serve
    let week = requestedWeek;

    // If no week requested, find the latest week with matchups
    if (!week || isNaN(week)) {
      const { data: latestMatchup } = await supabase
        .from("matchups")
        .select("week_number")
        .eq("league_id", DEMO_LEAGUE_ID)
        .order("week_number", { ascending: false })
        .limit(1)
        .single();

      week = latestMatchup?.week_number ?? 1;
    }

    // Check cache
    const cached = cache.get(week);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300", // Browser cache 5 min too
          "X-Cache": "HIT",
        },
      });
    }

    // Cache miss — build the full payload
    const payload = await buildDemoPayload(supabase, week);

    // Store in memory cache
    cache.set(week, { data: payload, timestamp: Date.now() });

    // Evict stale entries (keep max 5 weeks cached)
    if (cache.size > 5) {
      let oldest: number | null = null;
      let oldestTime = Infinity;
      for (const [key, val] of cache.entries()) {
        if (val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldest = key;
        }
      }
      if (oldest !== null) cache.delete(oldest);
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("[demo-matchup-cache] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to build demo payload" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Build the full demo matchup payload — everything the guest Matchup page needs
 * in a single response. Replaces ~16 individual client queries.
 */
async function buildDemoPayload(supabase: ReturnType<typeof createClient>, week: number) {
  // 1. League data
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, commissioner_id, draft_status, roster_size, draft_rounds, settings, scoring_settings, scheduled_draft_time, created_at, updated_at")
    .eq("id", DEMO_LEAGUE_ID)
    .single();

  if (leagueError || !league) {
    throw new Error(`Demo league not found: ${leagueError?.message}`);
  }

  // 2. All matchups for this week
  const { data: weekMatchups, error: matchupsError } = await supabase
    .from("matchups")
    .select("id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date, created_at, updated_at")
    .eq("league_id", DEMO_LEAGUE_ID)
    .eq("week_number", week)
    .order("created_at", { ascending: true });

  if (matchupsError || !weekMatchups?.length) {
    throw new Error(`No matchups for week ${week}: ${matchupsError?.message}`);
  }

  const primaryMatchup = weekMatchups[0];

  // 3. Both teams (parallel)
  const [team1Result, team2Result] = await Promise.all([
    supabase.from("teams").select("id, league_id, owner_id, team_name, created_at, updated_at").eq("id", primaryMatchup.team1_id).single(),
    primaryMatchup.team2_id
      ? supabase.from("teams").select("id, league_id, owner_id, team_name, created_at, updated_at").eq("id", primaryMatchup.team2_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (team1Result.error) throw new Error(`Team1 fetch failed: ${team1Result.error.message}`);

  // 4. Lineups for both teams (parallel)
  const [team1Lineup, team2Lineup] = await Promise.all([
    supabase.from("team_lineups").select("starters, bench, ir, slot_assignments").eq("team_id", primaryMatchup.team1_id).eq("league_id", DEMO_LEAGUE_ID).maybeSingle(),
    primaryMatchup.team2_id
      ? supabase.from("team_lineups").select("starters, bench, ir, slot_assignments").eq("team_id", primaryMatchup.team2_id).eq("league_id", DEMO_LEAGUE_ID).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // 5. Collect all player IDs from both lineups
  const allPlayerIds = new Set<string>();
  for (const lineup of [team1Lineup.data, team2Lineup.data]) {
    if (!lineup) continue;
    for (const arr of [lineup.starters, lineup.bench, lineup.ir]) {
      if (Array.isArray(arr)) {
        arr.forEach((id: string) => { if (id) allPlayerIds.add(String(id)); });
      }
    }
  }

  // 6. Fetch player data + stats for all rostered players in one batch
  const playerIds = Array.from(allPlayerIds);
  let players: Record<string, unknown>[] = [];
  let playerStats: Record<string, unknown>[] = [];

  if (playerIds.length > 0) {
    const [playersResult, statsResult] = await Promise.all([
      supabase
        .from("player_directory")
        .select("id, full_name, position_code, team_abbrev, jersey_number, headshot_url, status")
        .in("id", playerIds),
      supabase
        .from("player_season_stats")
        .select("player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, total_projected_points")
        .in("player_id", playerIds),
    ]);

    players = playersResult.data || [];
    playerStats = statsResult.data || [];
  }

  // 7. Daily scores for both teams (parallel, if RPC exists)
  let team1DailyScores: unknown[] = [];
  let team2DailyScores: unknown[] = [];

  if (primaryMatchup.week_start_date && primaryMatchup.week_end_date) {
    const dailyScorePromises = [
      supabase.rpc("calculate_daily_matchup_scores", {
        p_matchup_id: primaryMatchup.id,
        p_team_id: primaryMatchup.team1_id,
        p_week_start: primaryMatchup.week_start_date,
        p_week_end: primaryMatchup.week_end_date,
      }).then((r: { data: unknown; error: unknown }) => r),
    ];

    if (primaryMatchup.team2_id) {
      dailyScorePromises.push(
        supabase.rpc("calculate_daily_matchup_scores", {
          p_matchup_id: primaryMatchup.id,
          p_team_id: primaryMatchup.team2_id,
          p_week_start: primaryMatchup.week_start_date,
          p_week_end: primaryMatchup.week_end_date,
        }).then((r: { data: unknown; error: unknown }) => r),
      );
    }

    const [t1Scores, t2Scores] = await Promise.all(dailyScorePromises);
    team1DailyScores = (t1Scores as any)?.data || [];
    team2DailyScores = (t2Scores as any)?.data || [];
  }

  // 8. Available weeks (for the week picker)
  const { data: allWeeksData } = await supabase
    .from("matchups")
    .select("week_number")
    .eq("league_id", DEMO_LEAGUE_ID)
    .order("week_number", { ascending: true });

  const availableWeeks = [...new Set((allWeeksData || []).map((m: any) => m.week_number))];

  // Build the complete payload
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
