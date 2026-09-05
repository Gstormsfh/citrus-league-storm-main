// THE SCHEDULE ON A PHONE (2026-09-04). Pins the four reads in order — the
// seven-day bars, games by club, back-to-backs, the games grouped by day —
// and that nothing is drawn for a week with no games.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SchedulePhone } from '../SchedulePhone';

afterEach(() => {
  cleanup();
});

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((key, i) => ({ key, count: i === 5 ? 6 : 2 }));

const mount = (over: Partial<React.ComponentProps<typeof SchedulePhone>> = {}) =>
  render(
    <SchedulePhone
      loading={false}
      games={[
        { id: 1, game_date: '2026-10-03', game_time: '2026-10-04T01:00:00Z', home_team: 'EDM', away_team: 'CGY' },
        { id: 2, game_date: '2026-10-03', game_time: null, home_team: 'TOR', away_team: 'MTL', status: 'postponed' },
        { id: 3, game_date: '2026-10-04', game_time: '2026-10-05T00:00:00Z', home_team: 'VAN', away_team: 'EDM' },
      ]}
      days={DAYS}
      teams={[{ team: 'EDM', games: 2 }, { team: 'TOR', games: 1 }]}
      backToBacks={[{ team: 'EDM', from: '2026-10-03', to: '2026-10-04' }]}
      dayLabel={(iso) => `DAY ${iso.slice(-2)}`}
      timeLabel={(iso) => (iso ? '7:00 PM' : null)}
      {...over}
    />,
  );

describe('SchedulePhone', () => {
  it('draws the bars, the clubs, the back-to-backs and the games grouped by day', () => {
    mount();
    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('The slate · 3 games · 7 days');
    const days = screen.getByTestId('schedule-phone-days');
    expect(within(days).getByText('6')).toBeInTheDocument();
    const teams = screen.getByTestId('schedule-phone-teams');
    expect(teams.querySelectorAll('li')).toHaveLength(2);
    expect(teams).toHaveTextContent('EDM');
    expect(screen.getByTestId('schedule-phone-b2b')).toHaveTextContent('DAY 03 → DAY 04');
    const games = screen.getByTestId('schedule-phone-games');
    expect(games.querySelectorAll('li')).toHaveLength(3);
    expect(within(games).getAllByText('DAY 03')).toHaveLength(1);
    expect(games).toHaveTextContent('CGY @ EDM');
    expect(games).toHaveTextContent('7:00 PM');
    // A game with no time and a status shows the status; a scheduled one, TBD.
    expect(games).toHaveTextContent('POSTPONED');
  });

  it('an empty week says so, and draws no reads', () => {
    mount({ games: [], teams: [], backToBacks: [] });
    expect(screen.getByTestId('schedule-phone-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-phone-days')).toBeNull();
  });

  it('loading is tiles', () => {
    mount({ loading: true, games: [] });
    expect(screen.getByTestId('schedule-phone-loading')).toBeInTheDocument();
  });
});
