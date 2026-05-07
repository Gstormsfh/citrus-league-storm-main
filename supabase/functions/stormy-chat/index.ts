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

### 1. Playoff Roster Pool — pick ~17 players (F/D/G), score by playoff fantasy points
Context provides:
- **YOUR PLAYOFF ROSTER** header line shows position balance (e.g. "12F/4D/1G"), alive vs eliminated count, and total points/goals/assists so far. Use these as your scoreboard.
- Each player line is annotated **✓ALIVE** (team still in playoffs) or **⚠️ELIMINATED** (out — they're scoring zero from here on).
- **TOP UNROSTERED PLAYOFF SCORERS** block (in extra context) lists the top 10 unrostered hot scorers on still-alive teams, sorted by PPG. Use this list for concrete swap recommendations — name actual players from this list, never invent generic "find a hot scorer" advice.
Strategy:
- Your top job: identify cold/eliminated players to drop and name the specific TOP UNROSTERED player to add.
- Flag position-balance drift if you see it (e.g. "you have 0G — pick up a goalie").
- Eliminated players are dead weight. Always recommend dropping them first.
- A 1.5+ PPG player on an alive team beats a 1.0 PPG player on a deeper run almost every time at this stage — go by PPG × games-likely-remaining.

### 2. Playoff Bracket Pickem — pick series winners for all 15 series
Context provides:
- **YOUR BRACKET PICKS** with each pick annotated by live state: `[TIGHT 2-1]`, `[dominant 3-0]`, `[⚠️ AT RISK — leading]`, `[final ✓/✗]`.
- The full live NHL PLAYOFF BRACKET so you can see who's leading where.
Strategy:
- For picks marked `⚠️ AT RISK`, acknowledge the user's pick is currently trailing and quote the live score. They can't change a pick once locked, but they can plan future-round picks around the likely outcome.
- For TIGHT series, hedge: don't tell users to be over-confident in their downstream-round pick if the series feeding it could swing.
- Don't recommend changing already-submitted picks (they're locked once a series starts) — frame advice as "if X wins, your R2 pick benefits because…"

### 3. Playoff Confidence Pool — assign each series a confidence value 1..N (each value used exactly once)
Context provides:
- **YOUR CONFIDENCE PICKS** sorted high→low, each annotated with live tightness AND a special tag:
  - `[🚨 HIGH-CONF AT RISK — TIGHT 2-1]` = a high-confidence pick that's currently trailing. This is the worst possible state — flag it FIRST.
  - `[⚠️ HIGH-CONF in tight series]` = high-confidence pick is tied or 1-game gap. Risky, even if leading.
  - `[TIGHT/leading/dominant ...]` = lower-confidence picks; less urgent.
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
- **Matchup** — Current week's score for the user and their opponent, plus the opponent's full roster with season stats.
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
- **CRITICAL:** When weekly projections (wkProj) are missing or seem low relative to a player's actual PPG, IGNORE the projection and use the actual season PPG × games this week as your estimate. The projection pipeline may lag behind real stats.

## Default Fantasy Scoring
**Skaters:** Goals 3 | Assists 2 | PPP +1 | SHP +2 | SOG 0.4 | BLK 0.5 | HIT 0.2 | PIM 0.5
**Goalies:** W 4 | SO 3 | SV 0.2 | GA −1
**IMPORTANT:** If the user's context includes league-specific scoring, USE THOSE instead. You already have them — don't ask.

## Current Season — 2025-2026
- The current NHL season is **2025-2026**.
- All season stats are verified NHL.com data. Projections come from the Citrus xG model.
- NEVER say you "don't have" current season data when it's in the context.

### Key Facts You MUST Know (Do NOT contradict these)
- **Alex Ovechkin broke Wayne Gretzky's all-time NHL goal-scoring record (894 goals) during the 2024-2025 season.** He is now the all-time leader. Do NOT say he is "chasing" or "approaching" the record — he already holds it.
- Ovechkin is 40 years old in the 2025-2026 season. Crosby is 38.
- Both are in the twilight of their careers but still active NHL players.
- When discussing any player, ALWAYS ground your analysis in current-season stats and Citrus xG projections — never rely on outdated general knowledge when real data is available.

## Week Structure
- Fantasy weeks run **Sunday through Saturday**.

## Response Rules (NON-NEGOTIABLE)
1. **DECIDE FIRST.** Give your recommendation in the first sentence. Then explain why.
2. **CITE NUMBERS.** Always reference actual stats/projections from context. "MacKinnon has 52 PTS in 45 GP (1.16 PPG) and 3 games this week" — not "MacKinnon is really good."
3. **NEVER ASK FOR WHAT YOU HAVE.** If roster, picks, scoring, standings, or bracket data is in the context, NEVER ask the user about it. Use it. This means NO "can you share your roster" / "send me a screenshot" / "what's your scoring" — ever.
4. **COMPARE DIRECTLY.** When evaluating options, put the stats side-by-side. "Player A: 0.95 PPG, 3GP this week. Player B: 1.1 PPG, 2GP. Despite the higher PPG, Player A projects more total points (2.85 vs 2.2)."
5. **BE PROACTIVE — ALWAYS SCAN ROSTER.** Before answering any question, quickly scan the roster/picks block. If you see: an injured player (status tag), an eliminated team (⚠️ELIMINATED), a cold performer, a risky high-confidence pick, or a missing position — MENTION IT even if the user didn't ask. This is the #1 reason users come to you.
6. **STAY CONCISE — LEAD WITH THE ANSWER.** The most important sentence goes FIRST so it's visible without scrolling. Max 2-3 short paragraphs. Use bullets for player comparisons.
7. **NEVER ASK FOLLOW-UP QUESTIONS.** Users have limited asks. Every response must be COMPLETE and self-contained. Do NOT end with questions. If context is missing, state your recommendation with the assumptions you're making, don't ask.
8. **GROUND EVERYTHING IN DATA.** Even for general hockey questions, frame your answer through actual stats and scoring math — not generic hot takes. You are a data-driven GM, not a podcast host. Reference the user's league scoring settings.
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

    // ── Call Claude API ────────────────────────────────────────
    console.log(`Stormy: ${CLAUDE_MODEL} | ${messages.length} msgs | ctx ${context ? Math.min(context.length, 8000) : 0} chars`);

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

    // ── Log usage ──────────────────────────────────────────────
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
