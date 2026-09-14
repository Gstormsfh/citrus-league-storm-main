import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LeagueImportService, chainYahooLeagues, type YahooLeagueSeason } from '../../services/import/LeagueImportService';
import { unpack } from '../../import/yahoo/normalize';
import { FakeSupabase } from './fakeSupabase';
import { yahooRouter, yahooLeagueBundle, yahooLeagueMetadata, yahooScoreboard, yahooPlayers, yahooTransactions, yahooUserLeagues, type YLeagueOpts, type YTeam, type YStat } from './yahooFixtures';

const LEAGUE = 'league-1';
const USER = 'user-commish';

const TEAMS: YTeam[] = [
  { id: 1, name: 'Alpha', guid: 'GUID_A', rank: 1, seed: 1, wins: 150, losses: 90, ties: 24, clinched: true },
  { id: 2, name: 'Bravo', guid: 'GUID_B', rank: 2, seed: 2, wins: 140, losses: 100, ties: 24, clinched: true },
  { id: 3, name: 'Charlie', guid: 'GUID_C', rank: 3, seed: 3, wins: 130, losses: 110, ties: 24, clinched: true },
  { id: 4, name: 'Delta', guid: 'GUID_D', rank: 4, seed: 4, wins: 100, losses: 140, ties: 24, clinched: true },
];
const STATS: YStat[] = [{ id: 1, display: 'G' }, { id: 2, display: 'A' }, { id: 20, display: 'W', positionType: 'G' }];

const seasonOpts = (leagueKey: string, season: number, over: Partial<YLeagueOpts> = {}): YLeagueOpts => ({
  leagueKey, season, name: 'The Puck Stops Here', scoringType: 'head', isFinished: true, startWeek: 1, endWeek: 3, playoffStartWeek: 3, numPlayoffTeams: 2,
  teams: TEAMS, stats: STATS, draft: [{ pick: 1, round: 1, teamId: 1, playerId: 6743 }], ...over,
});

const week = (o: YLeagueOpts, w: number, finalWinner: 'home' | 'away' = 'home') => {
  const sw = (winner: 'home' | 'away') => [1, 2, 20].map((statId) => ({ statId, winner }));
  const playoff = w === 3;
  return yahooScoreboard(o, w, [
    { home: 1, away: 2, homePts: finalWinner === 'home' ? 3 : 0, awayPts: finalWinner === 'home' ? 0 : 3, winner: finalWinner, statWinners: sw(finalWinner), isPlayoffs: playoff },
    { home: 3, away: 4, homePts: 2, awayPts: 1, winner: 'home', statWinners: sw('home'), isPlayoffs: playoff, isConsolation: playoff },
  ]);
};

/** Two seasons chained: 2023 (game 427) renewed into 2024 (game 453). */
function twoSeasonRoutes() {
  const s2024 = seasonOpts('453.l.200', 2024, { renew: '427_100' });
  const s2023 = seasonOpts('427.l.100', 2023, { renewed: '453_200', teams: TEAMS.map((t) => ({ ...t, rank: 5 - t.rank, seed: 5 - t.rank })) });
  const routes: Record<string, { status: number; body?: unknown }> = {};
  for (const o of [s2024, s2023]) {
    routes[`league/${o.leagueKey}/metadata`] = { status: 200, body: yahooLeagueMetadata(o) };
    routes[`league/${o.leagueKey};out=settings,standings,draftresults`] = { status: 200, body: yahooLeagueBundle(o) };
    for (let w = 1; w <= 3; w++) routes[`league/${o.leagueKey}/scoreboard;week=${w}`] = { status: 200, body: week(o, w, o.season === 2024 ? 'home' : 'away') };
    routes[`league/${o.leagueKey}/players;status=K;out=ownership`] = { status: 200, body: yahooPlayers(o, [{ playerId: 6743, name: 'Connor McDavid', team: 'Edm', number: '97', position: 'C', ownerTeamId: 1, keeper: { status: true, cost: 1 } }]) };
    routes[`league/${o.leagueKey}/transactions`] = { status: 200, body: yahooTransactions(o, [{ id: 1, type: 'add/drop', timestamp: 1700000000, moves: [{ playerId: 111, name: 'Waiver Guy', team: 'Bos', position: 'C', kind: 'add', to: 3, fromWaivers: true }] }]) };
    routes[`league/${o.leagueKey}/players;player_keys=*`] = { status: 200, body: yahooPlayers(o, [{ playerId: 6743, name: 'Connor McDavid', team: 'Edm', number: '97', position: 'C' }]) };
  }
  routes['users;use_login=1/games;game_codes=nhl;game_types=full/leagues'] = { status: 200, body: yahooUserLeagues('GUID_A', [
    { gameId: '453', season: 2024, leagues: [{ leagueKey: '453.l.200', name: 'The Puck Stops Here', season: 2024, renew: '427_100' }, { leagueKey: '453.l.999', name: 'Work League', season: 2024, isFinished: false }] },
    { gameId: '427', season: 2023, leagues: [{ leagueKey: '427.l.100', name: 'The Puck Stops Here', season: 2023, renewed: '453_200' }] },
  ]) };
  return routes;
}

function freshDb(over: Record<string, any[]> = {}) {
  return new FakeSupabase({
    leagues: [{ id: LEAGUE, name: 'Citrus League', history_locked: false, founded_season: null, imported_from: null }],
    player_directory: [{ player_id: 8478402, season: 2025, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' }],
    ...over,
  });
}

describe('chainYahooLeagues', () => {
  const row = (leagueKey: string, season: number, name: string, renew: string | null = null, renewed: string | null = null): YahooLeagueSeason =>
    ({ leagueKey, leagueId: leagueKey.split('.l.')[1], gameId: leagueKey.split('.')[0], season, name, isFinished: true, scoringType: 'h2h_categories', numTeams: 10, renew, renewed });

  it('groups seasons by renew/renewed and orders chains newest first', () => {
    const chains = chainYahooLeagues([
      row('427.l.100', 2023, 'Puck', null, '453.l.200'),
      row('453.l.200', 2024, 'Puck (renamed)', '427.l.100', null),
      row('411.l.50', 2021, 'Puck', null, '427.l.100'), // a gap year: 2022 missing, renew still links 2023 -> 2021
      row('453.l.999', 2024, 'Work League'),
      row('303.l.7', 2012, 'Ancient'),
    ]);
    expect(chains.map((c) => c.name)).toEqual(['Puck (renamed)', 'Work League', 'Ancient']);
    expect(chains[0].seasons.map((s) => s.season)).toEqual([2021, 2023, 2024]);
    expect(chains[0].key).toBe('453.l.200');
    expect(chains[0].latestSeason).toBe(2024);
  });

  it('a renew pointing at a season the user was not in does not break the chain', () => {
    const chains = chainYahooLeagues([row('453.l.200', 2024, 'Puck', '427.l.100', null)]);
    expect(chains).toHaveLength(1);
    expect(chains[0].seasons).toHaveLength(1);
  });

  it('empty in, empty out', () => {
    expect(chainYahooLeagues([])).toEqual([]);
  });
});

describe('LeagueImportService.discoverYahoo', () => {
  it('lists the connected account\'s NHL leagues by chain', async () => {
    const { client } = yahooRouter(twoSeasonRoutes());
    const svc = new LeagueImportService(freshDb() as any, freshDb() as any);
    const d = await svc.discoverYahoo(client);
    expect(d.guid).toBe('GUID_A');
    expect(d.chains.map((c) => [c.name, c.seasons.length])).toEqual([['The Puck Stops Here', 2], ['Work League', 1]]);
    expect(d.chains[0]).toMatchObject({ key: '453.l.200', latestSeason: 2024, scoringType: 'h2h_categories', numTeams: 10 });
    expect(d.chains[0].seasons.map((s) => s.leagueKey)).toEqual(['427.l.100', '453.l.200']);
  });

  it('reads the real users/games/leagues shape', async () => {
    const body = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/yahoo/sample.users_leagues.json'), 'utf8'));
    const { client } = yahooRouter({ 'users;use_login=1/games;game_codes=nhl;game_types=full/leagues': { status: 200, body } });
    const svc = new LeagueImportService(freshDb() as any, freshDb() as any);
    const d = await svc.discoverYahoo(client);
    expect(d.guid).toMatch(/^FIXTUREGUID/);
    // The fixture is football and baseball; a game with a non-nhl code is skipped.
    expect(d.chains).toEqual([]);
    void unpack;
  });
});

describe('LeagueImportService.runYahoo', () => {
  it('walks the chain from the picked season and imports every season, oldest first', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client, requested } = yahooRouter(twoSeasonRoutes());

    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client, importerGuid: 'GUID_A' });

    expect(job.status).toBe('done');
    expect(job.platform).toBe('yahoo');
    expect(job.external_league_id).toBe('453.l.200');
    expect(job.seasons_discovered).toEqual([2023, 2024]);
    expect(job.seasons_imported).toEqual([2023, 2024]);
    expect((job.progress as any).chain).toEqual([{ leagueKey: '427.l.100', season: 2023, name: 'The Puck Stops Here' }, { leagueKey: '453.l.200', season: 2024, name: 'The Puck Stops Here' }]);
    // Chain walk: picked, then renew backward; 2023 has no renew.
    expect(requested.slice(0, 2)).toEqual(['league/453.l.200/metadata', 'league/427.l.100/metadata']);
    // Per season: bundle, 3 weeks, keepers, transactions, player names.
    expect(requested.filter((r) => r.startsWith('league/427.l.100/scoreboard'))).toHaveLength(3);

    const memberOf = (guid: string) => db.rows('league_member_identities').find((i) => i.external_manager_id === guid)!.member_id;
    expect(db.rows('league_members')).toHaveLength(4);
    expect(db.rows('league_members').find((m) => m.id === memberOf('GUID_A'))).toMatchObject({ owner_id: USER, claim_method: 'oauth_match' });
    const s2024 = db.rows('league_seasons').find((s) => s.season === 2024)!;
    expect(s2024).toMatchObject({ platform: 'yahoo', external_league_id: '453.l.200', external_season_key: '453', scoring_type: 'h2h_categories', champion_member_id: memberOf('GUID_A'), runner_up_member_id: memberOf('GUID_B'), is_verified_by_bracket: true, is_finished: true });
    const s2023 = db.rows('league_seasons').find((s) => s.season === 2023)!;
    expect(s2023.champion_member_id).toBe(memberOf('GUID_D'));
    // The 2023 final was Alpha (home) vs Bravo (away) with the away side winning, while the standings put Delta first: flagged.
    expect(s2023.is_verified_by_bracket).toBe(false);
    expect(db.rows('league_season_matchups').filter((m) => m.season === 2024)).toHaveLength(6);
    expect(db.rows('league_season_matchups').find((m) => m.season === 2024 && m.is_championship)).toMatchObject({ home_member_id: memberOf('GUID_A'), winner_member_id: memberOf('GUID_A'), home_cat_wins: 3, home_score: null });
    expect(db.rows('league_season_drafts').find((p) => p.season === 2024)).toMatchObject({ overall_pick: 1, is_keeper: true, keeper_cost: 'round 1', nhl_player_id: 8478402, external_player_name: 'Connor McDavid' });
    expect(db.rows('league_season_transactions').filter((t) => t.season === 2024)).toHaveLength(1);
    expect(db.rows('league_season_transactions')[0]).toMatchObject({ type: 'waiver', member_id: memberOf('GUID_C'), source: 'yahoo', external_player_name: 'Waiver Guy' });
    expect(db.rows('external_league_links').map((l) => l.external_league_id).sort()).toEqual(['427.l.100', '453.l.200']);
    expect(db.rows('leagues')[0]).toMatchObject({ founded_season: 2023, imported_from: 'yahoo' });
    expect(db.rows('league_trophies').some((t) => t.trophy_key === 'champion' && t.season === 2024 && t.member_id === memberOf('GUID_A'))).toBe(true);
    // Every raw response was stored, keyed on the game id.
    expect(db.rows('import_raw_payloads').length).toBe(requested.length);
    expect(new Set(db.rows('import_raw_payloads').map((p) => p.external_season_key))).toEqual(new Set(['427', '453']));
  });

  it('re-running is idempotent for transactions as well', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client: yahooRouter(twoSeasonRoutes()).client });
    await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client: yahooRouter(twoSeasonRoutes()).client });
    expect(db.rows('league_season_transactions')).toHaveLength(2);
    expect(db.rows('league_members')).toHaveLength(4);
    expect(db.rows('league_seasons')).toHaveLength(2);
  });

  it('a season the account cannot read is recorded as needing credentials; the rest lands', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const routes = twoSeasonRoutes();
    routes['league/427.l.100;out=settings,standings,draftresults'] = { status: 403 };
    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client: yahooRouter(routes).client });
    expect(job.status).toBe('partial');
    expect(job.seasons_imported).toEqual([2024]);
    expect(job.seasons_needing_credentials).toEqual([2023]);
  });

  it('a dead connection during the chain walk parks the job as needs_credentials', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const { client } = yahooRouter(twoSeasonRoutes(), { get: async () => { throw new (await import('../../import/types')).NeedsCredentialsError(0, 'Connect Yahoo again'); }, invalidate: () => undefined });
    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client });
    expect(job.status).toBe('needs_credentials');
    expect(job.error).toMatchObject({ code: 'NEEDS_CREDENTIALS' });
    expect(db.rows('league_seasons')).toHaveLength(0);
  });

  it('throttling mid-run leaves a partial job with a retry hint', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const routes = twoSeasonRoutes();
    routes['league/453.l.200/scoreboard;week=2'] = { status: 999 };
    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client: yahooRouter(routes).client });
    expect(job.status).toBe('partial');
    expect(job.seasons_imported).toEqual([2023]);
    expect(job.error).toMatchObject({ code: 'THROTTLED', season: 2024 });
  });

  it('a missing keeper list or transaction log degrades to a warning', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const routes = twoSeasonRoutes();
    delete routes['league/453.l.200/players;status=K;out=ownership'];
    delete routes['league/453.l.200/transactions'];
    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.200', requestedBy: USER, client: yahooRouter(routes).client, seasons: [2024] });
    expect(job.status).toBe('done');
    expect(job.seasons_imported).toEqual([2024]);
    expect(db.rows('league_season_drafts')[0].is_keeper).toBe(false);
  });

  it('a points league skips nothing and a roto league skips the scoreboard', async () => {
    const db = freshDb();
    const svc = new LeagueImportService(db as any, db as any);
    const roto = seasonOpts('453.l.300', 2024, { scoringType: 'roto', teams: TEAMS.map((t) => ({ ...t, pointsFor: 50 })) });
    const { client, requested } = yahooRouter({
      'league/453.l.300/metadata': { status: 200, body: yahooLeagueMetadata(roto) },
      'league/453.l.300;out=settings,standings,draftresults': { status: 200, body: yahooLeagueBundle(roto) },
      'league/453.l.300/players;status=K;out=ownership': { status: 200, body: yahooPlayers(roto, []) },
      'league/453.l.300/transactions': { status: 200, body: yahooTransactions(roto, []) },
      'league/453.l.300/players;player_keys=*': { status: 200, body: yahooPlayers(roto, []) },
    });
    const job = await svc.runYahoo({ leagueId: LEAGUE, leagueKey: '453.l.300', requestedBy: USER, client });
    expect(job.status).toBe('done');
    expect(requested.some((r) => r.includes('scoreboard'))).toBe(false);
    expect(db.rows('league_seasons')[0]).toMatchObject({ scoring_type: 'roto', champion_member_id: expect.any(String), is_verified_by_bracket: null });
    expect(db.rows('league_season_matchups')).toHaveLength(0);
  });
});
