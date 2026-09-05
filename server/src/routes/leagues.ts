import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
import { LeagueService } from '../services/LeagueService';
import { SeasonStateService } from '../services/SeasonStateService';
import { TeamAnalyticsService } from '../services/TeamAnalyticsService';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';
import { mirrorRulesIntoSettings, settingsDiffer } from '../lib/scoringMirror';
import { getCurrentSeason, logger } from '@citrus/shared';

const leagueRoutes = new Hono<Env>();

leagueRoutes.use('*', authMiddleware);

// GET /api/leagues — Get all leagues for the authenticated user
leagueRoutes.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const supabase = createUserClient(c.get('userToken'));
    const service = new LeagueService(supabase);

    const { leagues, error } = await service.getUserLeagues(userId);
    if (error) {
      return handleError(c, error, 'Failed to fetch leagues');
    }

    return ok(c, leagues);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch leagues');
  }
});

// GET /api/leagues/:leagueId — Get a specific league
leagueRoutes.get('/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { league, error } = await service.getLeague(leagueId, userId);
    if (error || !league) {
      return fail(c, AppError.notFound('League'));
    }
    return ok(c, league);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch league');
  }
});

// GET /api/leagues/:leagueId/season-state — Is the fantasy season complete?
leagueRoutes.get('/:leagueId/season-state', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new SeasonStateService(supabase);
  const state = await service.isSeasonComplete(leagueId);
  return ok(c, state);
});

// POST /api/leagues — Create a new league
leagueRoutes.post('/', validateBody(schemas.createLeague), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.createLeague>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.createLeague(
    body.name,
    userId,
    body.roster_size,
    body.draft_rounds,
    body.settings as Record<string, unknown> | undefined,
    body.scoring_settings as Record<string, number> | undefined,
    body.waiver_settings as Record<string, unknown> | undefined,
  );

  if (error || !league) {
    // ERROR PASSTHROUGH (2026-08-17): Postgres trigger refusals arrive as
    // error OBJECTS ({ message }), and the old string-only check collapsed
    // them into a generic "Failed to create league" — the 2-team draft-
    // night test hid "Playoff teams (6) cannot exceed total teams (2)"
    // behind exactly that. Surface the DB's user-facing message.
    const detail =
      typeof error === 'string'
        ? error
        : (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to create league');
    return fail(c, AppError.badRequest(detail));
  }

  const audit = new AuditService(supabase);
  audit.logLeagueEvent('LEAGUE_CREATE', league.id, { name: body.name });

  return created(c, { league, team });
});

// POST /api/leagues/join — Join a league by invite code
leagueRoutes.post('/join', validateBody(schemas.joinLeague), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.joinLeague>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.joinLeagueByCode(
    body.joinCode,
    userId,
    body.teamName,
  );

  if (error) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to join league'));
  }

  if (league) {
    const audit = new AuditService(supabase);
    audit.logLeagueEvent('LEAGUE_JOIN', league.id, { joinCode: body.joinCode });
  }

  return created(c, { league, team });
});

// PUT /api/leagues/:leagueId/settings — Update league settings (commissioner only)
leagueRoutes.put('/:leagueId/settings', commissionerMiddleware, validateBody(schemas.leagueSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.leagueSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { league, error } = await service.updateSettings(
      leagueId,
      userId,
      body.settings as Record<string, unknown>,
      body.scoring_settings as Record<string, number> | undefined,
    );

    if (error) {
      return handleError(c, error, 'Failed to update settings');
    }

    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', leagueId, { action: 'update_settings', changedBy: userId });

    return ok(c, league);
  } catch (err) {
    return handleError(c, err, 'Failed to update settings');
  }
});

// PUT /api/leagues/:leagueId/waiver-settings — Update waiver settings
leagueRoutes.put('/:leagueId/waiver-settings', commissionerMiddleware, validateBody(schemas.waiverSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.waiverSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateWaiverSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update waiver settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update waiver settings');
  }
});

// PUT /api/leagues/:leagueId/scoring-settings — Update scoring settings
leagueRoutes.put('/:leagueId/scoring-settings', commissionerMiddleware, validateBody(schemas.scoringSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.scoringSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateScoringSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update scoring settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update scoring settings');
  }
});

// PUT /api/leagues/:leagueId/draft-settings — Update draft settings
leagueRoutes.put('/:leagueId/draft-settings', commissionerMiddleware, validateBody(schemas.draftSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.draftSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateDraftSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update draft settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update draft settings');
  }
});

// PUT /api/leagues/:leagueId/roster-slots — Update roster slot settings
leagueRoutes.put('/:leagueId/roster-slots', commissionerMiddleware, validateBody(schemas.rosterSlots), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.rosterSlots>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateRosterSlotSettings(leagueId, userId, body.rosterSlots);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update roster slots'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update roster slots');
  }
});

// PUT /api/leagues/:leagueId/keeper-settings — Update keeper settings
leagueRoutes.put('/:leagueId/keeper-settings', commissionerMiddleware, validateBody(schemas.keeperSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.keeperSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateKeeperSettings(leagueId, userId, body as any);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update keeper settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update keeper settings');
  }
});

// PUT /api/leagues/:leagueId/category-settings — Update category settings
leagueRoutes.put('/:leagueId/category-settings', commissionerMiddleware, validateBody(z.object({
  categories: z.array(z.string()).min(2, 'At least 2 categories are required'),
})), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<{ categories: string[] }>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateCategorySettings(leagueId, userId, body.categories);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update category settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update category settings');
  }
});

// GET /api/leagues/:leagueId/teams — Get all teams in a league
//
// Every row carries `avatar_url`: the OWNER's profiles.avatar_url joined by
// owner_id (2026-09-01, Sleeper parity audit M8), null for AI teams and
// owners without a picture. The matchup header and scoreboard discs read
// it; teams have no avatar column of their own yet. Explicit columns on
// the profiles read (LeagueService.attachOwnerAvatars); membership is
// checked by the middleware above before any of it runs.
leagueRoutes.get('/:leagueId/teams', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const withOwners = c.req.query('withOwners') === 'true';
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  if (withOwners) {
    // Owner names and the avatar come from the same profiles read.
    const { teams, error } = await service.getLeagueTeamsWithOwners(leagueId);
    if (error) return handleError(c, error, 'Failed to fetch teams');
    return ok(c, teams);
  }

  const { teams, error } = await service.getLeagueTeams(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch teams');
  return ok(c, await service.attachOwnerAvatars(teams));
});

// GET /api/leagues/:leagueId/teams/:teamId/analytics — projected vs actual
//
// Returns RAW projected and actual totals. The calibration that turns those
// into "% of expectation" lives in apps/web/src/utils/teamAnalytics.ts and is
// deliberately not duplicated here — the projection model runs hot, the
// correction is a stated constant, and one place to state it beats two places
// to let it drift.
leagueRoutes.get('/:leagueId/teams/:teamId/analytics', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const seasonParam = c.req.query('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : getCurrentSeason();

  if (!Number.isFinite(season)) {
    return fail(c, AppError.badRequest('Invalid season'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new TeamAnalyticsService(supabase);

  const { data, error } = await service.getProjectedVsActual(leagueId, teamId, season);
  if (error) return handleError(c, error, 'Failed to fetch team analytics');

  return ok(c, data);
});

// GET /api/leagues/:leagueId/standings — Get league standings
leagueRoutes.get('/:leagueId/standings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { standings, error } = await service.getStandings(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch standings');
  return ok(c, standings);
});

// GET /api/leagues/:leagueId/my-team — Get user's team in a league
leagueRoutes.get('/:leagueId/my-team', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { team, error } = await service.getUserTeam(leagueId, userId);
  if (error) return handleError(c, error, 'Failed to fetch team');
  return ok(c, team);
});

// DELETE /api/leagues/:leagueId/teams/:teamId — Delete a team (commissioner only)
leagueRoutes.delete('/:leagueId/teams/:teamId', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.deleteTeam(teamId, leagueId, userId);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to delete team'));
    }

    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', leagueId, { action: 'delete_team', teamId, deletedBy: userId });

    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to delete team');
  }
});

// POST /api/leagues/:leagueId/simulate-fill — Add AI teams to fill league (commissioner only)
// Uses admin client because AI teams have owner_id=null which RLS blocks on user-scoped clients.
leagueRoutes.post('/:leagueId/simulate-fill', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');

  try {
    const body = await c.req.json();
    const teamNames: string[] = body.teamNames || [];

    if (!teamNames.length) {
      return fail(c, AppError.badRequest('No team names provided'));
    }

    // Use admin client to bypass RLS — AI teams have null owner_id
    const adminClient = getSupabaseAdmin();

    // SEAT CAP (2026-09-04 funnel audit). This route inserted exactly what
    // the client asked for, with no idea how many seats the league has.
    // The count the caller sends is `league_size - teams.length` computed
    // from a team list the draft lobby fetches once, so two lobbies open
    // at the same time (two tabs, phone + laptop) both compute "11 open"
    // and both fill: 23 teams in a 12-team league.
    //
    // That is not a cosmetic overfill. start_draft_v2 hard-requires
    // round-1 team_order length === league_size, so the league can never
    // start again — and the v2 lobby has no delete-team control, so there
    // is no way back from inside the product. Clamp to the seats that are
    // actually open and refuse outright when there are none.
    const { data: leagueRow, error: leagueErr } = await adminClient
      .from('leagues')
      .select('league_size')
      .eq('id', leagueId)
      .single();
    if (leagueErr) return handleError(c, leagueErr, 'Failed to add AI teams');

    const leagueSize = (leagueRow as { league_size: number | null } | null)?.league_size ?? null;
    let wanted = teamNames;
    if (leagueSize !== null && leagueSize > 0) {
      const { count, error: countErr } = await adminClient
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId);
      if (countErr) return handleError(c, countErr, 'Failed to add AI teams');

      const openSeats = leagueSize - (count ?? 0);
      if (openSeats <= 0) {
        return fail(
          c,
          AppError.badRequest(
            `This league already has all ${leagueSize} teams. Refresh the lobby to see them.`,
          ),
        );
      }
      wanted = teamNames.slice(0, openSeats);
    }

    const rows = wanted.map(name => ({
      league_id: leagueId,
      team_name: name,
      owner_id: null,
    }));

    const { data: teams, error } = await adminClient
      .from('teams')
      .insert(rows)
      .select('id, team_name');

    if (error) return handleError(c, error, 'Failed to add AI teams');

    // F14(a) (2026-08-03): no clearCache call — AI teams write
    // owner_id=null so no user's isMember/isCommissioner flips from
    // this operation. If a future revision assigns AI teams to a
    // real user (co-manager style), add clearCache(leagueId, ownerId)
    // adjacent to the write. Leaving the sentinel comment so nobody
    // greps for "F14" here and thinks it was forgotten.

    const audit = new AuditService(createUserClient(c.get('userToken')));
    audit.log('ADMIN_ACTION', leagueId, { action: 'add_ai_teams', count: (teams || []).length, addedBy: userId });

    return ok(c, { teams: teams || [], count: (teams || []).length });
  } catch (err) {
    return handleError(c, err, 'Failed to add AI teams');
  }
});

// GET /api/leagues/:leagueId/transactions — Get transaction history
leagueRoutes.get('/:leagueId/transactions', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { transactions, error } = await service.fetchTransactions(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch transactions');
  return ok(c, transactions);
});


// ---------------------------------------------------------------------------
// Scoring RULES — the data-driven replacement for the twelve categories that
// used to be hardcoded in calculate_daily_matchup_scores.
//
// stat_catalog holds the vocabulary (35 stats). league_scoring_rules holds one
// multiplier per league per stat, with league_id 00000000-... as the explicit
// global default. Adding a category is a row, not a migration.
//
// The legacy leagues.scoring_settings JSONB is now redundant — every league that
// had one was migrated verbatim. Do not write both.
// ---------------------------------------------------------------------------

// GET /api/leagues/:leagueId/scoring-rules — catalog + this league's effective weights
leagueRoutes.get('/:leagueId/scoring-rules', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  try {
    const [catalogRes, rulesRes] = await Promise.all([
      supabase
        .from('stat_catalog')
        .select('stat_key, display_name, applies_to, default_multiplier, is_core, sort_order')
        .order('applies_to')
        .order('sort_order'),
      supabase.rpc('get_effective_scoring_rules', { p_league_id: leagueId }),
    ]);

    if (catalogRes.error) return handleError(c, catalogRes.error, 'Failed to fetch stat catalog');
    if (rulesRes.error) return handleError(c, rulesRes.error, 'Failed to fetch scoring rules');

    const effective = new Map<string, number>(
      ((rulesRes.data ?? []) as Array<{ stat_key: string; multiplier: number }>)
        .map((r) => [r.stat_key, Number(r.multiplier)]),
    );

    const stats = ((catalogRes.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      multiplier: effective.get(s.stat_key as string) ?? Number(s.default_multiplier),
    }));

    return ok(c, { stats });
  } catch (err) {
    return handleError(c, err, 'Failed to fetch scoring rules');
  }
});

// PUT /api/leagues/:leagueId/scoring-rules — commissioner sets weights
leagueRoutes.put('/:leagueId/scoring-rules', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');

  const parsed = z
    .object({
      rules: z
        .array(
          z.object({
            stat_key: z.string().min(1).max(64),
            multiplier: z.number().finite().min(-100).max(100),
          }),
        )
        .min(1)
        .max(100),
    })
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return fail(c, AppError.badRequest('Body must be { rules: [{ stat_key, multiplier }] }'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const admin = getSupabaseAdmin();

  try {
    // Reject unknown stat keys rather than silently persisting a rule that can
    // never score anything.
    const { data: known, error: catErr } = await supabase.from('stat_catalog').select('stat_key');
    if (catErr) return handleError(c, catErr, 'Failed to validate scoring rules');

    const valid = new Set(((known ?? []) as Array<{ stat_key: string }>).map((k) => k.stat_key));
    const unknown = parsed.data.rules.filter((r) => !valid.has(r.stat_key)).map((r) => r.stat_key);
    if (unknown.length > 0) {
      return fail(c, AppError.badRequest(`Unknown stat keys: ${unknown.join(', ')}`));
    }

    const { error: upsertErr } = await admin.from('league_scoring_rules').upsert(
      parsed.data.rules.map((r) => ({
        league_id: leagueId,
        stat_key: r.stat_key,
        multiplier: r.multiplier,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'league_id,stat_key' },
    );
    if (upsertErr) return handleError(c, upsertErr, 'Failed to update scoring rules');

    // SETTINGS PASS-THROUGH (2026-09-05): fold the effective rules back into
    // leagues.scoring_settings so ScoresService, TeamAnalytics and the client's
    // ScoringCalculator score with the weights the commissioner just set. The
    // trigger on that column re-upserts the same rules: idempotent. A failure
    // here is logged, not returned; the rules (the scorer's truth) are saved.
    try {
      const [catalogRes, effectiveRes, leagueRes] = await Promise.all([
        admin.from('stat_catalog').select('stat_key, applies_to'),
        admin.rpc('get_effective_scoring_rules', { p_league_id: leagueId }),
        admin.from('leagues').select('scoring_settings').eq('id', leagueId).single(),
      ]);
      if (catalogRes.error) throw new Error(catalogRes.error.message);
      if (effectiveRes.error) throw new Error(effectiveRes.error.message);
      if (leagueRes.error) throw new Error(leagueRes.error.message);
      const mirrored = mirrorRulesIntoSettings(
        leagueRes.data?.scoring_settings ?? null,
        (catalogRes.data ?? []) as Array<{ stat_key: string; applies_to: string }>,
        (effectiveRes.data ?? []) as Array<{ stat_key: string; multiplier: number | string }>,
      );
      if (settingsDiffer(leagueRes.data?.scoring_settings ?? null, mirrored)) {
        const { error: mirrorErr } = await admin.from('leagues').update({ scoring_settings: mirrored }).eq('id', leagueId);
        if (mirrorErr) throw new Error(mirrorErr.message);
      }
    } catch (mirrorFail) {
      logger.error(
        `[leagues] scoring rules saved for ${leagueId} but scoring_settings mirror failed: ${mirrorFail instanceof Error ? mirrorFail.message : String(mirrorFail)}`,
      );
    }

    // NOTE: not audit-logged. AuditService.log takes a closed SecurityEventType
    // union and there is no member for a scoring-rule change. Adding one (and
    // logging here) is a worthwhile follow-up — inventing a string that fails
    // the type is not.
    void userId;

    return ok(c, { success: true, updated: parsed.data.rules.length });
  } catch (err) {
    return handleError(c, err, 'Failed to update scoring rules');
  }
});

export { leagueRoutes };
