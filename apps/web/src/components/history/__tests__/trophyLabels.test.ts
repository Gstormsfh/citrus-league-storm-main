import { describe, it, expect } from 'vitest';
import type { Trophy } from '@/api/imports';
import { careerLine, groupAwards, groupTrophies, memberNamer, ordinal, seasonLabel, statName, trophyLabel, trophyValueLine, TROPHY_LABELS } from '../trophyLabels';

const trophy = (over: Partial<Trophy>): Trophy => ({
  id: 't', season: null, member_id: 'A', trophy_key: 'champion', rank: null, value: null, detail: {}, source: 'computed', display_name: null, icon_key: null, is_hidden: false, ...over,
});
const nameOf = (id: string | null | undefined) => ({ A: 'Alice', B: 'Bob' }[id ?? ''] ?? 'Unknown manager');

describe('seasonLabel / ordinal', () => {
  it('renders the start year as a hockey season', () => {
    expect(seasonLabel(2024)).toBe('2024-25');
    expect(seasonLabel(1999)).toBe('1999-00');
    expect(seasonLabel(2009)).toBe('2009-10');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe('trophyLabel', () => {
  it('every server trophy key has a title and a section', () => {
    const keys = ['champion', 'runner_up', 'third', 'regular_season_title', 'playoff_appearance', 'toilet_bowl', 'most_championships', 'championship_drought',
      'founding_member', 'tenure', 'all_time_win_pct', 'highest_week', 'lowest_week', 'biggest_blowout', 'closest_game', 'longest_win_streak', 'longest_losing_streak',
      'lifetime_h2h', 'toughest_opponent', 'favourite_victim', 'comeback_seed', 'category_sweep', 'narrowest_category_win', 'category_dominance', 'perfect_week', 'custom'];
    for (const k of keys) expect(TROPHY_LABELS[k], k).toBeTruthy();
  });
  it('a commissioner rename wins; an unknown key is still readable', () => {
    expect(trophyLabel({ trophy_key: 'champion', display_name: 'The Frozen Cup' }).title).toBe('The Frozen Cup');
    expect(trophyLabel({ trophy_key: 'something_new', display_name: null })).toMatchObject({ title: 'something new', section: 'record' });
  });
});

describe('trophyValueLine', () => {
  it('says what each number means', () => {
    expect(trophyValueLine(trophy({ trophy_key: 'champion', season: 2024, detail: { team_name: 'Dangle Dynasty' } }), nameOf)).toBe('Dangle Dynasty');
    expect(trophyValueLine(trophy({ trophy_key: 'most_championships', value: 3, detail: { seasons: [2019, 2021, 2024] } }), nameOf)).toBe('3 titles (2019-20, 2021-22, 2024-25)');
    expect(trophyValueLine(trophy({ trophy_key: 'championship_drought', value: 5, detail: { last_title: 2019 } }), nameOf)).toBe('5 seasons since 2019-20');
    expect(trophyValueLine(trophy({ trophy_key: 'championship_drought', value: 1, detail: { last_title: null } }), nameOf)).toBe('1 season and counting');
    expect(trophyValueLine(trophy({ trophy_key: 'all_time_win_pct', value: 0.6212, detail: { wins: 41, losses: 25, ties: 0 } }), nameOf)).toBe('62.1% (41-25)');
    expect(trophyValueLine(trophy({ trophy_key: 'highest_week', value: 187.5, detail: { season: 2022, week: 9, opponent_member_id: 'B' } }), nameOf)).toBe('187.5 points vs Bob, 2022-23, week 9');
    expect(trophyValueLine(trophy({ trophy_key: 'biggest_blowout', value: 70, detail: { season: 2019, week: 3, opponent_member_id: 'B' } }), nameOf)).toBe('By 70 over Bob, 2019-20, week 3');
    expect(trophyValueLine(trophy({ trophy_key: 'longest_win_streak', value: 7, detail: { ended_season: 2020 } }), nameOf)).toBe('7 straight, ended 2020-21');
    expect(trophyValueLine(trophy({ trophy_key: 'comeback_seed', value: 4 }), nameOf)).toBe('Won it as the 4th seed');
    expect(trophyValueLine(trophy({ trophy_key: 'perfect_week', value: 10, detail: { week: 4, line: '10-0-0' } }), nameOf)).toBe('10-0-0, week 4');
    expect(trophyValueLine(trophy({ trophy_key: 'category_dominance', value: 14, detail: { stat_key: 'shots_on_goal' } }), nameOf)).toBe('Shots on goal: 14 weekly wins');
    expect(trophyValueLine(trophy({ trophy_key: 'lifetime_h2h', value: 9, detail: { opponent_member_id: 'B', wins: 9, losses: 4, ties: 1 } }), nameOf)).toBe('9-4-1 vs Bob');
    expect(trophyValueLine(trophy({ trophy_key: 'toughest_opponent', value: 0.25, detail: { opponent_member_id: 'B', wins: 1, losses: 3, ties: 0 } }), nameOf)).toBe('25.0% vs Bob (1-3)');
    expect(trophyValueLine(trophy({ trophy_key: 'founding_member', value: 2013 }), nameOf)).toBe('Here since 2013-14');
    expect(trophyValueLine(trophy({ trophy_key: 'custom', season: 2018, detail: { note: 'Left the trophy at the rink' } }), nameOf)).toBe('Left the trophy at the rink');
  });
  it('never invents a value it does not have', () => {
    expect(trophyValueLine(trophy({ trophy_key: 'champion', detail: {} }), nameOf)).toBeNull();
    expect(trophyValueLine(trophy({ trophy_key: 'highest_week', value: null }), nameOf)).toBeNull();
  });
});

describe('careerLine / statName / memberNamer', () => {
  it('reads a career in one line and skips zeros', () => {
    expect(careerLine({ titles: 3, seasons_played: 11, playoff_seasons: 6, best_finish: 1 })).toBe('3 titles · 11 seasons · 6 playoff runs');
    expect(careerLine({ titles: 0, seasons_played: 1, playoff_seasons: 0, best_finish: 4 })).toBe('1 season · best: 4th');
    expect(careerLine({ titles: null, seasons_played: null, playoff_seasons: null, best_finish: null })).toBe('');
  });
  it('names stats for people', () => {
    expect(statName('power_play_points')).toBe('Power play points');
    expect(statName('unknown_yahoo_77')).toBe('Unknown stat 77');
    expect(statName('faceoff_losses')).toBe('faceoff losses');
  });
  it('maps ids to names with a placeholder', () => {
    const n = memberNamer({ members: [{ member_id: 'A', display_name: 'Alice' } as never] });
    expect(n('A')).toBe('Alice');
    expect(n('Z')).toBe('Unknown manager');
    expect(n(null)).toBe('Unknown manager');
  });
});

describe('groupTrophies', () => {
  it('sorts seasons newest first, records in the book order, and drops hidden rows', () => {
    const g = groupTrophies([
      trophy({ id: '1', trophy_key: 'runner_up', season: 2023, rank: 2 }),
      trophy({ id: '2', trophy_key: 'champion', season: 2024, rank: 1 }),
      trophy({ id: '3', trophy_key: 'champion', season: 2023, rank: 1 }),
      trophy({ id: '4', trophy_key: 'closest_game', value: 1 }),
      trophy({ id: '5', trophy_key: 'highest_week', value: 100 }),
      trophy({ id: '6', trophy_key: 'highest_week', value: 200, is_hidden: true }),
      trophy({ id: '7', trophy_key: 'tenure', value: 3 }),
      trophy({ id: '8', trophy_key: 'most_championships', value: 2 }),
      trophy({ id: '9', trophy_key: 'lifetime_h2h', value: 2 }),
    ]);
    expect(g.season.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(g.record.map((t) => t.id)).toEqual(['5', '4']);
    expect(g.career.map((t) => t.id)).toEqual(['8', '7']);
    expect(g.h2h.map((t) => t.id)).toEqual(['9']);
  });
});

describe('groupAwards', () => {
  it('groups the league\'s own awards by name, newest first, whoever handed them out, and skips hidden ones', () => {
    const g = groupAwards([
      trophy({ id: '1', trophy_key: 'custom', season: 2019, member_id: 'B', source: 'imported', display_name: 'The Sacko', detail: { award: 'The Sacko', winner_name: 'Bob', note: 'Last place' } }),
      trophy({ id: '2', trophy_key: 'custom', season: 2023, member_id: 'A', source: 'manual', display_name: 'the sacko', detail: {} }),
      trophy({ id: '3', trophy_key: 'custom', season: null, member_id: null, source: 'imported', display_name: 'Commissioner of the Decade', detail: { winner_name: 'Alice' } }),
      trophy({ id: '4', trophy_key: 'custom', season: 2020, member_id: 'A', source: 'imported', display_name: 'Hidden one', is_hidden: true }),
      trophy({ id: '5', trophy_key: 'champion', season: 2020, member_id: 'A' }),
    ]);
    expect(g.map((a) => a.name)).toEqual(['The Sacko', 'Commissioner of the Decade']);
    expect(g[0].winners.map((w) => [w.season, w.member_id])).toEqual([[2023, 'A'], [2019, 'B']]);
    expect(g[1].winners[0]).toEqual({ season: null, member_id: null, winner: 'Alice', note: null });
    expect(groupTrophies([trophy({ id: '6', trophy_key: 'custom', season: 2018 })]).awards).toHaveLength(1);
  });
});
