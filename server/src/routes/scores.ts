/**
 * Scores API — the live scoreboard for one day, with Citrus projections.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ REGISTRATION STILL REQUIRED. This branch's file scope excludes         │
 * │ `server/src/app.ts`, so these routes are not mounted yet. Two lines    │
 * │ there make them live, beside the other `app.route(...)` calls:         │
 * │                                                                        │
 * │     import { scoresRoutes } from './routes/scores';                    │
 * │     app.route('/api/scores', scoresRoutes);                            │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Endpoints:
 *   GET /api/scores?date=YYYY-MM-DD&leagueId=<uuid>
 *   GET /api/scores/game/:gameId?leagueId=<uuid>
 *
 * Both sit behind `authMiddleware` and read through `createUserClient`, so
 * RLS applies exactly as it does for the sibling schedule and matchup routes.
 * `leagueId` is optional; when supplied it is checked against
 * `LeagueMembershipService` before any league data is touched, because it
 * arrives as a query parameter and so cannot use `membershipMiddleware`
 * (which reads `:leagueId` off the path).
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { ScoresService } from '../services/ScoresService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { getTodayMST } from '@citrus/shared';

const scoresRoutes = new Hono<Env>();

scoresRoutes.use('*', authMiddleware);

/**
 * Resolve the optional league context.
 *
 * Returns `{ leagueId: null }` when none was asked for, and an AppError when
 * one was asked for that the caller is not a member of. A caller who passes a
 * league they do not belong to gets a 403 rather than a scoreboard with the
 * league silently dropped, because silently dropping it would show them a
 * page that looks like their league has nobody in tonight's games.
 */
async function resolveLeague(
  supabase: ReturnType<typeof createUserClient>,
  leagueId: string | undefined,
  userId: string,
): Promise<{ leagueId: string | null; error: AppError | null }> {
  if (!leagueId) return { leagueId: null, error: null };

  const membership = new LeagueMembershipService(supabase);
  const result = await membership.checkMembership(leagueId, userId);
  if (!result.isMember) {
    return {
      leagueId: null,
      error: AppError.forbidden('Access denied: You are not a member of this league'),
    };
  }
  return { leagueId, error: null };
}

// GET /api/scores — one day's games. Defaults to today in Mountain Time.
scoresRoutes.get('/', async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));
    const userId = c.get('userId') as string;

    const league = await resolveLeague(supabase, c.req.query('leagueId'), userId);
    if (league.error) return fail(c, league.error);

    const date = c.req.query('date') || getTodayMST();
    const service = new ScoresService(supabase);
    const { result, error } = await service.getDay(date, { leagueId: league.leagueId, userId });

    if (error) return handleError(c, new Error(error.message), 'Failed to fetch scores');
    if (!result) return fail(c, AppError.badRequest('Invalid date'));

    // 15s, matching the playoff live-games route. Long enough to blunt a
    // traffic spike, short enough that a goal is on screen within a refresh.
    c.header('Cache-Control', 'private, max-age=15');
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch scores');
  }
});

// GET /api/scores/game/:gameId — one game, every projected player in it.
scoresRoutes.get('/game/:gameId', async (c) => {
  try {
    const gameId = Number(c.req.param('gameId'));
    if (!Number.isInteger(gameId)) {
      return fail(c, AppError.badRequest('gameId must be an integer'));
    }

    const supabase = createUserClient(c.get('userToken'));
    const userId = c.get('userId') as string;

    const league = await resolveLeague(supabase, c.req.query('leagueId'), userId);
    if (league.error) return fail(c, league.error);

    const service = new ScoresService(supabase);
    const { result, error } = await service.getGameDetail(gameId, {
      leagueId: league.leagueId,
      userId,
    });

    if (error) return handleError(c, new Error(error.message), 'Failed to fetch game');
    if (!result) return fail(c, AppError.notFound('Game not found'));

    c.header('Cache-Control', 'private, max-age=15');
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch game');
  }
});

export { scoresRoutes };
