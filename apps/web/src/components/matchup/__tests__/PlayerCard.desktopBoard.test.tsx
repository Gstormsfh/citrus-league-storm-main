import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MatchupPlayer } from '../types';
vi.mock('@/api/client', () => ({ apiClient: {}, API_BASE_URL: '', ApiError: class extends Error {} }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../PointsTooltip', () => ({ PointsTooltip: ({children}: {children: React.ReactNode}) => <>{children}</> }));
vi.mock('../ProjectionTooltip', () => ({ ProjectionTooltip: ({children}: {children: React.ReactNode}) => <>{children}</> }));
vi.mock('../GoalieProjectionTooltip', () => ({ GoalieProjectionTooltip: ({children}: {children: React.ReactNode}) => <>{children}</> }));
import { PlayerCard } from '../PlayerCard';
afterEach(() => vi.useRealTimers());
const p = {
  id: 1, name: 'Sample Skater', position: 'C', team: 'EDM', points: 500,
  gamesRemaining: 2, status: null, isStarter: true,
  stats: { goals: 30, assists: 40, sog: 200, blk: 20, gamesPlayed: 70 },
  total_points: 19, daily_total_points: 4,
} as MatchupPlayer;

describe('desktop matchup board', () => {
  it.each([0, -2.7, 6.8])('shows scheduled-day forecast %s instead of an earned zero placeholder', total => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    render(<PlayerCard player={{...p, daily_total_points: 0,
      games: [{game_date:'2026-10-03',status:'scheduled',home_team:'EDM',away_team:'TOR'}],
      daily_projection:{total_projected_points:total},
    } as MatchupPlayer} isUserTeam selectedDate="2026-10-03" />);
    expect(screen.getByText(total.toFixed(1))).toBeTruthy();
    expect(screen.getByText('Projected')).toBeTruthy();
  });
  it.each(['live', 'intermission', 'final'])('uses earned points once the game is %s', status => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    render(<PlayerCard player={{...p, daily_total_points: 0,
      games: [{game_date:'2026-10-03',status,home_team:'EDM',away_team:'TOR'}],
      daily_projection:{total_projected_points:6.8},
    } as MatchupPlayer} isUserTeam selectedDate="2026-10-03" />);
    expect(screen.getByText('0.0')).toBeTruthy();
    expect(screen.queryByText('6.8')).toBeNull();
    expect(screen.getByText('Earned')).toBeTruthy();
  });
  it('opens the exact player and keeps week scope distinct from season points', () => {
    const open=vi.fn();
    render(<PlayerCard player={p} isUserTeam selectedDate={null} onPlayerClick={open} />);
    fireEvent.click(screen.getByRole('button', {name:'Open player card for Sample Skater'}));
    expect(open).toHaveBeenCalledWith(p);
    expect(screen.getByTestId('desktop-matchup-player').dataset.scope).toBe('week');
    expect(screen.queryByText('500.0')).toBeNull();
    expect(screen.getByText('19.0')).toBeTruthy();
    expect(screen.getByText('Week earned')).toBeTruthy();
  });
  it('retains the daily earned number and clearly marks a bench row', () => {
    render(<PlayerCard player={p} isUserTeam isBench selectedDate="2026-01-01" />);
    expect(screen.getByText('4.0')).toBeTruthy();
    expect(screen.getByText('Bench')).toBeTruthy();
    expect(screen.getByTestId('desktop-matchup-player').dataset.scope).toBe('day');
  });
  it('does not display missing actuals as zero or fall back to season points', () => {
    render(<PlayerCard player={{...p,daily_total_points:undefined}} isUserTeam selectedDate="2026-01-01" />);
    expect(screen.getByText('–')).toBeTruthy();
    expect(screen.queryByText('0.0')).toBeNull();
  });
});
