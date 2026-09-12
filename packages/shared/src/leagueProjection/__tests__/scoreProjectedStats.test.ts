/**
 * A projection row scored under a league's own rules (2026-09-12).
 *
 * The defect: total_projected_points is baked with default scoring, so the
 * Match screen printed a default-scored projection beside a league-scored
 * live total, and Stormy argued from the default-scored one while being
 * handed the league's scoring separately.
 */
import { describe, it, expect } from 'vitest';
import { ScoringCalculator } from '../../utils/scoring';
import { projectionSettings, projectedPointsFor, scoreProjectedStats } from '../index';

const skaterRow = {
  is_goalie: false,
  projected_goals: 1.2,
  projected_assists: 2,
  projected_ppp: 0.5,
  projected_sog: 4,
  projected_blocks: 1.5,
  projected_hits: 3,
  projected_pim: 0.5,
  projected_shp: 0.1,
};

// projectionSettings reads the CANONICAL key names off the source object --
// it walks Object.keys(DEFAULT_SCORING) and looks each one up -- so a fixture
// written with the short spellings silently scores those categories at zero.
// These fixtures used ppp / sog / shp / pim, which resolved to undefined and
// then to 0, costing 1.0 + 2.0 + 0.2 = 3.2 points and reporting 18.2 against a
// hand-checked 21.4. Every league on production stores the long spellings
// (verified 2026-09-12: 10/10 carry shots_on_goal, power_play_points and
// short_handed_points; none carry the short forms), so the fixtures were wrong
// about the shape, not projectionSettings.
const bangerLeague = projectionSettings({
  skater: {
    goals: 6, assists: 4, power_play_points: 2, shots_on_goal: 0.5,
    blocks: 1, hits: 0.5, penalty_minutes: 0, short_handed_points: 2,
  },
  goalie: { wins: 5, saves: 0.2, shutouts: 3, goals_against: -2 },
});

const puristLeague = projectionSettings({
  skater: {
    goals: 6, assists: 4, power_play_points: 2, shots_on_goal: 0.5,
    blocks: 0, hits: 0, penalty_minutes: 0, short_handed_points: 2,
  },
  goalie: { wins: 5, saves: 0.2, shutouts: 3, goals_against: -2 },
});

describe('scoreProjectedStats', () => {
  it('scores a skater under the league that is asking', () => {
    expect(scoreProjectedStats(skaterRow, new ScoringCalculator(bangerLeague))).toBeCloseTo(21.4, 5);
  });

  it('the same row is worth less where hits and blocks pay nothing', () => {
    expect(scoreProjectedStats(skaterRow, new ScoringCalculator(puristLeague))).toBeCloseTo(18.4, 5);
  });

  it('a goalie is scored on wins, saves, shutouts and goals against', () => {
    const row = {
      is_goalie: true,
      projected_wins: 0.6,
      projected_saves: 28,
      projected_shutouts: 0.08,
      projected_goals_against: 2.4,
    };
    expect(scoreProjectedStats(row, new ScoringCalculator(bangerLeague))).toBeCloseTo(4.04, 5);
  });

  it('accepts the ROS table spelling of the goalie columns', () => {
    const row = {
      is_goalie: true,
      projected_wins_ros: 0.6,
      projected_saves_ros: 28,
      projected_shutouts_ros: 0.08,
      projected_ga_ros: 2.4,
    };
    expect(scoreProjectedStats(row, new ScoringCalculator(bangerLeague))).toBeCloseTo(4.04, 5);
  });

  it('accepts numerics that arrive as strings, the way PostgREST sends them', () => {
    const row = { ...skaterRow, projected_goals: '1.2', projected_assists: '2' };
    expect(scoreProjectedStats(row, new ScoringCalculator(bangerLeague))).toBeCloseTo(21.4, 5);
  });

  it('a row with no components cannot be rescored, and says so', () => {
    // A backfilled row that carries only the stored total. Answering 0 here
    // would take the player's projection off the screen.
    expect(scoreProjectedStats({ total_projected_points: 7.5 }, new ScoringCalculator(bangerLeague))).toBeNull();
    expect(scoreProjectedStats(null, new ScoringCalculator(bangerLeague))).toBeNull();
    expect(scoreProjectedStats(undefined, new ScoringCalculator(bangerLeague))).toBeNull();
  });

  it('a real zero is a measurement, not a missing component', () => {
    const row = { ...Object.fromEntries(Object.keys(skaterRow).map(key => [key, 0])), is_goalie: false };
    expect(scoreProjectedStats(row, new ScoringCalculator(bangerLeague))).toBe(0);
  });
});

describe('projectedPointsFor', () => {
  it('scores under the league when the components are there', () => {
    expect(projectedPointsFor({ ...skaterRow, total_projected_points: 99 }, new ScoringCalculator(bangerLeague)))
      .toBeCloseTo(21.4, 5);
  });

  it('never substitutes a default-scored stored total', () => {
    expect(projectedPointsFor({ total_projected_points: 7.5 }, new ScoringCalculator(bangerLeague))).toBeNull();
    expect(projectedPointsFor({ total_projected_points: '7.5' }, new ScoringCalculator(bangerLeague))).toBeNull();
  });

  it('missing is unavailable, not zero', () => {
    expect(projectedPointsFor(null, new ScoringCalculator(bangerLeague))).toBeNull();
    expect(projectedPointsFor({}, new ScoringCalculator(bangerLeague))).toBeNull();
  });
  it('requires enabled components and allows disabled ones to be missing', () => {
    const row = { ...skaterRow, projected_hits: undefined, projected_blocks: undefined };
    expect(scoreProjectedStats(row, new ScoringCalculator(bangerLeague))).toBeNull();
    expect(scoreProjectedStats(row, new ScoringCalculator(puristLeague))).toBeCloseTo(18.4);
  });
  it('keeps unsupported plus/minus unavailable when enabled', () => {
    expect(scoreProjectedStats(skaterRow, new ScoringCalculator({ ...bangerLeague,
      skater: { ...bangerLeague.skater, plus_minus: 1 } }))).toBeNull();
  });
});

// Saved Finalsz settings captured 2026-09-12. Totals below are synthetic category
// fixtures, never player forecasts; expected sums are independent arithmetic.
import finalsz from './fixtures/finalsz-scoring.json';
import { reweightProjections } from '../../utils/draftGuide';
import { projectionFor, expectedDailyProjection } from '../index';
import type { DashboardIndexEntry } from '../../types/playerDashboard';
describe('Finalsz plus/minus projection contract', () => {
  const scorer = new ScoringCalculator(projectionSettings(finalsz));
  const row = { ...skaterRow, projected_plus_minus: -2 };
  // 1.2*3 + 2*2 + .5*1 + 4*.4 + 1.5*.5 + 3*.2 + .5*.5 + .1*2 - 2*.5
  const expected = 10.5;
  it('scores signed category counts and passes them through the dashboard and daily adapters', () => {
    expect(scoreProjectedStats(row, scorer)).toBeCloseTo(expected);
    const entry = { is_goalie: false, proj_gp: 10, proj_goals: 1.2, proj_assists: 2,
      proj_ppp: .5, proj_sog: 4, proj_blocks: 1.5, proj_hits: 3, proj_pim: .5,
      proj_shp: .1, proj_plus_minus: -2 } as DashboardIndexEntry;
    expect(projectionFor(entry, scorer)?.total).toBeCloseTo(expected);
    expect(projectionFor(entry, scorer)?.perGp).toBeCloseTo(expected / 10);
    expect(projectionFor(entry, scorer)?.gamesRemaining).toBe(10);
    const daily = expectedDailyProjection({...row, projection_basis: 'unconditional', projected_gp: .5}, finalsz, false);
    expect(daily?.projected_plus_minus).toBe(-2);
    expect(daily?.total_projected_points).toBeCloseTo(expected);
    expect(row.projected_plus_minus).toBe(-2);
    expect(reweightProjections([{playerId: 1, playerName: 'Fixture', position: 'C', isGoalie: false,
      goals: 1.2, assists: 2, power_play_points: .5, shots_on_goal: 4, blocks: 1.5, hits: 3,
      penalty_minutes: .5, short_handed_points: .1, plus_minus: -2}], projectionSettings(finalsz))[0].projectedPoints).toBeCloseTo(expected);
  });
  it('never substitutes cached points or zero for a missing weighted category', () => {
    expect(scoreProjectedStats({...skaterRow, total_projected_points: 999}, scorer)).toBeNull();
    expect(expectedDailyProjection(skaterRow, finalsz, false)).toBeNull();
    expect(scoreProjectedStats({...row, projected_plus_minus: 0}, scorer)).toBeCloseTo(expected + 1);
  });
});
