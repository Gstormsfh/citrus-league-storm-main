// INJURED RESERVE IS ALWAYS ON THE PAGE (2026-09-01, audit R8)
//
// The IR section used to render only once someone was on IR, so a manager
// with a healthy roster could not learn the league had IR slots at all — the
// one roster feature that matters most on the day it is needed was invisible
// until then. What this pins:
//
//   * the section renders with an empty roster, headed "Injured Reserve n/N"
//     where N is the league's real slot count (default 3, the server's rule);
//   * an empty section says so in plain words — "No one on IR";
//   * a league with zero IR slots gets no section (nothing to discover);
//   * with a player selected and an open IR slot judged legal by the page,
//     the empty row becomes the move target, reporting the slot id the same
//     way the empty starter rows do;
//   * the other sections are untouched by all of the above.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import MobileRosterList from '../MobileRosterList';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position: string, over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, ...over }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C');
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C');
const HURT = mk('7', 'Evander Kane', 'LW', { status: 'IR', is_ir_eligible: true });

const ASSIGN: Record<string, string> = { '1': 'slot-C-1', '2': 'slot-C-2' };

function renderList(over: Partial<React.ComponentProps<typeof MobileRosterList>> = {}) {
  const onSlotTap = vi.fn();
  const utils = render(
    <MobileRosterList
      starters={[MCDAVID, DRAISAITL]}
      bench={[]}
      ir={[]}
      slotAssignments={ASSIGN}
      onSlotTap={onSlotTap}
      positionType="individual"
      {...over}
    />,
  );
  return { onSlotTap, ...utils };
}

const irHeader = () => screen.getByText('Injured Reserve').closest('div') as HTMLElement;

describe('the IR section is discoverable before anyone is hurt', () => {
  it('renders with nobody on IR, headed 0/3 by default, and says "No one on IR"', () => {
    renderList();
    expect(screen.getByText('Injured Reserve')).toBeInTheDocument();
    expect(irHeader()).toHaveTextContent('0/3');
    expect(screen.getByTestId('ir-empty')).toHaveTextContent('No one on IR');
  });

  it('the count is the league\'s real slot count, not a hardcoded 3', () => {
    renderList({ irSlotCount: 2 });
    expect(irHeader()).toHaveTextContent('0/2');
    expect(irHeader()).not.toHaveTextContent('0/3');
  });

  it('a league with no IR slots gets no section', () => {
    renderList({ irSlotCount: 0 });
    expect(screen.queryByText('Injured Reserve')).toBeNull();
    expect(screen.queryByTestId('ir-empty')).toBeNull();
  });

  it('counts the players on IR and drops the empty state once someone is there', () => {
    renderList({ ir: [HURT], slotAssignments: { ...ASSIGN, '7': 'ir-slot-1' } });
    expect(irHeader()).toHaveTextContent('1/3');
    expect(screen.getByText('Evander Kane')).toBeInTheDocument();
    expect(screen.queryByTestId('ir-empty')).toBeNull();
    expect(screen.queryByText('No one on IR')).toBeNull();
  });

  it('the badge is set in tabular figures so n/N does not jitter', () => {
    renderList();
    const badge = screen.getByText('0/3');
    expect(badge.className).toContain('tabular-nums');
  });

  it('the empty state is not a control — nothing is selected, so there is nothing to do', () => {
    renderList();
    const empty = screen.getByTestId('ir-empty');
    expect(empty).not.toHaveAttribute('role');
    expect(screen.queryByRole('button', { name: /Move here: IR/ })).toBeNull();
  });
});

describe('an open IR slot is a move target once the page judges it legal', () => {
  it('offers the slot and reports its id — the same contract as the empty starter rows', () => {
    const { onSlotTap } = renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-2', 'bench-grid', 'ir-slot-1', 'ir-slot-2']),
    });
    const target = screen.getByRole('button', { name: /Move here: IR/ });
    expect(target).toHaveTextContent(/Tap to move to IR/);
    expect(screen.queryByTestId('ir-empty')).toBeNull();
    fireEvent.click(target);
    expect(onSlotTap).toHaveBeenCalledWith('ir-slot-1');
  });

  it('skips a slot someone already lies in', () => {
    const { onSlotTap } = renderList({
      ir: [HURT],
      slotAssignments: { ...ASSIGN, '7': 'ir-slot-1' },
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['ir-slot-1', 'ir-slot-2']),
    });
    fireEvent.click(screen.getByRole('button', { name: /Move here: IR/ }));
    expect(onSlotTap).toHaveBeenCalledWith('ir-slot-2');
  });

  it('stays the plain empty state when the page did not judge IR legal — never widens the set', () => {
    renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-2', 'bench-grid']),
    });
    expect(screen.queryByRole('button', { name: /Move here: IR/ })).toBeNull();
    expect(screen.getByTestId('ir-empty')).toBeInTheDocument();
  });

  it('never offers a slot past the league\'s count', () => {
    renderList({
      irSlotCount: 1,
      ir: [HURT],
      slotAssignments: { ...ASSIGN, '7': 'ir-slot-1' },
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['ir-slot-1', 'ir-slot-2', 'ir-slot-3']),
    });
    expect(screen.queryByRole('button', { name: /Move here: IR/ })).toBeNull();
    expect(irHeader()).toHaveTextContent('1/1');
  });
});

describe('the rest of the list is unchanged', () => {
  it('the starter sections keep their plain counts and the bench its own', () => {
    renderList();
    expect(screen.getByText('Forwards').closest('div')).toHaveTextContent(/2$/);
    expect(screen.getByText('Bench').closest('div')).toHaveTextContent(/0$/);
    expect(screen.getByText('UTIL')).toBeInTheDocument();
  });
});
