import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseEspnSeason, espnTeamName, finalRankOf, mapEspnScoringType } from '../../import/espn/parse';
import { espnSeasonToCitrus } from '../../import/espn/maps';

// Real ESPN fhl payload: a 10-team H2H categories keeper league, 2019-20 season,
// captured by the espn-api project. Members, SWIDs, team names and logos are
// synthetic (rotated deterministically before the file was committed); every number is genuine.
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/espn/league_2020_keeper_h2h_categories.json'), 'utf8'));
// Real mid-season 2021 payload with the mMatchupScore view: playoff tiers present.
const tiers = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/espn/league_2021_matchupscore_playoff_tiers.json'), 'utf8'));

describe('espn season conversion', () => {
  it('ESPN seasonId is the END year; Citrus stores the START year', () => {
    expect(espnSeasonToCitrus(2020)).toBe(2019);
    expect(espnSeasonToCitrus(2026)).toBe(2025);
  });
});

describe('espnTeamName', () => {
  it('prefers the current name field', () => {
    expect(espnTeamName({ name: ' Dangle Dynasty ', location: 'Old', nickname: 'Name' })).toBe('Dangle Dynasty');
  });
  it('falls back to location + nickname for pre-2023 payloads', () => {
    expect(espnTeamName({ location: 'Dangle ', nickname: 'Dynasty' })).toBe('Dangle Dynasty');
  });
  it('never returns an empty name', () => {
    expect(espnTeamName({ id: 7 })).toBe('Team 7');
  });
});

describe('finalRankOf', () => {
  it('uses the commissioner override when present', () => {
    expect(finalRankOf({ rankFinal: 2, rankCalculatedFinal: 1 })).toEqual({ rank: 2, source: 'commissioner' });
  });
  it('falls back to the calculated rank', () => {
    expect(finalRankOf({ rankFinal: 0, rankCalculatedFinal: 3 })).toEqual({ rank: 3, source: 'source_calculated' });
  });
  it('treats 0 as not yet final', () => {
    expect(finalRankOf({ rankFinal: 0, rankCalculatedFinal: 0 })).toEqual({ rank: null, source: null });
  });
});

describe('mapEspnScoringType', () => {
  it('maps the formats ESPN uses', () => {
    expect(mapEspnScoringType('H2H_CATEGORY')).toBe('h2h_categories');
    expect(mapEspnScoringType('H2H_POINTS')).toBe('h2h_points');
    expect(mapEspnScoringType('ROTO')).toBe('roto');
    expect(mapEspnScoringType('SOMETHING_NEW')).toBe('unknown');
  });
});

describe('ESPN unfilled draft slots', () => {
  it('does not import preallocated sentinel rows as player selections', () => {
    const picks = [
      {playerId:-1,teamId:1,overallPickNumber:1,keeper:false},
      {playerId:1234,teamId:1,overallPickNumber:2,keeper:false},
      {playerId:0,teamId:1,overallPickNumber:3,keeper:false},
    ];
    const season=parseEspnSeason('123456',{core:{...fixture,draftDetail:{drafted:false,inProgress:false,picks}}});
    expect(season.picks).toHaveLength(1);
    expect(season.picks[0]).toMatchObject({overallPick:2,player:{externalPlayerId:'1234'}});
  });
});

describe('parseEspnSeason on the 2020 keeper league', () => {
  const season = parseEspnSeason('123456', { core: fixture });

  it('identifies the season and format', () => {
    expect(season.platform).toBe('espn');
    expect(season.externalLeagueId).toBe('123456');
    expect(season.externalSeasonKey).toBe('2020');
    expect(season.season).toBe(2019);
    expect(season.settings.scoringType).toBe('h2h_categories');
    expect(season.isFinished).toBe(true);
  });

  it('carries every enabled category with a Citrus key or an explicit unknown', () => {
    expect(season.settings.scoringItems).toHaveLength(9);
    for (const item of season.settings.scoringItems) {
      expect(item.points).toBeNull(); // category league: no point weights
      expect(item.citrusKey).toMatch(/^[a-z_]+$|^unknown_espn_\d+$/);
    }
    const keys = season.settings.scoringItems.map((i) => i.citrusKey);
    expect(keys).toContain('special_teams_points');
    expect(keys).toContain('shutouts');
    expect(keys).toContain('save_percentage');
  });

  it('reads roster slots and keeper settings', () => {
    expect(season.settings.rosterSlots).toEqual(expect.arrayContaining([
      { slot: 'C', count: 3 }, { slot: 'LW', count: 3 }, { slot: 'RW', count: 3 },
      { slot: 'D', count: 4 }, { slot: 'G', count: 2 }, { slot: 'BN', count: 8 }, { slot: 'IR', count: 2 },
    ]));
    expect(season.settings.keeperCount).toBe(8);
    expect(season.settings.keeperOrderType).toBe('TRADITIONAL');
    expect(season.settings.draftType).toBe('SNAKE');
    expect(season.settings.regularSeasonWeeks).toBe(22);
    expect(season.settings.playoffTeamCount).toBe(4);
  });

  it('builds ten teams keyed on the SWID, with the primary owner first', () => {
    expect(season.teams).toHaveLength(10);
    const t1 = season.teams.find((t) => t.externalTeamId === '1')!;
    expect(t1.teamName).toBe('Fixture Team 1');
    expect(t1.managers[0].externalManagerId).toBe('{F1A70008-0000-4000-8000-000000000008}');
    expect(t1.managers[0].displayName).toMatch(/^manager_\d+$/);
    expect(t1.finalRank).toBe(3);
    expect(t1.finalRankSource).toBe('source_calculated');
    expect(t1.playoffSeed).toBe(3);
    expect(t1.madePlayoffs).toBe(true);
  });

  it('keeps the category record verbatim and derives the matchup record from the schedule', () => {
    const t1 = season.teams.find((t) => t.externalTeamId === '1')!;
    expect(t1.categoryRecord).toBe('109-63-26');
    // 109+63+26 = 198 = 22 weeks x 9 categories: proof it counts categories, not games.
    expect(109 + 63 + 26).toBe(22 * 9);
    // The matchup record must therefore come from the schedule, not record.overall.
    expect(t1.wins).not.toBe(109);
    expect((t1.wins ?? 0) + (t1.losses ?? 0) + (t1.ties ?? 0)).toBeLessThanOrEqual(24);
    expect(t1.pointsFor).toBeNull();
  });

  it('reads all 120 matchups across 24 periods with category results, never a points score', () => {
    expect(season.matchups).toHaveLength(120);
    const weeks = new Set(season.matchups.map((m) => m.week));
    expect(weeks.size).toBe(24);
    for (const m of season.matchups) {
      expect(m.homeScore).toBeNull();
      expect(m.awayScore).toBeNull();
      expect(m.categoryResults).not.toBeNull();
      expect(m.homeCatWins).not.toBeNull();
    }
    const first = season.matchups.find((m) => m.week === 1 && m.homeExternalTeamId === '3')!;
    expect(first.winner).toBe('home');
    expect(first.homeCatWins).toBe(5);
    expect(first.awayExternalTeamId).toBe('8');
  });

  it('flags weeks past the regular season as playoffs when no tier data exists', () => {
    const regular = season.matchups.filter((m) => m.week <= 22);
    const playoff = season.matchups.filter((m) => m.week > 22);
    expect(regular.every((m) => !m.isPlayoff)).toBe(true);
    expect(playoff.every((m) => m.isPlayoff)).toBe(true);
    // Exactly one championship matchup is claimed, in the last week, involving the rank-1 team.
    const champ = season.matchups.filter((m) => m.isChampionship);
    expect(champ).toHaveLength(1);
    expect(champ[0].week).toBe(24);
    const rankOne = season.teams.find((t) => t.finalRank === 1)!.externalTeamId;
    expect([champ[0].homeExternalTeamId, champ[0].awayExternalTeamId]).toContain(rankOne);
  });

  it('reads 8 keeper designations per team from draftStrategy', () => {
    expect(season.keepers).toHaveLength(80);
    const t1 = season.keepers.filter((k) => k.externalTeamId === '1');
    expect(t1.map((k) => k.player.externalPlayerId)).toContain('3041969'); // Nathan MacKinnon
    // No player lookup supplied: names are empty, ids preserved, nothing invented.
    expect(t1[0].player.name).toBe('');
  });

  it('converts previousSeasons to Citrus start years', () => {
    expect(season.previousSeasons).toEqual([2012, 2013, 2014, 2015, 2016, 2017, 2018]);
  });

  it('records what it could not import instead of failing', () => {
    expect(season.picks).toHaveLength(0);
    expect(season.warnings.some((w) => /draft detail/i.test(w))).toBe(true);
  });
});

describe('parseEspnSeason with mMatchupScore playoff tiers', () => {
  const season = parseEspnSeason('123456', { core: tiers, schedule: tiers });

  it('uses tiers when present and marks consolation matchups', () => {
    const tiered = season.matchups.filter((m) => m.isPlayoff);
    expect(tiered.length).toBe(6);
    expect(season.matchups.filter((m) => m.isConsolation)).toHaveLength(4);
    // Championship is only claimed for WINNERS_BRACKET at the last winners' period.
    const champ = season.matchups.filter((m) => m.isChampionship);
    expect(champ.every((m) => !m.isConsolation)).toBe(true);
  });

  it('does not claim a finished season while ranks are 0', () => {
    expect(season.isFinished).toBe(false);
    for (const t of season.teams) expect(t.finalRank).toBeNull();
  });
});
