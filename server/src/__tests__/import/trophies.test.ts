import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTrophies, type SeasonRow, type TeamRow, type MatchupRow, type TrophyRow } from '../../import/trophies';

const REPO = resolve(fileURLToPath(import.meta.url), '../../../../..');

const season = (s: number, over: Partial<SeasonRow> = {}): SeasonRow => ({
  season: s, scoring_type: 'h2h_points', champion_member_id: null, runner_up_member_id: null, regular_winner_id: null, is_verified_by_bracket: null, ...over,
});
const team = (s: number, member_id: string, over: Partial<TeamRow> = {}): TeamRow => ({
  season: s, member_id, team_name: `${member_id} FC`, rank: null, wins: null, losses: null, ties: null, points_for: null, points_against: null,
  made_playoffs: null, playoff_finish: null, playoff_seed: null, ...over,
});
const game = (s: number, week: number, home: string, away: string, hs: number | null, as: number | null, over: Partial<MatchupRow> = {}): MatchupRow => ({
  season: s, week, home_member_id: home, away_member_id: away, home_score: hs, away_score: as,
  home_cat_wins: null, home_cat_losses: null, home_cat_ties: null, category_results: null,
  is_playoff: false, is_consolation: false, is_championship: false,
  winner_member_id: hs == null || as == null ? null : hs > as ? home : as > hs ? away : null,
  is_tie: hs != null && as != null && hs === as,
  ...over,
});
const catGame = (s: number, week: number, home: string, away: string, w: number, l: number, t: number, results: MatchupRow['category_results'] = null): MatchupRow =>
  game(s, week, home, away, null, null, { home_cat_wins: w, home_cat_losses: l, home_cat_ties: t, category_results: results, winner_member_id: w > l ? home : l > w ? away : null, is_tie: w === l });

const pick = (rows: TrophyRow[], key: string, member?: string, s?: number | null) =>
  rows.filter((r) => r.trophy_key === key && (member === undefined || r.member_id === member) && (s === undefined || r.season === s));
const one = (rows: TrophyRow[], key: string, member?: string, s?: number | null) => {
  const found = pick(rows, key, member, s);
  expect(found, `${key} ${member ?? ''} ${s ?? ''}`).toHaveLength(1);
  return found[0];
};

/** Three points seasons, four founding managers, one late joiner. */
function pointsLeague() {
  const seasons = [
    season(2019, { champion_member_id: 'A', runner_up_member_id: 'B', regular_winner_id: 'A', is_verified_by_bracket: true }),
    season(2020), // champion must fall back to playoff_finish
    season(2021, { champion_member_id: 'A', runner_up_member_id: 'C' }),
  ];
  const teams = [
    team(2019, 'A', { rank: 1, wins: 15, losses: 5, ties: 2, made_playoffs: true, playoff_seed: 1, playoff_finish: 1 }),
    team(2019, 'B', { rank: 2, wins: 12, losses: 8, ties: 2, made_playoffs: true, playoff_seed: 2, playoff_finish: 2 }),
    team(2019, 'C', { rank: 3, wins: 10, losses: 10, ties: 2, made_playoffs: true, playoff_seed: 3 }),
    team(2019, 'D', { rank: 4, wins: 4, losses: 16, ties: 2, made_playoffs: false }),
    team(2020, 'A', { rank: 2, wins: 14, losses: 8, ties: 0, made_playoffs: true, playoff_seed: 1, playoff_finish: 2 }),
    team(2020, 'B', { rank: 1, wins: 9, losses: 13, ties: 0, made_playoffs: true, playoff_seed: 3, playoff_finish: 1 }),
    team(2020, 'C', { rank: 3, wins: 11, losses: 11, ties: 0, made_playoffs: true, playoff_seed: 2 }),
    team(2020, 'D', { rank: 4, wins: 6, losses: 16, ties: 0, made_playoffs: false }),
    team(2021, 'A', { rank: 1, wins: 16, losses: 6, ties: 0, made_playoffs: true, playoff_seed: 1, playoff_finish: 1 }),
    team(2021, 'B', { rank: 3, wins: 10, losses: 12, ties: 0, made_playoffs: true, playoff_seed: 4 }),
    team(2021, 'C', { rank: 2, wins: 12, losses: 10, ties: 0, made_playoffs: true, playoff_seed: 2, playoff_finish: 2 }),
    team(2021, 'D', { rank: 5, wins: 5, losses: 17, ties: 0, made_playoffs: false }),
    team(2021, 'E', { rank: 4, wins: 8, losses: 14, ties: 0, made_playoffs: false }),
  ];
  const matchups = [
    game(2019, 1, 'A', 'B', 100, 80),
    game(2019, 2, 'A', 'C', 90, 89),
    game(2019, 3, 'A', 'D', 120, 50),
    game(2019, 4, 'B', 'A', 70, 60),
    game(2019, 5, 'C', 'D', 200, 10, { is_playoff: true, is_consolation: true }), // consolation: must not count anywhere
    game(2019, 6, 'A', 'B', 95, 95),
    game(2020, 1, 'A', 'B', 88, 91),
    game(2020, 2, 'A', 'B', 70, 72),
    game(2020, 3, 'A', 'B', 64, 66),
  ];
  return { seasons, teams, matchups };
}

describe('computeTrophies: imported per-season honours', () => {
  const rows = computeTrophies(pointsLeague());

  it('returns nothing for an empty league', () => {
    expect(computeTrophies({ seasons: [], teams: [], matchups: [] })).toEqual([]);
  });

  it('champion comes from the season row first, then playoff_finish, and is always imported', () => {
    const c19 = one(rows, 'champion', 'A', 2019);
    expect(c19.source).toBe('imported');
    expect(c19.detail).toEqual({ verified_by_bracket: true, team_name: 'A FC' });
    expect(one(rows, 'champion', 'B', 2020).source).toBe('imported');
    expect(one(rows, 'champion', 'A', 2021).rank).toBe(1);
    expect(pick(rows, 'champion')).toHaveLength(3);
  });

  it('runner-up, third, regular-season title and playoff appearances', () => {
    expect(one(rows, 'runner_up', 'B', 2019).rank).toBe(2);
    expect(one(rows, 'runner_up', 'A', 2020).member_id).toBe('A');
    expect(one(rows, 'third', 'C', 2019).rank).toBe(3);
    expect(one(rows, 'third', 'B', 2021).member_id).toBe('B');
    expect(one(rows, 'regular_season_title', 'A', 2019).source).toBe('imported');
    expect(one(rows, 'regular_season_title', 'A', 2020).detail).toEqual({ team_name: 'A FC' }); // from playoff_seed 1
    expect(pick(rows, 'playoff_appearance', undefined, 2019).map((r) => r.member_id).sort()).toEqual(['A', 'B', 'C']);
    expect(one(rows, 'playoff_appearance', 'B', 2020).rank).toBe(3);
  });

  it('toilet bowl goes to the worst ranked team when at least four are ranked', () => {
    expect(one(rows, 'toilet_bowl', 'D', 2019).rank).toBe(4);
    expect(one(rows, 'toilet_bowl', 'D', 2021).rank).toBe(5);
    const tiny = computeTrophies({ seasons: [season(2019)], teams: [team(2019, 'A', { rank: 1 }), team(2019, 'B', { rank: 2 })], matchups: [] });
    expect(pick(tiny, 'toilet_bowl')).toHaveLength(0);
  });

  it('a champion seeded third or worse earns a computed comeback', () => {
    const cb = one(rows, 'comeback_seed', 'B', 2020);
    expect(cb.source).toBe('computed');
    expect(cb.value).toBe(3);
    expect(pick(rows, 'comeback_seed', 'A')).toHaveLength(0);
  });
});

describe('computeTrophies: all-time computed honours', () => {
  const rows = computeTrophies(pointsLeague());

  it('most championships, with ties sharing the trophy', () => {
    const most = pick(rows, 'most_championships');
    expect(most).toHaveLength(1);
    expect(most[0]).toMatchObject({ member_id: 'A', value: 2, season: null, source: 'computed', detail: { seasons: [2019, 2021] } });
    const tied = computeTrophies({
      seasons: [season(2019, { champion_member_id: 'A' }), season(2020, { champion_member_id: 'B' })],
      teams: [team(2019, 'A'), team(2019, 'B'), team(2020, 'A'), team(2020, 'B')], matchups: [],
    });
    expect(pick(tied, 'most_championships').map((r) => r.member_id).sort()).toEqual(['A', 'B']);
  });

  it('tenure and founding membership', () => {
    expect(one(rows, 'tenure', 'A')).toMatchObject({ value: 3, detail: { first_season: 2019, last_season: 2021 } });
    expect(one(rows, 'tenure', 'E')).toMatchObject({ value: 1, detail: { first_season: 2021, last_season: 2021 } });
    expect(pick(rows, 'founding_member').map((r) => r.member_id).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(one(rows, 'founding_member', 'A').value).toBe(2019);
  });

  it('all-time win percentage counts ties as half', () => {
    // A: 45-19-2 -> (45 + 1) / 66
    expect(one(rows, 'all_time_win_pct', 'A')).toMatchObject({ value: 0.697, detail: { wins: 45, losses: 19, ties: 2 } });
    const noGames = computeTrophies({ seasons: [season(2019)], teams: [team(2019, 'A')], matchups: [] });
    expect(pick(noGames, 'all_time_win_pct')).toHaveLength(0);
  });

  it('championship drought: seasons since the last title, or since joining', () => {
    expect(pick(rows, 'championship_drought', 'A')).toHaveLength(0); // won the latest season
    expect(one(rows, 'championship_drought', 'B')).toMatchObject({ value: 1, detail: { last_title: 2020, through: 2021 } });
    expect(one(rows, 'championship_drought', 'C')).toMatchObject({ value: 3, detail: { last_title: null } });
    expect(one(rows, 'championship_drought', 'E').value).toBe(1);
  });
});

describe('computeTrophies: matchup-derived records', () => {
  const rows = computeTrophies(pointsLeague());

  it('lifetime head-to-head is an ordered pair and ignores consolation games', () => {
    const ab = pick(rows, 'lifetime_h2h', 'A').find((r) => r.detail.opponent_member_id === 'B')!;
    expect(ab.detail).toEqual({ opponent_member_id: 'B', wins: 1, losses: 4, ties: 1 });
    expect(ab.value).toBe(1);
    expect(pick(rows, 'lifetime_h2h', 'A')).toHaveLength(3); // B, C, D
    const ba = pick(rows, 'lifetime_h2h', 'B').find((r) => r.detail.opponent_member_id === 'A')!;
    expect(ba.detail).toEqual({ opponent_member_id: 'A', wins: 4, losses: 1, ties: 1 });
    // C vs D only ever met in a consolation game.
    expect(pick(rows, 'lifetime_h2h', 'C').find((r) => r.detail.opponent_member_id === 'D')).toBeUndefined();
  });

  it('toughest opponent and favourite victim need three meetings and a real edge', () => {
    expect(one(rows, 'toughest_opponent', 'A')).toMatchObject({ value: 0.25, detail: { opponent_member_id: 'B' } });
    expect(one(rows, 'favourite_victim', 'B')).toMatchObject({ value: 0.75, detail: { opponent_member_id: 'A' } });
    expect(pick(rows, 'favourite_victim', 'A')).toHaveLength(0); // C and D: one game each
  });

  it('streaks run across seasons in order and reset on a tie', () => {
    expect(one(rows, 'longest_win_streak', 'A')).toMatchObject({ value: 3, detail: { ended_season: 2019 } });
    // A lost wk4 2019, tied wk6 (reset), then lost three straight in 2020.
    expect(one(rows, 'longest_losing_streak', 'A')).toMatchObject({ value: 3, detail: { ended_season: 2020 } });
    expect(one(rows, 'longest_win_streak', 'B').value).toBe(3);
    expect(pick(rows, 'longest_win_streak', 'C')).toHaveLength(0);
  });

  it('points records: highest/lowest week, blowout, closest, none from consolation', () => {
    expect(one(rows, 'highest_week')).toMatchObject({ member_id: 'A', value: 120, detail: { season: 2019, week: 3, opponent_member_id: 'D' } });
    expect(one(rows, 'lowest_week')).toMatchObject({ member_id: 'D', value: 50 });
    expect(one(rows, 'biggest_blowout')).toMatchObject({ member_id: 'A', value: 70 });
    expect(one(rows, 'closest_game')).toMatchObject({ member_id: 'A', value: 1, detail: { week: 2, opponent_member_id: 'C' } });
    for (const r of pick(rows, 'highest_week').concat(pick(rows, 'lowest_week'), pick(rows, 'biggest_blowout'), pick(rows, 'closest_game'))) {
      expect(r.source).toBe('computed');
      expect(r.season).toBeNull();
    }
  });

  it('a points league produces no category records', () => {
    for (const key of ['category_sweep', 'narrowest_category_win', 'perfect_week', 'category_dominance']) expect(pick(rows, key)).toHaveLength(0);
  });
});

describe('computeTrophies: category leagues get the hockey-native set', () => {
  const input = {
    seasons: [season(2022, { scoring_type: 'h2h_categories', champion_member_id: 'A' }), season(2023, { scoring_type: 'h2h_points' })],
    teams: [team(2022, 'A'), team(2022, 'B'), team(2022, 'C'), team(2022, 'D'), team(2023, 'A'), team(2023, 'B')],
    matchups: [
      catGame(2022, 1, 'A', 'B', 10, 0, 0, [{ statKey: 'goals', winner: 'home' }, { statKey: 'assists', winner: 'home' }]),
      catGame(2022, 2, 'C', 'D', 5, 4, 1, [{ statKey: 'goals', winner: 'away' }, { statKey: 'assists', winner: 'tie' }]),
      catGame(2022, 3, 'A', 'C', 6, 3, 1, [{ statKey: 'goals', winner: 'home' }]),
      game(2023, 1, 'A', 'B', 300, 10), // a points week in the same league must not become a category record
    ],
  };
  const rows = computeTrophies(input);

  it('sweep, narrowest win and perfect week', () => {
    expect(one(rows, 'category_sweep')).toMatchObject({ member_id: 'A', value: 10, detail: { season: 2022, week: 1, line: '10-0-0', opponent_member_id: 'B' } });
    expect(one(rows, 'narrowest_category_win')).toMatchObject({ member_id: 'C', value: 1, detail: { line: '5-4-1' } });
    expect(one(rows, 'perfect_week')).toMatchObject({ member_id: 'A', season: 2022, value: 10, detail: { week: 1, line: '10-0-0' } });
  });

  it('category dominance per stat', () => {
    const dom = pick(rows, 'category_dominance');
    expect(dom.find((r) => r.detail.stat_key === 'goals')).toMatchObject({ member_id: 'A', value: 2 });
    expect(dom.find((r) => r.detail.stat_key === 'assists')).toMatchObject({ member_id: 'A', value: 1 });
  });

  it('points records only cover the points season', () => {
    expect(one(rows, 'highest_week')).toMatchObject({ member_id: 'A', value: 300, detail: { season: 2023 } });
    expect(one(rows, 'lowest_week')).toMatchObject({ member_id: 'B', value: 10 });
  });

});

describe('computeTrophies: a season still in play', () => {
  const league = pointsLeague();
  // 2022 is being played: standings so far have B on top, one game played.
  const input = {
    seasons: [...league.seasons, season(2022, { is_finished: false })],
    teams: [...league.teams, team(2022, 'A', { rank: 2, wins: 0, losses: 1, ties: 0, playoff_seed: 2, made_playoffs: true }), team(2022, 'B', { rank: 1, wins: 1, losses: 0, ties: 0, playoff_seed: 1, made_playoffs: true }), team(2022, 'C', { rank: 3 }), team(2022, 'D', { rank: 4 })],
    matchups: [...league.matchups, game(2022, 1, 'B', 'A', 90, 80)],
  };
  const rows = computeTrophies(input);

  it('gets no standings honours: no champion, regular-season title, playoff appearance or toilet bowl', () => {
    for (const key of ['champion', 'runner_up', 'third', 'regular_season_title', 'playoff_appearance', 'toilet_bowl', 'comeback_seed']) {
      expect(pick(rows, key, undefined, 2022), key).toHaveLength(0);
    }
    expect(pick(rows, 'champion')).toHaveLength(3);
  });

  it('is not a drought year yet', () => {
    expect(pick(rows, 'championship_drought', 'A')).toHaveLength(0); // still the reigning champion
    expect(one(rows, 'championship_drought', 'B')).toMatchObject({ value: 1, detail: { through: 2021 } });
  });

  it('still counts toward tenure and the games already played', () => {
    expect(one(rows, 'tenure', 'A')).toMatchObject({ value: 4, detail: { last_season: 2022 } });
    expect(pick(rows, 'lifetime_h2h', 'B').find((r) => r.detail.opponent_member_id === 'A')!.detail).toMatchObject({ wins: 5, losses: 1, ties: 1 });
    expect(one(rows, 'longest_win_streak', 'B').value).toBe(4); // three in 2020 plus the 2022 opener
  });

  it('a league whose only season is in play has no drought at all', () => {
    const fresh = computeTrophies({ seasons: [season(2025, { is_finished: false })], teams: [team(2025, 'A', { rank: 1 }), team(2025, 'B', { rank: 2 })], matchups: [] });
    expect(pick(fresh, 'championship_drought')).toHaveLength(0);
    expect(pick(fresh, 'champion')).toHaveLength(0);
    expect(pick(fresh, 'founding_member')).toHaveLength(2);
  });
});

describe('computeTrophies: every emitted key is accepted by the league_trophies CHECK', () => {
  // A computed key the migration does not list would be rejected by Postgres at
  // insert time, after the import has already run. Catch it here instead.
  const migration = readFileSync(resolve(REPO, 'supabase/migrations/20260914110100_league_import_platform.sql'), 'utf8');
  const checkBlock = migration.match(/league_trophies_key_known check \(trophy_key in \(([\s\S]*?)\)\)/);
  const allowed = new Set((checkBlock?.[1] ?? '').match(/'([a-z_0-9]+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []);

  it('the CHECK list was found', () => {
    expect(allowed.size).toBeGreaterThan(20);
    expect(allowed.has('custom')).toBe(true);
  });

  it('points and category leagues together emit only listed keys with a provenance', () => {
    const both = computeTrophies({
      ...pointsLeague(),
      seasons: [...pointsLeague().seasons, season(2022, { scoring_type: 'h2h_categories' })],
      teams: [...pointsLeague().teams, team(2022, 'A'), team(2022, 'B')],
      matchups: [...pointsLeague().matchups, catGame(2022, 1, 'A', 'B', 10, 0, 0, [{ statKey: 'goals', winner: 'home' }])],
    });
    const emitted = new Set(both.map((r) => r.trophy_key));
    for (const key of emitted) expect(allowed.has(key), key).toBe(true);
    for (const r of both) expect(['imported', 'computed', 'manual']).toContain(r.source);
    // The full computed vocabulary is exercised by this fixture.
    for (const key of ['champion', 'runner_up', 'third', 'regular_season_title', 'playoff_appearance', 'toilet_bowl', 'most_championships', 'championship_drought',
      'founding_member', 'tenure', 'all_time_win_pct', 'highest_week', 'lowest_week', 'biggest_blowout', 'closest_game', 'longest_win_streak', 'longest_losing_streak',
      'lifetime_h2h', 'toughest_opponent', 'favourite_victim', 'comeback_seed', 'category_sweep', 'narrowest_category_win', 'category_dominance', 'perfect_week']) {
      expect(emitted.has(key), key).toBe(true);
    }
  });
});
