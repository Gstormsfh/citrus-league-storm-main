import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * score-pools — Edge Function to score all pool types (Survivor, Pick'em, Confidence).
 *
 * Triggers:
 *   1. pg_cron via score-weekly-pools (Tuesdays 8 AM UTC)
 *   2. Commissioner "Score Week" button (manual POST)
 *   3. Direct invocation for testing
 *
 * Endpoints:
 *   POST /score-pools                     — Score the previous week (auto-detect)
 *   POST /score-pools?week=5              — Score a specific week
 *   POST /score-pools?league_id=...&week=5 — Score a specific league/week
 *   POST /score-pools?type=survivor&...   — Score only one pool type
 *
 * This function calls the SQL RPCs created in the scoring migration.
 * The actual scoring logic lives in Postgres for atomicity and performance.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function makeJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Calculate the current NHL week number.
 * Week 1 starts on the first Sunday on/after Oct 1, 2025.
 * Weeks run Sunday-Saturday (matching app-wide standard).
 */
function getCurrentWeekNumber(): number {
  const oct1 = new Date(2025, 9, 1); // October 1, 2025
  const dayOfWeek = oct1.getDay(); // 0=Sun, 1=Mon, ...
  // Find first Sunday on or after Oct 1
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = new Date(oct1);
  firstSunday.setDate(oct1.getDate() + daysUntilSunday);

  const now = new Date();
  const diffMs = now.getTime() - firstSunday.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const svc = createClient(supabaseUrl, supabaseServiceKey);

    // Parse parameters
    const url = new URL(req.url);
    const weekParam = url.searchParams.get("week");
    const leagueIdParam = url.searchParams.get("league_id");
    const typeParam = url.searchParams.get("type"); // survivor, pickem, confidence

    // Default: score the previous week (current week - 1)
    const weekNumber = weekParam
      ? parseInt(weekParam, 10)
      : getCurrentWeekNumber() - 1;

    if (weekNumber < 1) {
      return makeJsonResponse({ error: "Invalid week number", week: weekNumber }, 400);
    }

    const results: Array<{
      league_id: string;
      league_name: string;
      pool_type: string;
      scored_count: number;
    }> = [];

    if (leagueIdParam) {
      // Score specific league
      if (!typeParam || typeParam === "survivor") {
        const { data: survivorResults } = await svc.rpc("score_survivor_week", {
          p_league_id: leagueIdParam,
          p_week_number: weekNumber,
        });
        if (survivorResults && survivorResults.length > 0) {
          results.push({
            league_id: leagueIdParam,
            league_name: "",
            pool_type: "survivor",
            scored_count: survivorResults.length,
          });
        }
      }

      if (!typeParam || typeParam === "pickem") {
        const { data: pickemResults } = await svc.rpc("score_pickem_week", {
          p_league_id: leagueIdParam,
          p_week_number: weekNumber,
        });
        if (pickemResults && pickemResults.length > 0) {
          results.push({
            league_id: leagueIdParam,
            league_name: "",
            pool_type: "pickem",
            scored_count: pickemResults.length,
          });
        }
      }

      if (!typeParam || typeParam === "confidence") {
        const { data: confidenceResults } = await svc.rpc(
          "score_confidence_week",
          {
            p_league_id: leagueIdParam,
            p_week_number: weekNumber,
          }
        );
        if (confidenceResults && confidenceResults.length > 0) {
          results.push({
            league_id: leagueIdParam,
            league_name: "",
            pool_type: "confidence",
            scored_count: confidenceResults.length,
          });
        }
      }
    } else {
      // Score all leagues for the week
      const { data: allResults, error } = await svc.rpc(
        "score_all_pools_for_week",
        { p_week_number: weekNumber }
      );

      if (error) {
        console.error("score_all_pools_for_week error:", error);
        return makeJsonResponse({ error: error.message }, 500);
      }

      if (allResults) {
        for (const r of allResults) {
          results.push({
            league_id: r.league_id,
            league_name: r.league_name,
            pool_type: r.pool_type,
            scored_count: r.scored_count,
          });
        }
      }
    }

    const totalScored = results.reduce((sum, r) => sum + r.scored_count, 0);
    console.log(
      `Scored ${totalScored} pool entries across ${results.length} league/pool combos for week ${weekNumber}`
    );

    return makeJsonResponse({
      success: true,
      week: weekNumber,
      total_scored: totalScored,
      results,
    });
  } catch (error) {
    console.error("Error in score-pools:", error);
    return makeJsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
