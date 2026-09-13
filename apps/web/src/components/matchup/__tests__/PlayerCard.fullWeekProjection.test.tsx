import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import type { MatchupPlayer } from '../types';

const today = '2026-09-13';
const player = (game: boolean, points?: number): MatchupPlayer => ({
  id: 8477951, name: 'Nick Schmaltz', team: 'UTA', position: 'C', isStarter: true,
  points: 12.3, total_points: 12.3, stats: {}, gamesRemaining: game ? 1 : 0,
  games: game ? [{ game_date: today, status: 'scheduled', home_team: 'UTA', away_team: 'TOR' }] : [],
  daily_projection: points === undefined ? undefined : { total_projected_points: points },
} as unknown as MatchupPlayer);
const panel = (p: MatchupPlayer, selectedDate: string | null) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
  const { container } = render(<TooltipProvider><PlayerCard player={p} selectedDate={selectedDate} isUserTeam /></TooltipProvider>);
  return container.querySelector('.player-projection-bar-container')!;
};
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Full Week daily projection prompt', () => {
  it.each([true, false])('does not imply weekly availability when today has a game: %s', game => {
    const content = panel(player(game, 6.8), null).textContent;
    expect(content).toContain('Select a day for daily projections');
    expect(content).not.toContain('No game');
    expect(content).not.toContain('6.8');
  });
  it.each([6.8, 0, -2.7])('keeps a selected-day projection %s', points => {
    const content = panel(player(true, points), today).textContent;
    expect(content).toContain(points.toFixed(1));
    expect(content).not.toContain('Select a day');
    expect(content).not.toContain('TBD');
  });
  it('keeps selected-day missing and no-game states distinct', () => {
    expect(panel(player(true), today).textContent).toContain('TBD');
    cleanup();
    expect(panel(player(false), today).textContent).toContain('No game this day');
  });
});
