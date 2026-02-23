import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * fetch-spreads — Edge Function to fetch NHL puck lines from The Odds API.
 *
 * Endpoints:
 *   POST /fetch-spreads          — Fetch today's spreads (manual or cron trigger)
 *   POST /fetch-spreads?date=... — Fetch spreads for a specific date
 *
 * The Odds API (free tier):
 *   - 500 requests/month
 *   - icehockey_nhl sport key
 *   - spreads market = puck lines
 *   - 1 API call returns all games for the sport
 *
 * Environment variables needed:
 *   - THE_ODDS_API_KEY: API key from https://the-odds-api.com
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The Odds API configuration
const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports";
const SPORT_KEY = "icehockey_nhl";
const REGIONS = "us";       // US bookmakers
const MARKETS = "spreads,h2h,totals";  // puck lines + moneyline + totals
const ODDS_FORMAT = "american";

// Team name → NHL abbreviation mapping
// The Odds API uses full team names; we need abbreviations for our DB
const TEAM_NAME_TO_ABBREV: Record<string, string> = {
  "Anaheim Ducks": "ANA",
  "Arizona Coyotes": "ARI",
  "Boston Bruins": "BOS",
  "Buffalo Sabres": "BUF",
  "Calgary Flames": "CGY",
  "Carolina Hurricanes": "CAR",
  "Chicago Blackhawks": "CHI",
  "Colorado Avalanche": "COL",
  "Columbus Blue Jackets": "CBJ",
  "Dallas Stars": "DAL",
  "Detroit Red Wings": "DET",
  "Edmonton Oilers": "EDM",
  "Florida Panthers": "FLA",
  "Los Angeles Kings": "LAK",
  "Minnesota Wild": "MIN",
  "Montreal Canadiens": "MTL",
  "Nashville Predators": "NSH",
  "New Jersey Devils": "NJD",
  "New York Islanders": "NYI",
  "New York Rangers": "NYR",
  "Ottawa Senators": "OTT",
  "Philadelphia Flyers": "PHI",
  "Pittsburgh Penguins": "PIT",
  "San Jose Sharks": "SJS",
  "Seattle Kraken": "SEA",
  "St. Louis Blues": "STL",
  "St Louis Blues": "STL",
  "Tampa Bay Lightning": "TBL",
  "Toronto Maple Leafs": "TOR",
  "Utah Hockey Club": "UTA",
  "Vancouver Canucks": "VAN",
  "Vegas Golden Knights": "VGK",
  "Washington Capitals": "WSH",
  "Winnipeg Jets": "WPG",
};

function teamAbbrev(fullName: string): string {
  return TEAM_NAME_TO_ABBREV[fullName] || fullName.substring(0, 3).toUpperCase();
}

function makeJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const API_KEY = Deno.env.get("THE_ODDS_API_KEY");
    if (!API_KEY) {
      console.error("THE_ODDS_API_KEY not set");
      return makeJsonResponse({
        error: "Odds API key not configured. Set THE_ODDS_API_KEY in Supabase secrets.",
        setup: "supabase secrets set THE_ODDS_API_KEY=your_key_here",
      }, 503);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const svc = createClient(supabaseUrl, supabaseServiceKey);

    // Parse optional date parameter
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date"); // YYYY-MM-DD

    // Fetch odds from The Odds API
    const oddsUrl = `${ODDS_API_BASE}/${SPORT_KEY}/odds?apiKey=${API_KEY}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=${ODDS_FORMAT}`;
    console.log(`Fetching NHL spreads from The Odds API...`);

    const oddsResponse = await fetch(oddsUrl);
    if (!oddsResponse.ok) {
      const errText = await oddsResponse.text();
      console.error("Odds API error:", oddsResponse.status, errText);
      return makeJsonResponse({
        error: `Odds API returned ${oddsResponse.status}`,
        details: errText,
      }, 502);
    }

    // Log remaining API requests (returned in headers)
    const remaining = oddsResponse.headers.get("x-requests-remaining");
    const used = oddsResponse.headers.get("x-requests-used");
    console.log(`Odds API usage: ${used} used, ${remaining} remaining this month`);

    const events: OddsEvent[] = await oddsResponse.json();
    console.log(`Received ${events.length} NHL events with odds`);

    // Filter by date if specified
    let filteredEvents = events;
    if (dateParam) {
      filteredEvents = events.filter((e) => {
        const eventDate = new Date(e.commence_time)
          .toISOString()
          .split("T")[0];
        return eventDate === dateParam;
      });
      console.log(`Filtered to ${filteredEvents.length} events for ${dateParam}`);
    }

    // Process each event and build spread rows
    const spreadRows: Array<Record<string, unknown>> = [];

    for (const event of filteredEvents) {
      const homeAbbrev = teamAbbrev(event.home_team);
      const awayAbbrev = teamAbbrev(event.away_team);
      const gameDate = new Date(event.commence_time).toISOString().split("T")[0];

      // Try to match to an nhl_games row
      const { data: nhlGame } = await svc
        .from("nhl_games")
        .select("id")
        .eq("game_date", gameDate)
        .eq("home_team", homeAbbrev)
        .eq("away_team", awayAbbrev)
        .maybeSingle();

      const gameId = nhlGame?.id || `${gameDate}_${awayAbbrev}_${homeAbbrev}`;

      // Extract consensus odds (use first available bookmaker, or average)
      let homeSpread = -1.5; // NHL standard puck line default
      let awaySpread = 1.5;
      let homeMoneyline: number | null = null;
      let awayMoneyline: number | null = null;
      let overUnder: number | null = null;

      if (event.bookmakers.length > 0) {
        // Use first bookmaker as primary (typically FanDuel or DraftKings)
        const book = event.bookmakers[0];

        for (const market of book.markets) {
          if (market.key === "spreads") {
            const homeOutcome = market.outcomes.find(
              (o) => o.name === event.home_team
            );
            const awayOutcome = market.outcomes.find(
              (o) => o.name === event.away_team
            );
            if (homeOutcome?.point !== undefined)
              homeSpread = homeOutcome.point;
            if (awayOutcome?.point !== undefined)
              awaySpread = awayOutcome.point;
          } else if (market.key === "h2h") {
            const homeOutcome = market.outcomes.find(
              (o) => o.name === event.home_team
            );
            const awayOutcome = market.outcomes.find(
              (o) => o.name === event.away_team
            );
            if (homeOutcome) homeMoneyline = homeOutcome.price;
            if (awayOutcome) awayMoneyline = awayOutcome.price;
          } else if (market.key === "totals") {
            const overOutcome = market.outcomes.find(
              (o) => o.name === "Over"
            );
            if (overOutcome?.point !== undefined)
              overUnder = overOutcome.point;
          }
        }

        spreadRows.push({
          game_id: gameId,
          game_date: gameDate,
          external_id: event.id,
          home_team: homeAbbrev,
          away_team: awayAbbrev,
          home_spread: homeSpread,
          away_spread: awaySpread,
          home_moneyline: homeMoneyline,
          away_moneyline: awayMoneyline,
          over_under: overUnder,
          source: "the-odds-api",
          bookmaker: book.key,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert into game_spreads
    if (spreadRows.length > 0) {
      const { error: upsertErr } = await svc
        .from("game_spreads")
        .upsert(spreadRows, { onConflict: "game_id,bookmaker" });

      if (upsertErr) {
        console.error("Upsert error:", upsertErr);
        return makeJsonResponse({
          error: "Failed to save spreads",
          details: upsertErr.message,
        }, 500);
      }
    }

    return makeJsonResponse({
      success: true,
      events_fetched: filteredEvents.length,
      spreads_saved: spreadRows.length,
      api_requests_remaining: remaining,
      api_requests_used: used,
    });
  } catch (error) {
    console.error("Error in fetch-spreads:", error);
    return makeJsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
