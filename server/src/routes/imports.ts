/**
 * League history import, trophy room, and member claiming.
 *
 *   POST /api/imports/espn/discover                       any signed-in user; public leagues need no credentials
 *   GET  /api/imports/yahoo/connect                       any signed-in user; where to send the browser
 *   POST /api/imports/yahoo/callback                      any signed-in user; redeems the code Yahoo sent back
 *   GET  /api/imports/yahoo/connection                    any signed-in user; connected or not
 *   DELETE /api/imports/yahoo/connection                  any signed-in user; forget the refresh token
 *   GET  /api/imports/yahoo/leagues                       any signed-in user with a connection; their NHL leagues, by chain
 *   POST /api/leagues/:leagueId/imports/espn              commissioner; starts a background job
 *   POST /api/leagues/:leagueId/imports/yahoo             commissioner; starts a background job
 *   GET  /api/imports/screenshots/status                  any signed-in user; whether the reader is configured
 *   POST /api/leagues/:leagueId/imports/screenshots/read  commissioner; reads screenshots into pages for review (nothing written)
 *   POST /api/leagues/:leagueId/imports/screenshots/:jobId/confirm  commissioner; writes the reviewed pages as a background job
 *   GET  /api/leagues/:leagueId/imports/:jobId            member
 *   GET  /api/leagues/:leagueId/history/seasons/:season   member; one season's draft, transactions, matchups and keepers
 *   GET  /api/leagues/:leagueId/history/carryover         commissioner; keepers and traded picks waiting to land on the coming draft
 *   POST /api/leagues/:leagueId/history/carryover/keepers commissioner; prefill keeper_designations
 *   POST /api/leagues/:leagueId/history/carryover/picks   commissioner; rewrite draft_order with traded picks
 *   GET  /api/leagues/:leagueId/history                   member; the trophy room
 *   GET  /api/leagues/:leagueId/history/unclaimed         member; "which one is you?" and whether the caller still needs asking
 *   POST /api/leagues/:leagueId/history/claim             member
 *   POST /api/leagues/:leagueId/history/recompute         commissioner
 *   POST /api/leagues/:leagueId/history/lock              commissioner
 *   POST /api/leagues/:leagueId/history/members/merge     commissioner
 *   POST /api/leagues/:leagueId/history/members/:memberId/assign    commissioner
 *   POST /api/leagues/:leagueId/history/members/:memberId/unclaim   commissioner
 *   PATCH /api/leagues/:leagueId/history/trophies/:trophyId         commissioner
 *   POST /api/leagues/:leagueId/history/trophies                    commissioner (manual trophy)
 *   POST /api/leagues/:leagueId/history/players/:platform/:externalPlayerId  commissioner (resolve a player)
 *
 * ESPN credentials, when supplied, arrive in the request body, are handed to
 * the job closure, and are never written to a table or a log. The iOS binary
 * never sends them; only the web import page does.
 *
 * Yahoo is OAuth: the browser goes to Yahoo (system browser on iOS, never a
 * WebView), comes back to the web callback page with a code, and that page
 * posts the code here with the user's own JWT. The refresh token is sealed
 * server-side; the client never sees a Yahoo token of any kind.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { validateBody, getValidatedBody } from '../middleware/validate';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';
import { AuditService } from '../services/AuditService';
import { EspnClient, type EspnCredentials } from '../import/espn/client';
import { YahooClient } from '../import/yahoo/client';
import { YahooOAuth } from '../import/yahoo/oauth';
import { NeedsCredentialsError, SourceThrottledError } from '../import/types';
import { LeagueImportService } from '../services/import/LeagueImportService';
import { ScoringTranslationService } from '../services/import/ScoringTranslationService';
import type { ImportedSettings } from '../import/types';
import { TrophyService } from '../services/import/TrophyService';
import { MemberClaimService } from '../services/import/MemberClaimService';
import { PlayerCrosswalkService } from '../services/import/PlayerCrosswalkService';
import { YahooConnectionService } from '../services/import/YahooConnectionService';
import { ScreenshotReader, MAX_IMAGES_PER_READ, MAX_IMAGE_BASE64_LENGTH, type ScreenshotImage } from '../import/screenshot/reader';
import { extractedPageSchema } from '../import/screenshot/schema';
import { ScreenshotImportService, SCREENSHOT_PLATFORMS } from '../services/import/ScreenshotImportService';
import { DynastyCarryoverService } from '../services/import/DynastyCarryoverService';
import { currentCitrusSeason } from '../services/import/LeagueImportService';
import { keeperSeasonYear } from '@citrus/shared';

const espnCredentials = z.object({
  espnS2: z.string().min(20).max(4000),
  swid: z.string().regex(/^\{[0-9A-Fa-f-]{36}\}$/).optional(),
}).optional();

const schemas = {
  espnDiscover: z.object({
    league: z.string().min(1).max(300),
    credentials: espnCredentials,
  }),
  espnRun: z.object({
    externalLeagueId: z.string().regex(/^\d{1,12}$/),
    seasons: z.array(z.number().int().min(1990).max(2100)).max(40).optional(),
    latestEspnSeason: z.number().int().min(1990).max(2100).optional(),
    credentials: espnCredentials,
  }),
  yahooCallback: z.object({
    code: z.string().min(1).max(2000),
    state: z.string().min(1).max(2000),
  }),
  yahooRun: z.object({
    leagueKey: z.string().regex(/^\d{1,6}\.l\.\d{1,12}$/),
    seasons: z.array(z.number().int().min(1990).max(2100)).max(40).optional(),
  }),
  claim: z.object({
    memberId: z.string().uuid(),
    claimToken: z.string().min(8).max(200).optional(),
  }),
  merge: z.object({ fromMemberId: z.string().uuid(), intoMemberId: z.string().uuid() }),
  assign: z.object({ userId: z.string().uuid() }),
  decorate: z.object({
    display_name: z.string().max(80).nullable().optional(),
    icon_key: z.string().max(40).nullable().optional(),
    is_hidden: z.boolean().optional(),
  }),
  manualTrophy: z.object({
    season: z.number().int().min(1990).max(2100).nullable(),
    member_id: z.string().uuid().nullable(),
    display_name: z.string().min(1).max(80),
    detail: z.record(z.unknown()).optional(),
    icon_key: z.string().max(40).nullable().optional(),
  }),
  resolvePlayer: z.object({ nhlPlayerId: z.number().int().positive() }),
  screenshotRead: z.object({
    platform: z.enum(['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual']),
    leagueName: z.string().max(120).nullable().optional(),
    season: z.number().int().min(1990).max(2100).nullable().optional(),
    images: z.array(z.object({
      data: z.string().min(100).max(MAX_IMAGE_BASE64_LENGTH).regex(/^[A-Za-z0-9+/=]+$/),
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    })).min(1).max(MAX_IMAGES_PER_READ),
  }),
  screenshotConfirm: z.object({
    platform: z.enum(['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual']),
    leagueName: z.string().max(120).nullable().optional(),
    pages: z.array(extractedPageSchema).min(1).max(40),
    finished: z.record(z.string().regex(/^\d{4}$/), z.boolean()).optional(),
    rostersAsKeepers: z.boolean().optional(),
  }),
  carryoverPicks: z.object({ draftSeason: z.number().int().min(1990).max(2100) }),
};

/** Accepts a pasted ESPN URL or a bare league id. */
export function parseEspnLeagueId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{1,12}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/[?&]leagueId=(\d{1,12})/i) ?? trimmed.match(/\/leagues?\/(\d{1,12})/i);
  return m ? m[1] : null;
}

const importRoutes = new Hono<Env>();
importRoutes.use('*', authMiddleware);

// POST /api/imports/espn/discover
importRoutes.post('/espn/discover', validateBody(schemas.espnDiscover), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.espnDiscover>>(c);
  const externalLeagueId = parseEspnLeagueId(body.league);
  if (!externalLeagueId) return fail(c, AppError.badRequest('Paste the league link from ESPN, or its numeric league id.'));
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueImportService(supabase, supabaseAdmin);
  try {
    const creds = body.credentials as EspnCredentials | undefined;
    const discovery = await service.discoverEspn(externalLeagueId, new EspnClient(), creds);
    return ok(c, { externalLeagueId, ...discovery, needsCredentials: false });
  } catch (e) {
    if (e instanceof NeedsCredentialsError) {
      return ok(c, {
        externalLeagueId, needsCredentials: true,
        message: 'This league is private on ESPN. Ask your commissioner to turn on "Make League Viewable to Public" in ESPN league settings, or sign in to ESPN to import it.',
      });
    }
    return handleError(c, e, 'Could not reach ESPN for that league');
  }
});

// ---- Yahoo: connection ---------------------------------------------------------

const YAHOO_NOT_CONFIGURED = 'Yahoo import is not available yet.';

// GET /api/imports/yahoo/connect
importRoutes.get('/yahoo/connect', async (c) => {
  const connection = new YahooConnectionService(supabaseAdmin);
  if (!connection.isConfigured()) return fail(c, AppError.serviceUnavailable(YAHOO_NOT_CONFIGURED));
  const { url } = new YahooOAuth().authorizeUrl(c.get('userId'));
  return ok(c, { url });
});

// POST /api/imports/yahoo/callback
importRoutes.post('/yahoo/callback', validateBody(schemas.yahooCallback), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.yahooCallback>>(c);
  const connection = new YahooConnectionService(supabaseAdmin);
  if (!connection.isConfigured()) return fail(c, AppError.serviceUnavailable(YAHOO_NOT_CONFIGURED));
  if (!new YahooOAuth().verifyState(body.state, userId)) {
    return fail(c, AppError.badRequest('That Yahoo sign-in has expired or belongs to a different session. Start again.'));
  }
  try {
    const { guid } = await connection.connect(userId, body.code);
    void new AuditService(createUserClient(c.get('userToken'))).log('OAUTH_CONNECTED', null, { platform: 'yahoo' });
    return ok(c, { connected: true, guid });
  } catch (e) {
    // Never echo the code or Yahoo's error body.
    return fail(c, AppError.badGateway('Yahoo did not accept the sign-in. Try connecting again.'));
  }
});

// GET /api/imports/yahoo/connection
importRoutes.get('/yahoo/connection', async (c) => {
  const connection = new YahooConnectionService(supabaseAdmin);
  try {
    const status = await connection.status(c.get('userId'));
    return ok(c, { ...status, configured: connection.isConfigured() });
  } catch (e) {
    return handleError(c, e, 'Failed to read Yahoo connection');
  }
});

// DELETE /api/imports/yahoo/connection
importRoutes.delete('/yahoo/connection', async (c) => {
  const userId = c.get('userId');
  try {
    await new YahooConnectionService(supabaseAdmin).disconnect(userId);
    void new AuditService(createUserClient(c.get('userToken'))).log('OAUTH_DISCONNECTED', null, { platform: 'yahoo' });
    return ok(c, { connected: false });
  } catch (e) {
    return handleError(c, e, 'Failed to disconnect Yahoo');
  }
});

// GET /api/imports/yahoo/leagues
importRoutes.get('/yahoo/leagues', async (c) => {
  const userId = c.get('userId');
  const connection = new YahooConnectionService(supabaseAdmin);
  if (!connection.isConfigured()) return fail(c, AppError.serviceUnavailable(YAHOO_NOT_CONFIGURED));
  const service = new LeagueImportService(createUserClient(c.get('userToken')), supabaseAdmin);
  try {
    const client = new YahooClient(connection.tokenProvider(userId));
    return ok(c, await service.discoverYahoo(client));
  } catch (e) {
    if (e instanceof NeedsCredentialsError) return fail(c, AppError.conflict(e.message));
    if (e instanceof SourceThrottledError) return fail(c, AppError.serviceUnavailable('Yahoo is rate limiting requests. Try again in a minute.'));
    return handleError(c, e, 'Could not list your Yahoo leagues');
  }
});

// GET /api/imports/screenshots/status
importRoutes.get('/screenshots/status', (c) => ok(c, { configured: new ScreenshotReader().isConfigured(), maxImages: MAX_IMAGES_PER_READ, platforms: SCREENSHOT_PLATFORMS }));

export { importRoutes };

// ---- league-scoped routes -----------------------------------------------------

const leagueHistoryRoutes = new Hono<Env>();
leagueHistoryRoutes.use('*', authMiddleware);

// POST /api/leagues/:leagueId/imports/espn
leagueHistoryRoutes.post('/:leagueId/imports/espn', commissionerMiddleware, validateBody(schemas.espnRun), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.espnRun>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueImportService(supabase, supabaseAdmin);
  try {
    const creds = body.credentials as EspnCredentials | undefined;
    const job = await service.startEspn({
      leagueId, externalLeagueId: body.externalLeagueId, requestedBy: userId,
      client: new EspnClient(), creds, importerSwid: creds?.swid ?? null, seasons: body.seasons,
      latestEspnSeason: body.latestEspnSeason as number | undefined,
    });
    const audit = new AuditService(supabase);
    void audit.log('LEAGUE_HISTORY_IMPORT', leagueId, { platform: 'espn', externalLeagueId: body.externalLeagueId, jobId: job.id, withCredentials: Boolean(body.credentials) });
    return created(c, job);
  } catch (e) {
    return handleError(c, e, 'Failed to start import');
  }
});

// POST /api/leagues/:leagueId/imports/yahoo
leagueHistoryRoutes.post('/:leagueId/imports/yahoo', commissionerMiddleware, validateBody(schemas.yahooRun), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.yahooRun>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const connection = new YahooConnectionService(supabaseAdmin);
  if (!connection.isConfigured()) return fail(c, AppError.serviceUnavailable(YAHOO_NOT_CONFIGURED));
  try {
    const status = await connection.status(userId);
    if (!status.connected) return fail(c, AppError.conflict('Connect Yahoo before importing a league.'));
    const service = new LeagueImportService(supabase, supabaseAdmin);
    const job = await service.startYahoo({
      leagueId, leagueKey: body.leagueKey, requestedBy: userId,
      client: new YahooClient(connection.tokenProvider(userId), undefined, 250),
      importerGuid: status.guid, seasons: body.seasons,
    });
    void new AuditService(supabase).log('LEAGUE_HISTORY_IMPORT', leagueId, { platform: 'yahoo', leagueKey: body.leagueKey, jobId: job.id });
    return created(c, job);
  } catch (e) {
    return handleError(c, e, 'Failed to start import');
  }
});

// POST /api/leagues/:leagueId/imports/screenshots/read
// The images are in this request and nowhere else afterwards: the reading is
// what is kept (a raw payload on the job), and the commissioner reviews it
// before anything is written.
leagueHistoryRoutes.post('/:leagueId/imports/screenshots/read', commissionerMiddleware, validateBody(schemas.screenshotRead), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.screenshotRead>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new ScreenshotImportService(new LeagueImportService(supabase, supabaseAdmin), new ScreenshotReader());
  try {
    const outcome = await service.read({ leagueId, requestedBy: userId, images: body.images as ScreenshotImage[], platform: body.platform, leagueName: body.leagueName ?? null, season: body.season ?? null });
    void new AuditService(supabase).log('LEAGUE_HISTORY_IMPORT', leagueId, { platform: body.platform, method: 'screenshot', step: 'read', jobId: outcome.job.id, images: body.images.length });
    return created(c, outcome);
  } catch (e) {
    return handleError(c, e, 'Could not read the screenshots');
  }
});

// POST /api/leagues/:leagueId/imports/screenshots/:jobId/confirm
leagueHistoryRoutes.post('/:leagueId/imports/screenshots/:jobId/confirm', commissionerMiddleware, validateBody(schemas.screenshotConfirm), async (c) => {
  const { leagueId, jobId } = c.req.param();
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.screenshotConfirm>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new ScreenshotImportService(new LeagueImportService(supabase, supabaseAdmin), new ScreenshotReader());
  try {
    const finished = body.finished ? Object.fromEntries(Object.entries(body.finished).map(([k, v]) => [Number(k), v])) : undefined;
    const job = await service.confirm({
      leagueId, jobId, requestedBy: userId, pages: body.pages, platform: body.platform, leagueName: body.leagueName ?? null,
      finished, rostersAsKeepers: body.rostersAsKeepers, currentSeason: currentCitrusSeason(),
    });
    void new AuditService(supabase).log('LEAGUE_HISTORY_IMPORT', leagueId, { platform: body.platform, method: 'screenshot', step: 'confirm', jobId, pages: body.pages.length });
    return ok(c, job);
  } catch (e) {
    return handleError(c, e, 'Could not import the reviewed pages');
  }
});

// GET /api/leagues/:leagueId/imports/:jobId
leagueHistoryRoutes.get('/:leagueId/imports/:jobId', membershipMiddleware, async (c) => {
  const { leagueId, jobId } = c.req.param();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueImportService(supabase, supabaseAdmin);
  try {
    const job = await service.getJob(jobId);
    if (!job || job.league_id !== leagueId) return fail(c, AppError.notFound('Import job not found'));
    return ok(c, job);
  } catch (e) {
    return handleError(c, e, 'Failed to read import job');
  }
});

// GET /api/leagues/:leagueId/history
leagueHistoryRoutes.get('/:leagueId/history', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  try {
    const [seasons, teams, members, trophies, league, links, unresolved] = await Promise.all([
      supabase.from('league_season_results').select('league_id, season, platform, team_count, champion, runner_up, regular_season_winner').eq('league_id', leagueId).order('season', { ascending: false }),
      supabase.from('league_season_teams').select('season, member_id, team_name, rank, wins, losses, ties, points_for, points_against, made_playoffs, playoff_finish, playoff_seed, category_record').eq('league_id', leagueId).order('season', { ascending: false }).order('rank', { ascending: true }),
      // Merged rows keep their league_members row for provenance and would otherwise show as a ghost manager with no seasons.
      supabase.from('league_member_honours').select('member_id, display_name, owner_id, first_season, last_season, seasons_played, titles, finals_lost, playoff_seasons, best_finish, career_wins, career_losses, career_ties').eq('league_id', leagueId).is('merged_into_member_id', null),
      new TrophyService(supabase).list(leagueId),
      supabase.from('leagues').select('id, name, founded_season, imported_from, history_locked').eq('id', leagueId).maybeSingle(),
      supabase.from('external_league_links').select('platform, external_league_id, external_season_key, season, scoring_type, is_public_source, settings').eq('league_id', leagueId).order('season', { ascending: false }),
      // Picks whose player the crosswalk could not place: the commissioner's "unmatched players" list.
      supabase.from('league_season_drafts').select('season, external_player_id, external_player_name, source').eq('league_id', leagueId).is('nhl_player_id', null).order('season', { ascending: false }),
    ]);
    for (const r of [seasons, teams, members, league, links, unresolved]) if (r.error) throw new Error(r.error.message);
    // The newest imported season's settings, translated for the commissioner's confirm screen.
    const newest = ((links.data ?? []) as Array<{ season: number; platform: string; settings: unknown }>).find((l) => l.settings);
    const importedSettings = newest ? { platform: newest.platform, season: newest.season, ...new ScoringTranslationService().translate(newest.settings as ImportedSettings) } : null;
    const seen = new Set<string>();
    const unmatchedPlayers = ((unresolved.data ?? []) as Array<{ season: number; external_player_id: string; external_player_name: string | null; source: string }>)
      .filter((p) => { const k = `${p.source}:${p.external_player_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((p) => ({ platform: p.source, externalPlayerId: p.external_player_id, name: p.external_player_name, season: p.season }));
    return ok(c, {
      league: league.data, seasons: seasons.data ?? [], standings: teams.data ?? [], members: members.data ?? [], trophies,
      sources: (links.data ?? []).map((l: { platform: string; external_league_id: string; season: number; is_public_source: boolean | null }) => ({ platform: l.platform, externalLeagueId: l.external_league_id, season: l.season, isPublicSource: l.is_public_source })),
      importedSettings, unmatchedPlayers,
    });
  } catch (e) {
    return handleError(c, e, 'Failed to load league history');
  }
});

// GET /api/leagues/:leagueId/history/seasons/:season
// The parts of a season too long for the room's first paint: the draft, the
// transaction log (trades carry picks as well as players), the weekly results
// and the keeper list.
leagueHistoryRoutes.get('/:leagueId/history/seasons/:season', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const season = Number(c.req.param('season'));
  if (!Number.isInteger(season) || season < 1990 || season > 2100) return fail(c, AppError.badRequest('Season must be a start year, like 2024'));
  const supabase = createUserClient(c.get('userToken'));
  try {
    const [picks, transactions, matchups, keepers] = await Promise.all([
      supabase.from('league_season_drafts').select('overall_pick, round, pick_in_round, member_id, nhl_player_id, external_player_id, external_player_name, is_keeper, keeper_cost, auction_cost, source').eq('league_id', leagueId).eq('season', season).order('overall_pick', { ascending: true }),
      supabase.from('league_season_transactions').select('id, occurred_at, type, member_id, counterparty_member_id, nhl_player_id, external_player_id, external_player_name, pick_season, pick_round, pick_original_member_id, faab_bid, external_transaction_id, source').eq('league_id', leagueId).eq('season', season).order('occurred_at', { ascending: true, nullsFirst: false }),
      supabase.from('league_season_matchups').select('week, home_member_id, away_member_id, home_score, away_score, home_cat_wins, home_cat_losses, home_cat_ties, is_playoff, is_consolation, is_championship, winner_member_id, is_tie').eq('league_id', leagueId).eq('season', season).order('week', { ascending: true }),
      supabase.from('league_season_keepers').select('member_id, external_player_id, external_player_name, nhl_player_id, round, round_next, years_kept, source').eq('league_id', leagueId).eq('season', season),
    ]);
    for (const r of [picks, transactions, matchups, keepers]) if (r.error) throw new Error(r.error.message);
    return ok(c, { season, picks: picks.data ?? [], transactions: transactions.data ?? [], matchups: matchups.data ?? [], keepers: keepers.data ?? [] });
  } catch (e) {
    return handleError(c, e, 'Failed to load the season');
  }
});

// GET /api/leagues/:leagueId/history/carryover
leagueHistoryRoutes.get('/:leagueId/history/carryover', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DynastyCarryoverService(supabase);
  try {
    const draftSeason = keeperSeasonYear(false);
    const [keepers, picks] = await Promise.all([service.keeperPlan(leagueId, draftSeason), service.pickOwnership(leagueId)]);
    return ok(c, { draftSeason, keepers, picks });
  } catch (e) {
    return handleError(c, e, 'Failed to load the carry-over');
  }
});

// POST /api/leagues/:leagueId/history/carryover/keepers
leagueHistoryRoutes.post('/:leagueId/history/carryover/keepers', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  try {
    const seasonYear = keeperSeasonYear(false);
    const result = await new DynastyCarryoverService(supabase).applyKeepers(leagueId, seasonYear);
    void new AuditService(supabase).log('LEAGUE_HISTORY_IMPORT', leagueId, { method: 'carryover', step: 'keepers', seasonYear, ...result });
    return ok(c, { seasonYear, ...result });
  } catch (e) {
    return handleError(c, e, 'Could not apply the keepers');
  }
});

// POST /api/leagues/:leagueId/history/carryover/picks
leagueHistoryRoutes.post('/:leagueId/history/carryover/picks', commissionerMiddleware, validateBody(schemas.carryoverPicks), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.carryoverPicks>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    const result = await new DynastyCarryoverService(supabase).applyPickOwnership(leagueId, body.draftSeason);
    void new AuditService(supabase).log('LEAGUE_HISTORY_IMPORT', leagueId, { method: 'carryover', step: 'picks', draftSeason: body.draftSeason, applied: result.applied, skipped: result.skipped.length });
    return ok(c, result);
  } catch (e) {
    return handleError(c, e, 'Could not apply the traded picks');
  }
});

// GET /api/leagues/:leagueId/history/unclaimed
leagueHistoryRoutes.get('/:leagueId/history/unclaimed', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  try {
    return ok(c, await new MemberClaimService(supabase).listUnclaimed(leagueId, c.get('userId')));
  } catch (e) {
    return handleError(c, e, 'Failed to list unclaimed members');
  }
});

// POST /api/leagues/:leagueId/history/claim
leagueHistoryRoutes.post('/:leagueId/history/claim', membershipMiddleware, validateBody(schemas.claim), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.claim>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    const result = await new MemberClaimService(supabase).claim(body.memberId, body.claimToken ?? null);
    if (result.league_id !== leagueId) return fail(c, AppError.badRequest('That member belongs to a different league'));
    const audit = new AuditService(supabase);
    void audit.log('LEAGUE_HISTORY_CLAIM', leagueId, { memberId: result.member_id, method: result.claim_method });
    return ok(c, result);
  } catch (e) {
    return handleError(c, e, 'Failed to claim member');
  }
});

// POST /api/leagues/:leagueId/history/recompute
leagueHistoryRoutes.post('/:leagueId/history/recompute', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  try {
    const n = await new TrophyService(supabase).recompute(leagueId, null);
    return ok(c, { trophies: n });
  } catch (e) {
    return handleError(c, e, 'Failed to recompute trophies');
  }
});

// POST /api/leagues/:leagueId/history/lock
leagueHistoryRoutes.post('/:leagueId/history/lock', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const { error } = await supabase.from('leagues').update({ history_locked: true }).eq('id', leagueId);
  if (error) return handleError(c, error, 'Failed to lock history');
  void new AuditService(supabase).log('LEAGUE_HISTORY_LOCK', leagueId, {});
  return ok(c, { history_locked: true });
});

// POST /api/leagues/:leagueId/history/members/merge
leagueHistoryRoutes.post('/:leagueId/history/members/merge', commissionerMiddleware, validateBody(schemas.merge), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.merge>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    const survivor = await new MemberClaimService(supabase).merge(body.fromMemberId, body.intoMemberId);
    void new AuditService(supabase).log('LEAGUE_HISTORY_MERGE', leagueId, { from: body.fromMemberId, into: body.intoMemberId });
    await new TrophyService(supabase).recompute(leagueId, null);
    return ok(c, { survivorMemberId: survivor });
  } catch (e) {
    return handleError(c, e, 'Failed to merge members');
  }
});

// POST /api/leagues/:leagueId/history/members/:memberId/assign
leagueHistoryRoutes.post('/:leagueId/history/members/:memberId/assign', commissionerMiddleware, validateBody(schemas.assign), async (c) => {
  const { leagueId, memberId } = c.req.param();
  const body = getValidatedBody<z.infer<typeof schemas.assign>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    const result = await new MemberClaimService(supabase).assign(leagueId, memberId, body.userId);
    void new AuditService(supabase).log('LEAGUE_HISTORY_CLAIM', leagueId, { memberId, method: 'commissioner_assign', userId: body.userId, merged: result.merged });
    if (result.merged) await new TrophyService(supabase).recompute(leagueId, null);
    return ok(c, { memberId: result.memberId, userId: body.userId, merged: result.merged });
  } catch (e) {
    return handleError(c, e, 'Failed to assign member');
  }
});

// POST /api/leagues/:leagueId/history/members/:memberId/unclaim
leagueHistoryRoutes.post('/:leagueId/history/members/:memberId/unclaim', commissionerMiddleware, async (c) => {
  const { leagueId, memberId } = c.req.param();
  const supabase = createUserClient(c.get('userToken'));
  try {
    await new MemberClaimService(supabase).unclaim(leagueId, memberId);
    return ok(c, { memberId, unclaimed: true });
  } catch (e) {
    return handleError(c, e, 'Failed to unclaim member');
  }
});

// PATCH /api/leagues/:leagueId/history/trophies/:trophyId
leagueHistoryRoutes.patch('/:leagueId/history/trophies/:trophyId', commissionerMiddleware, validateBody(schemas.decorate), async (c) => {
  const { leagueId, trophyId } = c.req.param();
  const body = getValidatedBody<z.infer<typeof schemas.decorate>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    await new TrophyService(supabase).decorate(leagueId, trophyId, body);
    return ok(c, { trophyId, ...body });
  } catch (e) {
    return handleError(c, e, 'Failed to update trophy');
  }
});

// POST /api/leagues/:leagueId/history/trophies
leagueHistoryRoutes.post('/:leagueId/history/trophies', commissionerMiddleware, validateBody(schemas.manualTrophy), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.manualTrophy>>(c);
  const supabase = createUserClient(c.get('userToken'));
  try {
    await new TrophyService(supabase).addManual(leagueId, body as { season: number | null; member_id: string | null; display_name: string; detail?: Record<string, unknown>; icon_key?: string | null });
    return created(c, { added: true });
  } catch (e) {
    return handleError(c, e, 'Failed to add trophy');
  }
});

// POST /api/leagues/:leagueId/history/players/:platform/:externalPlayerId
leagueHistoryRoutes.post('/:leagueId/history/players/:platform/:externalPlayerId', commissionerMiddleware, validateBody(schemas.resolvePlayer), async (c) => {
  const { platform, externalPlayerId } = c.req.param();
  if (platform !== 'espn' && platform !== 'yahoo') return fail(c, AppError.badRequest('Unknown platform'));
  const body = getValidatedBody<z.infer<typeof schemas.resolvePlayer>>(c);
  try {
    // Commissioner status is proven above; the shared crosswalk is written on the admin client.
    await new PlayerCrosswalkService(supabaseAdmin).resolveManually(platform, externalPlayerId, body.nhlPlayerId, c.get('userId'));
    return ok(c, { platform, externalPlayerId, nhlPlayerId: body.nhlPlayerId });
  } catch (e) {
    return handleError(c, e, 'Failed to resolve player');
  }
});

export { leagueHistoryRoutes };
