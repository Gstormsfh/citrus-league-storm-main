import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { LeagueMembershipService } from '../../services/LeagueMembershipService';
import { YahooOAuth, YAHOO_TOKEN_URL } from '../../import/yahoo/oauth';
import { YahooConnectionService } from '../../services/import/YahooConnectionService';
import { FakeSupabase } from './fakeSupabase';
import { yahooRouter, yahooLeagueBundle, yahooLeagueMetadata, yahooScoreboard, yahooPlayers, yahooTransactions, yahooUserLeagues, type YLeagueOpts } from './yahooFixtures';

const state = vi.hoisted(() => ({ db: null as unknown as { from: (t: string) => unknown; rpc: (...a: unknown[]) => unknown } }));

vi.mock('../../lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => state.db.from(t), rpc: (...a: unknown[]) => state.db.rpc(...a) },
  createUserClient: () => state.db,
  getSupabaseAdmin: () => state.db,
}));

vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'u-test');
    c.set('userToken', 'tok');
    await next();
  },
}));

const LEAGUE = '11111111-1111-1111-1111-111111111111';
const KEY = 'b'.repeat(64);
const ENV = { YAHOO_CLIENT_ID: 'cid', YAHOO_CLIENT_SECRET: 'csecret', YAHOO_REDIRECT_URI: 'https://citrusfantasysports.com/import/yahoo/callback', YAHOO_TOKEN_ENCRYPTION_KEY: KEY, SUPABASE_JWT_SECRET: 'jwt-secret-for-tests' };

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

function configure(on: boolean) {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v; else delete process.env[k];
  }
}

function makeDb(commissionerId: string, extra: Record<string, any[]> = {}) {
  const db = new FakeSupabase({
    leagues: [{ id: LEAGUE, commissioner_id: commissionerId, history_locked: false, founded_season: null, imported_from: null, name: 'Citrus League' }],
    teams: [{ id: 't-1', league_id: LEAGUE, owner_id: 'u-test' }],
    player_directory: [],
    ...extra,
  });
  db.rpcHandlers.log_security_event = () => null;
  state.db = db;
  return db;
}

const season = (leagueKey: string, year: number, over: Partial<YLeagueOpts> = {}): YLeagueOpts => ({
  leagueKey, season: year, name: 'Puck', scoringType: 'headpoint', isFinished: true, startWeek: 1, endWeek: 2, playoffStartWeek: 2, numPlayoffTeams: 2,
  teams: [
    { id: 1, name: 'Alpha', guid: 'GUID_A', rank: 1, seed: 1, wins: 1, losses: 1, ties: 0, pointsFor: 200, clinched: true },
    { id: 2, name: 'Bravo', guid: 'GUID_B', rank: 2, seed: 2, wins: 1, losses: 1, ties: 0, pointsFor: 180, clinched: true },
  ],
  stats: [{ id: 1, display: 'G', value: 7 }], draft: [], ...over,
});

function apiRoutes() {
  const o = season('453.l.200', 2024);
  return {
    'users;use_login=1/games;game_codes=nhl;game_types=full/leagues': { status: 200, body: yahooUserLeagues('GUID_A', [{ gameId: '453', season: 2024, leagues: [{ leagueKey: '453.l.200', name: 'Puck', season: 2024 }] }]) },
    'league/453.l.200/metadata': { status: 200, body: yahooLeagueMetadata(o) },
    'league/453.l.200;out=settings,standings,draftresults': { status: 200, body: yahooLeagueBundle(o) },
    'league/453.l.200/scoreboard;week=1': { status: 200, body: yahooScoreboard(o, 1, [{ home: 1, away: 2, homePts: 100, awayPts: 90, winner: 'home' }]) },
    'league/453.l.200/scoreboard;week=2': { status: 200, body: yahooScoreboard(o, 2, [{ home: 1, away: 2, homePts: 100, awayPts: 90, winner: 'home', isPlayoffs: true }]) },
    'league/453.l.200/players;status=K;out=ownership': { status: 200, body: yahooPlayers(o, []) },
    'league/453.l.200/transactions': { status: 200, body: yahooTransactions(o, []) },
  };
}

/** Global fetch: the token endpoint answers a rotated token set; everything else is the API router. */
function mockYahoo(tokenStatus = 200) {
  const { impl, requested } = yahooRouter(apiRoutes());
  const tokenCalls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === YAHOO_TOKEN_URL) {
      tokenCalls.push(String(init?.body));
      return { status: tokenStatus, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-2', expires_in: 3600, xoauth_yahoo_guid: 'GUID_A' }) } as unknown as Response;
    }
    return impl(String(url), init);
  });
  return { requested, tokenCalls };
}

async function connected(db: FakeSupabase) {
  // Seed a live connection the way the callback would have, with a sealed refresh token.
  const svc = new YahooConnectionService(db as any, new YahooOAuth(), KEY);
  db.rows('yahoo_provider_tokens').push({ user_id: 'u-test', yahoo_guid: 'GUID_A', sealed_token: svc.seal('u-test', 'refresh-1'), updated_at: 'x' });
  db.rows('oauth_connections').push({ id: 'c1', user_id: 'u-test', platform: 'yahoo', external_user_id: 'GUID_A', granted_at: '2026-09-01T00:00:00Z', revoked_at: null, scopes: 'fspt-r' });
}

const post = (app: any, path: string, body: unknown) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (app: any, path: string) => app.request(path, { headers: { Authorization: 'Bearer tok' } });
const del = (app: any, path: string) => app.request(path, { method: 'DELETE', headers: { Authorization: 'Bearer tok' } });

beforeEach(() => { LeagueMembershipService.clearCache(); configure(true); });
afterEach(() => { vi.restoreAllMocks(); configure(false); });

describe('Yahoo connection routes', () => {
  it('connect: 503 until the app is configured, then a Yahoo URL with a state for this user', async () => {
    makeDb('u-test');
    const { app } = await import('../../app');
    configure(false);
    expect((await get(app, '/api/imports/yahoo/connect')).status).toBe(503);
    configure(true);
    const res = await get(app, '/api/imports/yahoo/connect');
    expect(res.status).toBe(200);
    const { url } = (await res.json()).data;
    const u = new URL(url);
    expect(u.hostname).toBe('api.login.yahoo.com');
    expect(new YahooOAuth().verifyState(u.searchParams.get('state'), 'u-test')).toBe(true);
    expect(new YahooOAuth().verifyState(u.searchParams.get('state'), 'someone-else')).toBe(false);
  });

  it('callback: a state minted for another user is refused before Yahoo is called', async () => {
    makeDb('u-test');
    const { tokenCalls } = mockYahoo();
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/yahoo/callback', { code: 'abc', state: new YahooOAuth().mintState('someone-else') });
    expect(res.status).toBe(400);
    expect(tokenCalls).toHaveLength(0);
  });

  it('callback: redeems the code, seals the refresh token, audits, and never stores the code or access token', async () => {
    const db = makeDb('u-test');
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    const { tokenCalls } = mockYahoo();
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/yahoo/callback', { code: 'the-code', state: new YahooOAuth().mintState('u-test') });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ connected: true, guid: 'GUID_A' });
    expect(tokenCalls[0]).toContain('grant_type=authorization_code');
    const stored = JSON.stringify(db.tables);
    expect(stored).not.toContain('the-code');
    expect(stored).not.toContain('access-1');
    expect(stored).not.toContain('refresh-2');
    expect(db.rows('oauth_connections')[0]).toMatchObject({ user_id: 'u-test', platform: 'yahoo', external_user_id: 'GUID_A', revoked_at: null });
    expect(audits[0]).toMatchObject({ p_event_type: 'OAUTH_CONNECTED', p_details: { platform: 'yahoo' } });
  });

  it('callback: Yahoo refusing the code is a 502 without the reason echoed', async () => {
    makeDb('u-test');
    mockYahoo(400);
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/yahoo/callback', { code: 'bad', state: new YahooOAuth().mintState('u-test') });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/Try connecting again/);
  });

  it('connection: status before and after disconnect', async () => {
    const db = makeDb('u-test');
    const { app } = await import('../../app');
    expect((await (await get(app, '/api/imports/yahoo/connection')).json()).data).toMatchObject({ connected: false, configured: true });
    await connected(db);
    expect((await (await get(app, '/api/imports/yahoo/connection')).json()).data).toMatchObject({ connected: true, guid: 'GUID_A' });
    const res = await del(app, '/api/imports/yahoo/connection');
    expect(res.status).toBe(200);
    expect(db.rows('yahoo_provider_tokens')).toHaveLength(0);
    expect((await (await get(app, '/api/imports/yahoo/connection')).json()).data.connected).toBe(false);
  });

  it('leagues: 409 when not connected; the chain list when connected, refreshing the token on the way', async () => {
    const db = makeDb('u-test');
    const { app } = await import('../../app');
    expect((await get(app, '/api/imports/yahoo/leagues')).status).toBe(409);
    await connected(db);
    const { tokenCalls } = mockYahoo();
    const res = await get(app, '/api/imports/yahoo/leagues');
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.guid).toBe('GUID_A');
    expect(body.chains[0]).toMatchObject({ key: '453.l.200', name: 'Puck', latestSeason: 2024 });
    expect(tokenCalls[0]).toContain('grant_type=refresh_token');
    // The rotated refresh token replaced the old one, sealed.
    const svc = new YahooConnectionService(db as any, new YahooOAuth(), KEY);
    expect(svc.unseal('u-test', db.rows('yahoo_provider_tokens')[0].sealed_token)).toBe('refresh-2');
  });
});

describe('POST /api/leagues/:leagueId/imports/yahoo', () => {
  it('refuses a non-commissioner and a commissioner without a connection', async () => {
    const db = makeDb('someone-else');
    const { app } = await import('../../app');
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/yahoo`, { leagueKey: '453.l.200' })).status).toBe(403);
    LeagueMembershipService.clearCache();
    makeDb('u-test');
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/yahoo`, { leagueKey: '453.l.200' })).status).toBe(409);
    expect(db.rows('import_jobs')).toHaveLength(0);
  });

  it('rejects a malformed league key', async () => {
    makeDb('u-test');
    const { app } = await import('../../app');
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/yahoo`, { leagueKey: 'nhl.l.abc' })).status).toBe(400);
  });

  it('starts a background job for the connected commissioner and finishes it', async () => {
    const db = makeDb('u-test');
    await connected(db);
    mockYahoo();
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/yahoo`, { leagueKey: '453.l.200' });
    expect(res.status).toBe(201);
    const job = (await res.json()).data;
    expect(job).toMatchObject({ league_id: LEAGUE, platform: 'yahoo', external_league_id: '453.l.200', status: 'queued' });
    // The route paces Yahoo calls at 250 ms; eight calls is about two seconds.
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const row = db.rows('import_jobs').find((j) => j.id === job.id)!;
      if (row.status === 'done' || row.status === 'failed' || row.status === 'partial' || row.status === 'needs_credentials') break;
    }
    const finished = db.rows('import_jobs').find((j) => j.id === job.id)!;
    expect(finished.status).toBe('done');
    expect(finished.seasons_imported).toEqual([2024]);
    expect(db.rows('league_members').find((m) => m.owner_id === 'u-test')).toBeTruthy(); // claimed via the connection's guid
    expect(audits[0]).toMatchObject({ p_event_type: 'LEAGUE_HISTORY_IMPORT', p_details: { platform: 'yahoo', leagueKey: '453.l.200' } });
  });
});
