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
import { projectionSettings, scoreProjectedStats } from '../index';

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

const bangerLeague = projectionSettings({
  skater: { goals: 6, assists: 4, ppp: 2, sog: 0.5, blocks: 1, hits: 0.5, pim: 0, shp: 2 },
  goalie: { wins: 5, saves: 0.2, shutouts: 3, goals_against: -2 },
});

const puristLeague = projectionSettings({
  skater: { goals: 6, assists: 4, ppp: 2, sog: 0.5, blocks: 0, hits: 0, pim: 0, shp: 2 },
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

  it('a missing row is worth nothing, not a guess', () => {
    expect(scoreProjectedStats(null, new ScoringCalculator(bangerLeague))).toBe(0);
    expect(scoreProjectedStats(undefined, new ScoringCalculator(bangerLeague))).toBe(0);
  });
});
