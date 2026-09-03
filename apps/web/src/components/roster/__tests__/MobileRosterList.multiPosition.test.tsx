// MULTI-POSITION ROWS AND THE ILLEGAL IR OCCUPANT (2026-09-03,
// WORLD_CLASS_READINESS §1 gaps A and B)
//
// The row chip is the SLOT, so a C/LW player in UTIL or on the bench never
// said he could play LW. Now his positions lead line 2, for him only. And an
// IR occupant the NHL no longer lists IR/LTIR wears "Move off IR": the
// server tolerates him where he is, but the roster is not legal until he
// moves, and a one-time toast is not a place to keep that fact. What this
// pins:
//
//   * a dual-eligible player prints "C/LW" on the bench, on IR and in a
//     starter slot; a single-position player prints nothing new;
//   * "Move off IR" appears only on an IR row whose player carries an
//     explicit is_ir_eligible=false: not on the injured, not on a healthy
//     starter, and not when the flag was never sent.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import MobileRosterList from '../MobileRosterList';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position: string, over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, ...over }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C', { is_ir_eligible: false });
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C', { eligible_positions: ['C', 'LW'] });
const HYMAN = mk('4', 'Zach Hyman', 'LW', { eligible_positions: ['LW', 'RW'], starter: false });
const NUGENT = mk('5', 'Ryan Nugent-Hopkins', 'C', { starter: false });
const KANE_HURT = mk('7', 'Evander Kane', 'LW', { status: 'IR', is_ir_eligible: true });
const KANE_BACK = mk('8', 'Corey Perry', 'RW', { eligible_positions: ['RW', 'LW'], is_ir_eligible: false });
const KANE_UNKNOWN = mk('9', 'Adam Henrique', 'C');

function renderList(over: Partial<React.ComponentProps<typeof MobileRosterList>> = {}) {
  return render(
    <MobileRosterList
      starters={[MCDAVID, DRAISAITL]}
      bench={[HYMAN, NUGENT]}
      ir={[]}
      slotAssignments={{ '1': 'slot-C-1', '2': 'slot-C-2' }}
      positionType="individual"
      {...over}
    />,
  );
}

// The same row locator the headshot and swap-affordance tests use.
const rowOf = (name: string) => screen.getByText(name).closest('div.flex.items-center.gap-2\\.5') as HTMLElement;

describe('a player with more than one position says so on his row', () => {
  it('prints "C/LW" for a dual-eligible starter and "LW/RW" for a dual-eligible bench player', () => {
    renderList();
    expect(rowOf('Leon Draisaitl')).toHaveTextContent('C/LW');
    expect(rowOf('Zach Hyman')).toHaveTextContent('LW/RW');
  });

  it('prints nothing new for a single-position player', () => {
    renderList();
    expect(rowOf('Connor McDavid').querySelector('[data-testid="row-positions"]')).toBeNull();
    expect(rowOf('Ryan Nugent-Hopkins').querySelector('[data-testid="row-positions"]')).toBeNull();
  });

  it('prints it on IR too', () => {
    renderList({ ir: [KANE_BACK], slotAssignments: { '1': 'slot-C-1', '2': 'slot-C-2', '8': 'ir-slot-1' } });
    expect(rowOf('Corey Perry')).toHaveTextContent('RW/LW');
  });
});

describe('an IR occupant the NHL no longer lists IR/LTIR wears "Move off IR"', () => {
  it('on the healed occupant, and only him', () => {
    renderList({
      ir: [KANE_HURT, KANE_BACK],
      slotAssignments: { '1': 'slot-C-1', '2': 'slot-C-2', '7': 'ir-slot-1', '8': 'ir-slot-2' },
    });
    expect(screen.getAllByTestId('ir-move-off')).toHaveLength(1);
    expect(rowOf('Corey Perry')).toHaveTextContent('Move off IR');
    expect(rowOf('Evander Kane')).not.toHaveTextContent('Move off IR');
  });

  it('never on a starter, whatever his flag says', () => {
    renderList();
    expect(screen.queryByTestId('ir-move-off')).toBeNull();
    expect(rowOf('Connor McDavid')).not.toHaveTextContent('Move off IR');
  });

  it('not when the flag was never sent: an undefined flag is not a healthy player', () => {
    renderList({ ir: [KANE_UNKNOWN], slotAssignments: { '1': 'slot-C-1', '2': 'slot-C-2', '9': 'ir-slot-1' } });
    expect(screen.queryByTestId('ir-move-off')).toBeNull();
  });
});
