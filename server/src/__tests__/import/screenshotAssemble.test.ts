import { describe, it, expect } from 'vitest';
import { assembleSeasons, normName, playerRef } from '../../import/screenshot/assemble';
import type { ExtractedPage } from '../../import/screenshot/schema';
import { resolveStatName, translateSettings } from '../../import/screenshot/settings';
import { allPages, awardsPage, championsPage, draft2023, keepersPage, pickOwnershipPage, settingsPage, standings2023, standings2022, transactions2023 } from './screenshotFixtures';

const opts = { platform: 'yahoo' as const, currentSeason: 2025, externalLeagueId: 'the-puck-stops-here', leagueName: 'The Puck Stops Here' };

describe('normName / playerRef', () => {
  it('normalises names the way a person reads them', () => {
    expect(normName('  Dangle  Dynasty 🏒 ')).toBe('dangle dynasty');
    expect(normName('Émile Côté')).toBe('emile cote');
    expect(normName("O'Reilly & Sons")).toBe("o'reilly & sons");
  });
  it('keys players on name, plus the NHL team when printed, so two Sebastian Ahos stay apart', () => {
    expect(playerRef('Sebastian Aho', 'CAR', 'C').externalPlayerId).toBe('name:sebastian aho|CAR');
    expect(playerRef('Sebastian Aho', 'nyi', 'd').externalPlayerId).toBe('name:sebastian aho|NYI');
    expect(playerRef('Connor McDavid').externalPlayerId).toBe('name:connor mcdavid');
    expect(playerRef('Connor McDavid', null, 'c').position).toBe('C');
  });
});

describe('assembleSeasons', () => {
  const { seasons, unplaced } = assembleSeasons(allPages, opts);
  const s2023 = seasons.find((s) => s.season === 2023)!;
  const s2022 = seasons.find((s) => s.season === 2022)!;

  it('groups pages by season, oldest first, and reports what it could not place', () => {
    expect(seasons.map((s) => s.season)).toEqual([2022, 2023]);
    expect(unplaced).toEqual([{ index: 9, reason: 'Not a league page.' }]);
  });

  it('teams come from the standings page; the person is keyed on the printed manager name', () => {
    expect(s2023.teams.map((t) => t.teamName)).toEqual(['Dangle Dynasty 🏒', 'Bench Bosses', 'Crease Lightning', 'Deke Squad']);
    const alice = s2023.teams[0];
    expect(alice.externalTeamId).toBe('team:dangle dynasty');
    expect(alice.managers).toEqual([{ externalManagerId: 'name:alice', displayName: 'Alice' }]);
    expect(alice).toMatchObject({ finalRank: 1, wins: 15, losses: 5, ties: 2, pointsFor: 1234.5, pointsAgainst: 980.25, playoffFinish: 1, madePlayoffs: true, finalRankSource: 'source_final' });
    // No manager name: the team stands in, and the commissioner is told.
    expect(s2023.teams[3].managers[0]).toEqual({ externalManagerId: 'team:deke squad', displayName: 'Deke Squad' });
    expect(s2023.warnings.some((w) => /Deke Squad.*no manager name/.test(w))).toBe(true);
  });

  it('the same person is the same identity across seasons even when the team is renamed', () => {
    const alice2022 = s2022.teams.find((t) => t.teamName === 'Old Dangle')!;
    expect(alice2022.managers[0].externalManagerId).toBe('name:alice');
    expect(alice2022.externalTeamId).toBe('team:old dangle');
  });

  it('the playoff bracket fills finishes and playoff membership and becomes matchups where weeks are printed', () => {
    const finish = Object.fromEntries(s2023.teams.map((t) => [t.teamName, t.playoffFinish]));
    expect(finish).toEqual({ 'Dangle Dynasty 🏒': 1, 'Bench Bosses': 2, 'Crease Lightning': null, 'Deke Squad': 3 });
    const final = s2023.matchups.find((m) => m.isChampionship)!;
    expect(final).toMatchObject({ week: 23, homeExternalTeamId: 'team:dangle dynasty', awayExternalTeamId: 'team:bench bosses', winner: 'home', isPlayoff: true, homeScore: 101.5, awayScore: 99 });
    expect(s2023.matchups).toHaveLength(4);
  });

  it('a truncated team name on the draft page resolves to the standings team', () => {
    const makar = s2023.picks.find((p) => p.player.name === 'Cale Makar')!;
    expect(makar.externalTeamId).toBe('team:dangle dynasty');
    expect(s2023.picks.map((p) => p.overallPick)).toEqual([1, 2, 3, 4]);
    expect(s2023.picks[0]).toMatchObject({ isKeeper: true, keeperCost: 'Round 1', round: 1, pickInRound: 1 });
    expect(s2023.picks[1].player.externalPlayerId).toBe('name:sebastian aho|CAR');
    expect(s2023.picks[2].player.externalPlayerId).toBe('name:sebastian aho|NYI');
    expect(s2023.warnings).toContain('2023, image 3: Round 3 was cut off at the bottom.');
  });

  it('transactions are one asset each: players, and traded picks with their draft year', () => {
    const tx = s2023.transactions;
    expect(tx).toHaveLength(4); // the drop with neither a player nor a pick is skipped
    expect(tx[0]).toMatchObject({ type: 'trade', externalTeamId: 'team:bench bosses', counterpartyExternalTeamId: 'team:deke squad', player: { name: 'Connor McDavid' }, pick: null, occurredAt: '2024-01-15T00:00:00.000Z' });
    expect(tx[1]).toMatchObject({ type: 'trade', externalTeamId: 'team:deke squad', player: null, pick: { season: 2024, round: 1, originalExternalTeamId: 'team:bench bosses' } });
    // No draft year printed: the next draft, and a warning.
    expect(tx[2].pick).toEqual({ season: 2024, round: 2, originalExternalTeamId: null });
    expect(s2023.warnings.some((w) => /traded pick had no draft year/.test(w))).toBe(true);
    expect(tx[3]).toMatchObject({ type: 'add', faabBid: 12, occurredAt: null });
    expect(s2023.warnings.some((w) => /names neither a player nor a pick/.test(w))).toBe(true);
    expect(new Set(tx.map((t) => t.externalTransactionId)).size).toBe(4);
  });

  it('keepers, pick ownership and settings with no season attach to the newest season', () => {
    expect(s2022.keepers).toEqual([]);
    expect(s2023.keepers).toEqual([
      { externalTeamId: 'team:bench bosses', player: playerRef('Connor McDavid', 'EDM', 'C'), round: 1, roundNext: 1 },
      { externalTeamId: 'team:dangle dynasty', player: playerRef('Cale Makar', 'COL', 'D'), round: 3, roundNext: 2 },
    ]);
    // A pick a team still owns itself is not ownership news.
    expect(s2023.pickOwnership).toEqual([
      { draftSeason: 2024, round: 1, originalExternalTeamId: 'team:bench bosses', ownerExternalTeamId: 'team:deke squad' },
      { draftSeason: 2025, round: 1, originalExternalTeamId: 'team:crease lightning', ownerExternalTeamId: 'team:dangle dynasty' },
    ]);
    expect(s2023.settings.scoringType).toBe('h2h_categories');
    expect(s2023.settings.scoringItems.map((i) => i.citrusKey)).toEqual(['goals', 'assists', 'plus_minus', 'penalty_minutes', 'power_play_points', 'shots_on_goal', 'hits', 'wins', 'goals_against_average', 'save_percentage', 'unknown_yahoo_bananas']);
    expect(s2023.settings.rosterSlots).toEqual([{ slot: 'C', count: 2 }, { slot: 'LW', count: 2 }, { slot: 'RW', count: 2 }, { slot: 'D', count: 4 }, { slot: 'G', count: 2 }, { slot: 'BN', count: 4 }, { slot: 'IR', count: 2 }]);
    expect(s2023.settings).toMatchObject({ keeperCount: 3, draftType: 'SNAKE', usesFaab: true, regularSeasonWeeks: 21, playoffTeamCount: 4, playoffWeeks: 2, leagueName: 'The Puck Stops Here' });
    expect(s2023.warnings.some((w) => /Bananas/.test(w))).toBe(true);
  });

  it('a category scoreboard becomes category matchups and the season infers its scoring type', () => {
    expect(s2022.settings.scoringType).toBe('h2h_categories');
    expect(s2022.matchups[0]).toMatchObject({ week: 5, homeCatWins: 6, homeCatLosses: 3, homeCatTies: 1, homeScore: null, winner: 'home' });
    expect(s2022.matchups[1].winner).toBe('away');
    expect(s2022.teams[0].categoryRecord).toBe('132-69-9');
  });

  it('a past season is finished; the current one only with a champion; overrides win', () => {
    expect(s2022.isFinished).toBe(true);
    expect(s2023.isFinished).toBe(true);
    const current = assembleSeasons([{ ...standings2023, season: 2025, standings: standings2023.standings!.map((r) => ({ ...r, isChampion: null, playoffFinish: null })) }], opts).seasons[0];
    expect(current.isFinished).toBe(false);
    const forced = assembleSeasons([{ ...standings2023, season: 2025 }], { ...opts, finished: { 2025: false } }).seasons[0];
    expect(forced.isFinished).toBe(false);
    const past = assembleSeasons([{ ...standings2023, standings: standings2023.standings!.map((r) => ({ ...r, isChampion: null })) }], opts).seasons[0];
    expect(past.isFinished).toBe(true);
    expect(past.warnings.some((w) => /ranked first is taken as champion/.test(w))).toBe(true);
  });

  it('a page with no season and nothing to attach to is unplaced, not guessed', () => {
    const r = assembleSeasons([{ ...draft2023, season: null }], opts);
    expect(r.seasons).toEqual([]);
    expect(r.unplaced).toEqual([{ index: 2, reason: 'No season on the page. Set the season and read it again.' }]);
    const r2 = assembleSeasons([keepersPage], opts);
    expect(r2.unplaced[0].reason).toMatch(/no standings or champions page to attach it to/);
  });

  it('rosters become keepers only for a dynasty league, and say so otherwise', () => {
    const roster: ExtractedPage = { index: 10, platform: 'fantrax', kind: 'roster', season: 2023, leagueName: null, confidence: 'high', notes: null, roster: [{ teamName: 'Bench Bosses', players: [{ playerName: 'Connor McDavid', playerTeamAbbr: 'EDM', position: 'C' }, { playerName: 'Zach Hyman', playerTeamAbbr: 'EDM', position: 'LW' }] }] };
    const off = assembleSeasons([standings2023, roster], opts).seasons[0];
    expect(off.keepers).toEqual([]);
    expect(off.warnings.some((w) => /keep whole rosters/.test(w))).toBe(true);
    const on = assembleSeasons([standings2023, roster], { ...opts, rostersAsKeepers: true }).seasons[0];
    expect(on.keepers.map((k) => k.player.name)).toEqual(['Connor McDavid', 'Zach Hyman']);
    expect(on.keepers[0]).toMatchObject({ externalTeamId: 'team:bench bosses', round: null });
  });

  it('a platform the commissioner could not name is taken from the pages', () => {
    const r = assembleSeasons([standings2023], { ...opts, platform: 'manual' });
    expect(r.seasons[0].platform).toBe('yahoo');
    const r2 = assembleSeasons([{ ...standings2023, platform: 'unknown' }], { ...opts, platform: 'manual' });
    expect(r2.seasons[0].platform).toBe('manual');
  });

  it('a name on no standings page becomes its own team, with a warning', () => {
    const r = assembleSeasons([standings2023, { ...transactions2023, transactions: [{ date: null, type: 'add', teamName: 'Mystery Team', playerName: 'Someone' }] }], opts).seasons[0];
    expect(r.teams.map((t) => t.teamName)).toContain('Mystery Team');
    expect(r.warnings.some((w) => /"Mystery Team" on the transactions page matches no team/.test(w))).toBe(true);
  });
});

describe('champions and awards pages', () => {
  it('a league history page makes a season per row with its champion and runner-up, no standings needed', () => {
    const { seasons, unplaced } = assembleSeasons([championsPage], opts);
    expect(unplaced).toEqual([]);
    expect(seasons.map((s) => s.season)).toEqual([2020, 2021, 2023]);
    const s2021 = seasons.find((s) => s.season === 2021)!;
    expect(s2021.teams.map((t) => [t.teamName, t.finalRank, t.playoffFinish, t.madePlayoffs, t.managers[0].externalManagerId])).toEqual([
      ['Crease Lightning', 1, 1, true, 'name:cy'],
      ['Old Dangle', 2, 2, true, 'name:alice'],
    ]);
    expect(s2021.isFinished).toBe(true);
    expect(s2021.warnings.some((w) => /no standings page/.test(w))).toBe(false);
    expect(seasons.find((s) => s.season === 2020)!.teams).toHaveLength(1);
  });

  it('a champions row for a season that also has standings only confirms the champion, never duplicates the team', () => {
    const { seasons } = assembleSeasons([standings2022, { ...championsPage, champions: [{ season: 2022, championTeam: 'Bench Bosses', championManager: 'Bob', runnerUpTeam: 'Old Dangle', runnerUpManager: 'Alice' }] }], opts);
    const s = seasons[0];
    expect(s.teams).toHaveLength(4);
    expect(s.teams.find((t) => t.teamName === 'Bench Bosses')).toMatchObject({ finalRank: 1, playoffFinish: 1, wins: 14 });
    expect(s.teams.find((t) => t.teamName === 'Old Dangle')).toMatchObject({ finalRank: 2, playoffFinish: 2 });
  });

  it('awards attach to their season under the league\'s own name, resolve the winner by team or manager, and all-time awards ride on the newest season', () => {
    const { seasons } = assembleSeasons([championsPage, standings2023, awardsPage], opts);
    const s2023 = seasons.find((s) => s.season === 2023)!;
    expect(s2023.awards).toEqual([
      { season: 2023, name: 'The Sacko', externalTeamId: 'team:deke squad', winnerName: 'Deke Squad', note: 'Last place, again' },
      { season: 2023, name: 'Golden Stick', externalTeamId: 'team:bench bosses', winnerName: 'Bob', note: 'Most goals' },
      { season: null, name: 'Commissioner of the Decade', externalTeamId: 'team:dangle dynasty', winnerName: 'Alice', note: null },
    ]);
    // 2021's Sacko names a manager who is not on that season's page: a row is made for them, and the commissioner is told.
    const s2021 = seasons.find((s) => s.season === 2021)!;
    expect(s2021.awards).toEqual([{ season: 2021, name: 'The Sacko', externalTeamId: 'team:dee', winnerName: 'Dee', note: null }]);
    expect(s2021.warnings.some((w) => /"Dee" on the awards page matches no manager/.test(w))).toBe(true);
    expect(s2021.warnings.some((w) => /Handwritten column/.test(w))).toBe(true);
  });

  it('an empty champions or awards page is unplaced, not silently accepted', () => {
    const r = assembleSeasons([{ ...championsPage, champions: [] }, { ...awardsPage, awards: [] }], opts);
    expect(r.seasons).toEqual([]);
    expect(r.unplaced.map((u) => u.reason)).toEqual(['No seasons were read from the champions page.', 'No awards were read from the page.']);
  });
});

describe('settings translation', () => {
  it('reads every platform\'s spelling of a stat, and carries what it cannot name', () => {
    expect(resolveStatName('Power Play Points', 'espn')).toMatchObject({ citrusKey: 'power_play_points', group: 'skater', known: true });
    expect(resolveStatName('blocked shots', 'fantrax').citrusKey).toBe('blocks');
    expect(resolveStatName('Save %', 'cbs')).toMatchObject({ citrusKey: 'save_percentage', group: 'goalie' });
    expect(resolveStatName('G: GP', 'yahoo').citrusKey).toBe('goalie_games_played');
    expect(resolveStatName('GP', 'yahoo').citrusKey).toBe('games_played');
    expect(resolveStatName('Bananas', 'fantrax')).toMatchObject({ citrusKey: 'unknown_fantrax_bananas', known: false });
  });
  it('points values and categories both become scoring items; GAA is reversed', () => {
    const { settings, warnings } = translateSettings({ pointValues: [{ stat: 'G', points: 7 }, { stat: 'A', points: 3 }, { stat: 'GAA', points: -1 }] }, 'espn', 'X');
    expect(settings.scoringType).toBe('h2h_points');
    expect(settings.scoringItems.map((i) => [i.citrusKey, i.points, i.reverse])).toEqual([['goals', 7, false], ['assists', 3, false], ['goals_against_average', -1, true]]);
    expect(warnings).toEqual([]);
    expect(translateSettings(settingsPage.settings!, 'yahoo', 'X').settings.scoringItems.every((i) => i.points === null)).toBe(true);
  });
});
