/**
 * Stormy AI assistant — POST /api/stormy/chat
 *
 * Chunk 11g.9 (2026-08-24): this route IS Stormy now. It was previously
 * a proxy that forwarded to the `stormy-chat` Supabase Edge Function;
 * that function is retired and its logic lives here.
 *
 * ── WHAT THE OLD PROXY GOT WRONG (all three fixed here) ────────────
 *
 *  1. NOTHING CALLED IT. The web UI calls `StormyService.sendMessage`,
 *     which invoked the Edge Function directly. `apps/web/src/api/
 *     stormy.ts` -> this route was exported but wired to no component.
 *     It carried a strictRateLimit and a membership check that never
 *     ran for a single real user.
 *  2. IT BROKE STREAMING. The proxy did `await response.json()` on an
 *     endpoint that can emit SSE. Any streaming build upstream would
 *     have hung or garbled here.
 *  3. ITS SCHEMA WAS WRONG. `schemas.stormyChat` typed `context` as
 *     `z.record(z.unknown())` (an object), but the client sends a
 *     pre-rendered STRING from `buildContextString`, and never sent
 *     `conversationHistory` at all. A real call would have 400'd.
 *
 * ── RESPONSE MODE: NON-STREAMING, DELIBERATELY ─────────────────────
 *
 * Ported from deployed Edge Function v33, whose own comment records
 * why:
 *
 *   "Reverted from SSE: the deployed web client could not parse the
 *    stream ('I couldn't process that'). Its JSON path is documented
 *    and reliable, and a working answer beats a token-by-token one.
 *    Re-enable streaming only once a client build that reads it is
 *    actually deployed."
 *
 * The repo's copy of the Edge Function still had streaming ON. Do NOT
 * "restore" it here from that file — that is the reverted bug. Adding
 * streaming is a deliberate, client-first piece of work: ship a client
 * that parses SSE, verify it, then switch this route.
 *
 * ── AUTH / SPEND ───────────────────────────────────────────────────
 * authMiddleware supplies userId (the Edge Function had to do its own
 * getUser round-trip; we already have it). Three spend guards run in
 * kill-switch order — monthly token budget, global daily cap, per-user
 * weekly cap — and each returns null on query failure, which is
 * treated as "allowed" so a guard outage cannot take the chat down.
 *
 * ── REQUIRED ENV ───────────────────────────────────────────────────
 *   ANTHROPIC_API_KEY — NOT previously set on the API server; it lived
 *   only as a Supabase Edge secret. Add it to Cloud Run secrets before
 *   deploying this, or every request 503s.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { logger } from '@citrus/shared';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { STORMY_SYSTEM_PROMPT } from '../lib/stormy/systemPrompt';
import {
  CLAUDE_MODEL,
  MAX_CONVERSATION_TURNS,
  MAX_RESPONSE_TOKENS,
  WEEKLY_MESSAGE_LIMIT,
  MONTHLY_TOKEN_BUDGET,
  GLOBAL_DAILY_MESSAGE_LIMIT,
  checkGlobalDailyLimit,
  checkMonthlyTokenBudget,
  checkUserWeeklyLimit,
  logStormyUsage,
  lookupPlayers,
} from '../services/StormyAssistantService';

const stormyRoutes = new Hono<Env>();

stormyRoutes.use('*', authMiddleware);

/**
 * Body schema. `context` is a STRING (the client pre-renders it via
 * buildContextString) — the old shared schema had this as an object,
 * which is part of why the proxy route was unusable.
 */
const StormyChatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  leagueId: z.string().optional(),
  context: z.string().max(64_000).optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    )
    .max(50)
    .optional(),
});

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_TIMEOUT_MS = 60_000;

stormyRoutes.post('/chat', async (c) => {
  const userId = c.get('userId') as string | undefined;
  if (!userId) return fail(c, AppError.unauthorized('Missing user context'));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Same operator-facing hint the Edge Function logged, retargeted at
    // Cloud Run since that is where the secret lives now.
    console.error(
      '[stormy] ANTHROPIC_API_KEY not set — add it to the Cloud Run service secrets.',
    );
    return fail(
      c,
      AppError.serviceUnavailable('AI service is not configured yet. The team is on it!'),
    );
  }

  let body: z.infer<typeof StormyChatBodySchema>;
  try {
    body = StormyChatBodySchema.parse(await c.req.json());
  } catch (err) {
    const detail =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : 'invalid JSON body';
    return fail(c, AppError.badRequest(`invalid_request: ${detail}`));
  }

  const { message, leagueId, context, conversationHistory } = body;

  // League membership gate — preserved from the proxy. Stormy's context
  // can carry another team's roster, so a non-member must not be able
  // to ask questions scoped to a league they are not in.
  if (leagueId) {
    const membership = new LeagueMembershipService(createUserClient(c.get('userToken')));
    const memberCheck = await membership.checkMembership(leagueId, userId);
    if (!memberCheck.isMember) {
      return fail(c, AppError.forbidden('Not a member of this league'));
    }
  }

  try {
    // ── Spend guards, in kill-switch order ─────────────────────────
    const budget = await checkMonthlyTokenBudget(supabaseAdmin);
    if (budget && !budget.allowed) {
      console.warn(
        `[stormy] BUDGET KILL-SWITCH: ${budget.totalTokens}/${MONTHLY_TOKEN_BUDGET} tokens`,
      );
      return fail(
        c,
        new AppError(
          "Stormy has hit the monthly usage cap. We'll be back next month!",
          429,
          'RATE_LIMITED',
        ),
      );
    }

    const globalRL = await checkGlobalDailyLimit(supabaseAdmin);
    if (globalRL && !globalRL.allowed) {
      console.warn(
        `[stormy] GLOBAL DAILY CAP: ${globalRL.used}/${GLOBAL_DAILY_MESSAGE_LIMIT}`,
      );
      return fail(
        c,
        new AppError(
          'Stormy is resting — daily capacity reached. Try again tomorrow!',
          429,
          'RATE_LIMITED',
        ),
      );
    }

    const userRL = await checkUserWeeklyLimit(supabaseAdmin, userId);
    if (userRL && !userRL.allowed) {
      return fail(
        c,
        new AppError(
          `You've used your ${WEEKLY_MESSAGE_LIMIT} Stormy questions for this matchup week. They reset every 7 days!`,
          429,
          'RATE_LIMITED',
        ),
      );
    }

    // ── Build the system prompt ────────────────────────────────────
    // RULE 0 requires the verified-data block; without it the model has
    // no rows to obey and falls back on memory. See
    // StormyAssistantService for why this is not optional.
    let systemPrompt = STORMY_SYSTEM_PROMPT;
    const verified = await lookupPlayers(supabaseAdmin, message);
    if (verified) systemPrompt += verified;
    if (context && context.length > 0) {
      systemPrompt += '\n\n## Current User Context\n' + context.substring(0, 8000);
    }

    // ── Trim conversation for tokens ───────────────────────────────
    const messages: Array<{ role: string; content: string }> = [];
    if (Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-MAX_CONVERSATION_TURNS)) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content).substring(0, 500),
          });
        }
      }
    }
    messages.push({ role: 'user', content: message.substring(0, 1000) });

    logger.log('[stormy] upstream request', {
      model: CLAUDE_MODEL,
      messages: messages.length,
      contextChars: context ? Math.min(context.length, 8000) : 0,
    });

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: systemPrompt,
        messages,
      }),
      signal:
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS)
          : undefined,
    });

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      console.error('[stormy] Claude API error:', upstream.status, errorBody);
      // Surface upstream 429 as 429 so the client's rate-limit copy
      // engages rather than a generic failure.
      if (upstream.status === 429) {
        return fail(
          c,
          new AppError('Stormy is busy right now — try again shortly.', 429, 'RATE_LIMITED'),
        );
      }
      return fail(
        c,
        AppError.badGateway(`AI service error (${upstream.status}). Try again in a moment.`),
      );
    }

    const data = (await upstream.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const aiResponse = data.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    // Fire-and-forget: a failed usage write must not fail a delivered
    // answer, but it must also not be awaited into the response path.
    void logStormyUsage(supabaseAdmin, userId, inputTokens + outputTokens, message);

    return ok(c, {
      response: aiResponse,
      usage: { weeklyLimit: WEEKLY_MESSAGE_LIMIT, inputTokens, outputTokens },
    });
  } catch (err) {
    return handleError(c, err, 'Something went wrong. Try again in a moment.');
  }
});

export { stormyRoutes };
