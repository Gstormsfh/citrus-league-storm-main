import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Player } from '@/services/PlayerService';
import { FreeAgentAddButton } from '../FreeAgentAddButton';
import { FreeAgentSummaryTable } from '../FreeAgentSummaryTable';

afterEach(cleanup);

function mkPlayer(over: Partial<Player> & { id: string }): Player {
  return {
    full_name: `Player ${over.id}`, position: 'C', eligible_positions: ['C'], team: 'EDM', jersey_number: null,
    status: null, headshot_url: null, last_updated: null, games_played: 10, goals: 1, assists: 2, points: 3,
    plus_minus: 0, shots: 10, hits: 1, blocks: 1, xGoals: 1, wins: null, losses: null, ot_losses: null, saves: null,
    goals_against_average: null, save_percentage: null, highDangerSavePct: 0, goalsSavedAboveExpected: 0,
    is_on_waivers: false, ...over,
  } as Player;
}

const games = [
  { game_date: '2026-10-09', home_team: 'EDM', away_team: 'CGY' },
  { game_date: '2026-10-08', home_team: 'VAN', away_team: 'EDM' },
] as never;

function renderTable(players: Player[], metricHeader = 'Adds', pending: number | null = null) {
  const onAdd = vi.fn();
  const onToggleWatch = vi.fn();
  const onOpen = vi.fn();
  render(
    <FreeAgentSummaryTable
      players={players.map((p) => ({ ...p, games }))}
      metric={{ header: metricHeader, render: (p) => <b>{p.full_name.length}</b> }}
      positionType="individual"
      isWatched={(p) => p.id === '2'}
      addState={(p) => (p.id === '3' ? 'claimed' : p.is_on_waivers ? 'claim' : 'add')}
      pendingPlayerId={pending}
      onOpen={onOpen}
      onToggleWatch={onToggleWatch}
      onAdd={onAdd}
    />,
  );
  return { onAdd, onToggleWatch, onOpen };
}

describe('FreeAgentSummaryTable — the two summary cards share one shape', () => {
  it('renders the fixed five columns with the metric header the caller names', () => {
    renderTable([mkPlayer({ id: '1' })], 'Proj');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Player', 'Pos', 'Schedule', 'Proj', '']);
  });

  it('orders the schedule chips by date, away as @ and home as vs', () => {
    renderTable([mkPlayer({ id: '1' })]);
    const row = screen.getAllByRole('row')[1];
    const scheduleCell = within(row).getAllByRole('cell')[2];
    const chips = within(scheduleCell).getAllByRole('img');
    expect(chips.map((c) => c.getAttribute('alt'))).toEqual(['VAN', 'CGY']);
    expect(within(row).getByText('@')).toBeTruthy();
    expect(within(row).getByText('vs')).toBeTruthy();
  });

  it('every row gets the same green circular add button, the claim state a check, and the star reflects the watch list', () => {
    const { onAdd, onToggleWatch } = renderTable([
      mkPlayer({ id: '1' }), mkPlayer({ id: '2', is_on_waivers: true } as never), mkPlayer({ id: '3' }),
    ]);
    const buttons = screen.getAllByTestId('fa-add-button');
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b.className).toMatch(/rounded-full/);
    expect(buttons.map((b) => b.getAttribute('data-state'))).toEqual(['add', 'claim', 'claimed']);
    expect(buttons[0].className).toMatch(/bg-emerald-600/);
    expect(buttons[1].className).toMatch(/bg-emerald-600/); // waivers: still the green circle
    expect(buttons[1].getAttribute('title')).toBe('Submit waiver claim');
    expect(buttons[2].className).toMatch(/bg-emerald-900/);
    fireEvent.click(buttons[1]);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    const star = screen.getByRole('button', { name: 'Remove Player 2 from watch list' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    expect(onToggleWatch).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('disables every add button while one add is in flight and spins only that one', () => {
    renderTable([mkPlayer({ id: '1' }), mkPlayer({ id: '2' })], 'Adds', 2);
    const buttons = screen.getAllByTestId('fa-add-button');
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(buttons[0].getAttribute('aria-busy')).toBeNull();
    expect(buttons[1].getAttribute('aria-busy')).toBe('true');
  });

  it('opens the player from the name', () => {
    const { onOpen } = renderTable([mkPlayer({ id: '1' })]);
    fireEvent.click(screen.getByText('Player 1'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('FreeAgentAddButton', () => {
  it('is a plus in a green circle for add and claim, a check for a filed claim', () => {
    const { container, rerender } = render(<FreeAgentAddButton state="add" onClick={() => {}} />);
    expect(container.querySelector('svg.lucide-plus')).toBeTruthy();
    rerender(<FreeAgentAddButton state="claim" onClick={() => {}} />);
    expect(container.querySelector('svg.lucide-plus')).toBeTruthy();
    rerender(<FreeAgentAddButton state="claimed" onClick={() => {}} />);
    expect(container.querySelector('svg.lucide-check')).toBeTruthy();
    expect(container.querySelector('svg.lucide-plus')).toBeNull();
  });
});
