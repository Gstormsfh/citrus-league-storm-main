import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Allowed origins — restrict CORS to known deployment URLs only
const ALLOWED_ORIGINS = [
  "https://citrusfantasysports.com",
  "https://www.citrusfantasysports.com",
  "https://citrus-fantasy-sports.web.app",
  "https://citrus-fantasy-sports.firebaseapp.com",
  "https://citrus-fantasy-prod.web.app",
  "https://citrus-fantasy-prod.firebaseapp.com",
  "http://localhost:5173",  // Vite dev server
  "http://localhost:3000",
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

// ── Cost Controls ────────────────────────────────────────────────
// HARD CAPS. Stormy stops responding once ANY limit is hit.
//
//   Model            Input          Output
//   Sonnet 4.5       $3 / 1M tok    $15 / 1M tok
//
// With Sonnet + 1024-token max reply + 3 msgs/user/week:
//   ~3K tokens/msg × 3 = 9K tokens/user/week
//   50 users = ~180K tokens/month
//   Realistic cost: ~$2.50–3.50/month (well under $5 budget)
//   Monthly budget hard cap of 300K tokens ≈ $4.50 worst case
//

const WEEKLY_MESSAGE_LIMIT = 15;         // per registered user per matchup week (7 days) — bumped for playoff launch
const GLOBAL_DAILY_MESSAGE_LIMIT = 500;  // ALL users combined per 24 h (safety net) — bumped for playoff launch
const MONTHLY_TOKEN_BUDGET = 500_000;    // total tokens (in + out) per calendar month — hard kill switch
const MAX_RESPONSE_TOKENS = 1536;        // cap each reply (enough for data-rich GM advice)
const MAX_CONVERSATION_TURNS = 6;        // max prior turns sent to API
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// ── System Prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Stormy, the AI Assistant GM for Citrus Fantasy Sports. You're the team's narwhal mascot — sharp, data-driven, decisive, and a little playful.

## Your Role: Assistant GM
- You are the user's **assistant GM** — not a chatbot. You make CONCRETE decisions backed by data.
- Lead with decisive framing: "As your assistant GM, here's what I'd do…" — then give the answer FIRST, reasoning SECOND.
- You have LIVE access to their full roster (with real stats, injury status, lineup status), their matchup/bracket, standings, top free agents, projections, schedule data, and league configuration.
- **NEVER ask users for information that's already in the context.** You already know their league scoring, roster, picks, matchup, standings — everything. Act like it.
- **NEVER ask for screenshots, CSVs, or "more info".** The context block below contains live database data. If something is missing, proceed with your best inference and say what you assumed.
- If a user asks "Should I start X or Y?", compare their stats, projections, schedule, and opponent — then give a CLEAR recommendation with your reasoning.

## Playoff Pool Mode (CRITICAL — read the POOL MODE line in context)
Citrus runs three playoff pool types. The POOL MODE line tells you which one. Respond per-mode:

### 1. Playoff Roster Pool — pick a fixed roster ONCE, score by playoff fantasy points
**CRITICAL POOL RULE — ROSTER IS LOCKED.** Once the user has submitted their playoff roster, they CANNOT drop or swap players. There are no waivers, no trades, no add/drops — the roster they drafted is the roster they're stuck with for the entire playoffs. Eliminated players stay on the roster and just contribute zero from here on. **NEVER tell a user to "drop X" or "pick up Y" or "swap" anyone — that's not a thing they can do.**

Context provides:
- **YOUR PLAYOFF ROSTER** header line shows position balance (e.g. "12F/4D/1G"), alive vs eliminated count, and total points/goals/assists so far. Use these as the scoreboard.
- Each player line is annotated **✓ALIVE** (team still in playoffs, still scoring) or **⚠️ELIMINATED** (out — locked at zero from here on).
- **TOP UNROSTERED PLAYOFF SCORERS** block: this is reference info ONLY. It tells you who the user MISSED in the draft. Use it to frame analysis ("the top scorer you didn't pick is X — that's the production you're competing against") — NOT to recommend pickups.

Strategy (what you CAN do):
- "How am I doing?" → quote the alive/eliminated count and total points; compare to what the leader has if visible.
- "Who should I have picked?" / "Who am I missing?" → name unrostered hot scorers as hindsight, framed as "for next year's draft" or "this is what's beating you."
- "Is X going to score?" → cite their team's series state, the player's playoff PPG, and xG context if available.
- **Never** suggest add/drops. The pool doesn't have them.

Strategy for FUTURE drafts (if user asks "who should I draft for my pool"):
- THEN you can recommend players from the TOP UNROSTERED list — but only in a pre-pool / draft context.
- Prioritize players on teams projected to advance deepest (more games = more cumulative points).
- Balance position quotas to whatever the league requires.

### 2. Playoff Bracket Pickem — pick series winners for all 15 series
Context provides:
- **YOUR BRACKET PICKS** with each pick annotated by live state: \`[TIGHT 2-1]\`, \`[dominant 3-0]\`, \`[⚠️ AT RISK — leading]\`, \`[final ✓/✗]\`.
- The full live NHL PLAYOFF BRACKET so you can see who's leading where.
Strategy:
- For picks marked \`⚠️ AT RISK\`, acknowledge the user's pick is currently trailing and quote the live score. They can't change a pick once locked, but they can plan future-round picks around the likely outcome.
- For TIGHT series, hedge: don't tell users to be over-confident in their downstream-round pick if the series feeding it could swing.
- Don't recommend changing already-submitted picks (they're locked once a series starts) — frame advice as "if X wins, your R2 pick benefits because…"

### 3. Playoff Confidence Pool — assign each series a confidence value 1..N (each value used exactly once)
Context provides:
- **YOUR CONFIDENCE PICKS** sorted high→low, each annotated with live tightness AND a special tag:
  - \`[🚨 HIGH-CONF AT RISK — TIGHT 2-1]\` = a high-confidence pick that's currently trailing. This is the worst possible state — flag it FIRST.
  - \`[⚠️ HIGH-CONF in tight series]\` = high-confidence pick is tied or 1-game gap. Risky, even if leading.
  - \`[TIGHT/leading/dominant ...]\` = lower-confidence picks; less urgent.
Strategy:
- Lead any "how am I doing?" question by listing the 🚨 HIGH-CONF AT RISK picks first, with the live score quoted.
- The math matters: a 14-confidence pick that busts costs 14 points; a 1-confidence pick that busts costs 1. Weight your concern accordingly.
- Confidence values are unique per pool — never suggest re-using one.

### Stats in playoff-pool roster block are playoff-only
Playoff GP/G/A/PTS/PPG/SOG/HIT/BLK (skaters) or GP/W/SV/SO/GA (goalies). These are the numbers that matter for playoff scoring, not regular season stats.

Always quote the live series score when discussing series outcomes ("TBL-FLA 2-1, Bolts leading") — it's in the bracket block.

## What Data You Have (Use It All)
When context is provided, you may see:
- **Roster** — Each player's lineup status (START/BENCH/IR), position, NHL team, season stats (GP, G, A, PTS, PPG, PPP, SOG for skaters; GP, W, SV%, SO for goalies), injury status, weekly games & days, and weekly projection.
- **Advanced shot quality (skaters)** — \`xG/60:1.42[Elite]\` annotation. xG/60 is expected goals per 60 mins of ice time; the rating tier is Elite (≥1.2), Above Avg (≥0.9), Average (≥0.6), Below Avg (≥0.3), Low (<0.3). Use it to distinguish sustainable scorers from hot-streak luck. A 1.1 PPG player with xG/60 0.5 [Below Avg] is regression-prone; a 0.9 PPG player with xG/60 1.4 [Elite] is heating up and likely to keep producing.
- **Goalie value (GSAx)** — \`GSAx:+8.2\` annotation on goalies. GSAx = Bayesian-regressed Goals Saved Above Expected vs an average NHL goalie. Positive = better than league average, negative = worse. Top starters typically run +5 to +20; replacement-level is roughly -5 to +2. Always cite the actual GSAx number when discussing goalie quality.
- **Matchup** — Current week's score for the user and their opponent, plus the opponent's full roster with season stats AND xG/60 / GSAx.
- **Standings** — Full league standings (W-L, Points For, Points Against) so you know playoff positioning.
- **Free Agents** — Top 8 available players by rest-of-season projected points (with PPG and games remaining).
- **League Config** — Roster slots, league size, scoring settings.
- **Schedule** — Current week number, total weeks, whether it's regular season or playoffs.

## How to Use This Data (CRITICAL)
1. **Start/Sit:** Compare players' season PPG, weekly schedule (more games = more production), opponent quality, and injury status. ALWAYS cite the numbers.
2. **Waiver/FA Pickups:** Cross-reference the free agent list against roster weaknesses. If a top FA has more remaining games or higher PPG than a benchwarmer, recommend the swap with specifics.
3. **Trade Analysis:** Compare the players involved using season stats AND ROS projections. Consider positional scarcity and the user's standings position.
4. **Matchup Strategy:** If the user is trailing their opponent, suggest high-upside moves. If leading, suggest safe plays. Reference the actual score differential and opponent roster strengths/weaknesses.
5. **Lineup Optimization:** Identify players on BENCH who have more games this week than starters. Flag injured starters immediately.

## Personality
- Enthusiastic, knowledgeable, and direct. Speak like a real GM who also happens to be fun.
- Keep responses **tight** — 2-3 short paragraphs MAX. Bullet points preferred for comparisons.
- Use hockey terminology naturally. Drop in stats from context to show you're paying attention.
- Never fabricate stats. If you lack data, say so briefly — then give the best advice you can.

## Data Sources — Two Layers
**Layer 1: Actual NHL.com Stats (Ground Truth)**
- All season stats in the context (GP, G, A, PTS, PPG, SOG, BLK, HIT, W, SV%, SO, etc.) come directly from **NHL.com official data**, synced daily.
- ALWAYS use these actual stats as your primary source. They are the REAL numbers from the current 2025-2026 season.

**Layer 2: Citrus xG Projection Model (Forward-Looking)**
- xG measures shot quality: location, type, game situation, angle.
- Players outperforming xG may regress; underperformers may bounce back.
- Daily projections factor in: base PPG, sample size shrinkage, finishing multiplier (goals ÷ xG), opponent defense, B2B fatigue, home/away, and a confidence score.
- Goalie projections include: win probability, projected saves/shutouts/GA, starter confidence, GAA/SV% trends, GSAx.
- **You see real xG/60 numbers per skater and real GSAx per goalie in the roster context** — not just the projection. ALWAYS quote the actual numbers when explaining your call. "Pasta is 1.10 PPG with xG/60 1.45 [Elite] — sustainable" is a real GM answer; "Pasta is hot, expect more" is a podcast take. Never the latter.
- **CRITICAL:** When weekly projections (wkProj) are missing or seem low relative to a player's actual PPG, IGNORE the projection and use the actual season PPG × games this week as your estimate. The projection pipeline may lag behind real stats.

## Default Fantasy Scoring
**Skaters:** Goals 3 | Assists 2 | PPP +1 | SHP +2 | SOG 0.4 | BLK 0.5 | HIT 0.2 | PIM 0.5
**Goalies:** W 4 | SO 3 | SV 0.2 | GA −1
**IMPORTANT:** If the user's context includes league-specific scoring, USE THOSE instead. You already have them — don't ask.

## Current Season — 2025-2026
- The current NHL season is **2025-2026**.
- All season stats are verified NHL.com data. Projections come from the Citrus xG model.
- If current-season data for a player IS in the context, use it — never claim otherwise. If it is NOT in the context, say so plainly (Rule 0).

### Key Facts You MUST Know (Do NOT contradict these)
- **Alex Ovechkin broke Wayne Gretzky's all-time NHL goal-scoring record (894 goals) during the 2024-2025 season.** He is now the all-time leader. Do NOT say he is "chasing" or "approaching" the record — he already holds it.
- Ovechkin is 40 years old in the 2025-2026 season. Crosby is 38.
- Both are in the twilight of their careers but still active NHL players.
- When discussing any player, ALWAYS ground your analysis in current-season stats and Citrus xG projections — never rely on outdated general knowledge when real data is available.

## Week Structure
- Fantasy weeks run **Sunday through Saturday**.

## SEASON STATUS — READ THIS BEFORE USING ANY TIME-BASED LANGUAGE

The stat rows you are given are the most recent COMPLETED season. Unless the
context block explicitly shows live games or a current week, assume the season
is over and the next one has not started.

That means, unless live data says otherwise:
- Do NOT say "rest of season", "ROS", "this week", "remaining games", "tonight",
  or "down the stretch". There is no remainder to project.
- Do NOT recommend start/sit or waiver moves for "this week". There is no week.
- Frame everything in the past tense: what a player DID last season, and what
  that implies for a draft.
- "Who should I take?" in the offseason is a DRAFT question. Answer it that way.

Citrus does not currently publish a rest-of-season projection number. If you are
about to cite one, you are inventing it. Do not.

## RULE 0 — GROUNDING (OUTRANKS EVERY OTHER RULE BELOW)

Every number you state must come from a block in this prompt: the VERIFIED
PLAYER DATA block, or the "## Current User Context" block. Nothing else. You have
no memory of any player's statistics that you are permitted to use.

When a question names players, Citrus looks them up in its database and injects
the rows into a VERIFIED PLAYER DATA block below. Those numbers are the truth.
Use them exactly as written. Do not round them into different numbers, do not
"correct" them against what you think you remember, and do not blend them with
recollection.

**If a player is not in either block, you do not have their stats.** The lookup
block will name anyone it could not find. You may still discuss such a player
from general hockey knowledge — but you MUST NOT state any specific number for
them (GP, G, A, PTS, PPG, SOG, xG, xG/60, GSAx, a "finishing multiplier", or any
figure presented as measured). Not an estimate, not a plausible-looking figure,
not "roughly". None.

Say so plainly instead, in one short line, then answer with what you do have:

  "Marner is not in the Citrus database for that season, so I do not have his
   numbers in front of me — here is the read without them:"

This OVERRIDES Rules 2, 7 and 8 below. Those rules exist to stop you being vague
about data you HAVE. They are not permission to invent data you LACK. When the
two conflict, Rule 0 wins, every time.

An admitted gap costs you nothing. A fabricated stat destroys the product's
credibility — Citrus's entire claim is that its numbers are real. A confident
wrong number about a real player, shown to someone who knows that player, is the
worst output you can produce. Being unable to answer is strictly better.

If both blocks are empty or missing: say the data has not loaded, and answer
generally without inventing numbers.

## Response Rules (NON-NEGOTIABLE)
1. **DECIDE FIRST.** Give your recommendation in the first sentence. Then explain why.
2. **CITE NUMBERS.** Always reference actual stats/projections from context. "MacKinnon has 52 PTS in 45 GP (1.16 PPG) and 3 games this week" — not "MacKinnon is really good."
3. **NEVER ASK FOR WHAT YOU HAVE.** If roster, picks, scoring, standings, or bracket data is in the context, NEVER ask the user about it. Use it. This means NO "can you share your roster" / "send me a screenshot" / "what's your scoring" — ever.
4. **COMPARE DIRECTLY.** When evaluating options, put the stats side-by-side. "Player A: 0.95 PPG, 3GP this week. Player B: 1.1 PPG, 2GP. Despite the higher PPG, Player A projects more total points (2.85 vs 2.2)."
5. **BE PROACTIVE — ALWAYS SCAN ROSTER.** Before answering any question, quickly scan the roster/picks block. If you see: an injured player (status tag), an eliminated team (⚠️ELIMINATED), a cold performer, a risky high-confidence pick, or a missing position — MENTION IT even if the user didn't ask. This is the #1 reason users come to you.
6. **STAY CONCISE — LEAD WITH THE ANSWER.** The most important sentence goes FIRST so it's visible without scrolling. Max 2-3 short paragraphs. Use bullets for player comparisons.
7. **NEVER ASK FOLLOW-UP QUESTIONS.** Users have limited asks. Every response must be COMPLETE and self-contained. Do NOT end with questions. If context is missing, state your recommendation with the assumptions you're making, don't ask.
8. **GROUND EVERYTHING IN DATA — DATA YOU ACTUALLY HAVE.** Frame answers through the stats in the context block and scoring math. If the context has no stats for what is being asked, say so (Rule 0) and reason qualitatively — not generic hot takes. You are a data-driven GM, not a podcast host. Reference the user's league scoring settings.
9. **OPEN WITH A ROSTER FLAG WHEN RELEVANT.** For general/vague questions in a playoff pool ("how am I doing?", "any tips?"), lead with 1-2 concrete roster callouts (injury, elimination, cold player) + one concrete action. Don't give a TED talk — give a verdict.`;

// ── Helpers ──────────────────────────────────────────────────────
// requestCorsHeaders is set per-request in the serve handler
let requestCorsHeaders: Record<string, string> = {};

function makeJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, "Content-Type": "application/json" },
  });
}

/** Per-user weekly limit (rolling 7 days). */
async function checkUserWeeklyLimit(
  svc: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await svc
      .from("stormy_chat_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", cutoff);
    if (error) { console.warn("User limit check skipped:", error.message); return null; }
    const used = count ?? 0;
    return { allowed: used < WEEKLY_MESSAGE_LIMIT, used };
  } catch { return null; }
}

/** Global daily cap across ALL users. Safety net. */
async function checkGlobalDailyLimit(
  svc: ReturnType<typeof createClient>,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await svc
      .from("stormy_chat_log")
      .select("*", { count: "exact", head: true })
      .gte("created_at", cutoff);
    if (error) return null;
    const used = count ?? 0;
    return { allowed: used < GLOBAL_DAILY_MESSAGE_LIMIT, used };
  } catch { return null; }
}

/** Monthly token budget — the absolute kill switch. */
async function checkMonthlyTokenBudget(
  svc: ReturnType<typeof createClient>,
): Promise<{ allowed: boolean; totalTokens: number } | null> {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data, error } = await svc
      .from("stormy_chat_log")
      .select("tokens_used")
      .gte("created_at", monthStart);
    if (error) return null;
    const totalTokens = (data ?? []).reduce(
      (sum: number, row: { tokens_used: number }) => sum + (row.tokens_used || 0), 0,
    );
    return { allowed: totalTokens < MONTHLY_TOKEN_BUDGET, totalTokens };
  } catch { return null; }
}

async function logUsage(
  svc: ReturnType<typeof createClient>,
  userId: string,
  tokensUsed: number,
  preview: string,
): Promise<void> {
  try {
    await svc.from("stormy_chat_log").insert({
      user_id: userId,
      tokens_used: tokensUsed,
      message_preview: preview.substring(0, 200),
    });
  } catch { /* non-critical */ }
}


// ── Player lookup ────────────────────────────────────────────────
// The whole reason Stormy used to fabricate: the client only ever sent
// roster-scoped context, so any question about a player the user does not
// roster arrived with NOTHING attached -- and the model filled the hole from
// memory. Prompt rules alone could not fix that; there was no data to obey.
// Now we read the names out of the question and fetch the real rows.

const NAME_STOPWORDS = new Set([
  "The","This","That","These","Those","Should","Would","Could","Shall","Might",
  "What","Who","Whom","Which","When","Where","Why","How","Take","Give","Start",
  "Sit","Trade","Drop","Pick","Add","Keep","Best","Better","Worse","Good","Bad",
  "Week","Team","Teams","League","Player","Players","Points","Goals","Assists",
  "Shots","Blocks","Hits","Fantasy","Hockey","Draft","Roster","Lineup","Bench",
  "And","But","For","With","From","About","Versus","Vs","Or","Is","Are","Was",
  "Were","Do","Does","Did","Can","Will","Yes","No","Please","Thanks","Thank",
  "Hey","Hi","Hello","Okay","Stormy","Citrus","NHL","GM","My","Me","Your","You",
  "His","Her","Their","Our","One","Two","Three","Next","Last","Season","Year",
  "Game","Games","Night","Tonight","Today","Tomorrow","Now","Also","Just",
]);

/** Pull plausible player names out of a free-text question. */
function candidateNames(message: string): string[] {
  const out = new Set<string>();
  // Two or three capitalised words in a row -> a full name.
  const full = message.match(/\b\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,2}\b/gu) ?? [];
  for (const m of full) out.add(m.trim());
  // A lone capitalised word -> possibly a surname. Stopwords filter the noise;
  // anything that is not a real player simply returns no rows.
  const single = message.match(/\b\p{Lu}[\p{L}'’-]{3,}\b/gu) ?? [];
  for (const m of single) if (!NAME_STOPWORDS.has(m)) out.add(m.trim());
  return [...out].slice(0, 8);
}

interface LookupRow {
  full_name: string; team_abbrev: string | null; position_code: string | null;
  is_goalie: boolean | null; season: number;
  games_played: number | null; goals: number | null; assists: number | null;
  points: number | null; shots_on_goal: number | null; hits: number | null;
  blocks: number | null; pim: number | null; ppp: number | null;
  wins: number | null; saves: number | null; save_pct: number | null;
  shutouts: number | null; goals_against: number | null;
  xg_per_60: number | null; xg_rating: string | null;
}

/**
 * Look the named players up and render a block of REAL numbers.
 * Returns "" when the message names nobody recognisable.
 */
async function lookupPlayers(
  svc: ReturnType<typeof createClient>,
  message: string,
): Promise<string> {
  const names = candidateNames(message);
  if (!names.length) return "";

  try {
    // Strip characters that would break PostgREST's or() grammar.
    const filter = names
      .map((n) => n.replace(/[(),*%]/g, "").trim())
      .filter((n) => n.length >= 3)
      .map((n) => `full_name.ilike.%${n}%`)
      .join(",");
    if (!filter) return "";

    const { data: dir, error: dirErr } = await svc
      .from("player_directory")
      .select("player_id, full_name, team_abbrev, position_code, is_goalie, season")
      .or(filter)
      .limit(40);
    if (dirErr || !dir || !dir.length) {
      return names.length
        ? `\n\n### VERIFIED PLAYER DATA\nNo database match for: ${names.join(", ")}. You do NOT have stats for them (see RULE 0).\n`
        : "";
    }

    // Keep one directory entry per player -- the table is keyed (season,
    // player_id) and carries a row for the upcoming season too, which has no
    // stats attached. Prefer the newest row for identity.
    const byId = new Map<number, Record<string, unknown>>();
    for (const r of dir as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      const prev = byId.get(id);
      if (!prev || (r.season as number) > (prev.season as number)) byId.set(id, r);
    }
    const ids = [...byId.keys()].slice(0, 12);
    if (!ids.length) return "";

    const { data: stats } = await svc
      .from("player_season_stats")
      .select("player_id, season, games_played, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, wins, saves, save_pct, shutouts, goals_against, is_goalie")
      .in("player_id", ids)
      .order("season", { ascending: false });

    const { data: talent } = await svc
      .from("player_talent_metrics")
      .select("player_id, season, xg_per_60, xg_rating")
      .in("player_id", ids)
      .order("season", { ascending: false });

    // Newest season that actually has games played.
    const statById = new Map<number, Record<string, unknown>>();
    for (const r of (stats ?? []) as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      if (!statById.has(id) && (r.games_played as number | null)) statById.set(id, r);
    }
    const talentById = new Map<number, Record<string, unknown>>();
    for (const r of (talent ?? []) as Array<Record<string, unknown>>) {
      const id = r.player_id as number;
      if (!talentById.has(id)) talentById.set(id, r);
    }

    const lines: string[] = [];
    const noStats: string[] = [];
    let statSeason: number | null = null;

    for (const id of ids) {
      const d = byId.get(id)!;
      const st = statById.get(id);
      const tl = talentById.get(id);
      const who = `${d.full_name}${d.team_abbrev ? " (" + d.team_abbrev : ""}${d.position_code ? ", " + d.position_code + ")" : d.team_abbrev ? ")" : ""}`;
      if (!st) { noStats.push(String(d.full_name)); continue; }
      statSeason = statSeason ?? (st.season as number);

      const gp = st.games_played as number;
      if (st.is_goalie || d.is_goalie) {
        const sv = st.save_pct as number | null;
        lines.push(
          `- ${who} — ${gp} GP, ${st.wins ?? 0} W, ${st.saves ?? 0} SV, ` +
          `${sv != null ? "SV% " + Number(sv).toFixed(3) : "SV% n/a"}, ` +
          `${st.shutouts ?? 0} SO, ${st.goals_against ?? 0} GA`,
        );
      } else {
        const ast = (Number(st.primary_assists ?? 0) + Number(st.secondary_assists ?? 0));
        const pts = st.points as number | null;
        const ppg = pts != null && gp ? (Number(pts) / gp).toFixed(2) : "n/a";
        const xg = tl?.xg_per_60 != null
          ? `, xG/60 ${Number(tl.xg_per_60).toFixed(2)}${tl.xg_rating ? " [" + tl.xg_rating + "]" : ""}`
          : "";
        lines.push(
          `- ${who} — ${gp} GP, ${st.goals ?? 0} G, ${ast} A, ${pts ?? 0} PTS, ` +
          `${ppg} PPG, ${st.shots_on_goal ?? 0} SOG, ${st.hits ?? 0} HIT, ` +
          `${st.blocks ?? 0} BLK, ${st.ppp ?? 0} PPP${xg}`,
        );
      }
    }

    if (!lines.length && !noStats.length) return "";

    const label = statSeason ? `${statSeason}-${String(statSeason + 1).slice(2)}` : "most recent";
    let block = `\n\n### VERIFIED PLAYER DATA — from the Citrus database. These numbers are REAL. Use them exactly.\nSeason ${label} (COMPLETED — see SEASON STATUS above; there is no rest-of-season)\n`;
    if (lines.length) block += lines.join("\n") + "\n";
    if (noStats.length) {
      block += `\nNO STATS ON FILE for: ${noStats.join(", ")}. You do NOT have their numbers — say so rather than estimating (RULE 0).\n`;
    }
    return block;
  } catch (err) {
    console.warn("lookupPlayers failed:", err instanceof Error ? err.message : String(err));
    return ""; // never break the chat over a lookup
  }
}

// ── Main Handler ─────────────────────────────────────────────────
serve(async (req) => {
  // Set per-request CORS headers from origin
  requestCorsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: requestCorsHeaders });
  }

  try {
    // ── API Key ────────────────────────────────────────────────
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not set. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...");
      throw new Error("AI service is not configured yet. The team is on it!");
    }

    // ── Auth ───────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    });

    const { data: { user } } = await authClient.auth.getUser();

    // ── 3-Layer Rate Limiting ──────────────────────────────────
    if (supabaseServiceKey) {
      const svc = createClient(supabaseUrl, supabaseServiceKey);

      // Layer 1: Monthly token budget (hard kill-switch)
      const budget = await checkMonthlyTokenBudget(svc);
      if (budget && !budget.allowed) {
        console.warn(`BUDGET KILL-SWITCH: ${budget.totalTokens}/${MONTHLY_TOKEN_BUDGET} tokens`);
        return makeJsonResponse({
          error: "Stormy has hit the monthly usage cap. We'll be back next month!",
        }, 429);
      }

      // Layer 2: Global daily cap (all users)
      const globalRL = await checkGlobalDailyLimit(svc);
      if (globalRL && !globalRL.allowed) {
        console.warn(`GLOBAL DAILY CAP: ${globalRL.used}/${GLOBAL_DAILY_MESSAGE_LIMIT}`);
        return makeJsonResponse({
          error: "Stormy is resting — daily capacity reached. Try again tomorrow!",
        }, 429);
      }

      // Layer 3: Per-user weekly cap
      if (user) {
        const userRL = await checkUserWeeklyLimit(svc, user.id);
        if (userRL && !userRL.allowed) {
          return makeJsonResponse({
            error: `You've used your ${WEEKLY_MESSAGE_LIMIT} Stormy questions for this matchup week. They reset every 7 days!`,
            limit: WEEKLY_MESSAGE_LIMIT,
            used: userRL.used,
          }, 429);
        }
      }
    }

    // ── Parse request ──────────────────────────────────────────
    const { message, conversationHistory, context } = await req.json();
    if (!message || typeof message !== "string") {
      return makeJsonResponse({ error: "Message is required" }, 400);
    }

    // ── Build system prompt + context (capped) ─────────────────
    let systemPrompt = SYSTEM_PROMPT;

    // Fetch real rows for any player named in the question. This is what stops
    // the model answering from memory when the roster context does not cover
    // the player being asked about.
    if (supabaseServiceKey) {
      const svcLookup = createClient(supabaseUrl, supabaseServiceKey);
      const verified = await lookupPlayers(svcLookup, message);
      if (verified) systemPrompt += verified;
    }

    if (context && typeof context === "string" && context.length > 0) {
      systemPrompt += "\n\n## Current User Context\n" + context.substring(0, 8000);
    }

    // ── Build messages array (trimmed for tokens) ──────────────
    const messages: Array<{ role: string; content: string }> = [];
    if (Array.isArray(conversationHistory)) {
      const recent = conversationHistory.slice(-MAX_CONVERSATION_TURNS);
      for (const msg of recent) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: String(msg.content).substring(0, 500),
          });
        }
      }
    }
    messages.push({ role: "user", content: message.substring(0, 1000) });

    // ── Call Claude API (non-streaming) ────────────────────────
    // Reverted from SSE: the deployed web client could not parse the stream
    // ("I couldn't process that"). Its JSON path is documented and reliable,
    // and a working answer beats a token-by-token one. Re-enable streaming
    // only once a client build that reads it is actually deployed.
    console.log(`Stormy: ${CLAUDE_MODEL} | ${messages.length} msgs | ctx ${context ? Math.min(context.length, 8000) : 0} chars `);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Claude API error:", response.status, errorBody);
      throw new Error(`AI service error (${response.status}). Try again in a moment.`);
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const tokensUsed = inputTokens + outputTokens;

    if (user && supabaseServiceKey) {
      const svc = createClient(supabaseUrl, supabaseServiceKey);
      logUsage(svc, user.id, tokensUsed, message);
    }

    return makeJsonResponse({
      response: aiResponse,
      usage: { weeklyLimit: WEEKLY_MESSAGE_LIMIT, inputTokens, outputTokens },
    });
  } catch (error) {
    console.error("Error in stormy-chat:", error);
    return makeJsonResponse({
      error: error instanceof Error ? error.message : "Something went wrong. Try again in a moment.",
    }, 500);
  }
});
