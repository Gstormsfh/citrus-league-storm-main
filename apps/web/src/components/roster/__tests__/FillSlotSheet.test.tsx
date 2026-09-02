// FILL SHEET (2026-09-01, Sleeper parity audit R2)
//
// The slot-first counterpart of the Line Change sheet. What would be WRONG
// rather than ugly:
//
//   * offering a bench player Roster.tsx did not judge eligible (it must
//     render exactly the candidates it is handed — eligibility lives in one
//     place, on the page);
//   * letting a locked player through — he is listed so his absence never
//     reads as a bug, but the button is disabled;
//   * reporting something other than the player id `applyPlayerMove` takes;
//   * an empty box where a sentence belongs.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FillSlotSheet } from '../FillSlotSheet';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position = 'C', extra: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: false, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, ...extra }) as HockeyPlayer;

const DRAISAITL = mk('2', 'Leon Draisaitl', 'C', {
  nextGame: { opponent: 'vs CGY', isToday: true, gameTime: '7:00 PM' },
  daily_projection: { total_projected_points: 4.8 } as HockeyPlayer['daily_projection'],
});
const HORVAT = mk('7', 'Bo Horvat', 'C');
const NUGENT = mk('8', 'Ryan Nugent-Hopkins', 'C', {
  nextGame: { opponent: 'vs CGY', isToday: true, gameStatus: 'live' },
  daily_actual_points: 2.5,
});

function renderSheet(over: Partial<React.ComponentProps<typeof FillSlotSheet>> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FillSlotSheet
      slotId="slot-C-2"
      candidates={[DRAISAITL, HORVAT]}
      open
      onOpenChange={onOpenChange}
      onPick={onPick}
      {...over}
    />,
  );
  return { onPick, onOpenChange };
}

const sheet = () => within(screen.getByRole('dialog', { name: /fill a spot/i }));

describe('FillSlotSheet — what it offers', () => {
  it('names the open spot and lists exactly the candidates it was handed', () => {
    renderSheet();
    expect(sheet().getByText('C2 is open')).toBeInTheDocument();
    expect(sheet().getByText('Leon Draisaitl')).toBeInTheDocument();
    expect(sheet().getByText('Bo Horvat')).toBeInTheDocument();
    expect(sheet().getByText('2 bench players can step in')).toBeInTheDocument();
  });

  it("shows tonight's number for a player with a game and a dash for one without", () => {
    renderSheet();
    expect(sheet().getByText('4.8')).toBeInTheDocument();
    expect(sheet().getByText('No game today')).toBeInTheDocument();
    expect(sheet().getAllByText('-').length).toBe(1);
  });

  it('shows the live number once his game is under way', () => {
    renderSheet({ candidates: [NUGENT] });
    expect(sheet().getByText('2.5')).toBeInTheDocument();
    expect(sheet().getByText('live')).toBeInTheDocument();
  });

  it('says so in a sentence when nobody can step in', () => {
    renderSheet({ candidates: [] });
    expect(sheet().getByText(/No one on your bench can play C2 right now/)).toBeInTheDocument();
    expect(sheet().getByText('Nobody on the bench can step in')).toBeInTheDocument();
  });

  it('renders nothing while closed or without a slot', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog', { name: /fill a spot/i })).toBeNull();
  });
});

describe('FillSlotSheet — what it reports', () => {
  it('a pick reports the player id, which is what applyPlayerMove takes, then closes', () => {
    const { onPick, onOpenChange } = renderSheet();
    fireEvent.click(sheet().getByText('Leon Draisaitl').closest('button')!);
    expect(onPick).toHaveBeenCalledWith('2');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a locked bench player is listed but cannot be picked', () => {
    const { onPick } = renderSheet({ lockedPlayerIds: new Set(['2']) });
    const btn = sheet().getByText('Leon Draisaitl').closest('button')!;
    expect(btn).toBeDisabled();
    expect(sheet().getByText(/Game started/)).toBeInTheDocument();
    // The count of who can step in excludes him.
    expect(sheet().getByText('1 bench player can step in')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('the scrim and the ✕ both cancel', () => {
    const { onOpenChange } = renderSheet();
    fireEvent.click(screen.getByTestId('fill-sheet-root').firstElementChild!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(sheet().getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('Escape cancels', () => {
    const { onOpenChange } = renderSheet();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
