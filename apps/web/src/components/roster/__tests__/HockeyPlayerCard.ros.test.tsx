import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HockeyPlayerCard, { type HockeyPlayer } from '../HockeyPlayerCard';
import { indexRosterRosStats, rosterRosStats, formatRosCount } from '../rosStats';

const player = (overrides: Partial<HockeyPlayer> = {}): HockeyPlayer => ({
  id: '8478402', name: 'Connor McDavid', position: 'C', number: 97,
  team: 'EDM', starter: true, statView: 'restOfSeason',
  stats: { gamesPlayed: 82, goals: 48, assists: 90, shots: 306 }, ...overrides,
});
const cells = () => [...screen.getByLabelText('Rest of season projections').children].map(cell => cell.textContent);

describe('canonical roster ROS display', () => {
  it('renders canonical remaining exposure/counts instead of season actuals or hardcoded GP zero', () => {
    const rosStats = rosterRosStats({ games_remaining: '83', projected_goals: 37.701387537955235,
      projected_assists: 91.8, projected_sog: 279.9 });
    render(<HockeyPlayerCard player={player({ rosStats })} />);
    expect(cells()).toEqual(['GP83', 'G38', 'A92', 'SOG280']);
    expect(rosStats.goals).toBe(37.701387537955235);
  });

  it('renders absent rows/categories as unavailable but preserves genuine zero', () => {
    const { rerender } = render(<HockeyPlayerCard player={player()} />);
    expect(cells()).toEqual(['GP—', 'G—', 'A—', 'SOG—']);
    rerender(<HockeyPlayerCard player={player({ rosStats: rosterRosStats({ games_remaining: 0,
      projected_goals: 0, projected_assists: null, projected_sog: '' }) })} />);
    expect(cells()).toEqual(['GP0', 'G0', 'A—', 'SOG—']);
  });

  it('uses supported goalie totals without deriving GAA or weighting crease exposure twice', () => {
    const rosStats = rosterRosStats({ games_remaining: 2, projected_wins_ros: 1.18,
      projected_saves_ros: 55.66, projected_ga_ros: 4.17 });
    render(<HockeyPlayerCard player={player({ position: 'G', rosStats })} />);
    expect(cells()).toEqual(['W1', 'SV56', 'GA4']);
    expect(within(screen.getByLabelText('Rest of season projections')).queryByText('GAA')).toBeNull();
    expect(rosStats.saves).toBe(55.66);
  });

  it('does not substitute selected-day actuals into a ROS view', () => {
    render(<HockeyPlayerCard player={player({ nextGame: { isToday: true, gameStatus: 'final' },
      daily_actual_stats: { goals: 9, assists: 8 }, rosStats: rosterRosStats({ projected_goals: 20 }) })} />);
    expect(cells()).toEqual(['GP—', 'G20', 'A—', 'SOG—']);
  });

  it('keeps signed/zero/missing categories and total assists/PPP without inventing splits', () => {
    const stats = rosterRosStats({ projected_plus_minus: '-12.5', projected_assists: 0,
      projected_ppp: 7.3, projected_shp: 0, projected_pim: null });
    expect(stats).toMatchObject({ plusMinus: -12.5, assists: 0, powerPlayPoints: 7.3,
      shortHandedPoints: 0, pim: undefined, points: undefined });
    expect(formatRosCount(stats.plusMinus)).toBe('-12');
    expect(stats).not.toHaveProperty('primaryAssists');
    expect(stats).not.toHaveProperty('powerPlayAssists');
  });

  it('indexes all returned canonical rows, including players beyond a daily 1000-row cutoff', () => {
    const rows = Array.from({ length: 1325 }, (_, index) => ({ player_id: String(index + 1),
      games_remaining: 83, projected_goals: index }));
    const result = indexRosterRosStats(rows);
    expect(result.size).toBe(1325);
    expect(result.get(1325)?.goals).toBe(1324);
    expect(result.get(1326)).toBeUndefined();
  });
});
