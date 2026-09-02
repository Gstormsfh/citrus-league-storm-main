// Week-view scoring breakdown on the phone (2026-09-01, Sleeper parity
// audit M9).
//
// The weekly "F Pts" box with its scoring breakdown is display:none on
// phones (index.css), so a manager could never see what a player scored
// this week or for what. In week view the mobile score stack now carries
// the week total and opens the same PointsTooltip the day view uses, from
// `stats_breakdown`; under it, tonight's projection ("+4.2") while his game
// is still to come, "live" while it is on, else the scope label. Day view
// is untouched (PlayerCard.mobileScore.test.tsx).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import type { MatchupPlayer } from '../types';
import type { NHLGame } from '@/services/ScheduleService';
import { getTodayMST } from '@/utils/timezoneUtils';

const TODAY = getTodayMST();

const game = (over: Partial<NHLGame> = {}): NHLGame => ({
  id: 'g1',
  game_id: 1,
  game_date: TODAY,
  game_time: '19:00',
  home_team: 'TOR',
  away_team: 'BOS',
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 2026,
  game_type: 'regular',
  ...over,
});

const projection = (pts: number): NonNullable<MatchupPlayer['daily_projection']> => ({
  total_projected_points: pts,
  projected_goals: 0.4,
  projected_assists: 0.5,
  projected_sog: 3.2,
  projected_blocks: 0.5,
  projected_xg: 0.4,
  base_ppg: 4,
  shrinkage_weight: 1,
  finishing_multiplier: 1,
  opponent_adjustment: 1,
  b2b_penalty: 1,
  home_away_adjustment: 1,
  confidence_score: 0.7,
  calculation_method: 'test',
});

const WEEK_BREAKDOWN = { goals: { count: 2, points: 12 }, assists: { count: 3, points: 12 }, sog: { count: 9, points: 8.1 } };

const player = (over: Partial<MatchupPlayer> = {}): MatchupPlayer => ({
  id: 1,
  name: 'Auston Matthews',
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 1,
  status: null,
  isStarter: true,
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
  games: [game()],
  gameInfo: { opponent: 'vs BOS', time: '7:00 PM' },
  total_points: 32.1,
  stats_breakdown: WEEK_BREAKDOWN,
  ...over,
});

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
const stack = (c: HTMLElement) => c.querySelector('.player-mobile-score') as HTMLElement;
const value = (c: HTMLElement) => c.querySelector('.player-score-value') as HTMLElement | null;

let originalWidth: number;
beforeEach(() => {
  originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
});
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth });
});

describe('PlayerCard — week view: the number is the week, the tap is the breakdown', () => {
  it('shows the week total in sage, scoped "week", with the daily fields ignored', () => {
    const { container } = render(
      <PlayerCard player={player({ games: [], daily_total_points: 4.5, daily_projection: projection(3) })} isUserTeam selectedDate={null} />,
    );
    expect(stack(container)).toHaveAttribute('data-scope', 'week');
    const v = value(container)!;
    expect(v.textContent).toBe('32.1');
    expect(v.className).toContain('text-pastel-sage');
    expect(v.className).toContain('font-jbmono');
    expect(container.querySelector('.player-score-label')!.textContent).toBe('week');
    expect(stack(container).textContent).not.toContain('4.5');
    expect(stack(container).textContent).not.toContain('No game');
  });

  it('the week total opens the weekly scoring breakdown (PointsTooltip from stats_breakdown)', async () => {
    const { container } = render(<PlayerCard player={player({ games: [] })} isUserTeam selectedDate={null} />);
    const v = value(container)!;
    const trigger = v.closest('button')!;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    // The popover names the categories from the WEEK breakdown and totals the week.
    expect(await screen.findByText(/Scoring Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText('GOALS')).toBeInTheDocument();
    expect(screen.getByText('ASSISTS')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getAllByText('32.1').length).toBeGreaterThanOrEqual(2);
  });

  it('with no weekly breakdown the number is plain — no dead tap target', () => {
    const { container } = render(
      <PlayerCard player={player({ games: [], stats_breakdown: undefined })} isUserTeam selectedDate={null} />,
    );
    const v = value(container)!;
    expect(v.textContent).toBe('32.1');
    expect(v.closest('button')).toBeNull();
  });

  it('an empty breakdown object counts as none', () => {
    const { container } = render(
      <PlayerCard player={player({ games: [], stats_breakdown: {} })} isUserTeam selectedDate={null} />,
    );
    expect(value(container)!.closest('button')).toBeNull();
  });

  it('no week total on file prints 0.0, not NaN', () => {
    const { container } = render(
      <PlayerCard player={player({ games: [], total_points: undefined, stats_breakdown: undefined })} isUserTeam selectedDate={null} />,
    );
    expect(value(container)!.textContent).toBe('0.0');
  });

  it('tonight still to come: "+proj" in orange under the week total, tappable for the projection breakdown', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam selectedDate={null} />,
    );
    expect(value(container)!.textContent).toBe('32.1');
    const tonight = container.querySelector('.player-score-tonight')!;
    expect(tonight.textContent).toBe('+4.2');
    expect(tonight.className).toContain('text-pastel-orange');
    expect(tonight.className).toContain('tabular-nums');
    expect(tonight.closest('button')).toBeTruthy();
    expect(container.querySelector('.player-score-label')).toBeNull();
  });

  it('tonight live: the week total over "live"', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ status: 'live', home_score: 2, away_score: 1, period: '2nd' })], daily_projection: projection(4.2) })}
        isUserTeam
        selectedDate={null}
      />,
    );
    expect(value(container)!.textContent).toBe('32.1');
    expect(container.querySelector('.player-score-label')!.textContent).toBe('live');
    expect(container.querySelector('.player-score-tonight')).toBeNull();
  });

  it('tonight final: back to the scope label — the week total already holds the game', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ status: 'final', home_score: 3, away_score: 1 })], daily_projection: projection(4.2) })}
        isUserTeam
        selectedDate={null}
      />,
    );
    expect(container.querySelector('.player-score-label')!.textContent).toBe('week');
  });

  it('bench rows keep the stateless cream number in week view', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam isBench selectedDate={null} />,
    );
    expect(value(container)!.className).toContain('text-pastel-cream');
    expect(container.querySelector('.player-score-tonight')!.className).toContain('text-pastel-cream');
  });

  it('every label in the week stack is at least 10px', () => {
    const cases = [
      player({ games: [] }),
      player({ daily_projection: projection(4.2) }),
      player({ games: [game({ status: 'live' })] }),
    ];
    for (const p of cases) {
      const { container, unmount } = render(<PlayerCard player={p} isUserTeam selectedDate={null} />);
      for (const el of Array.from(stack(container).querySelectorAll('*'))) {
        for (const m of el.className.toString().matchAll(/text-\[(\d+)px\]/g)) {
          expect(Number(m[1]), `${el.className} in stack`).toBeGreaterThanOrEqual(10);
        }
      }
      unmount();
    }
  });

  it('day view is unchanged: a selected date shows the day number and daily breakdown', () => {
    const { container } = render(
      <PlayerCard
        player={player({
          games: [game({ game_date: '2099-03-01', status: 'final', home_score: 3, away_score: 1 })],
          daily_total_points: 7.5,
          daily_stats_breakdown: { goals: { count: 1, points: 6 } },
        })}
        isUserTeam
        selectedDate="2099-03-01"
      />,
    );
    expect(stack(container)).toHaveAttribute('data-scope', 'day');
    expect(value(container)!.textContent).toBe('7.5');
    expect(stack(container).textContent).not.toContain('32.1');
  });
});
