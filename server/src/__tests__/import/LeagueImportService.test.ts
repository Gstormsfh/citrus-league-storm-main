import { describe, it, expect, vi, afterEach } from 'vitest';
import { LeagueImportService, collectPlayerIds, currentCitrusSeason, type ImportJobRow } from '../../services/import/LeagueImportService';
import { NeedsCredentialsError, SourceThrottledError } from '../../import/types';
import { parseEspnSeason } from '../../import/espn/parse';
import { FakeSupabase } from './fakeSupabase';
import { espnCore, espnSchedule, espnDraft, espnRouter, type FakeTeam } from './espnFixtures';

const LEAGUE = 'league-1';
const USER = 'user-commish';
const EXT = '777';

const TEAMS: FakeTeam[] = [
  { id: 1, swid: '{A}', name: 'Alpha', rank: 1, seed: 1, wins: 14, losses: 6, keepers: [3895074] },
  { id: 2, swid: '{B}', name: 'Bravo', rank: 2, seed: 2, wins: 12, losses: 8 },
  { id: 3, swid: '{C}', name: 'Charlie', rank: 3, seed: 3, wins: 9, losses: 11 },
  { id: 4, swid: '{D}', name: 'Delta', rank: 4, seed: 4, wins: 5, losses: 15 },
];

const MCDAVID = { id: 3895074, fullName: 'Connor McDavid', proTeamId: 6, defaultPositionId: 1, jersey: '97' };
const playerLookup = async (_s: number, ids: number[]) => new Map(ids.filter((i) => i === MCDAVID.id).map((i) => [i, MCDAVID]));

function freshDb(over: Record<string, any[]> = {}) {
  return new FakeSupabase({
    leagues: [{ id: LEAGUE, name: 'Citrus League', history_locked: false, founded_season: null, imported_from: null }],
    player_directory: [
      { player_id: 8478402, season: 2019, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' },
      { player_id: 8478402, season: 2020, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' },
    ],
    ...over,
  });
}

/** A full public two-season league: ESPN 2020 (Citrus 2019) and ESPN 2021 (Citrus 2020). */
function twoSeasonRoutes() {
  return {
    '2021:mSettings': { status: 200, body: espnCore(2021, TEAMS, { previous: [2020], keeperCount: 1 }) },
    '2021:mMatchupScore': { status: 200, body: espnSchedule(TEAMS, 1) },
    '2021:mDraftDetail': { status: 200, body: espnDraft([{ overall: 1, teamId: 1, playerId: 3895074, keeper: true }, { overall: 2, teamId: 2, playerId: 999999 }]) },
    '2020:mSettings': { status: 200, body: espnCore(2020, TEAMS.map((t) => ({ ...t, rank: 5 - t.rank, seed: 5 - t.rank })), { previous: [] }) },
    '2020:mMatchupScore': { status: 200, body: espnSchedule(TEAMS.map((t) => ({ ...t, rank: 5 - t.rank, seed: 5 - t.rank })), 4) },
    '2020:mDraftDetail': { status: 200, body: espnDraft([{ overall: 1, teamId: 4, playerId: 3895074 }]) },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('LeagueImportService.writeSeason', () => {
  const parsed2020 = () => parseEspnSeason(EXT, {
    core: espnCore(2021, TEAMS, { keeperCount: 1 }), schedule: espnSchedule(TEAMS, 1),
    draft: espnDraft([{ overall: 1, teamId: 1, playerId: 3895074, keeper: true }, { overall: 2, teamId: 2, playerId: 999999 }]),
    playersById: new Map([[MCDAVID.id, MCDAVID]]),
  });

  it('writes the season, standings, matchups, picks and link, keyed on members not team ids', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const res = await svc.writeSeason(LEAGUE, 'job-1', parsed2020(), { importerUserId: USER, importerExternalId: '{B}' });

    expect(res).toMatchObject({ season: 2020, members_created: 4, teams: 4, matchups: 6, picks: 2, unmatched_players: 1 });
    const seasonRow = db.rows('league_seasons')[0];
    const memberOf = (swid: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === swid)!.member_id;
    expect(seasonRow).toMatchObject({
      league_id: LEAGUE, season: 2020, platform: 'espn', external_league_id: EXT, external_season_key: '2021', team_count: 4, scoring_type: 'h2h_points',
      champion_member_id: memberOf('{A}'), runner_up_member_id: memberOf('{B}'), regular_winner_id: memberOf('{A}'),
      champion_source: 'imported', is_verified_by_bracket: true, is_finished: true, import_job_id: 'job-1', imported_by: USER,
    });
    const alpha = db.rows('league_season_teams').find((t) => t.team_name === 'Alpha')!;
    expect(alpha).toMatchObject({ member_id: memberOf('{A}'), rank: 1, wins: 14, losses: 6, external_team_id: '1', playoff_seed: 1, made_playoffs: true, playoff_finish: 1, final_rank_source: 'source_calculated' });
    const final = db.rows('league_season_matchups').find((m) => m.is_championship)!;
    expect(final).toMatchObject({ week: 3, home_member_id: memberOf('{A}'), away_member_id: memberOf('{B}'), home_score: 120, away_score: 90, winner_member_id: memberOf('{A}'), is_playoff: true, is_consolation: false, source: 'espn' });
    const picks = db.rows('league_season_drafts').sort((a, b) => a.overall_pick - b.overall_pick);
    expect(picks[0]).toMatchObject({ overall_pick: 1, member_id: memberOf('{A}'), nhl_player_id: 8478402, external_player_id: '3895074', external_player_name: 'Connor McDavid', is_keeper: true, keeper_cost: 'round 1' });
    expect(picks[1]).toMatchObject({ overall_pick: 2, member_id: memberOf('{B}'), nhl_player_id: null, external_player_id: '999999', is_keeper: false });
    expect(db.rows('external_league_links')[0]).toMatchObject({ league_id: LEAGUE, platform: 'espn', external_league_id: EXT, external_season_key: '2021', season: 2020, is_public_source: true });
    // The importer is claimed; the other three carry claim tokens.
    const members = db.rows('league_members');
    expect(members.filter((m) => m.owner_id === USER)).toHaveLength(1);
    expect(members.filter((m) => m.claim_token)).toHaveLength(3);
  });

  it('is idempotent: a second write updates in place and creates nothing new', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    await svc.writeSeason(LEAGUE, 'job-1', parsed2020(), { importerUserId: USER });
    const snapshot = JSON.stringify([db.rows('league_members'), db.rows('league_season_teams').length, db.rows('league_season_matchups').length, db.rows('league_season_drafts').length]);
    const res = await svc.writeSeason(LEAGUE, 'job-2', parsed2020(), { importerUserId: USER });
    expect(res.members_created).toBe(0);
    expect(JSON.stringify([db.rows('league_members'), db.rows('league_season_teams').length, db.rows('league_season_matchups').length, db.rows('league_season_drafts').length])).toBe(snapshot);
    expect(db.rows('league_seasons')).toHaveLength(1);
    expect(db.rows('league_seasons')[0].import_job_id).toBe('job-2');
    expect(db.rows('external_league_links')).toHaveLength(1);
  });

  it('a locked league leaves an existing season untouched and says so', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    await svc.writeSeason(LEAGUE, 'job-1', parsed2020(), { importerUserId: USER });
    const before = db.ops.length;
    const res = await svc.writeSeason(LEAGUE, 'job-2', parsed2020(), { importerUserId: USER, locked: true });
    expect(res.teams).toBe(0);
    expect(res.warnings).toContain('League history is locked; existing season left untouched.');
    expect(db.ops.slice(before).every((o) => o.op === 'select')).toBe(true);
    expect(db.rows('league_seasons')[0].import_job_id).toBe('job-1');
  });

  it('a locked league still accepts a season it has never seen', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const res = await svc.writeSeason(LEAGUE, 'job-1', parsed2020(), { importerUserId: USER, locked: true });
    expect(res.teams).toBe(4);
  });

  it('a season still in play gets no champion and is flagged unfinished', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const live = parseEspnSeason(EXT, { core: espnCore(2021, TEAMS.map((t) => ({ ...t, rank: 0 })), { isActive: true }), schedule: espnSchedule(TEAMS, 1) });
    expect(live.isFinished).toBe(false);
    await svc.writeSeason(LEAGUE, 'job-1', live, { importerUserId: USER });
    expect(db.rows('league_seasons')[0]).toMatchObject({ champion_member_id: null, runner_up_member_id: null, regular_winner_id: null, champion_source: null, is_finished: false });
  });

  it('bracket disagreeing with the standings is recorded as unverified', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const parsed = parseEspnSeason(EXT, { core: espnCore(2021, TEAMS), schedule: espnSchedule(TEAMS, 2) });
    expect(parsed.warnings.some((w) => /bracket final was won by team 2/.test(w))).toBe(true);
    await svc.writeSeason(LEAGUE, 'job-1', parsed, { importerUserId: USER });
    const memberOf = (swid: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === swid)!.member_id;
    // The source's final standings name the champion; the flag tells the commissioner to look.
    expect(db.rows('league_seasons')[0]).toMatchObject({ champion_member_id: memberOf('{A}'), is_verified_by_bracket: false });
    // The bracket result itself is kept as the playoff finish.
    expect(db.rows('league_season_teams').find((t) => t.team_name === 'Bravo')).toMatchObject({ playoff_finish: 1, rank: 2 });
  });

  it('without a rank field the bracket winner is the champion', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const core = espnCore(2021, TEAMS.map((t) => ({ ...t, rank: 0 })));
    core.status.isActive = false; // finished, but ESPN never filled rankCalculatedFinal
    const parsed = parseEspnSeason(EXT, { core, schedule: espnSchedule(TEAMS, 2) });
    expect(parsed.isFinished).toBe(true);
    await svc.writeSeason(LEAGUE, 'job-1', parsed, { importerUserId: USER });
    const memberOf = (swid: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === swid)!.member_id;
    expect(db.rows('league_seasons')[0]).toMatchObject({ champion_member_id: memberOf('{B}'), runner_up_member_id: memberOf('{A}'), is_verified_by_bracket: null });
  });

  it('a category league writes category columns and never a score', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const core = espnCore(2021, TEAMS, { scoringType: 'H2H_CATEGORY' });
    const sched = espnSchedule(TEAMS, 1);
    for (const s of sched.schedule) {
      const homeWon = s.winner === 'HOME';
      s.home = { teamId: s.home.teamId, totalPoints: 0, cumulativeScore: { wins: homeWon ? 6 : 3, losses: homeWon ? 3 : 6, ties: 1, scoreByStat: { 13: { score: 10, result: homeWon ? 'WIN' : 'LOSS' } } } } as any;
      s.away = { teamId: s.away.teamId, totalPoints: 0, cumulativeScore: { wins: homeWon ? 3 : 6, losses: homeWon ? 6 : 3, ties: 1, scoreByStat: { 13: { score: 8, result: homeWon ? 'LOSS' : 'WIN' } } } } as any;
    }
    const parsed = parseEspnSeason(EXT, { core, schedule: sched });
    await svc.writeSeason(LEAGUE, 'job-1', parsed, { importerUserId: USER });
    const m = db.rows('league_season_matchups')[0];
    expect(m).toMatchObject({ home_score: null, away_score: null, home_cat_wins: 6, home_cat_losses: 3, home_cat_ties: 1 });
    expect(m.category_results[0]).toMatchObject({ statKey: 'goals', winner: 'home' });
    expect(db.rows('league_seasons')[0].scoring_type).toBe('h2h_categories');
    expect(db.rows('league_season_teams')[0].category_record).toMatch(/^\d+-\d+-\d+$/);
  });

  it('surfaces a write failure with the table named', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    db.failNext = { table: 'league_season_matchups', op: 'upsert', error: { message: 'boom' } };
    await expect(svc.writeSeason(LEAGUE, 'job-1', parsed2020(), { importerUserId: USER })).rejects.toThrow('league_season_matchups upsert failed: boom');
  });
});

describe('LeagueImportService: jobs', () => {
  it('createJob / getJob / updateJob round-trip', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const job = await svc.createJob(LEAGUE, 'espn', EXT, USER);
    expect(job).toMatchObject({ league_id: LEAGUE, platform: 'espn', external_league_id: EXT, requested_by: USER, status: 'queued' });
    await svc.updateJob(job.id, { status: 'importing', seasons_discovered: [2019, 2020] });
    expect(await svc.getJob(job.id)).toMatchObject({ status: 'importing', seasons_discovered: [2019, 2020] });
    expect(await svc.getJob('nope')).toBeNull();
  });

  it('stores raw payloads with a content hash', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    await svc.storeRawPayload('job-1', LEAGUE, 'espn', 'https://x/y', '2021', { a: 1 });
    const row = db.rows('import_raw_payloads')[0];
    expect(row).toMatchObject({ job_id: 'job-1', league_id: LEAGUE, platform: 'espn', endpoint: 'https://x/y', external_season_key: '2021', payload: { a: 1 } });
    expect(row.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('LeagueImportService.discoverEspn', () => {
  it('reads the latest season and lists every season the league has had', async () => {
    const { client } = espnRouter(twoSeasonRoutes());
    const svc = new LeagueImportService(freshDb() as any, freshDb() as any);
    const d = await svc.discoverEspn(EXT, client, undefined, 2021);
    expect(d).toEqual({ leagueName: 'Test League', latestSeason: 2020, latestEspnSeason: 2021, seasons: [2019, 2020], isPublic: true, scoringType: 'h2h_points', teamCount: 4 });
  });

  it('falls back one season when the current one does not exist yet on ESPN', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2021-09-15T12:00:00Z')); // Citrus 2021 -> ESPN 2022, not created yet
    const { client, requested } = espnRouter(twoSeasonRoutes());
    const svc = new LeagueImportService(freshDb() as any, freshDb() as any);
    const d = await svc.discoverEspn(EXT, client);
    expect(d.latestEspnSeason).toBe(2021);
    expect(requested[0]).toContain('/seasons/2022/');
    expect(requested[1]).toContain('/seasons/2021/');
  });

  it('does not fall back past a credentials demand', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2021-09-15T12:00:00Z'));
    const { client, requested } = espnRouter({ ...twoSeasonRoutes(), '2022:*': { status: 401 }, 'history:2022:*': { status: 401 } });
    const svc = new LeagueImportService(freshDb() as any, freshDb() as any);
    await expect(svc.discoverEspn(EXT, client)).rejects.toBeInstanceOf(NeedsCredentialsError);
    expect(requested.some((u) => u.includes('/seasons/2021/'))).toBe(false);
  });
});

describe('LeagueImportService.runEspn', () => {
  it('imports every season of a public league, computes trophies and stamps the league', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = espnRouter(twoSeasonRoutes());

    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, importerSwid: '{A}', latestEspnSeason: 2021, playerLookup });

    expect(job.status).toBe('done');
    expect(job.seasons_discovered).toEqual([2019, 2020]);
    expect(job.seasons_imported).toEqual([2019, 2020]);
    expect(job.seasons_needing_credentials).toEqual([]);
    expect(job.finished_at).toBeTruthy();
    expect((job.progress as any).seasons).toHaveLength(2);
    expect((job.progress as any).discovery.leagueName).toBe('Test League');

    expect(db.rows('import_raw_payloads')).toHaveLength(6); // core + schedule + draft per season
    expect(db.rows('league_seasons').map((s) => s.season).sort()).toEqual([2019, 2020]);
    expect(db.rows('league_members')).toHaveLength(4); // same four humans across both seasons
    expect(db.rows('league_member_identities')).toHaveLength(4);
    const memberOf = (swid: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === swid)!.member_id;
    expect(db.rows('league_seasons').find((s) => s.season === 2019)!.champion_member_id).toBe(memberOf('{D}'));
    expect(db.rows('league_seasons').find((s) => s.season === 2020)!.champion_member_id).toBe(memberOf('{A}'));

    const trophies = db.rows('league_trophies').filter((t) => !t.retired_at);
    expect(trophies.filter((t) => t.trophy_key === 'champion').map((t) => [t.season, t.member_id])).toEqual(expect.arrayContaining([[2019, memberOf('{D}')], [2020, memberOf('{A}')]]));
    expect(trophies.every((t) => t.computed_from_job_id === job.id)).toBe(true);
    expect(trophies.find((t) => t.trophy_key === 'founding_member' && t.member_id === memberOf('{A}'))).toBeTruthy();

    expect(db.rows('leagues')[0]).toMatchObject({ founded_season: 2019, imported_from: 'espn' });
    // The importer's own row is claimed via the SWID they supplied.
    expect(db.rows('league_members').find((m) => m.id === memberOf('{A}'))).toMatchObject({ owner_id: USER, claim_method: 'oauth_match' });
    // Keeper designation from draftStrategy landed in the crosswalk.
    expect(db.rows('external_player_ids').find((p) => p.external_player_id === '3895074')).toMatchObject({ nhl_player_id: 8478402, match_method: 'exact_name_team_number' });
  });

  it('a private older season is recorded as needing credentials; the rest still lands (partial)', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const routes = twoSeasonRoutes();
    for (const k of Object.keys(routes)) if (k.startsWith('2020:')) delete (routes as any)[k];
    const { client } = espnRouter({ ...routes, '2020:*': { status: 401 }, 'history:2020:*': { status: 401 } });

    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021 });

    expect(job.status).toBe('partial');
    expect(job.seasons_imported).toEqual([2020]);
    expect(job.seasons_needing_credentials).toEqual([2019]);
    expect(db.rows('league_seasons').map((s) => s.season)).toEqual([2020]);
    expect(db.rows('leagues')[0].founded_season).toBe(2020);
  });

  it('when nothing is reachable the job asks for credentials and writes nothing', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = espnRouter({ '2021:mSettings': { status: 200, body: espnCore(2021, TEAMS, { previous: [2020] }) }, '2020:*': { status: 401 }, 'history:2020:*': { status: 401 } });
    // Discovery succeeds (mSettings is the first view) but every season fetch is refused.
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021, seasons: [2019] });
    expect(job.status).toBe('needs_credentials');
    expect(job.seasons_needing_credentials).toEqual([2019]);
    expect(db.rows('league_seasons')).toHaveLength(0);
    expect(db.rows('leagues')[0].founded_season).toBeNull();
  });

  it('throttling stops the run as partial with a retry hint, keeping what landed', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    // Discovery reads the 2021 core once; the oldest season imports fine; ESPN
    // throttles the second read of the 2021 core, so the newer season is lost.
    const { client } = espnRouter(twoSeasonRoutes());
    const real = client.fetchSeason.bind(client);
    let coreReads2021 = 0;
    client.fetchSeason = async (id, s, views, creds) => {
      if (s === 2021 && views[0] === 'mSettings' && ++coreReads2021 === 2) throw new SourceThrottledError(30_000);
      return real(id, s, views, creds);
    };
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021 });
    expect(job.status).toBe('partial');
    expect(job.seasons_imported).toEqual([2019]);
    expect(job.error).toMatchObject({ code: 'THROTTLED', retry_after_ms: 30_000, season: 2020 });
    expect(job.finished_at ?? null).toBeNull(); // not finished: the client retries after the hint
    expect(db.rows('league_seasons').map((s) => s.season)).toEqual([2019]);
  });

  it('a failure past discovery marks the job failed with the reason', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = espnRouter(twoSeasonRoutes());
    db.failNext = { table: 'league_seasons', op: 'upsert', error: { message: 'disk full' } };
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021 });
    expect(job.status).toBe('failed');
    expect(job.error).toMatchObject({ code: 'IMPORT_FAILED', message: 'league_seasons upsert failed: disk full' });
    expect(job.finished_at).toBeTruthy();
  });

  it('a missing schedule or draft view degrades to a warning, not a failure', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const routes = twoSeasonRoutes();
    delete (routes as any)['2021:mMatchupScore'];
    delete (routes as any)['2021:mDraftDetail'];
    const { client } = espnRouter(routes);
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021, seasons: [2020] });
    expect(job.status).toBe('done');
    const r = (job.progress as any).seasons[0];
    expect(r.matchups).toBe(0);
    expect(r.picks).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/No draft detail/);
    // Standings still give a champion without the bracket, unverified.
    expect(db.rows('league_seasons')[0]).toMatchObject({ champion_member_id: expect.any(String), is_verified_by_bracket: null });
  });

  it('a locked league imports only seasons it does not have', async () => {
    const db = freshDb({ leagues: [{ id: LEAGUE, history_locked: true, founded_season: 2019, imported_from: 'manual' }] });
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = espnRouter(twoSeasonRoutes());
    await svc.writeSeason(LEAGUE, 'earlier', parseEspnSeason(EXT, { core: espnCore(2021, TEAMS), schedule: espnSchedule(TEAMS, 1) }), { importerUserId: USER });
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021 });
    expect(job.status).toBe('done');
    expect(db.rows('league_seasons').find((s) => s.season === 2020)!.import_job_id).toBe('earlier');
    expect(db.rows('league_seasons').find((s) => s.season === 2019)!.import_job_id).toBe(job.id);
    expect((job.progress as any).seasons.find((s: any) => s.season === 2020).warnings).toContain('League history is locked; existing season left untouched.');
  });

  it('an explicit season list restricts the run', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client, requested } = espnRouter(twoSeasonRoutes());
    const job = await svc.runEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021, seasons: [2019] });
    expect(job.seasons_imported).toEqual([2019]);
    expect(requested.filter((u) => u.includes('/seasons/2021/'))).toHaveLength(1); // discovery only
  });

  it('startEspn returns the queued job at once and finishes in the background', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = espnRouter(twoSeasonRoutes());
    const job = await svc.startEspn({ leagueId: LEAGUE, externalLeagueId: EXT, requestedBy: USER, client, latestEspnSeason: 2021 });
    expect(job.status).toBe('queued');
    let done: ImportJobRow | null = null;
    for (let i = 0; i < 50 && !done; i++) {
      await settle();
      const j = await svc.getJob(job.id);
      if (j && (j.status === 'done' || j.status === 'failed')) done = j;
    }
    expect(done?.status).toBe('done');
  });

  it('markFounded only moves the founding season earlier', async () => {
    const db = freshDb({ leagues: [{ id: LEAGUE, history_locked: false, founded_season: 2015, imported_from: null }] });
    const svc = new LeagueImportService(db as any, db as any);
    await svc.markFounded(LEAGUE, [2019, 2020], 'espn');
    expect(db.rows('leagues')[0]).toMatchObject({ founded_season: 2015, imported_from: 'espn' });
    await svc.markFounded(LEAGUE, [2012], 'yahoo');
    expect(db.rows('leagues')[0]).toMatchObject({ founded_season: 2012, imported_from: 'yahoo' });
  });
});

describe('helpers', () => {
  it('collectPlayerIds gathers picks and keeper designations once each', () => {
    const ids = collectPlayerIds(espnDraft([{ overall: 1, teamId: 1, playerId: 5 }, { overall: 2, teamId: 2, playerId: 6 }]), espnCore(2021, [{ ...TEAMS[0], keepers: [6, 7] }]));
    expect(ids.sort()).toEqual([5, 6, 7]);
    expect(collectPlayerIds(undefined, undefined)).toEqual([]);
  });

  it('currentCitrusSeason rolls over in July', () => {
    expect(currentCitrusSeason(new Date('2026-06-30T00:00:00Z'))).toBe(2025);
    expect(currentCitrusSeason(new Date('2026-07-01T00:00:00Z'))).toBe(2026);
    expect(currentCitrusSeason(new Date('2027-01-15T00:00:00Z'))).toBe(2026);
  });
});
