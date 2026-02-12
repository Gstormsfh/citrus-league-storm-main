import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Rate Limiting ────────────────────────────────────────────────
const DAILY_MESSAGE_LIMIT = 25; // per authenticated user
const MAX_RESPONSE_TOKENS = 1024;
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// ── System Prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Stormy, the AI fantasy hockey assistant for Citrus Fantasy Sports. You're the team's narwhal mascot — sharp, data-driven, and a little playful.

## Personality
- Enthusiastic but not over-the-top. Knowledgeable and direct.
- Speak like a hockey analyst who's also fun to chat with.
- Keep responses concise (2-4 short paragraphs). Users want quick, actionable advice.
- Use hockey terminology naturally. Explain advanced stats briefly when they help.
- Never fabricate specific stats or numbers. If you lack data, say so honestly.
- Use markdown formatting for readability (bold, bullet points, etc.).

## The Citrus xG Projection Model
Our projection system uses Expected Goals (xG) as its foundation:

### How xG Works
- xG measures shot quality: location, type, game situation, angle.
- A slot shot ≈ 0.15 xG (15 % chance of scoring).
- Players outperforming xG may regress; underperformers may bounce back.

### Daily Projection Factors
Each player's daily projection considers:
1. **Base PPG** — Historical fantasy points per game this season.
2. **Shrinkage Weight** — How much to trust small samples (fewer GP → more regression to the mean).
3. **Finishing Multiplier** — Goals ÷ xG. Above 1.0 = "hot" (expect regression). Below 1.0 = "cold" (expect bounce-back).
4. **Opponent Adjustment** — Opposing team's defensive/goaltending strength.
5. **Back-to-Back Penalty** — Reduced projection for B2B games (fatigue).
6. **Home / Away Adjustment** — Home-ice advantage factor.
7. **Confidence Score** — Reliability of the projection (higher = more data).

### Goalie Projections
- Based on projected wins, saves, shutouts, goals against.
- Considers starter confirmation, GAA & SV% trends.
- High-Danger Save Pct as a skill indicator.
- Goals Saved Above Expected (GSAx) for true talent assessment.

## Default Fantasy Scoring
**Skaters:** Goals 3 | Assists 2 | PPP +1 | SHP +2 | SOG 0.4 | BLK 0.5 | HIT 0.2 | PIM 0.5
**Goalies:** W 4 | SO 3 | SV 0.2 | GA −1

If the user's league has custom scoring (provided in context), always use those values instead.

## What You Help With
1. **Start / Sit** — Use projections, matchups, schedule. Give a clear pick, not "it depends."
2. **Trade Analysis** — Evaluate both sides, factor in schedule and projections, then give a verdict.
3. **Waiver Wire** — Identify undervalued free agents via xG vs. actual divergence.
4. **Roster Strategy** — Lineup optimization, IR management, streaming goalies.
5. **Matchup Analysis** — Win probability, key players, schedule advantages.
6. **Player Deep Dive** — Stats, trends, projections, comparisons.
7. **General Hockey** — NHL trends, team performance, league news.

## Response Guidelines
- Reference specific data when available (stats, projections, schedule).
- Explain reasoning, especially when xG or projection factors are involved.
- Flag uncertainty: "His projection looks solid, but the confidence score is low…"
- For trades: evaluate both sides fairly, then state your recommendation clearly.
- Stay focused and actionable. Managers want answers, not essays.`;

// ── Helpers ──────────────────────────────────────────────────────
function makeJsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Try to check rate limit. Returns { allowed, used } or null if table missing.
async function checkRateLimit(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await serviceClient
      .from("stormy_chat_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", cutoff);

    if (error) {
      // Table likely doesn't exist yet — fail open
      console.warn("Rate-limit check skipped (table missing?):", error.message);
      return null;
    }

    const used = count ?? 0;
    return { allowed: used < DAILY_MESSAGE_LIMIT, used };
  } catch {
    return null;
  }
}

async function logUsage(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  tokensUsed: number,
  preview: string,
): Promise<void> {
  try {
    await serviceClient.from("stormy_chat_log").insert({
      user_id: userId,
      tokens_used: tokensUsed,
      message_preview: preview.substring(0, 200),
    });
  } catch {
    // Non-critical — don't fail the request
  }
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
      console.error("ANTHROPIC_API_KEY is not set. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...");
      throw new Error(
        "AI service is not configured yet. The team is on it!",
      );
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

    const {
      data: { user },
    } = await authClient.auth.getUser();

    // ── Rate Limiting (authenticated users only) ───────────────
    if (user && supabaseServiceKey) {
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      const rl = await checkRateLimit(serviceClient, user.id);

      if (rl && !rl.allowed) {
        return makeJsonResponse(
          {
            error: `You've hit your daily limit of ${DAILY_MESSAGE_LIMIT} messages. It resets in 24 hours — come back soon!`,
            limit: DAILY_MESSAGE_LIMIT,
            used: rl.used,
          },
          429,
        );
      }
    }

    // ── Parse request ──────────────────────────────────────────
    const { message, conversationHistory, context } = await req.json();

    if (!message || typeof message !== "string") {
      return makeJsonResponse({ error: "Message is required" }, 400);
    }

    // ── Build system prompt with context ───────────────────────
    let systemPrompt = SYSTEM_PROMPT;
    if (context && typeof context === "string" && context.length > 0) {
      systemPrompt += "\n\n## Current User Context\n" + context;
    }

    // ── Build messages array ───────────────────────────────────
    const messages: Array<{ role: string; content: string }> = [];

    if (Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: String(msg.content),
          });
        }
      }
    }
    messages.push({ role: "user", content: message });

    // ── Call Claude API ────────────────────────────────────────
    console.log(
      `Stormy: calling Claude (${CLAUDE_MODEL}) with ${messages.length} messages, context: ${context ? context.length : 0} chars`,
    );

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
      throw new Error(
        `AI service returned an error (${response.status}). Try again in a moment.`,
      );
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const tokensUsed = inputTokens + outputTokens;

    // ── Log usage (fire-and-forget) ────────────────────────────
    if (user && supabaseServiceKey) {
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      logUsage(serviceClient, user.id, tokensUsed, message);
    }

    // ── Respond ────────────────────────────────────────────────
    return makeJsonResponse({
      response: aiResponse,
      usage: {
        messagesUsed: 0, // Will be filled by rate limit check next call
        dailyLimit: DAILY_MESSAGE_LIMIT,
        inputTokens,
        outputTokens,
      },
    });
  } catch (error) {
    console.error("Error in stormy-chat:", error);
    return makeJsonResponse(
      {
        error: error instanceof Error
          ? error.message
          : "Something went wrong. Try again in a moment.",
      },
      500,
    );
  }
});
