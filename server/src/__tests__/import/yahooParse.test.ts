import { describe, it, expect } from 'vitest';
import { unpack } from '../../import/yahoo/normalize';
import { parseYahooSeason, mapYahooScoringType, teamIdFromKey, playerIdFromKey, yahooPlayerRef } from '../../import/yahoo/parse';
import { resolveYahooStat, renewToLeagueKey, splitLeagueKey, yahooSlot } from '../../import/yahoo/maps';
import { yahooLeagueBundle, yahooScoreboard, yahooPlayers, yahooTransactions, type YLeagueOpts, type YTeam, type YStat } from './yahooFixtures';

const LEAGUE_KEY = '453.l.12345';
const TEAMS: YTeam[] = [
  { id: 1, name: 'Alpha', guid: 'GUID_A', rank: 1, seed: 1, wins: 150, losses: 90, ties: 24, clinched: true, isCommissioner: true },
  { id: 2, name: 'Bravo', guid: 'GUID_B', rank: 2, seed: 2, wins: 140, losses: 100, ties: 24, clinched: true, coGuid: 'GUID_B2' },
  { id: 3, name: 'Charlie', guid: 'GUID_C', rank: 3, seed: 3, wins: 130, losses: 110, ties: 24, clinched: true },
  { id: 4, name: 'Delta', guid: 'GUID_D', rank: 4, seed: 4, wins: 100, losses: 140, ties: 24, clinched: true },
  { id: 5, name: 'Echo', guid: 'GUID_E', rank: 5, wins: 90, losses: 150, ties: 24 },
  { id: 6, name: 'Foxtrot', guid: 'GUID_F', rank: 6, wins: 80, losses: 160, ties: 24 },
];
const CAT_STATS: YStat[] = [
  { id: 1, display: 'G' }, { id: 2, display: 'A' }, { id: 8, display: 'PPP' }, { id: 14, display: 'SOG' }, { id: 31, display: 'HIT' },
  { id: 32, display: 'BLK' }, { id: 20, display: 'W', positionType: 'G' }, { id: 24, display: 'GAA', positionType: 'G', sortOrder: 0 },
  { id: 27, display: 'SV%', positionType: 'G' }, { id: 28, display: 'SHO', positionType: 'G' },
  { id: 0, display: 'GP', displayOnly: true },
];
const base = (over: Partial<YLeagueOpts> = {}): YLeagueOpts => ({
  leagueKey: LEAGUE_KEY, season: 2024, name: 'The Puck Stops Here', scoringType: 'head', isFinished: true, renew: '427_9999',
  startWeek: 1, endWeek: 24, playoffStartWeek: 22, numPlayoffTeams: 4, teams: TEAMS, stats: CAT_STATS,
  draft: [{ pick: 1, round: 1, teamId: 1, playerId: 6743 }, { pick: 2, round: 1, teamId: 2, playerId: 7534 }, { pick: 3, round: 1, teamId: 3, playerId: 9999 }],
  ...over,
});

/** A category week: home wins 6-3-1 on the ten scored categories. */
const catWeek = (home: number, away: number, homeWins: number, over: Record<string, unknown> = {}) => {
  const ids = [1, 2, 8, 14, 31, 32, 20, 24, 27, 28];
  const statWinners = ids.map((statId, i) => ({ statId, winner: (i < homeWins ? 'home' : i === 9 ? 'tie' : 'away') as 'home' | 'away' | 'tie' }));
  const wins = statWinners.filter((w) => w.winner === 'home').length, losses = statWinners.filter((w) => w.winner === 'away').length;
  return { home, away, homePts: wins, awayPts: losses, winner: (wins > losses ? 'home' : losses > wins ? 'away' : 'tie') as 'home' | 'away' | 'tie', statWinners, homeStats: { 1: 10, 24: '2.50' }, awayStats: { 1: 7, 24: '3.10' }, ...over };
};

function categoryLeague() {
  const o = base();
  const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
  const scoreboards = [
    (unpack(yahooScoreboard(o, 1, [catWeek(1, 2, 6), catWeek(3, 4, 4), catWeek(5, 6, 5)])) as any).fantasy_content.league,
    (unpack(yahooScoreboard(o, 2, [catWeek(2, 1, 7), catWeek(4, 3, 9), { home: 5, away: 6, status: 'midevent', statWinners: [] }])) as any).fantasy_content.league,
    (unpack(yahooScoreboard(o, 24, [catWeek(1, 2, 6, { isPlayoffs: true }), catWeek(3, 4, 8, { isPlayoffs: true, isConsolation: true })])) as any).fantasy_content.league,
  ];
  const keepers = (unpack(yahooPlayers(o, [
    { playerId: 6743, name: 'Connor McDavid', team: 'Edm', number: '97', position: 'C', ownerTeamId: 1, keeper: { status: true, cost: 1, kept: true } },
    { playerId: 7534, name: 'Cale Makar', team: 'Col', number: '8', position: 'D', keeper: { status: true, cost: 2 } }, // no ownership: joined via the draft
    { playerId: 5555, name: 'Nobody Kept', team: 'Tor', position: 'LW', ownerTeamId: 2, keeper: { status: false } },
  ])) as any).fantasy_content.league;
  const transactions = (unpack(yahooTransactions(o, [
    { id: 1, type: 'add/drop', timestamp: 1700000000, moves: [{ playerId: 111, name: 'Waiver Guy', team: 'Bos', position: 'C', kind: 'add', to: 3, fromWaivers: true }, { playerId: 222, name: 'Dropped Guy', team: 'Bos', position: 'D', kind: 'drop', from: 3 }], faab: 12 },
    { id: 2, type: 'trade', timestamp: 1700100000, traderTeamId: 1, tradeeTeamId: 2, moves: [{ playerId: 333, name: 'Traded A', team: 'Nyr', position: 'RW', kind: 'trade', from: 1, to: 2 }, { playerId: 444, name: 'Traded B', team: 'Nyi', position: 'G', kind: 'trade', from: 2, to: 1 }] },
  ])) as any).fantasy_content.league;
  const playersById = new Map([['9999', { playerId: '9999', fullName: 'Looked Up', teamAbbr: 'Van', uniformNumber: '40', position: 'C,LW' }]]);
  return parseYahooSeason({ league, scoreboards, keepers, transactions, playersById });
}

describe('yahoo maps', () => {
  it('display name decides, id fills in, unknown is carried not dropped', () => {
    expect(resolveYahooStat(31, 'HIT')).toMatchObject({ citrusKey: 'hits', group: 'skater', known: true });
    expect(resolveYahooStat(999, 'BLK')).toMatchObject({ citrusKey: 'blocks', known: true });
    expect(resolveYahooStat(24, null)).toMatchObject({ citrusKey: 'goals_against_average', group: 'goalie' });
    expect(resolveYahooStat(0, 'GP', 'G')).toMatchObject({ citrusKey: 'goalie_games_played', group: 'goalie' });
    expect(resolveYahooStat(0, 'GP', 'P')).toMatchObject({ citrusKey: 'games_played', group: 'skater' });
    expect(resolveYahooStat(77, 'XYZ', 'G')).toEqual({ citrusKey: 'unknown_yahoo_77', group: 'goalie', provenance: 'name', known: false });
    expect(resolveYahooStat(27, 'sv%')).toMatchObject({ citrusKey: 'save_percentage' });
  });
  it('renew uses an underscore; league keys use .l.', () => {
    expect(renewToLeagueKey('378_2210')).toBe('378.l.2210');
    expect(renewToLeagueKey('')).toBeNull();
    expect(renewToLeagueKey('378.l.2210')).toBeNull();
    expect(splitLeagueKey('453.l.12345')).toEqual({ gameId: '453', leagueId: '12345' });
    expect(splitLeagueKey('nhl.l.1')).toBeNull();
  });
  it('scoring types and slots', () => {
    expect(mapYahooScoringType('head')).toBe('h2h_categories');
    expect(mapYahooScoringType('headpoint')).toBe('h2h_points');
    expect(mapYahooScoringType('headone')).toBe('h2h_one_win');
    expect(mapYahooScoringType('roto')).toBe('roto');
    expect(mapYahooScoringType('point')).toBe('points');
    expect(mapYahooScoringType('weird')).toBe('unknown');
    expect(yahooSlot('IR+')).toBe('IR');
    expect(yahooSlot('bn')).toBe('BN');
  });
  it('key helpers', () => {
    expect(teamIdFromKey('388.l.27081.t.4')).toBe('4');
    expect(teamIdFromKey(null)).toBeNull();
    expect(playerIdFromKey('388.p.6743')).toBe('6743');
    expect(yahooPlayerRef({ player_key: '453.p.1', name: { full: 'A B' }, editorial_team_abbr: 'Edm', uniform_number: '9', display_position: 'C,LW' })).toEqual({ externalPlayerId: '1', name: 'A B', teamAbbr: 'Edm', jerseyNumber: '9', position: 'C' });
  });
});

describe('parseYahooSeason: a finished H2H categories keeper league', () => {
  const season = categoryLeague();

  it('identifies the season without converting the year', () => {
    expect(season.platform).toBe('yahoo');
    expect(season.externalLeagueId).toBe(LEAGUE_KEY);
    expect(season.externalSeasonKey).toBe('453');
    expect(season.season).toBe(2024);
    expect(season.isFinished).toBe(true);
    expect(season.settings.leagueName).toBe('The Puck Stops Here');
    expect(season.settings.scoringType).toBe('h2h_categories');
    expect(season.settings.isPublic).toBe(false);
  });

  it('reads the scored categories, skips display-only stats, marks GAA reverse', () => {
    expect(season.settings.scoringItems).toHaveLength(10);
    expect(season.settings.scoringItems.every((i) => i.points === null)).toBe(true);
    expect(season.settings.scoringItems.map((i) => i.citrusKey)).toEqual(['goals', 'assists', 'power_play_points', 'shots_on_goal', 'hits', 'blocks', 'wins', 'goals_against_average', 'save_percentage', 'shutouts']);
    expect(season.settings.scoringItems.find((i) => i.citrusKey === 'goals_against_average')!.reverse).toBe(true);
    expect(season.settings.scoringItems.find((i) => i.citrusKey === 'wins')!.group).toBe('goalie');
  });

  it('reads roster slots, playoffs and draft type', () => {
    expect(season.settings.rosterSlots).toEqual(expect.arrayContaining([{ slot: 'C', count: 2 }, { slot: 'G', count: 2 }, { slot: 'BN', count: 4 }, { slot: 'IR', count: 2 }]));
    expect(season.settings.regularSeasonWeeks).toBe(21);
    expect(season.settings.playoffWeeks).toBe(3);
    expect(season.settings.playoffTeamCount).toBe(4);
    expect(season.settings.draftType).toBe('SNAKE');
    expect(season.settings.usesFaab).toBe(false);
  });

  it('teams keyed on guid, co-manager after the primary, category record verbatim, matchup record from the scoreboard', () => {
    expect(season.teams).toHaveLength(6);
    const bravo = season.teams.find((t) => t.externalTeamId === '2')!;
    expect(bravo.managers.map((m) => m.externalManagerId)).toEqual(['GUID_B', 'GUID_B2']);
    expect(bravo.managers[0]).not.toHaveProperty('emailHint');
    expect(bravo.categoryRecord).toBe('140-100-24');
    // Weeks 1 and 24 were Alpha over Bravo, week 2 Bravo over Alpha.
    expect(bravo).toMatchObject({ wins: 1, losses: 2, ties: 0, pointsFor: null, finalRank: 2, finalRankSource: 'source_final', playoffSeed: 2, madePlayoffs: true, playoffFinish: 2 });
    const alpha = season.teams.find((t) => t.externalTeamId === '1')!;
    expect(alpha).toMatchObject({ finalRank: 1, playoffFinish: 1, wins: 2, losses: 1 });
    expect(season.teams.find((t) => t.externalTeamId === '5')!.madePlayoffs).toBe(false);
  });

  it('matchups carry category results and never a points score', () => {
    expect(season.matchups).toHaveLength(8);
    const wk1 = season.matchups.find((m) => m.week === 1 && m.homeExternalTeamId === '1')!;
    expect(wk1).toMatchObject({ awayExternalTeamId: '2', homeScore: null, awayScore: null, homeCatWins: 6, homeCatLosses: 3, homeCatTies: 1, winner: 'home', isPlayoff: false, isConsolation: false, isChampionship: false });
    expect(wk1.categoryResults).toHaveLength(10);
    expect(wk1.categoryResults![0]).toEqual({ statKey: 'goals', home: 10, away: 7, winner: 'home' });
    expect(wk1.categoryResults![7]).toMatchObject({ statKey: 'goals_against_average', home: 2.5, away: 3.1 });
    expect(wk1.categoryResults![9].winner).toBe('tie');
    // A week still in play has no winner and counts toward nobody's record.
    const live = season.matchups.find((m) => m.week === 2 && m.homeExternalTeamId === '5')!;
    expect(live.winner).toBeNull();
    expect(season.teams.find((t) => t.externalTeamId === '5')!.wins).toBe(1);
  });

  it('the last playoff week that is not consolation is the championship; the bracket agrees with the rank', () => {
    const final = season.matchups.filter((m) => m.isChampionship);
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ week: 24, homeExternalTeamId: '1', awayExternalTeamId: '2', winner: 'home', isPlayoff: true });
    const conso = season.matchups.find((m) => m.week === 24 && m.homeExternalTeamId === '3')!;
    expect(conso).toMatchObject({ isPlayoff: true, isConsolation: true, isChampionship: false });
    expect(season.warnings.some((w) => /Champion left unverified/.test(w))).toBe(false);
  });

  it('keepers come from the keeper list, with the team from ownership or the draft', () => {
    expect(season.keepers).toHaveLength(2);
    expect(season.keepers.find((k) => k.player.externalPlayerId === '6743')).toMatchObject({ externalTeamId: '1', round: 1, player: { name: 'Connor McDavid', teamAbbr: 'Edm', jerseyNumber: '97', position: 'C' } });
    expect(season.keepers.find((k) => k.player.externalPlayerId === '7534')).toMatchObject({ externalTeamId: '2', round: 2 });
    expect(season.keepers.some((k) => k.player.externalPlayerId === '5555')).toBe(false);
    expect(season.settings.keeperCount).toBe(1);
  });

  it('draft picks join the keeper flag and take names from the lookup', () => {
    expect(season.picks).toHaveLength(3);
    expect(season.picks[0]).toMatchObject({ overallPick: 1, round: 1, externalTeamId: '1', isKeeper: true, keeperCost: 'round 1', player: { externalPlayerId: '6743', name: '' } });
    expect(season.picks[2]).toMatchObject({ overallPick: 3, externalTeamId: '3', isKeeper: false, player: { externalPlayerId: '9999', name: 'Looked Up', teamAbbr: 'Van', jerseyNumber: '40', position: 'C' } });
  });

  it('transactions: waiver add, drop, and both sides of a trade', () => {
    expect(season.transactions).toHaveLength(4);
    expect(season.transactions[0]).toMatchObject({ externalTransactionId: '1', type: 'waiver', externalTeamId: '3', counterpartyExternalTeamId: null, faabBid: 12, player: { externalPlayerId: '111', name: 'Waiver Guy' } });
    expect(season.transactions[0].occurredAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(season.transactions[1]).toMatchObject({ type: 'drop', externalTeamId: '3', player: { externalPlayerId: '222' } });
    expect(season.transactions[2]).toMatchObject({ type: 'trade', externalTeamId: '2', counterpartyExternalTeamId: '1', player: { externalPlayerId: '333' } });
    expect(season.transactions[3]).toMatchObject({ type: 'trade', externalTeamId: '1', counterpartyExternalTeamId: '2', player: { externalPlayerId: '444' } });
  });
});

describe('parseYahooSeason: other shapes', () => {
  it('a points league carries weights and weekly totals', () => {
    const o = base({ scoringType: 'headpoint', stats: [{ id: 1, display: 'G', value: 7 }, { id: 2, display: 'A', value: 3 }, { id: 20, display: 'W', positionType: 'G', value: 4 }], teams: TEAMS.map((t) => ({ ...t, wins: 12, losses: 8, ties: 2, pointsFor: 1000 + t.id, pointsAgainst: 900 })) });
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const sb = (unpack(yahooScoreboard(o, 1, [{ home: 1, away: 2, homePts: 101.5, awayPts: 88, winner: 'home' }, { home: 3, away: 4, homePts: 70, awayPts: 70, winner: 'tie' }])) as any).fantasy_content.league;
    const season = parseYahooSeason({ league, scoreboards: [sb] });
    expect(season.settings.scoringType).toBe('h2h_points');
    expect(season.settings.scoringItems.map((i) => [i.citrusKey, i.points])).toEqual([['goals', 7], ['assists', 3], ['wins', 4]]);
    const alpha = season.teams.find((t) => t.externalTeamId === '1')!;
    expect(alpha).toMatchObject({ wins: 12, losses: 8, ties: 2, pointsFor: 1001, pointsAgainst: 900, categoryRecord: null });
    expect(season.matchups[0]).toMatchObject({ homeScore: 101.5, awayScore: 88, homeCatWins: null, categoryResults: null, winner: 'home' });
    expect(season.matchups[1]).toMatchObject({ winner: 'tie' });
  });

  it('a season still in play has no rank and no champion', () => {
    const o = base({ isFinished: false, teams: TEAMS.map((t) => ({ ...t, clinched: false })) });
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const season = parseYahooSeason({ league, scoreboards: [] });
    expect(season.isFinished).toBe(false);
    expect(season.teams.every((t) => t.finalRank === null && t.playoffFinish === null)).toBe(true);
    expect(season.warnings.some((w) => /No scoreboard weeks/.test(w))).toBe(true);
  });

  it('a bracket that disagrees with the standings is flagged for a person', () => {
    const o = base();
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const sb = (unpack(yahooScoreboard(o, 24, [catWeek(1, 2, 3, { isPlayoffs: true })])) as any).fantasy_content.league; // Bravo wins the final
    const season = parseYahooSeason({ league, scoreboards: [sb] });
    expect(season.teams.find((t) => t.externalTeamId === '2')!.playoffFinish).toBe(1);
    expect(season.teams.find((t) => t.externalTeamId === '1')!.finalRank).toBe(1);
    expect(season.warnings.some((w) => /Final standings say team 1 finished first but the playoff final was won by team 2/.test(w))).toBe(true);
  });

  it('an unknown stat is carried as unknown_yahoo_{id} with a warning', () => {
    const o = base({ stats: [{ id: 1, display: 'G' }, { id: 88, display: 'ZZZ' }] });
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const season = parseYahooSeason({ league });
    expect(season.settings.scoringItems.map((i) => i.citrusKey)).toEqual(['goals', 'unknown_yahoo_88']);
    expect(season.warnings.some((w) => /stat id 88/.test(w))).toBe(true);
  });

  it('a category week without stat winners falls back to the category-win totals', () => {
    const o = base();
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const sb = (unpack(yahooScoreboard(o, 3, [{ home: 1, away: 2, homePts: 6, awayPts: 4, winner: 'home' }])) as any).fantasy_content.league;
    const season = parseYahooSeason({ league, scoreboards: [sb] });
    expect(season.matchups[0]).toMatchObject({ homeCatWins: 6, homeCatLosses: 4, homeCatTies: null, winner: 'home' });
    expect(season.warnings.some((w) => /no per-category winners/.test(w))).toBe(true);
  });

  it('a two-week championship is noted', () => {
    const o = base({ multiweekFinal: true });
    const league = (unpack(yahooLeagueBundle(o)) as any).fantasy_content.league;
    const sb = (unpack(yahooScoreboard(o, 24, [catWeek(1, 2, 6, { isPlayoffs: true })])) as any).fantasy_content.league;
    const season = parseYahooSeason({ league, scoreboards: [sb] });
    expect(season.warnings.some((w) => /two-week championship/.test(w))).toBe(true);
  });

  it('refuses a payload with no league key or season', () => {
    expect(() => parseYahooSeason({ league: {} })).toThrow(/no league_key/);
    expect(() => parseYahooSeason({ league: { league_key: '453.l.1' } })).toThrow(/no season/);
  });
});
