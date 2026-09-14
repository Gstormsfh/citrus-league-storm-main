import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { LeagueMembershipService } from '../../services/LeagueMembershipService';
import { FakeSupabase } from './fakeSupabase';
import { allPages, standings2023 } from './screenshotFixtures';

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
const USER_B = '44444444-4444-4444-4444-444444444444';
const image = { data: Buffer.from('x'.repeat(120)).toString('base64'), mediaType: 'image/jpeg' };

function makeDb(commissionerId: string, extra: Record<string, any[]> = {}) {
  const db = new FakeSupabase({
    leagues: [{ id: LEAGUE, commissioner_id: commissionerId, history_locked: false, founded_season: null, imported_from: null, name: 'Citrus League', draft_status: 'not_started' }],
    teams: [{ id: 't-1', league_id: LEAGUE, owner_id: 'u-test', team_name: 'Mine' }],
    player_directory: [{ player_id: 8478402, season: 2025, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' }],
    ...extra,
  });
  db.rpcHandlers.log_security_event = () => null;
  state.db = db;
  return db;
}

function visionAnswers(pages: unknown, status = 200) {
  const impl = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_league_pages', input: { pages } }], usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: 'tool_use' }), { status }));
  vi.spyOn(globalThis, 'fetch').mockImplementation(impl as unknown as typeof fetch);
  return impl;
}

const post = (app: any, path: string, body: unknown) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (app: any, path: string) => app.request(path, { headers: { Authorization: 'Bearer tok' } });
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { LeagueMembershipService.clearCache(); process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterEach(() => { vi.restoreAllMocks(); delete process.env.ANTHROPIC_API_KEY; });

describe('GET /api/imports/screenshots/status', () => {
  it('says whether the reader is configured', async () => {
    makeDb('u-test');
    const { app } = await import('../../app');
    expect((await (await get(app, '/api/imports/screenshots/status')).json()).data).toMatchObject({ configured: true, maxImages: 12 });
    delete process.env.ANTHROPIC_API_KEY;
    expect((await (await get(app, '/api/imports/screenshots/status')).json()).data.configured).toBe(false);
  });
});

describe('POST /api/leagues/:leagueId/imports/screenshots/read', () => {
  it('a member who is not the commissioner is refused before any reading', async () => {
    makeDb('someone-else');
    const impl = visionAnswers({ pages: [] });
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [image] });
    expect(res.status).toBe(403);
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects a bad body before the reader is asked: a platform it does not know, no images, bad base64', async () => {
    makeDb('u-test');
    const impl = visionAnswers([]);
    const { app } = await import('../../app');
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'nhl', images: [image] })).status).toBe(400);
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [] })).status).toBe(400);
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [{ data: 'not base64 at all!!'.repeat(10), mediaType: 'image/jpeg' }] })).status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  it('the commissioner gets the pages back and a queued job; the audit says screenshot', async () => {
    const db = makeDb('u-test');
    const audits: any[] = [];
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    visionAnswers([standings2023]);
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', leagueName: 'Puck', images: [image] });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.pages).toHaveLength(1);
    expect(body.job).toMatchObject({ status: 'queued', method: 'screenshot', platform: 'yahoo', seasons_discovered: [2023] });
    expect(db.rows('import_raw_payloads')).toHaveLength(1);
    expect(audits[0]).toMatchObject({ p_event_type: 'LEAGUE_HISTORY_IMPORT', p_details: { method: 'screenshot', step: 'read', images: 1 } });
  });

  it('without the reader configured the answer is 503 and no job is made', async () => {
    const db = makeDb('u-test');
    delete process.env.ANTHROPIC_API_KEY;
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [image] });
    expect(res.status).toBe(503);
    expect(db.rows('import_jobs')).toHaveLength(0);
  });

  it('a busy reader is a 429 with its own words and a failed job', async () => {
    const db = makeDb('u-test');
    visionAnswers([], 429);
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [image] });
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/busy/);
    expect(db.rows('import_jobs')[0].status).toBe('failed');
  });
});

describe('POST /api/leagues/:leagueId/imports/screenshots/:jobId/confirm', () => {
  it('writes the reviewed pages and the job finishes done; the room then has the season', async () => {
    const db = makeDb('u-test');
    visionAnswers(allPages);
    const { app } = await import('../../app');
    const read = (await (await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', leagueName: 'Puck', images: [image] })).json()).data;
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/${read.job.id}/confirm`, { platform: 'yahoo', leagueName: 'Puck', pages: read.pages, finished: { '2023': true } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('importing');
    for (let i = 0; i < 60 && db.rows('import_jobs')[0].status !== 'done'; i++) await settle();
    expect(db.rows('import_jobs')[0]).toMatchObject({ status: 'done', seasons_imported: [2022, 2023] });
    // league_season_results is a view the in-memory stand-in does not derive; the tables behind it are checked directly.
    expect(db.rows('league_seasons').map((s: any) => s.season).sort()).toEqual([2022, 2023]);
    const history = (await (await get(app, `/api/leagues/${LEAGUE}/history`)).json()).data;
    expect(history.sources[0]).toMatchObject({ platform: 'yahoo', externalLeagueId: 'screenshots:puck' });
    const detail = (await (await get(app, `/api/leagues/${LEAGUE}/history/seasons/2023`)).json()).data;
    expect(detail.picks).toHaveLength(4);
    expect(detail.transactions.filter((t: any) => t.pick_round != null)).toHaveLength(2);
    expect(detail.keepers).toHaveLength(2);
    expect(detail.matchups).toHaveLength(4);
  });

  it('a page whose season the commissioner never set is refused with the image number', async () => {
    makeDb('u-test');
    visionAnswers([standings2023]);
    const { app } = await import('../../app');
    const read = (await (await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [image] })).json()).data;
    const res = await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/${read.job.id}/confirm`, { platform: 'yahoo', pages: [{ ...standings2023, season: null }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Image 1: No season on the page/);
  });

  it('an edited cell that breaks the page shape is refused like a bad reading', async () => {
    makeDb('u-test');
    visionAnswers([standings2023]);
    const { app } = await import('../../app');
    const read = (await (await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/read`, { platform: 'yahoo', images: [image] })).json()).data;
    const bad = { ...standings2023, standings: [{ ...standings2023.standings![0], wins: 'fourteen' }] };
    expect((await post(app, `/api/leagues/${LEAGUE}/imports/screenshots/${read.job.id}/confirm`, { platform: 'yahoo', pages: [bad] })).status).toBe(400);
  });
});

describe('GET /api/leagues/:leagueId/history/seasons/:season', () => {
  it('a member reads it; a bad season is a 400; another league\'s member is refused', async () => {
    makeDb('someone-else', { league_season_drafts: [{ league_id: LEAGUE, season: 2020, overall_pick: 1, round: 1, pick_in_round: 1, member_id: 'm', nhl_player_id: 1, external_player_id: 'x', external_player_name: 'X', is_keeper: false, keeper_cost: null, auction_cost: null, source: 'espn' }] });
    const { app } = await import('../../app');
    const body = (await (await get(app, `/api/leagues/${LEAGUE}/history/seasons/2020`)).json()).data;
    expect(body.picks).toHaveLength(1);
    expect(body).toMatchObject({ season: 2020, transactions: [], matchups: [], keepers: [] });
    expect((await get(app, `/api/leagues/${LEAGUE}/history/seasons/abc`)).status).toBe(400);
    makeDb('someone-else', { teams: [{ id: 't-9', league_id: 'other', owner_id: 'u-test' }] });
    LeagueMembershipService.clearCache();
    expect((await get(app, `/api/leagues/${LEAGUE}/history/seasons/2020`)).status).toBe(403);
  });
});

describe('carry-over routes', () => {
  function carryDb(commissioner = 'u-test') {
    return makeDb(commissioner, {
      teams: [{ id: 't-1', league_id: LEAGUE, owner_id: 'u-test', team_name: 'Mine' }, { id: 't-2', league_id: LEAGUE, owner_id: USER_B, team_name: 'Theirs' }],
      league_members: [
        { id: 'm-me', league_id: LEAGUE, display_name: 'Me', owner_id: 'u-test', merged_into_member_id: null },
        { id: 'm-b', league_id: LEAGUE, display_name: 'B', owner_id: USER_B, merged_into_member_id: null },
        { id: 'm-c', league_id: LEAGUE, display_name: 'C', owner_id: null, merged_into_member_id: null },
      ],
      league_season_keepers: [
        { league_id: LEAGUE, season: 2025, member_id: 'm-me', external_player_id: 'name:connor mcdavid|EDM', external_player_name: 'Connor McDavid', nhl_player_id: 8478402, round: 2, round_next: 1, years_kept: 1, source: 'yahoo' },
        { league_id: LEAGUE, season: 2025, member_id: 'm-c', external_player_id: 'name:someone', external_player_name: 'Someone', nhl_player_id: 5, round: 4, round_next: 3, years_kept: 1, source: 'yahoo' },
      ],
      league_pick_ownership: [
        { league_id: LEAGUE, draft_season: 2026, round: 1, original_member_id: 'm-b', owner_member_id: 'm-me', source: 'yahoo', applied_at: null },
        { league_id: LEAGUE, draft_season: 2026, round: 2, original_member_id: 'm-c', owner_member_id: 'm-me', source: 'yahoo', applied_at: null },
      ],
      draft_order: [{ id: 'o1', league_id: LEAGUE, round_number: 1, team_order: ['t-1', 't-2'] }, { id: 'o2', league_id: LEAGUE, round_number: 2, team_order: ['t-2', 't-1'] }],
    });
  }

  it('GET carryover: the plan for keepers and traded picks, commissioner only', async () => {
    carryDb();
    const { app } = await import('../../app');
    const res = await get(app, `/api/leagues/${LEAGUE}/history/carryover`);
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.draftSeason).toBeGreaterThanOrEqual(2026);
    expect(body.keepers).toMatchObject({ season: 2025, ready: 1, blocked: 1 });
    expect(body.keepers.rows.map((r: any) => [r.memberName, r.blocker])).toEqual([['C', 'unclaimed'], ['Me', null]]);
    expect(body.picks.map((p: any) => [p.round, p.originalName, p.ownerName, p.blocker])).toEqual([[1, 'B', 'Me', null], [2, 'C', 'Me', 'unclaimed']]);
    carryDb('someone-else');
    LeagueMembershipService.clearCache();
    expect((await get(app, `/api/leagues/${LEAGUE}/history/carryover`)).status).toBe(403);
  });

  it('POST carryover/keepers: prefills through the function and audits', async () => {
    const db = carryDb();
    const calls: any[] = [];
    const audits: any[] = [];
    db.rpcHandlers.citrus_apply_imported_keepers = (args) => { calls.push(args); return [{ written: 1, skipped_locked: 0 }]; };
    db.rpcHandlers.log_security_event = (args) => { audits.push(args); return null; };
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/carryover/keepers`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ written: 1, skippedLocked: 0, blocked: 1 });
    expect(calls[0].p_rows).toEqual([{ team_id: 't-1', player_id: '8478402', original_draft_round: 2, years_kept: 1 }]);
    expect(audits.some((a) => a.p_details?.step === 'keepers')).toBe(true);
  });

  it('POST carryover/picks: rewrites the order for the season asked, refuses once the draft is under way', async () => {
    const db = carryDb();
    const { app } = await import('../../app');
    const res = await post(app, `/api/leagues/${LEAGUE}/history/carryover/picks`, { draftSeason: 2026 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ applied: 1, alreadyApplied: 0, skipped: [{ round: 2, reason: 'C or Me has not claimed a team yet.' }] });
    expect(db.rows('draft_order')[0].team_order).toEqual(['t-1', 't-1']);
    db.rows('leagues')[0].draft_status = 'in_progress';
    expect((await post(app, `/api/leagues/${LEAGUE}/history/carryover/picks`, { draftSeason: 2026 })).status).toBe(409);
    expect((await post(app, `/api/leagues/${LEAGUE}/history/carryover/picks`, { draftSeason: 'next' })).status).toBe(400);
  });
});
