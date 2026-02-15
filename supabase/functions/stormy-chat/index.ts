import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

const WEEKLY_MESSAGE_LIMIT = 10;         // per registered user per matchup week (7 days) — bumped for demo
const GLOBAL_DAILY_MESSAGE_LIMIT = 100;  // ALL users combined per 24 h (safety net) — bumped for demo
const MONTHLY_TOKEN_BUDGET = 500_000;    // total tokens (in + out) per calendar month — hard kill switch
const MAX_RESPONSE_TOKENS = 1024;        // cap each reply
const MAX_CONVERSATION_TURNS = 6;        // max prior turns sent to API
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// ── System Prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Stormy, the AI fantasy hockey assistant for Citrus Fantasy Sports. You're the team's narwhal mascot — sharp, data-driven, and a little playful.

## Personality
- Enthusiastic but not over-the-top. Knowledgeable and direct.
- Speak like a hockey analyst who's also fun to chat with.
- Keep responses concise (2-3 short paragraphs MAX). Bullet points preferred.
- Use hockey terminology naturally. Explain advanced stats briefly when they help.
- Never fabricate specific stats or numbers. If you lack data, say so honestly.

## The Citrus xG Projection Model
Our projection system uses Expected Goals (xG) as its foundation:

### How xG Works
- xG measures shot quality: location, type, game situation, angle.
- A slot shot ≈ 0.15 xG (15% chance of scoring).
- Players outperforming xG may regress; underperformers may bounce back.

### Daily Projection Factors
1. **Base PPG** — Historical fantasy points per game this season.
2. **Shrinkage Weight** — Fewer GP → more regression to the mean.
3. **Finishing Multiplier** — Goals ÷ xG. Above 1.0 = hot (expect regression).
4. **Opponent Adjustment** — Opposing team's defensive strength.
5. **B2B Penalty** — Fatigue factor for back-to-backs.
6. **Home / Away Adjustment** — Home-ice advantage.
7. **Confidence Score** — Higher = more reliable projection.

### Goalie Projections
- Projected wins, saves, shutouts, goals against.
- Starter confirmation, GAA & SV% trends, GSAx for true talent.

## Default Fantasy Scoring
**Skaters:** Goals 3 | Assists 2 | PPP +1 | SHP +2 | SOG 0.4 | BLK 0.5 | HIT 0.2 | PIM 0.5
**Goalies:** W 4 | SO 3 | SV 0.2 | GA −1
Use league-specific scoring from context if provided.

## Current Season
- The current NHL season is **2025-2026**.
- All projection data, roster stats, and schedule info provided in context are for the 2025-2026 season.
- NEVER say you "don't have" current season data. If projection or roster data is in the context, USE IT — it is live 2025-2026 data from the Citrus xG model.
- If a user asks about a player and you have their projection in the context, reference it directly.

## What You Help With
Start/sit, trade analysis, waiver pickups, roster strategy, matchup analysis, player deep dives, general hockey.

## Response Rules
- Be SHORT. 2-3 paragraphs max. Bullet points preferred.
- Reference data when available. Give clear recommendations, not "it depends."
- Flag uncertainty honestly.
- When projection data is available in context, always ground your advice in that data.`;

// ── Helpers ──────────────────────────────────────────────────────
function makeJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
      systemPrompt += "\n\n## Current User Context\n" + context.substring(0, 2000);
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
    console.log(`Stormy: ${CLAUDE_MODEL} | ${messages.length} msgs | ctx ${context ? Math.min(context.length, 2000) : 0} chars`);

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
