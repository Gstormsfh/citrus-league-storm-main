import { describe, it, expect } from 'vitest';
import { TrophyService } from '../../services/import/TrophyService';
import { FakeSupabase } from './fakeSupabase';

const LEAGUE = 'league-1';

function db(over: Record<string, any[]> = {}) {
  return new FakeSupabase({
    league_seasons: [
      { league_id: LEAGUE, season: 2023, scoring_type: 'h2h_points', champion_member_id: 'A', runner_up_member_id: 'B', regular_winner_id: 'A', is_verified_by_bracket: true, is_finished: true },
      { league_id: LEAGUE, season: 2024, scoring_type: 'h2h_points', champion_member_id: 'B', runner_up_member_id: 'A', regular_winner_id: 'B', is_verified_by_bracket: true, is_finished: true },
      { league_id: 'league-2', season: 2024, scoring_type: 'h2h_points', champion_member_id: 'Z', runner_up_member_id: null, regular_winner_id: null, is_verified_by_bracket: null, is_finished: true },
    ],
    league_season_teams: [
      { league_id: LEAGUE, season: 2023, member_id: 'A', team_name: 'A FC', rank: 1, wins: 12, losses: 8, ties: 0, points_for: 1000, points_against: 900, made_playoffs: true, playoff_finish: 1, playoff_seed: 1 },
      { league_id: LEAGUE, season: 2023, member_id: 'B', team_name: 'B FC', rank: 2, wins: 8, losses: 12, ties: 0, points_for: 900, points_against: 1000, made_playoffs: true, playoff_finish: 2, playoff_seed: 2 },
      { league_id: LEAGUE, season: 2024, member_id: 'A', team_name: 'A FC', rank: 2, wins: 9, losses: 11, ties: 0, points_for: 950, points_against: 960, made_playoffs: true, playoff_finish: 2, playoff_seed: 2 },
      { league_id: LEAGUE, season: 2024, member_id: 'B', team_name: 'B FC', rank: 1, wins: 11, losses: 9, ties: 0, points_for: 960, points_against: 950, made_playoffs: true, playoff_finish: 1, playoff_seed: 1 },
      { league_id: 'league-2', season: 2024, member_id: 'Z', team_name: 'Z', rank: 1, wins: 1, losses: 0, ties: 0, points_for: 1, points_against: 0, made_playoffs: true, playoff_finish: 1, playoff_seed: 1 },
    ],
    league_season_matchups: [
      { league_id: LEAGUE, season: 2023, week: 1, home_member_id: 'A', away_member_id: 'B', home_score: 100, away_score: 50, home_cat_wins: null, home_cat_losses: null, home_cat_ties: null, category_results: null, is_playoff: false, is_consolation: false, is_championship: false, winner_member_id: 'A', is_tie: false },
      { league_id: 'league-2', season: 2024, week: 1, home_member_id: 'Z', away_member_id: 'Y', home_score: 999, away_score: 0, home_cat_wins: null, home_cat_losses: null, home_cat_ties: null, category_results: null, is_playoff: false, is_consolation: false, is_championship: false, winner_member_id: 'Z', is_tie: false },
    ],
    league_trophies: [
      { id: 't-old', league_id: LEAGUE, season: 2023, member_id: 'A', trophy_key: 'champion', rank: 1, value: null, detail: {}, source: 'imported', computed_from_job_id: 'job-0', retired_at: null, is_hidden: false },
      { id: 't-manual', league_id: LEAGUE, season: 2019, member_id: 'A', trophy_key: 'custom', rank: null, value: null, detail: {}, source: 'manual', computed_from_job_id: null, retired_at: null, display_name: 'Lost the trophy in a lake', is_hidden: false },
      // The league's own award, imported from a screenshot: nothing in the season tables could rebuild it.
      { id: 't-award', league_id: LEAGUE, season: 2023, member_id: 'B', trophy_key: 'custom', rank: null, value: null, detail: { award: 'The Sacko' }, source: 'imported', computed_from_job_id: 'job-0', retired_at: null, display_name: 'The Sacko', is_hidden: false },
      { id: 't-retired', league_id: LEAGUE, season: 2022, member_id: 'A', trophy_key: 'champion', rank: 1, value: null, detail: {}, source: 'imported', computed_from_job_id: null, retired_at: '2026-01-01T00:00:00Z', is_hidden: false },
      { id: 't-other', league_id: 'league-2', season: 2024, member_id: 'Z', trophy_key: 'champion', rank: 1, value: null, detail: {}, source: 'imported', computed_from_job_id: null, retired_at: null, is_hidden: false },
    ],
    ...over,
  });
}

describe('TrophyService.loadInput', () => {
  it('reads only this league and passes the finished flag through', async () => {
    const input = await new TrophyService(db() as any).loadInput(LEAGUE);
    expect(input.seasons.map((s) => s.season).sort()).toEqual([2023, 2024]);
    expect(input.seasons[0].is_finished).toBe(true);
    expect(input.teams).toHaveLength(4);
    expect(input.matchups).toHaveLength(1);
    expect(input.matchups[0].home_score).toBe(100);
  });

  it('surfaces a read failure with the table named', async () => {
    const fake = db();
    fake.failNext = { table: 'league_season_teams', op: 'select', error: { message: 'boom' } };
    await expect(new TrophyService(fake as any).loadInput(LEAGUE)).rejects.toThrow('league_season_teams read failed: boom');
  });
});

describe('TrophyService.recompute', () => {
  it('retires the old computed rows, keeps manual ones, inserts the new set stamped with the job', async () => {
    const fake = db();
    const n = await new TrophyService(fake as any).recompute(LEAGUE, 'job-7');
    const rows = fake.rows('league_trophies');
    expect(rows.find((r) => r.id === 't-old')!.retired_at).toBeTruthy();
    expect(rows.find((r) => r.id === 't-manual')!.retired_at).toBeNull();
    expect(rows.find((r) => r.id === 't-award')!.retired_at).toBeNull(); // the league's own award survives a recompute
    expect(rows.find((r) => r.id === 't-other')!.retired_at).toBeNull(); // another league, untouched
    const live = rows.filter((r) => r.league_id === LEAGUE && !r.retired_at && r.source !== 'manual' && r.trophy_key !== 'custom');
    expect(live).toHaveLength(n);
    expect(n).toBeGreaterThan(5);
    expect(live.every((r) => r.computed_from_job_id === 'job-7')).toBe(true);
    expect(live.filter((r) => r.trophy_key === 'champion').map((r) => [r.season, r.member_id]).sort()).toEqual([[2023, 'A'], [2024, 'B']]);
    expect(live.find((r) => r.trophy_key === 'highest_week')).toMatchObject({ member_id: 'A', value: 100, source: 'computed' });
    // One title each: the honour is shared.
    expect(live.filter((r) => r.trophy_key === 'most_championships').map((r) => r.member_id).sort()).toEqual(['A', 'B']);
  });

  it('with no history it retires and writes nothing', async () => {
    const fake = db({ league_seasons: [], league_season_teams: [], league_season_matchups: [] });
    const n = await new TrophyService(fake as any).recompute(LEAGUE, null);
    expect(n).toBe(0);
    expect(fake.rows('league_trophies').find((r) => r.id === 't-old')!.retired_at).toBeTruthy();
    expect(fake.opsFor('league_trophies', 'insert')).toHaveLength(0);
  });

  it('a retire failure stops before any insert', async () => {
    const fake = db();
    fake.failNext = { table: 'league_trophies', op: 'update', error: { message: 'RLS' } };
    await expect(new TrophyService(fake as any).recompute(LEAGUE, 'job-7')).rejects.toThrow('league_trophies retire failed: RLS');
    expect(fake.opsFor('league_trophies', 'insert')).toHaveLength(0);
  });
});

describe('TrophyService.list / decorate / addManual', () => {
  it('lists live trophies for the league, newest season first, hidden included', async () => {
    const fake = db();
    fake.rows('league_trophies').find((r) => r.id === 't-manual')!.is_hidden = true;
    const list = await new TrophyService(fake as any).list(LEAGUE);
    expect(list.map((t) => t.id)).toEqual(['t-old', 't-award', 't-manual']);
    expect(list[2].is_hidden).toBe(true);
  });

  it('decorate changes presentation only, scoped to the league', async () => {
    const fake = db();
    await new TrophyService(fake as any).decorate(LEAGUE, 't-old', { display_name: 'The Cup', icon_key: 'cup', is_hidden: false });
    expect(fake.rows('league_trophies').find((r) => r.id === 't-old')).toMatchObject({ display_name: 'The Cup', icon_key: 'cup', trophy_key: 'champion', member_id: 'A' });
    await new TrophyService(fake as any).decorate(LEAGUE, 't-other', { display_name: 'Nope' });
    expect(fake.rows('league_trophies').find((r) => r.id === 't-other')!.display_name).toBeUndefined();
  });

  it('addManual writes a custom manual trophy', async () => {
    const fake = db();
    await new TrophyService(fake as any).addManual(LEAGUE, { season: 2018, member_id: 'B', display_name: 'Worst trade ever', detail: { note: 'gave away Draisaitl' } });
    const row = fake.rows('league_trophies').find((r) => r.display_name === 'Worst trade ever')!;
    expect(row).toMatchObject({ league_id: LEAGUE, season: 2018, member_id: 'B', trophy_key: 'custom', source: 'manual', detail: { note: 'gave away Draisaitl' }, icon_key: null });
  });
});
