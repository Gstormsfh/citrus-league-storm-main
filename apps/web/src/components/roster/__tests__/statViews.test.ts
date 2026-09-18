import { describe, expect, it } from 'vitest';
import { actualStats, rosterStatSummary, ROSTER_STAT_VIEWS } from '../statViews';

const scoring = { skater: { goals: 5, assists: 3, shots_on_goal: 0.5 }, goalie: { wins: 4, saves: 0.2, goals_against: -1, shutouts: 3 } };
const actual = { nhl_goals: 10, nhl_assists: 20, nhl_shots_on_goal: 80 };
const ros = { season: 2026, games_remaining: 60, projected_goals: 30, projected_assists: 40, projected_sog: 220 };
const sources = { actual, prior: { nhl_goals: 50, nhl_assists: 60, nhl_shots_on_goal: 330 }, ros };
describe('roster comparison periods', () => {
  it('offers precisely the four requested scopes', () => {
    expect(ROSTER_STAT_VIEWS.map(([, label]) => label)).toEqual(['Actuals', 'Week', 'Season Proj', 'Prior Season']);
  });
  it('uses actuals and prior-season evidence separately with current league weights', () => {
    expect(rosterStatSummary('actuals', sources, false, scoring, 2026)).toMatchObject({ points: 150, detail: '2026-27 · 10 G · 20 A · 80 SOG', projected: false });
    expect(rosterStatSummary('priorSeason', sources, false, scoring, 2026)).toMatchObject({ points: 595, detail: '2025-26 · 50 G · 60 A · 330 SOG' });
  });
  it('full-season forecast is earned plus remaining, not remaining renamed or last season added', () => {
    expect(rosterStatSummary('seasonProjection', sources, false, scoring, 2026)).toMatchObject({ points: 530, detail: '2026-27 · 40 G · 60 A · 300 SOG', projected: true });
  });
  it('does not use another season or missing exposure as a full-season forecast', () => {
    expect(rosterStatSummary('seasonProjection', { ...sources, ros: { ...ros, season: 2025 } }, false, scoring, 2026).points).toBeNull();
    expect(rosterStatSummary('seasonProjection', { ...sources, ros: { ...ros, games_remaining: null } }, false, scoring, 2026).points).toBeNull();
  });
  it('keeps missing enabled stats and failures distinct from a successful empty season', () => {
    expect(actualStats(undefined)).toBeNull();
    expect(rosterStatSummary('actuals', { actual: null }, false, scoring, 2026).points).toBe(0);
    expect(rosterStatSummary('priorSeason', { prior: null }, false, scoring, 2026).points).toBeNull();
    expect(rosterStatSummary('actuals', { actual: { nhl_goals: 10 } }, false, scoring, 2026).points).toBeNull();
    expect(rosterStatSummary('seasonProjection', { ...sources, actual: undefined }, false, scoring, 2026).points).toBeNull();
  });
  it('uses the selected week outlook, not season or daily figures', () => {
    expect(rosterStatSummary('week', sources, false, scoring, 2026, { weekPoints: 25, actualToDate: 10, projRemaining: 15, projToDate: 9, gamesRemaining: 2, weekTrendPct: 11 })).toEqual({ points: 25, projected: true, detail: '10.0 earned + 15.0 remaining' });
  });
  it('scores goalies with wins/saves/GA/SO, without scaling ROS exposure again', () => {
    const goalie = { actual: { nhl_wins: 10, nhl_saves: 500, nhl_goals_against: 45, nhl_shutouts: 1 }, ros: { season: 2026, games_remaining: 40, projected_wins_ros: 20, projected_saves_ros: 1000, projected_ga_ros: 90, projected_shutouts_ros: 3 } };
    expect(rosterStatSummary('seasonProjection', goalie, true, scoring, 2026)).toMatchObject({ points: 297, detail: '2026-27 · 30 W · 1500 SV · 135 GA' });
  });
});
