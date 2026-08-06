import { Hono } from 'hono';
import type { Env } from '../app';
import { getSupabaseAdmin } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { AppError } from '../lib/errors';
import { ok, fail } from '../lib/responses';
import { logger } from '@citrus/shared';

/**
 * Scheduled / cron routes — NOT authenticated via user JWT.
 *
 * Auth model: shared-secret header `X-Scheduled-Secret` must match
 * `process.env.SCHEDULED_TRIGGER_SECRET`. The secret lives in the Cloud
 * Run env AND in the GitHub Actions secret store. Failing either the
 * env-var-set check or the header match returns a hard 403 — never fall
 * back to an "anyone can trigger" mode.
 *
 * Every handler here uses the admin (service_role) client. Anon and
 * authenticated roles cannot reach this router because it is mounted at
 * a distinct path and does not call authMiddleware.
 */

const scheduledRoutes = new Hono<Env>();

// Shared-secret gate. Runs before every route in this router.
scheduledRoutes.use('*', async (c, next) => {
  const expected = process.env.SCHEDULED_TRIGGER_SECRET;
  if (!expected) {
    logger.error('[scheduled] SCHEDULED_TRIGGER_SECRET not set — refusing all requests');
    return fail(c, AppError.serviceUnavailable('Scheduled endpoints not configured'));
  }
  const provided = c.req.header('X-Scheduled-Secret');
  if (!provided || provided !== expected) {
    return fail(c, AppError.forbidden('Invalid or missing X-Scheduled-Secret header'));
  }
  await next();
});

/**
 * POST /api/scheduled/roster-snapshot-today
 *
 * Task 1A. Writes one fantasy_daily_rosters row per player, per
 * team-in-active-matchup, for TODAY. source='scheduled_snapshot'.
 * Idempotent per (team, matchup, player, roster_date) — existing rows
 * (user_edit, reconstructed, or a prior scheduled_snapshot) are left
 * untouched by the UPSERT.
 *
 * Coverage assertion: the underlying service returns expected vs actual
 * team-matchup counts; a mismatch raises HTTP 500 here. Silent partial
 * writes are exactly the failure class this endpoint exists to eliminate.
 */
scheduledRoutes.post('/roster-snapshot-today', async (c) => {
  const admin = getSupabaseAdmin();
  const service = new MatchupService(admin);
  try {
    const result = await service.snapshotTodayForAllLeagues();
    if (result.expected_team_matchups !== result.actual_team_matchups_written) {
      logger.error('[scheduled.roster-snapshot-today] coverage mismatch:', result);
      return fail(c, AppError.internal(
        `coverage mismatch: expected ${result.expected_team_matchups} team-matchups, ` +
        `wrote ${result.actual_team_matchups_written}. errors=${JSON.stringify(result.errors)}`,
      ));
    }
    logger.info('[scheduled.roster-snapshot-today] complete:', result);
    return ok(c, result);
  } catch (err) {
    logger.error('[scheduled.roster-snapshot-today] failed:', err);
    return fail(c, AppError.internal(
      err instanceof Error ? err.message : String(err),
    ));
  }
});

export { scheduledRoutes };
