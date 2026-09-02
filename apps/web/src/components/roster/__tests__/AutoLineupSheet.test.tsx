// AUTO LINEUP SHEET (2026-09-01, Sleeper parity audit R6)
//
// The planner's arithmetic is pinned in autoLineup.test.ts; this file pins
// how the sheet reads it. What would be WRONG rather than ugly:
//
//   * a gain that is not the difference the plan reports, or a move count
//     that is not the number of rows;
//   * an Apply button in the zero-move state (there is nothing to apply);
//   * Apply firing while a save is in flight, or the week's Apply firing
//     before the week has been computed;
//   * a Rest-of-week option offered when no day of the week is still ahead;
//   * numbers set in anything but the mono face with tabular figures.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AutoLineupSheet } from '../AutoLineupSheet';
import type { AutoLineupPlan, LineupMove } from '../autoLineup';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position = 'C', extra: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: false, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, ...extra }) as HockeyPlayer;

const DRAISAITL = mk('2', 'Leon Draisaitl', 'C', { projectedPoints: 0 });
const HORVAT = mk('7', 'Bo Horvat', 'C', {
  projectedPoints: 4.8,
  nextGame: { opponent: 'vs TOR', isToday: true, gameTime: '7:00 PM' },
});
const MAKAR = mk('3', 'Cale Makar', 'D', { projectedPoints: 4.1, nextGame: { opponent: 'Game', isToday: true } });

const plan = (moves: LineupMove[], before: number, after: number, pinned: HockeyPlayer[] = []): AutoLineupPlan => ({
  lineup: { starters: [], bench: [], slotAssignments: {} },
  moves,
  before,
  after,
  pinned,
});

const THREE_MOVES = plan(
  [
    { player: DRAISAITL, from: 'slot-C-1', to: 'bench-grid' },
    { player: HORVAT, from: 'bench-grid', to: 'slot-C-1' },
    { player: MAKAR, from: 'bench-grid', to: 'slot-D-2' },
  ],
  41.6,
  44.0,
);
const OPTIMAL = plan([], 41.6, 41.6);

function renderSheet(over: Partial<React.ComponentProps<typeof AutoLineupSheet>> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const onScopeChange = vi.fn();
  render(
    <AutoLineupSheet
      open
      onOpenChange={onOpenChange}
      scope="day"
      onScopeChange={onScopeChange}
      dayLabel="Today"
      day={THREE_MOVES}
      weekAvailable
      week={null}
      onApply={onApply}
      {...over}
    />,
  );
  return { onApply, onOpenChange, onScopeChange };
}

const sheet = () => within(screen.getByRole('dialog', { name: /auto lineup/i }));

describe('AutoLineupSheet — the preview', () => {
  it('leads with the move count and the projected gain, and lists every move', () => {
    renderSheet();
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent('3 moves · proj +2.4');
    expect(screen.getByTestId('auto-sheet-subline')).toHaveTextContent('41.6 → 44.0 tonight');
    const rows = screen.getAllByTestId('auto-move');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Leon Draisaitl');
    expect(rows[0]).toHaveAttribute('data-from', 'slot-C-1');
    expect(rows[0]).toHaveAttribute('data-to', 'bench-grid');
    expect(within(rows[0]).getByText('C1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('BN')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Bo Horvat');
    expect(within(rows[1]).getByText('4.8')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/vs TOR · 7:00 PM/)).toBeInTheDocument();
  });

  it("a player without a game shows a dash, not a zero, and the row says so", () => {
    renderSheet();
    const row = screen.getAllByTestId('auto-move')[0];
    expect(within(row).getByText('-')).toBeInTheDocument();
    expect(within(row).getByText(/No game/)).toBeInTheDocument();
  });

  it('every number is set in the mono face with tabular figures; the gain reads as a gain', () => {
    renderSheet();
    const gain = screen.getByTestId('auto-sheet-gain');
    expect(gain).toHaveClass('font-jbmono');
    expect(gain).toHaveClass('tabular-nums');
    expect(gain).toHaveClass('text-pastel-sage');
    expect(screen.getByTestId('auto-sheet-subline')).toHaveClass('font-jbmono');
    const number = within(screen.getAllByTestId('auto-move')[1]).getByText('4.8');
    expect(number).toHaveClass('font-jbmono');
    expect(number).toHaveClass('tabular-nums');
  });

  it('Apply names the move count and fires; Keep current closes without applying', () => {
    const { onApply, onOpenChange } = renderSheet();
    const apply = screen.getByTestId('auto-sheet-apply');
    expect(apply).toHaveTextContent('Apply 3 moves');
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('auto-sheet-keep'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('while saving, Apply is off and says so', () => {
    const { onApply } = renderSheet({ applying: true });
    const apply = screen.getByTestId('auto-sheet-apply');
    expect(apply).toBeDisabled();
    expect(apply).toHaveTextContent('Saving…');
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a disabled Apply turns off rather than dimming the brand fill', () => {
    renderSheet();
    const cls = screen.getByTestId('auto-sheet-apply').className;
    expect(cls).toContain('bg-pastel-orange');
    expect(cls).toContain('disabled:bg-white/10');
    expect(cls).not.toContain('disabled:opacity-50');
  });

  it('zero moves is a state: already optimal, the projected total, one Done, no Apply', () => {
    const { onOpenChange } = renderSheet({ day: OPTIMAL });
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent('Lineup already optimal');
    expect(screen.getByTestId('auto-sheet-subline')).toHaveTextContent('proj 41.6 tonight');
    expect(screen.queryByTestId('auto-sheet-apply')).toBeNull();
    expect(screen.queryByTestId('auto-move')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-sheet-done'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says how many locked players were held in place', () => {
    renderSheet({ day: plan(THREE_MOVES.moves, 41.6, 44.0, [DRAISAITL, HORVAT]) });
    expect(sheet().getByText('2 locked players stay put')).toBeInTheDocument();
  });

  it('names the day being viewed when it is not today', () => {
    renderSheet({ dayLabel: 'Thu Oct 16' });
    expect(screen.getByTestId('auto-sheet-subline')).toHaveTextContent('41.6 → 44.0 Thu Oct 16');
    expect(screen.getByTestId('auto-scope-day')).toHaveTextContent('Thu Oct 16');
  });

  it('renders nothing while closed or without a plan', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog', { name: /auto lineup/i })).toBeNull();
  });
});

describe('AutoLineupSheet — scope', () => {
  it('offers Today / Rest of week only when a day of the week is still ahead', () => {
    renderSheet({ weekAvailable: false });
    expect(screen.queryByTestId('auto-scope-week')).toBeNull();
  });

  it('the toggle reports the chosen scope and marks the active one', () => {
    const { onScopeChange } = renderSheet();
    expect(screen.getByTestId('auto-scope-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('auto-scope-week')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('auto-scope-week'));
    expect(onScopeChange).toHaveBeenCalledWith('week');
  });

  it('in week scope, waits for the week before offering Apply', () => {
    renderSheet({ scope: 'week', week: null, weekLoading: true });
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent('Checking the rest of the week');
    expect(screen.queryByTestId('auto-sheet-apply')).toBeNull();
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
  });

  it('in week scope, sums the days and lists each day with its own count', () => {
    const { onApply } = renderSheet({
      scope: 'week',
      week: [
        { date: '2026-10-14', label: 'Today', plan: THREE_MOVES },
        { date: '2026-10-15', label: 'Wed Oct 15', plan: OPTIMAL },
        { date: '2026-10-16', label: 'Thu Oct 16', plan: plan([{ player: HORVAT, from: 'bench-grid', to: 'slot-C-2' }], 38.0, 39.1) },
      ],
    });
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent('4 moves · proj +3.5');
    expect(screen.getByTestId('auto-sheet-subline')).toHaveTextContent('3 days · 121.2 → 124.7');
    const days = screen.getAllByTestId('auto-week-day');
    expect(days).toHaveLength(3);
    expect(days[0]).toHaveTextContent('3 moves · +2.4');
    expect(days[1]).toHaveTextContent('set · proj 41.6');
    expect(within(days[1]).queryByTestId('auto-move')).toBeNull();
    expect(days[2]).toHaveTextContent('1 move · +1.1');
    expect(screen.getAllByTestId('auto-move')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('auto-sheet-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('in week scope, a week that is already set gets Done, not Apply', () => {
    renderSheet({ scope: 'week', week: [{ date: '2026-10-15', label: 'Wed Oct 15', plan: OPTIMAL }] });
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent('Week already set');
    expect(screen.queryByTestId('auto-sheet-apply')).toBeNull();
    expect(screen.getByTestId('auto-sheet-done')).toBeInTheDocument();
  });

  it('in week scope, a failure says so and leaves the way back open', () => {
    renderSheet({ scope: 'week', week: null, weekError: 'Could not load projections for the week.' });
    expect(screen.getByTestId('auto-sheet-headline')).toHaveTextContent("Couldn't check the week");
    expect(sheet().getByText('Could not load projections for the week.')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-sheet-apply')).toBeNull();
    expect(screen.getByTestId('auto-scope-day')).toBeInTheDocument();
  });
});

describe('AutoLineupSheet — dismissal', () => {
  it('the scrim and the ✕ both cancel', () => {
    const { onOpenChange } = renderSheet();
    fireEvent.click(screen.getByTestId('auto-sheet-root').firstElementChild!);
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
