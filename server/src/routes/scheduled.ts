import { Hono } from 'hono';
import type { Env } from '../app';
import { getSupabaseAdmin } from '../lib/supabase';
import { readAllPaged } from '../lib/pagedRead';
import { MatchupService } from '../services/MatchupService';
import { NewsRoomService } from '../services/NewsRoomService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger } from '@citrus/shared';
import { generateCitrusNews } from '../services/CitrusNewsService';

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
/**
 * POST /api/scheduled/lock-completed-days
 *
 * Task A3. Locks fantasy_daily_rosters rows for every roster_date whose
 * NHL games are all 'final'. Same logic as MatchupService.lockCompletedDays
 * (previously reachable only from a commissioner-manual endpoint) but
 * driven by a shared-secret cron trigger — the launch requirement is a
 * FIXED DAILY TIME lock rather than commissioner-manual, so rows stop
 * being mutable forever.
 *
 * Idempotent: already-locked rows are filtered by `.eq('is_locked', false)`
 * inside the service, so re-running is a no-op.
 */
scheduledRoutes.post('/lock-completed-days', async (c) => {
  const admin = getSupabaseAdmin();
  const service = new MatchupService(admin);
  try {
    const { lockedCount, error } = await service.lockCompletedDays();
    if (error) {
      logger.error('[scheduled.lock-completed-days] failed:', error);
      return fail(c, AppError.internal(
        error instanceof Error ? error.message : String(error),
      ));
    }
    logger.info('[scheduled.lock-completed-days] locked_count=', lockedCount);
    return ok(c, { lockedCount });
  } catch (err) {
    logger.error('[scheduled.lock-completed-days] unexpected:', err);
    return fail(c, AppError.internal(
      err instanceof Error ? err.message : String(err),
    ));
  }
});

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


/**
 * POST /api/scheduled/waiver-process
 *
 * SETTINGS-ENFORCEMENT (2026-08-16) — the missing ignition. The waiver
 * processors (process_all_pending_waivers, process_faab_waivers_for_league)
 * existed with NO scheduled caller: claims sat pending forever unless a
 * commissioner manually hit process-all. Industry standard is automatic
 * processing at the league's configured time (~3 AM at ESPN).
 *
 * Called hourly by .github/workflows/daily-waiver-process.yml (cron
 * "10 * * * *"). Honors each league's `waiver_process_time` via
 * `should_process_waivers_now(p_league_id)`, which is true when the
 * league holds a claim that was already pending at its last due moment
 * and nothing in that league has been processed since. Falls back to
 * processing (loudly) if that RPC errors: better processed at the wrong
 * hour than never.
 */
scheduledRoutes.post('/waiver-process', async (c) => {
  const admin = getSupabaseAdmin();
  try {
    // PAGED (2026-09-03). This drives WHICH leagues get their waivers
    // processed at all, and pending claims are platform-wide: a few
    // thousand leagues each carrying a handful of pending claims puts
    // this read past PostgREST's 1,000-row clamp on an ordinary
    // Tuesday. Clamped, the endpoint returned HTTP 200, derived a
    // short league list, and reported success - the leagues outside
    // the window simply never had their waivers run, with no error
    // anywhere. `id` is the primary key and is selected so the paging
    // sort is unique per row; only `league_id` is read below, exactly
    // as before.
    const { data: pending } = await readAllPaged<{ id: string; league_id: string }>(
      admin,
      {
        table: 'waiver_claims',
        columns: 'id, league_id',
        filters: [['status', 'pending']],
        orderBy: ['id'],
      },
    );
    const leagueIds = [...new Set((pending ?? []).map((r) => r.league_id))];
    if (leagueIds.length === 0) return ok(c, { processed: 0, leagues: [] });

    const results: Array<Record<string, unknown>> = [];

    for (const leagueId of leagueIds) {
      const { data: league } = await admin
        .from('leagues')
        .select('waiver_type, waiver_process_time')
        .eq('id', leagueId)
        .single();

      // WAIVER-SCHEDULING (2026-09-03) - this gate was dead twice over.
      // It passed { p_league_id } to should_process_waivers_now(), which
      // takes NO arguments in production, so PostgREST answered PGRST202
      // and `!dueErr` was always false; and that function returns SETOF a
      // row, so `due === false` could never be true for the array
      // supabase-js hands back. Every league with a pending claim was
      // processed on every hourly run, at any hour of the day.
      // Migration 20260903191000 adds the scalar per-league overload.
      const { data: due, error: dueErr } = await admin.rpc('should_process_waivers_now', {
        p_league_id: leagueId,
      });
      if (dueErr) {
        // Fail OPEN, as before: a claim processed at the wrong hour beats a
        // claim never processed. But say so - the silent version of this
        // fallback is exactly what hid the defect.
        logger.error(
          `[scheduled.waiver-process] due-gate unavailable for league ${leagueId}, processing anyway:`,
          dueErr.message,
        );
      } else if (due !== true) {
        results.push({ leagueId, skipped: 'not_due_yet' });
        continue;
      }

      if (league?.waiver_type === 'faab') {
        const { data, error } = await admin.rpc('process_faab_waivers_for_league', {
          p_league_id: leagueId,
        });
        results.push({ leagueId, type: 'faab', error: error?.message ?? null, claims: data ?? null });
      } else {
        // WAIVER-SCHEDULING (2026-09-03) - was process_all_pending_waivers(),
        // which loops over EVERY non-faab league holding a pending claim and
        // has no time predicate of its own. One league coming due therefore
        // dragged every other league's waivers through with it, at that
        // league's hour. process_waiver_claims(uuid) is the per-league body
        // that global wrapper already calls in its loop.
        // The wrapper also expires player_waiver_status rows; that
        // housekeeping still runs daily as pg_cron job 2.
        const { data, error } = await admin.rpc('process_waiver_claims', {
          p_league_id: leagueId,
        });
        results.push({ leagueId, type: 'rolling', error: error?.message ?? null, claims: data ?? null });
      }
    }
    // NOTIFICATIONS (2026-08-16) — waiver RESULTS were silent: claims
    // resolved and nobody was told. Notify each human owner whose claim
    // just resolved (window covers this run; a run that dies between
    // processing and notifying drops that batch's notifications — v1
    // accepted trade-off, claims themselves are never lost).
    try {
      const windowIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: resolved } = await admin
        .from('waiver_claims')
        .select('id, league_id, team_id, player_id, status, failure_reason, processed_at')
        .in('status', ['successful', 'failed'])
        .gte('processed_at', windowIso)
        .limit(500);

      if (resolved && resolved.length > 0) {
        const teamIds = [...new Set(resolved.map((r) => r.team_id as string))];
        const playerIds = [...new Set(resolved.map((r) => r.player_id as number))];
        const [{ data: owners }, { data: players }] = await Promise.all([
          admin.from('teams').select('id, owner_id').in('id', teamIds),
          admin.from('player_directory').select('player_id, full_name').in('player_id', playerIds),
        ]);
        const ownerByTeam = new Map((owners ?? []).map((t) => [t.id as string, t.owner_id as string | null]));
        const nameById = new Map((players ?? []).map((p) => [Number(p.player_id), p.full_name as string]));

        const rows = resolved.flatMap((cl) => {
          const ownerId = ownerByTeam.get(cl.team_id as string);
          if (!ownerId) return []; // AI team — no one to notify
          const player = nameById.get(Number(cl.player_id)) ?? 'your target player';
          const won = cl.status === 'successful';
          return [{
            league_id: cl.league_id,
            user_id: ownerId,
            // TYPE (2026-09-04 TestFlight audit). Was 'waiver_result',
            // which public.notifications' CHECK constraint does not admit:
            // notifications_type_check allows only ADD, DROP, WAIVER,
            // TRADE, CHAT and SYSTEM. Every insert here therefore failed
            // with 23514, and because these rows go in as ONE batch a
            // single bad type killed the whole batch. The catch below
            // logged it and the endpoint still returned 200, so waiver
            // results have been silent since they shipped on 2026-08-16.
            // Confirmed against production: notifications has never held a
            // row of any type outside the six the constraint names.
            type: 'WAIVER',
            title: won ? 'Waiver Claim Successful' : 'Waiver Claim Missed',
            message: won
              ? `${player} is now on your roster.`
              : `Your claim for ${player} did not go through${cl.failure_reason ? `: ${cl.failure_reason}` : '.'}`,
            metadata: { claim_id: cl.id, player_id: cl.player_id, status: cl.status },
          }];
        });
        if (rows.length > 0) {
          await admin.from('notifications').insert(rows);
        }
      }
    } catch (notifyErr) {
      logger.error('[scheduled.waiver-process] result notifications failed:', notifyErr);
    }

    return ok(c, { processed: leagueIds.length, results });
  } catch (e) {
    logger.error('[scheduled.waiver-process] failed:', e);
    return fail(c, AppError.internal(e instanceof Error ? e.message : String(e)));
  }
});

/**
 * POST /api/scheduled/trade-review-sweep
 *
 * SETTINGS-ENFORCEMENT (2026-08-16) — trades under league review whose
 * review window expired previously hung forever: submit_trade_vote
 * blocks late votes, but nothing ever resolved the trade. Industry
 * behaviour: a trade that survives its review period un-vetoed EXECUTES.
 */
scheduledRoutes.post('/trade-review-sweep', async (c) => {
  const admin = getSupabaseAdmin();
  try {
    // VETO-BYPASS FIX (2026-08-23, found during launch QA): this route
    // used to run its OWN sweep — select expired under_review rows and
    // execute_trade every one of them, never reading trade_votes. The
    // veto-aware `process_expired_trade_reviews()` (threshold =
    // GREATEST(CEIL((teams-2)*veto_threshold),1), stamps vetoed_at,
    // leaves rosters untouched on veto) existed but had NO caller in
    // the cron path, so in production a league's veto votes were
    // cosmetic: the hourly sweep executed the trade anyway. Delegate to
    // the one implementation that counts votes — verified live on prod
    // (approve outcome AND veto outcome, 2026-08-22/23).
    const { data, error } = await admin.rpc('process_expired_trade_reviews');
    if (error) {
      logger.error('[scheduled.trade-review-sweep] rpc failed:', error);
      return fail(c, AppError.internal(error.message));
    }
    const results = ((data ?? []) as Array<{ trade_id: string; league_id: string; action: string }>)
      .map((r) => ({ tradeId: r.trade_id, leagueId: r.league_id, action: r.action }));

    // OFFER-EXPIRY FIX (2026-08-23): expire stale PENDING offers too —
    // expires_at was written on every proposal but never enforced, so a
    // week-old offer stayed acceptable forever. The accept path now
    // refuses expired offers in-line; this sweep tidies the rows so
    // Trade History tells the truth.
    const nowIso = new Date().toISOString();
    const { data: lapsed, error: expireErr } = await admin
      .from('trade_offers')
      .update({ status: 'expired', processed_at: nowIso, updated_at: nowIso })
      .eq('status', 'pending')
      .lt('expires_at', nowIso)
      .select('id');
    if (expireErr) {
      logger.error('[scheduled.trade-review-sweep] pending-expiry failed:', expireErr);
    }

    return ok(c, {
      swept: results.length,
      results,
      expiredPending: (lapsed ?? []).length,
    });
  } catch (e) {
    logger.error('[scheduled.trade-review-sweep] failed:', e);
    return fail(c, AppError.internal(e instanceof Error ? e.message : String(e)));
  }
});

/**
 * POST /api/scheduled/matchup-sweep
 *
 * AUTONOMY (2026-08-16) — season progression without page visits.
 * update_all_matchup_scores / auto_complete_matchups /
 * auto_generate_playoff_bracket previously ran only when someone opened
 * the right page: a league nobody visited never scored, never completed
 * weeks, never generated its playoff bracket. Yahoo/ESPN/Sleeper advance
 * the season server-side on a schedule; this endpoint is that schedule.
 *
 * Called hourly by .github/workflows/daily-waiver-process.yml (all three
 * RPCs are idempotent — re-running is a no-op). Order matters: scores
 * first (write final numbers), then completion (lock statuses), then
 * playoff generation (self-guarded in SQL: skips unless draft completed,
 * regular season fully complete, auto-playoffs enabled, and no bracket
 * exists for the season).
 */
scheduledRoutes.post('/matchup-sweep', async (c) => {
  const admin = getSupabaseAdmin();
  try {
    // Population: every league whose draft is done. Pre-season or
    // matchup-less leagues no-op inside the RPCs. Deliberately NOT
    // derived from a matchups select — that read caps at db-max-rows
    // (1000) and would silently drop leagues as the table grows.
    //
    // PAGED (2026-09-03). The comment above was right about the
    // mechanism and the replacement read had the same defect: this
    // population is `draft_status='completed'`, which only ever
    // GROWS - every league that has ever finished a draft stays in
    // it. Past 1,000 of them PostgREST returned the first 1,000 with
    // HTTP 200 and the sweep stopped scoring the rest, with nothing
    // in the response to say so. `orderBy: ['id']` is the primary key
    // (the paging contract needs a sort unique per row); the filter
    // is unchanged.
    const { data: leagues, error: lErr } = await readAllPaged<{ id: string }>(
      admin,
      {
        table: 'leagues',
        columns: 'id',
        filters: [['draft_status', 'completed']],
        orderBy: ['id'],
      },
    );
    if (lErr) return fail(c, AppError.internal(lErr.message));

    const scored: Array<Record<string, unknown>> = [];
    for (const lg of leagues ?? []) {
      // Post-draft waiver priority (inverse draft order) — idempotent
      // no-op for every league that already has rows. Industry behaviour
      // Yahoo/ESPN set at draft completion; the sweep is our guarantee.
      try {
        await admin.rpc('initialize_waiver_priority', { p_league_id: lg.id });
      } catch { /* non-critical; next sweep retries */ }

      const { data, error } = await admin.rpc('update_all_matchup_scores', {
        p_league_id: lg.id,
      });
      const updated = Array.isArray(data)
        ? data.filter((r: { updated?: boolean }) => r.updated).length
        : 0;
      if (error || updated > 0) {
        scored.push({ leagueId: lg.id, updated, error: error?.message ?? null });
      }
    }

    const { data: completedRows, error: cErr } = await admin.rpc('auto_complete_matchups');
    const completedCount = Array.isArray(completedRows)
      ? ((completedRows[0] as { updated_count?: number } | undefined)?.updated_count ?? 0)
      : 0;

    const playoffs: Array<Record<string, unknown>> = [];
    for (const lg of leagues ?? []) {
      const { data, error } = await admin.rpc('auto_generate_playoff_bracket', {
        p_league_id: lg.id,
      });
      const outcome = data as { skipped?: string } | null;
      // Only report leagues where something happened or went wrong —
      // the common self-skip cases would drown the log otherwise.
      if (error || !outcome?.skipped) {
        playoffs.push({ leagueId: lg.id, result: data ?? null, error: error?.message ?? null });
      }
    }

    // Round advancement: time-guarded in SQL (only rounds whose matchup
    // weeks are fully completed advance), commissioner-gated function is
    // invoked under a transaction-local claim by the definer wrapper.
    const { data: advanced, error: advErr } = await admin.rpc('auto_advance_playoff_rounds');

    logger.info(
      '[scheduled.matchup-sweep] leagues=', (leagues ?? []).length,
      'completed=', completedCount,
    );
    return ok(c, {
      leagues: (leagues ?? []).length,
      scored,
      completedMatchups: completedCount,
      completeError: cErr?.message ?? null,
      playoffs,
      roundsAdvanced: advanced ?? [],
      advanceError: advErr?.message ?? null,
    });
  } catch (e) {
    logger.error('[scheduled.matchup-sweep] failed:', e);
    return fail(c, AppError.internal(e instanceof Error ? e.message : String(e)));
  }
});

/**
 * POST /api/scheduled/generate-news
 *
 * Runs the Citrus News detectors and persists whatever they find. Safe to call
 * on any cadence: dedupe_key is UNIQUE and inserts ignore conflicts, so a note
 * is published once and its published_at never moves. Re-running is a no-op
 * rather than a republish — which is the whole point, because a timestamp that
 * changes on every run is the dishonesty the fabricated news fallback was
 * guilty of.
 *
 * Optional body: { "season": 2025 } to regenerate a specific season.
 */
scheduledRoutes.post('/generate-news', async (c) => {
  try {
    const admin = getSupabaseAdmin();

    let season: number | undefined;
    try {
      const body = await c.req.json<{ season?: number }>();
      if (body && Number.isFinite(body.season)) season = Number(body.season);
    } catch {
      // No body is the normal case for a cron invocation.
    }

    const result = await generateCitrusNews(admin, season ? { season } : {});
    logger.info(
      '[scheduled.generate-news] phase=', result.phase,
      'season=', result.season,
      'generated=', result.generated,
      'inserted=', result.inserted,
      'errors=', result.errors.length,
    );
    return ok(c, result);
  } catch (e) {
    logger.error('[scheduled.generate-news] failed:', e);
    return fail(c, AppError.internal(e instanceof Error ? e.message : String(e)));
  }
});


/**
 * POST /api/scheduled/news-ingest (2026-09-05)
 *
 * The News Room's hourly read of the wires: every enabled source in
 * news_sources, one run row each in news_ingest_runs. A source that fails
 * is a row with an error, not a failed request; the response carries every
 * run so the trigger's log shows the shape of the hour.
 */
scheduledRoutes.post('/news-ingest', async (c) => {
  try {
    const runs = await new NewsRoomService(getSupabaseAdmin()).ingest();
    const totals = runs.reduce(
      (t, r) => ({ seen: t.seen + r.seen, inserted: t.inserted + r.inserted, matched: t.matched + r.matched, errors: t.errors + r.errors }),
      { seen: 0, inserted: 0, matched: 0, errors: 0 },
    );
    logger.info(`[scheduled] news-ingest: ${runs.length} sources, ${totals.inserted} new of ${totals.seen} seen, ${totals.matched} matched, ${totals.errors} errors`);
    return ok(c, { runs, totals });
  } catch (err) {
    return handleError(c, err, 'news-ingest failed');
  }
});

export { scheduledRoutes };
