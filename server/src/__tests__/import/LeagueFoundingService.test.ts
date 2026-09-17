import { describe, it, expect, vi } from 'vitest';
import { foundingPlan, LeagueFoundingService } from '../../services/import/LeagueFoundingService';
import { parseYahooSeason } from '../../import/yahoo/parse';
import { parseEspnSeason } from '../../import/espn/parse';
import { unpack } from '../../import/yahoo/normalize';
import { YahooClient } from '../../import/yahoo/client';
import { EspnClient } from '../../import/espn/client';
import { LeagueService } from '../../services/LeagueService';
import { FakeSupabase } from './fakeSupabase';
import { yahooLeagueBundle, yahooRouter, staticTokens, type YLeagueOpts } from './yahooFixtures';
import { espnCore, espnRouter, type FakeTeam } from './espnFixtures';
import type { ImportedSettings } from '../../import/types';

const yahooSeason = (over: Partial<YLeagueOpts> = {}): YLeagueOpts => ({
  leagueKey: '453.l.200', season: 2024, name: 'The Puck Stops Here', scoringType: 'headpoint', isFinished: true, startWeek: 1, endWeek: 2,
  playoffStartWeek: 2, numPlayoffTeams: 4,
  teams: [
    { id: 1, name: 'Alpha', guid: 'GUID_A', rank: 1, seed: 1, wins: 1, losses: 1, ties: 0, pointsFor: 200 },
    { id: 2, name: 'Bravo', guid: 'GUID_B', rank: 2, seed: 2, wins: 1, losses: 1, ties: 0, pointsFor: 180 },
    { id: 3, name: 'Charlie', guid: 'GUID_C', rank: 3, seed: 3, wins: 1, losses: 1, ties: 0, pointsFor: 170 },
  ],
  stats: [{ id: 1, display: 'G', value: 6 }, { id: 2, display: 'A', value: 4 }, { id: 19, display: 'W', value: 5 }],
  draft: [], ...over,
});

function yahooSettings(over: Partial<YLeagueOpts> = {}): { settings: ImportedSettings; teams: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const league = (unpack(yahooLeagueBundle(yahooSeason(over))) as any).fantasy_content.league;
  const parsed = parseYahooSeason({ league });
  return { settings: parsed.settings, teams: parsed.teams.length };
}

const ESPN_TEAMS: FakeTeam[] = [
  { id: 1, swid: '{A}', name: 'Alpha', rank: 1, seed: 1, wins: 14, losses: 6 },
  { id: 2, swid: '{B}', name: 'Bravo', rank: 2, seed: 2, wins: 12, losses: 8 },
];

describe('foundingPlan', () => {
  it('a Yahoo points league becomes a points league with its weights, roster, team count and playoff shape', () => {
    const { settings, teams } = yahooSettings();
    const plan = foundingPlan(settings, teams);
    expect(plan.name).toBe('The Puck Stops Here');
    expect(plan.scoringFormat).toBe('h2h-points');
    expect(plan.scoringSettings).toEqual({ skater: { goals: 6, assists: 4 }, goalie: { wins: 5 } });
    expect(plan.categories).toBeNull();
    expect(plan.rosterSlots).toEqual({ C: 2, LW: 2, RW: 2, D: 4, G: 2, BN: 4, IR: 2 });
    expect(plan.rosterSize).toBe(16);
    expect(plan.draftRounds).toBe(16);
    expect(plan.draftType).toBe('snake');
    expect(plan.teamsCount).toBe(3);
    expect(plan.playoffTeams).toBe(4);
    expect(plan.keeper).toEqual({ enabled: false, count: 0 });
    expect(plan.notes).toEqual([]);
  });

  it('a Yahoo categories league keeps the categories Citrus scores and names the ones it does not', () => {
    const { settings, teams } = yahooSettings({ scoringType: 'head', stats: [{ id: 1, display: 'G', value: 0 }, { id: 2, display: 'A', value: 0 }, { id: 8, display: 'PIM', value: 0 }, { id: 31, display: 'FW', value: 0 }] });
    const plan = foundingPlan(settings, teams);
    expect(plan.scoringFormat).toBe('h2h-categories');
    expect(plan.scoringSettings).toBeNull();
    expect(plan.categories).toEqual(['goals', 'assists', 'pim']);
    expect(plan.notes.some((n) => /left out: faceoff wins/.test(n))).toBe(true);
  });

  it('an auction draft and a keeper count carry over; the keeper rule is named as something to confirm', () => {
    const { settings, teams } = yahooSettings({ isAuction: true });
    const withKeepers: ImportedSettings = { ...settings, keeperCount: 3 };
    const plan = foundingPlan(withKeepers, teams);
    expect(plan.draftType).toBe('auction');
    expect(plan.keeper).toEqual({ enabled: true, count: 3 });
    expect(plan.notes.some((n) => /Keepers: 3 per team/.test(n))).toBe(true);
  });

  it('what the source cannot say falls back to Citrus defaults, each fallback named', () => {
    const bare: ImportedSettings = {
      leagueName: '  ', scoringType: 'unknown', scoringItems: [], rosterSlots: [{ slot: 'F', count: 3 }, { slot: 'Taxi', count: 2 }],
      regularSeasonWeeks: null, playoffTeamCount: null, playoffWeeks: null, keeperCount: null, keeperOrderType: null, draftType: null, usesFaab: null, isPublic: null,
    };
    const plan = foundingPlan(bare, null);
    expect(plan.name).toBe('My league');
    expect(plan.scoringFormat).toBe('h2h-points');
    expect(plan.scoringSettings).toBeNull();
    expect(plan.rosterSlots).toEqual({ UTIL: 3 });
    expect(plan.teamsCount).toBe(12);
    expect(plan.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/did not say how the league scores/),
      expect.stringMatching(/gave no point values/),
      expect.stringMatching(/Forward and wing slots became utility/),
      expect.stringMatching(/left out: Taxi x2/),
      expect.stringMatching(/did not say how many teams; the league starts at 12/),
    ]));
  });

  it('an ESPN league reads the same way', () => {
    const parsed = parseEspnSeason('777', { core: espnCore(2024, ESPN_TEAMS, { leagueName: 'Bay Street Hockey', scoringType: 'H2H_POINTS' }) });
    const plan = foundingPlan(parsed.settings, parsed.teams.length);
    expect(plan.name).toBe('Bay Street Hockey');
    expect(plan.teamsCount).toBe(2);
    expect(plan.scoringFormat).toBe('h2h-points');
  });
});

describe('LeagueFoundingService', () => {
  function makeDb() {
    const db = new FakeSupabase({
      leagues: [], teams: [],
      profiles: [{ id: 'u-1', username: 'garrett', first_name: 'Garrett', last_name: 'S', default_team_name: 'Storm Front' }],
    });
    return db;
  }

  it('founds a Yahoo league: name, format, weights, roster, team count and the stamp, commissioner team, then the import starts on it', async () => {
    const db = makeDb();
    const { impl } = yahooRouter({ 'league/453.l.200;out=settings,standings,draftresults': { status: 200, body: yahooLeagueBundle(yahooSeason()) } });
    const client = new YahooClient(staticTokens(), impl as never, 0);
    const startYahoo = vi.fn(async (o: { leagueId: string }) => ({ id: 'job-1', league_id: o.leagueId, status: 'queued' }));
    const svc = new LeagueFoundingService(db as never, db as never, { leagues: new LeagueService(db as never), imports: { startYahoo } as never });

    const res = await svc.foundFromYahoo({ leagueKey: '453.l.200', userId: 'u-1', client, importerGuid: 'GUID_A' });

    const league = db.rows('leagues')[0];
    expect(res.league.id).toBe(league.id);
    expect(league.name).toBe('The Puck Stops Here');
    expect(league.commissioner_id).toBe('u-1');
    expect(league.roster_size).toBe(16);
    expect(league.draft_rounds).toBe(16);
    expect(league.league_size).toBe(3);
    expect(league.scoring_settings).toEqual({ skater: { goals: 6, assists: 4 }, goalie: { wins: 5 } });
    expect(league.settings.scoringFormat).toBe('h2h-points');
    expect(league.settings.teamsCount).toBe(3);
    expect(league.settings.playoffTeams).toBe(4);
    expect(league.settings.rosterSlots).toEqual({ C: 2, LW: 2, RW: 2, D: 4, G: 2, BN: 4, IR: 2 });
    expect(league.roster_slots).toEqual(league.settings.rosterSlots);
    expect(league.settings.foundedFrom).toMatchObject({ platform: 'yahoo', externalLeagueId: '453.l.200', notes: [] });
    expect(league.imported_from).toBe('yahoo');
    expect(db.rows('teams')).toEqual([expect.objectContaining({ league_id: league.id, owner_id: 'u-1', team_name: 'Storm Front' })]);
    expect(startYahoo).toHaveBeenCalledWith(expect.objectContaining({ leagueId: league.id, leagueKey: '453.l.200', requestedBy: 'u-1', importerGuid: 'GUID_A' }));
    expect(res.job).toMatchObject({ id: 'job-1' });
    expect(res.plan).not.toHaveProperty('translated');
  });

  it('founds an ESPN league from its newest season and starts the import with the same credentials', async () => {
    const db = makeDb();
    const { impl } = espnRouter({ '2024:mSettings': { status: 200, body: espnCore(2024, ESPN_TEAMS, { leagueName: 'Bay Street Hockey' }) } });
    const client = new EspnClient(impl as never);
    const startEspn = vi.fn(async (o: { leagueId: string }) => ({ id: 'job-2', league_id: o.leagueId, status: 'queued' }));
    const svc = new LeagueFoundingService(db as never, db as never, { leagues: new LeagueService(db as never), imports: { startEspn } as never });
    const creds = { espnS2: 's'.repeat(30), swid: '{A}' };

    const res = await svc.foundFromEspn({ externalLeagueId: '777', userId: 'u-1', client, creds, latestEspnSeason: 2024, importerSwid: '{A}' });

    const league = db.rows('leagues')[0];
    expect(league.name).toBe('Bay Street Hockey');
    expect(league.settings.foundedFrom).toMatchObject({ platform: 'espn', externalLeagueId: '777' });
    expect(startEspn).toHaveBeenCalledWith(expect.objectContaining({ leagueId: league.id, externalLeagueId: '777', creds, importerSwid: '{A}', latestEspnSeason: 2024 }));
    expect(res.job).toMatchObject({ id: 'job-2' });
  });

  it('a source that cannot be read creates nothing', async () => {
    const db = makeDb();
    const { impl } = yahooRouter({});
    const client = new YahooClient(staticTokens(), impl as never, 0);
    const startYahoo = vi.fn();
    const svc = new LeagueFoundingService(db as never, db as never, { leagues: new LeagueService(db as never), imports: { startYahoo } as never });
    await expect(svc.foundFromYahoo({ leagueKey: '453.l.999', userId: 'u-1', client })).rejects.toThrow();
    expect(db.rows('leagues')).toEqual([]);
    expect(startYahoo).not.toHaveBeenCalled();
  });
});
