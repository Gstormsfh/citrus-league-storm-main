import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { parseEspnLeagueId } from '../../routes/imports';
import { LeagueMembershipService } from '../../services/LeagueMembershipService';
import { FakeSupabase } from './fakeSupabase';
import { espnCore, espnSchedule, espnDraft, espnRouter, type FakeTeam } from './espnFixtures';

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

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

const LEAGUE = '11111111-1111-1111-1111-111111111111';
const OTHER_LEAGUE = '22222222-2222-2222-2222-222222222222';
const MEMBER = '33333333-3333-3333-3333-333333333333';
const USER_B = '44444444-4444-4444-4444-444444444444';

const TEAMS: FakeTeam[] = [
  { id: 1, swid: '{A}', name: 'Alpha', rank: 1, seed: 1, wins: 14, losses: 6 },
  { id: 2, swid: '{B}', name: 'Bravo', rank: 2, seed: 2, wins: 12, losses: 8 },
  { id: 3, swid: '{C}', name: 'Charlie', rank: 3, seed: 3, wins: 9, losses: 11 },
  { id: 4, swid: '{D}', name: 'Delta', rank: 4, seed: 4, wins: 5, losses: 15 },
];

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

function publicLeagueFetch() {
  return espnRouter({
    '2021:mSettings': { status: 200, body: espnCore(2021, TEAMS, { previous: [2020] }) },
    '2021:mMatchupScore': { status: 200, body: espnSchedule(TEAMS, 1) },
    '2021:mDraftDetail': { status: 200, body: espnDraft([]) },
    '2020:mSettings': { status: 200, body: espnCore(2020, TEAMS) },
    '2020:mMatchupScore': { status: 200, body: espnSchedule(TEAMS, 1) },
    '2020:mDraftDetail': { status: 200, body: espnDraft([]) },
  });
}

const post = (app: any, path: string, body: unknown) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (app: any, path: string) => app.request(path, { headers: { Authorization: 'Bearer tok' } });

beforeEach(() => LeagueMembershipService.clearCache());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('parseEspnLeagueId', () => {
  it('accepts every way a person pastes an ESPN league', () => {
    expect(parseEspnLeagueId('12345')).toBe('12345');
    expect(parseEspnLeagueId('  12345 ')).toBe('12345');
    expect(parseEspnLeagueId('https://fantasy.espn.com/hockey/league?leagueId=12345')).toBe('12345');
    expect(parseEspnLeagueId('https://fantasy.espn.com/hockey/team?leagueId=12345&teamId=4&seasonId=2025')).toBe('12345');
    expect(parseEspnLeagueId('https://fantasy.espn.com/hockey/league/standings?seasonId=2024&leagueId=98765')).toBe('98765');
    expect(parseEspnLeagueId('https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/2025/segments/0/leagues/555?view=mTeam')).toBe('555');
  });

  it('rejects anything that is not a league', () => {
    expect(parseEspnLeagueId('')).toBeNull();
    expect(parseEspnLeagueId('my league')).toBeNull();
    expect(parseEspnLeagueId('https://football.fantasysports.yahoo.com/hockey/12345')).toBeNull();
    expect(parseEspnLeagueId('1234567890123')).toBeNull(); // 13 digits: not an id
  });
});

describe('POST /api/imports/espn/discover', () => {
  it('rejects text that is not an ESPN league', async () => {
    makeDb('u-test');
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/espn/discover', { league: 'the boys league' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Paste the league link/);
  });

  it('a public league is discovered from a pasted link with no credentials', async () => {
    makeDb('u-test');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2021-11-01T00:00:00Z')); // current ESPN season 2022 -> falls back to 2021
    const { impl } = publicLeagueFetch();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => impl(String(url), init));
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/espn/discover', { league: 'https://fantasy.espn.com/hockey/league?leagueId=777' });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toMatchObject({ externalLeagueId: '777', leagueName: 'Test League', latestSeason: 2020, latestEspnSeason: 2021, seasons: [2019, 2020], isPublic: true, teamCount: 4, needsCredentials: false });
    // No cookie header was ever sent.
    for (const call of fetchSpy.mock.calls) expect((call[1] as RequestInit | undefined)?.headers).not.toHaveProperty('Cookie');
  });

  it('a private league answers needsCredentials with the two ways forward', async () => {
    makeDb('u-test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 401, json: async () => null } as unknown as Response);
    const { app } = await import('../../app');
    const res = await post(app, '/api/imports/espn/discover', { league: '777' });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.needsCredentials).toBe(true);
    expect(body.message).toMatch(/Make League Viewable to Public/);
    expect(body.message).toMatch(/sign in to ESPN/);
  });
});

describe('POST /api/leagues/:leagueId/imports/espn', () => {
  it('refuses a member who is not the commissioner, creating no job', async () => {
    const db = makeDb('someone-else');
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/espn`, { externalLeagueId: '777' });
    expect(res.status).toBe(403);
    expect(db.rows('import_jobs')).toHaveLength(0);
  });

  it('the commissioner gets a queued job at once; credentials never land in a table or the audit log', async () => {
    const db = makeDb('u-test');
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    const { impl } = publicLeagueFetch();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => impl(String(url), init));
    const { app } = await import('../../app');
    const creds = { espnS2: 'AEB' + 'x'.repeat(40), swid: '{9F2C1B22-8E2A-4D2A-9B3F-1A2B3C4D5E6F}' };
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/espn`, { externalLeagueId: '777', latestEspnSeason: 2021, credentials: creds });
    expect(res.status).toBe(201);
    const job = (await res.json()).data;
    expect(job).toMatchObject({ league_id: LEAGUE, platform: 'espn', external_league_id: '777', requested_by: 'u-test', status: 'queued' });

    // Let the background job finish.
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 0));
      const row = db.rows('import_jobs').find((j) => j.id === job.id)!;
      if (row.status === 'done' || row.status === 'failed') break;
    }
    expect(db.rows('import_jobs').find((j) => j.id === job.id)!.status).toBe('done');
    expect(db.rows('league_seasons').map((s) => s.season).sort()).toEqual([2019, 2020]);

    const everything = JSON.stringify([db.tables, audits]);
    expect(everything).not.toContain(creds.espnS2);
    expect(audits[0]).toMatchObject({ p_event_type: 'LEAGUE_HISTORY_IMPORT', p_league_id: LEAGUE, p_details: { platform: 'espn', externalLeagueId: '777', jobId: job.id, withCredentials: true } });
    // The SWID is the importer's identity and is allowed in the identity table only.
    expect(JSON.stringify(db.tables.import_jobs)).not.toContain(creds.swid);
    expect(db.rows('league_member_identities').some((i) => i.external_manager_id === creds.swid)).toBe(false); // not a manager in this league
  });

  it('rejects a malformed SWID or short espn_s2 before anything runs', async () => {
    const db = makeDb('u-test');
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/espn`, { externalLeagueId: '777', credentials: { espnS2: 'short', swid: 'nope' } });
    expect(res.status).toBe(400);
    expect(db.rows('import_jobs')).toHaveLength(0);
  });
});

describe('GET /api/leagues/:leagueId/imports/:jobId', () => {
  it('returns the job to a member and hides a job from another league', async () => {
    const db = makeDb('someone-else', { import_jobs: [
      { id: 'job-1', league_id: LEAGUE, platform: 'espn', external_league_id: '777', requested_by: 'x', status: 'importing', seasons_discovered: [2019], seasons_imported: [], seasons_needing_credentials: [], progress: {}, error: null },
      { id: 'job-2', league_id: OTHER_LEAGUE, platform: 'espn', external_league_id: '778', requested_by: 'x', status: 'done', seasons_discovered: [], seasons_imported: [], seasons_needing_credentials: [], progress: {}, error: null },
    ] });
    void db;
    const { app } = await import('../../app');
    const ok = await get(app, `/api/leagues/${LEAGUE}/imports/job-1`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.status).toBe('importing');
    const hidden = await get(app, `/api/leagues/${LEAGUE}/imports/job-2`);
    expect(hidden.status).toBe(404);
  });
});

describe('GET /api/leagues/:leagueId/history', () => {
  it('returns the room plus the newest season\'s settings translated and the players still unmatched', async () => {
    const settings = {
      leagueName: 'Puck', scoringType: 'h2h_points', rosterSlots: [{ slot: 'C', count: 2 }], regularSeasonWeeks: 20, playoffTeamCount: 4, playoffWeeks: 2,
      keeperCount: 2, keeperOrderType: 'TRADITIONAL', draftType: 'SNAKE', usesFaab: true, isPublic: true,
      scoringItems: [
        { sourceStatId: '13', citrusKey: 'goals', group: 'skater', points: 7, reverse: false, enabled: true },
        { sourceStatId: '1', citrusKey: 'wins', group: 'goalie', points: 4, reverse: false, enabled: true },
        { sourceStatId: '99', citrusKey: 'unknown_espn_99', group: 'unknown', points: 1, reverse: false, enabled: true },
      ],
    };
    const db = makeDb('someone-else', {
      external_league_links: [
        { league_id: LEAGUE, platform: 'espn', external_league_id: '777', external_season_key: '2020', season: 2019, scoring_type: 'h2h_points', is_public_source: true, settings: null },
        { league_id: LEAGUE, platform: 'espn', external_league_id: '777', external_season_key: '2021', season: 2020, scoring_type: 'h2h_points', is_public_source: true, settings },
      ],
      league_season_drafts: [
        { league_id: LEAGUE, season: 2020, overall_pick: 1, nhl_player_id: 8478402, external_player_id: '1', external_player_name: 'Connor McDavid', source: 'espn' },
        { league_id: LEAGUE, season: 2020, overall_pick: 2, nhl_player_id: null, external_player_id: '2', external_player_name: 'Retired Guy', source: 'espn' },
        { league_id: LEAGUE, season: 2019, overall_pick: 3, nhl_player_id: null, external_player_id: '2', external_player_name: 'Retired Guy', source: 'espn' },
        { league_id: OTHER_LEAGUE, season: 2020, overall_pick: 1, nhl_player_id: null, external_player_id: '5', external_player_name: 'Other League Guy', source: 'espn' },
      ],
    });
    void db;
    const { app } = await import('../../app');
    const res = await get(app, `/api/leagues/${LEAGUE}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.league).toMatchObject({ id: LEAGUE, name: 'Citrus League' });
    expect(body.sources.map((s: any) => s.season)).toEqual([2020, 2019]);
    expect(body.importedSettings).toMatchObject({ platform: 'espn', season: 2020, scoringFormat: 'h2h-points', scoringSettings: { skater: { goals: 7 }, goalie: { wins: 4 } }, keeper: { count: 2 }, usesFaab: true });
    expect(body.importedSettings.unmapped).toEqual([{ sourceStatId: '99', citrusKey: 'unknown_espn_99', points: 1, reason: 'Not in the translation table' }]);
    expect(body.unmatchedPlayers).toEqual([{ platform: 'espn', externalPlayerId: '2', name: 'Retired Guy', season: 2020 }]);
  });

  it('a league with no imports has null settings and an empty unmatched list', async () => {
    makeDb('someone-else');
    const { app } = await import('../../app');
    const body = (await (await get(app, `/api/leagues/${LEAGUE}/history`)).json()).data;
    expect(body.importedSettings).toBeNull();
    expect(body.unmatchedPlayers).toEqual([]);
    expect(body.sources).toEqual([]);
  });

  it('a merged row never shows as a ghost manager', async () => {
    makeDb('someone-else', {
      league_member_honours: [
        { league_id: LEAGUE, member_id: 'm-live', display_name: 'Bob', owner_id: USER_B, merged_into_member_id: null, seasons_played: 3, titles: 1 },
        { league_id: LEAGUE, member_id: 'm-ghost', display_name: 'Bob (old account)', owner_id: null, merged_into_member_id: 'm-live', seasons_played: 0, titles: 0 },
      ],
    });
    const { app } = await import('../../app');
    const body = (await (await get(app, `/api/leagues/${LEAGUE}/history`)).json()).data;
    expect(body.members.map((m: any) => m.member_id)).toEqual(['m-live']);
  });
});

describe('GET /api/leagues/:leagueId/history/unclaimed', () => {
  it('answers who is still unclaimed and whether the caller has already been attached', async () => {
    makeDb('someone-else', {
      league_member_honours: [
        { league_id: LEAGUE, member_id: 'm-bob', display_name: 'Bob', owner_id: null, merged_into_member_id: null, first_season: 2015, last_season: 2024, seasons_played: 10, titles: 2, playoff_seasons: 6, best_finish: 1 },
        { league_id: LEAGUE, member_id: 'm-me', display_name: 'garrett', owner_id: 'u-test', merged_into_member_id: null, first_season: null, last_season: null, seasons_played: 0, titles: 0, playoff_seasons: 0, best_finish: null },
      ],
      // The foundation seed gave the caller a row with no claim yet: they must still be asked.
      league_members: [{ id: 'm-me', league_id: LEAGUE, owner_id: 'u-test', merged_into_member_id: null, claimed_at: null }],
    });
    const { app } = await import('../../app');
    const res = await get(app, `/api/leagues/${LEAGUE}/history/unclaimed`);
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.attached).toBe(false);
    expect(body.members).toEqual([{ id: 'm-bob', display_name: 'Bob', first_season: 2015, last_season: 2024, titles: 2, seasons_played: 10, playoff_seasons: 6, best_finish: 1 }]);
  });

  it('once claimed the caller is done, whoever else is still unclaimed', async () => {
    makeDb('someone-else', {
      league_member_honours: [{ league_id: LEAGUE, member_id: 'm-bob', display_name: 'Bob', owner_id: null, merged_into_member_id: null, seasons_played: 10, titles: 2, playoff_seasons: 6, best_finish: 1, first_season: 2015, last_season: 2024 }],
      league_members: [{ id: 'm-me', league_id: LEAGUE, owner_id: 'u-test', merged_into_member_id: null, claimed_at: '2026-09-13T00:00:00.000Z' }],
    });
    const { app } = await import('../../app');
    const body = (await (await get(app, `/api/leagues/${LEAGUE}/history/unclaimed`)).json()).data;
    expect(body.attached).toBe(true);
    expect(body.members).toHaveLength(1);
  });

  it('a non-member is refused', async () => {
    makeDb('someone-else', { teams: [{ id: 't-9', league_id: OTHER_LEAGUE, owner_id: 'u-test' }] });
    const { app } = await import('../../app');
    expect((await get(app, `/api/leagues/${LEAGUE}/history/unclaimed`)).status).toBe(403);
  });
});

describe('POST /api/leagues/:leagueId/history/claim', () => {
  it('claims through the SECURITY DEFINER function and audits it', async () => {
    const db = makeDb('someone-else');
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    db.rpcHandlers.citrus_claim_league_member = (args) => [{ member_id: args.p_member_id, league_id: LEAGUE, display_name: 'Bob', claim_method: 'email_link' }];
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/claim`, { memberId: MEMBER, claimToken: 'tok-bob-12345' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ member_id: MEMBER, claim_method: 'email_link' });
    expect(audits[0]).toMatchObject({ p_event_type: 'LEAGUE_HISTORY_CLAIM', p_details: { memberId: MEMBER, method: 'email_link' } });
  });

  it("the function's refusal comes back as a 400 in its own words", async () => {
    const db = makeDb('someone-else');
    db.rpcHandlers.citrus_claim_league_member = () => { throw new Error('That claim link is not valid.'); };
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/claim`, { memberId: MEMBER, claimToken: 'tok-wrong-1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('That claim link is not valid.');
  });

  it('a member from another league cannot be claimed through this league', async () => {
    const db = makeDb('someone-else');
    db.rpcHandlers.citrus_claim_league_member = () => [{ member_id: MEMBER, league_id: OTHER_LEAGUE, display_name: 'Bob', claim_method: 'list_pick' }];
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/claim`, { memberId: MEMBER });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/leagues/:leagueId/history/members/:memberId/assign', () => {
  it('a commissioner assigning to a user who already has a row merges and recomputes', async () => {
    const db = makeDb('u-test', {
      league_members: [
        { id: MEMBER, league_id: LEAGUE, owner_id: null, merged_into_member_id: null },
        { id: 'm-existing', league_id: LEAGUE, owner_id: USER_B, merged_into_member_id: null },
      ],
      league_seasons: [], league_season_teams: [], league_season_matchups: [], league_trophies: [],
    });
    db.rpcHandlers.citrus_merge_league_members = (args) => { expect(args.p_from).toBe(MEMBER); return 'm-existing'; };
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/members/${MEMBER}/assign`, { userId: USER_B });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ memberId: 'm-existing', userId: USER_B, merged: true });
    expect(db.opsFor('league_trophies', 'update')).toHaveLength(1); // recompute retired the old rows
  });

  it('assigning an already-claimed member is a 409', async () => {
    const db = makeDb('u-test', { league_members: [{ id: MEMBER, league_id: LEAGUE, owner_id: 'someone', merged_into_member_id: null }] });
    void db;
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/members/${MEMBER}/assign`, { userId: USER_B });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/leagues/:leagueId/history/lock', () => {
  it('locks and audits; members cannot', async () => {
    const db = makeDb('u-test');
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/lock`, {});
    expect(res.status).toBe(200);
    expect(db.rows('leagues')[0].history_locked).toBe(true);
    expect(audits[0].p_event_type).toBe('LEAGUE_HISTORY_LOCK');

    LeagueMembershipService.clearCache();
    const db2 = makeDb('someone-else');
    const denied = await post(app, `/api/leagues/${LEAGUE}/history/lock`, {});
    expect(denied.status).toBe(403);
    expect(db2.rows('leagues')[0].history_locked).toBe(false);
  });
});
