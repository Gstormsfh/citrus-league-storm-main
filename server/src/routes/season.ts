/**
 * Season API — one endpoint answering "is there hockey right now".
 *
 *   GET /api/season/status[?date=YYYY-MM-DD]
 *
 * The response is the raw schedule facts plus the derived status, both from
 * `@citrus/shared`, so the browser can re-derive rather than trust a shape it
 * cannot check. `date` exists for tests and for the harness; it is not used
 * by the app.
 *
 * Behind `authMiddleware` like every other route here. It reads nothing
 * user-specific — `nhl_games` is league-agnostic — but an unauthenticated
 * surface is a surface, and the schedule is not worth one.
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { SeasonPhaseService } from '../services/SeasonPhaseService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { deriveSeasonStatus, getTodayMST } from '@citrus/shared';

const seasonRoutes = new Hono<Env>();

seasonRoutes.use('*', authMiddleware);

seasonRoutes.get('/status', async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));

    const date = c.req.query('date') || getTodayMST();
    const service = new SeasonPhaseService(supabase);
    const { result, error } = await service.getScheduleFacts(date);

    // No fabricated fallback. The client's `unknown` phase is designed for
    // exactly this: render the app's normal self and claim nothing about the
    // season. A synthesised "offseason" here would be a lie with a 200 on it.
    if (error) return handleError(c, new Error(error.message), 'Failed to read the schedule');
    if (!result) return fail(c, AppError.badRequest('Invalid date'));

    return ok(c, { facts: result, status: deriveSeasonStatus(result) });
  } catch (error) {
    return handleError(c, error, 'Failed to read the schedule');
  }
});

export { seasonRoutes };
