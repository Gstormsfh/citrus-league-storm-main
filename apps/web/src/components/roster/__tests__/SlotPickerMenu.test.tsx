// SLOT PICKER (2026-08-27)
//
// The menu replaces a flow where eligible slots lit up elsewhere on a
// multi-screen list. What these pin is not the styling but the two things
// that would make it WRONG rather than ugly:
//
//   * it must offer exactly the slots Roster.tsx judged legal — never one
//     more, because the only IR gate in the app lives in that computation;
//   * it must name the occupant, because that is the whole reason a menu
//     beats a highlight: the consequence of the swap is legible before you
//     commit to it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotPickerMenu } from '../SlotPickerMenu';
import { slotLabel } from '../slotLabel';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position = 'C'): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', stats: {} }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C');
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C');
const MAKAR = mk('3', 'Cale Makar', 'D');

function renderMenu(over: Partial<React.ComponentProps<typeof SlotPickerMenu>> = {}) {
  const onPick = vi.fn();
  render(
    <SlotPickerMenu
      player={MCDAVID}
      eligibleSlots={new Set(['slot-C-1', 'slot-C-2', 'slot-UTIL', 'bench-grid'])}
      slotAssignments={{ '1': 'slot-C-1', '2': 'slot-C-2', '3': 'slot-D-1' }}
      allPlayers={[MCDAVID, DRAISAITL, MAKAR]}
      open
      onOpenChange={vi.fn()}
      onPick={onPick}
      {...over}
    >
      <button>open</button>
    </SlotPickerMenu>,
  );
  return { onPick };
}

// ── slotLabel ─────────────────────────────────────────────────────────────

describe('slotLabel', () => {
  it.each([
    ['slot-C-1', 'C1'],
    ['slot-LW-2', 'LW2'],
    ['slot-D-4', 'D4'],
    ['slot-UTIL', 'UTIL'],
    ['slot-UTIL-2', 'UTIL2'],
    ['bench-grid', 'Bench'],
    ['ir-slot-1', 'IR'],
    ['ir-slot-3', 'IR'],
  ])('%s -> %s', (slotId, expected) => {
    expect(slotLabel(slotId)).toBe(expected);
  });

  it('passes an unrecognised slot id through rather than rendering blank', () => {
    expect(slotLabel('slot-something-odd')).toBe('slot-something-odd');
  });
});

// ── What it offers ────────────────────────────────────────────────────────

describe('SlotPickerMenu — offers exactly what Roster.tsx judged legal', () => {
  it('renders every eligible slot', () => {
    renderMenu();
    for (const label of ['C1', 'C2', 'UTIL', 'Bench']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('never invents a slot the caller did not allow', () => {
    // Eligibility is computed once, in Roster.tsx, and it is the only place
    // the IR gate is applied. A menu that widened the set would silently
    // route round `is_ir_eligible`.
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid']) });
    expect(screen.queryByText('C2')).toBeNull();
    expect(screen.queryByText('UTIL')).toBeNull();
    expect(screen.queryByText('IR')).toBeNull();
  });

  it('offers IR only when the caller included an IR slot', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'ir-slot-1', 'bench-grid']) });
    expect(screen.getByText('IR')).toBeTruthy();
  });

  it('says so plainly when nothing is available', () => {
    renderMenu({ eligibleSlots: new Set() });
    expect(screen.getByText(/No other slots are open/i)).toBeTruthy();
  });
});

// ── Naming the consequence ────────────────────────────────────────────────

describe('SlotPickerMenu — the swap is legible before it happens', () => {
  it('names the player already in a target slot', () => {
    renderMenu();
    // C2 holds Draisaitl: moving McDavid there is a swap, and the menu says so
    // before the tap rather than after.
    expect(screen.getByText('Leon Draisaitl')).toBeTruthy();
  });

  it('marks an unoccupied slot as empty', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'slot-UTIL']) });
    expect(screen.getByText('Empty')).toBeTruthy();
  });

  it('does not name bench occupants — the bench holds many, not one', () => {
    renderMenu({
      eligibleSlots: new Set(['bench-grid']),
      slotAssignments: { '1': 'slot-C-1', '2': 'bench-grid' },
    });
    expect(screen.getByText('Bench')).toBeTruthy();
    expect(screen.queryByText('Leon Draisaitl')).toBeNull();
  });
});

// ── Picking ───────────────────────────────────────────────────────────────

describe('SlotPickerMenu — picking', () => {
  it('reports the slot id, not the label', () => {
    const { onPick } = renderMenu();
    fireEvent.click(screen.getByText('C2').closest('button')!);
    expect(onPick).toHaveBeenCalledWith('slot-C-2');
  });

  it('the slot the player already occupies is inert', () => {
    const { onPick } = renderMenu();
    const current = screen.getByText('C1').closest('button')!;
    expect(current.hasAttribute('disabled')).toBe(true);
    fireEvent.click(current);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on pick, so a second tap cannot fire a stale move', () => {
    const onOpenChange = vi.fn();
    render(
      <SlotPickerMenu
        player={MCDAVID}
        eligibleSlots={new Set(['slot-C-1', 'bench-grid'])}
        slotAssignments={{ '1': 'slot-C-1' }}
        allPlayers={[MCDAVID]}
        open
        onOpenChange={onOpenChange}
        onPick={vi.fn()}
      >
        <button>open</button>
      </SlotPickerMenu>,
    );
    fireEvent.click(screen.getByText('Bench').closest('button')!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ── Grouping ──────────────────────────────────────────────────────────────

describe('SlotPickerMenu — grouping follows the roster page', () => {
  it('groups under the same headings the roster uses, in the same order', () => {
    renderMenu({
      eligibleSlots: new Set(['slot-C-1', 'slot-D-1', 'slot-G-1', 'bench-grid', 'ir-slot-1']),
      slotAssignments: { '1': 'slot-C-1' },
      allPlayers: [MCDAVID],
    });
    const headings = screen
      .getAllByText(/^(Forwards|Defense|Goalies|Utility)$/)
      .map((n) => n.textContent);
    expect(headings).toEqual(['Forwards', 'Defense', 'Goalies']);
  });

  it('omits a heading with no eligible slots under it', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid']) });
    expect(screen.queryByText('Goalies')).toBeNull();
    expect(screen.queryByText('Utility')).toBeNull();
  });

  it('bench and IR carry no heading — a "Bench" group holding one "Bench" row reads as a bug', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid', 'ir-slot-1']) });
    expect(screen.getAllByText('Bench')).toHaveLength(1);
    expect(screen.queryByText('Injured Reserve')).toBeNull();
    expect(screen.getByText('IR')).toBeTruthy();
  });
});

describe('SlotPickerMenu — the bench reports a count, not an occupancy claim', () => {
  it('never says the bench is Empty when players are sitting on it', () => {
    // "Empty" beside Bench is simply false, and it is the kind of false that
    // a manager acts on.
    renderMenu({
      eligibleSlots: new Set(['slot-C-1', 'bench-grid']),
      slotAssignments: { '1': 'slot-C-1', '2': 'bench-grid', '3': 'bench-grid' },
      allPlayers: [MCDAVID, DRAISAITL, MAKAR],
    });
    expect(screen.getByText('2 players')).toBeTruthy();
    expect(screen.queryByText('Empty')).toBeNull();
  });

  it('singularises a bench of one', () => {
    renderMenu({
      eligibleSlots: new Set(['bench-grid']),
      slotAssignments: { '1': 'slot-C-1', '2': 'bench-grid' },
      allPlayers: [MCDAVID, DRAISAITL],
    });
    expect(screen.getByText('1 player')).toBeTruthy();
  });

  it('an empty bench says 0 players rather than Empty', () => {
    renderMenu({
      eligibleSlots: new Set(['bench-grid']),
      slotAssignments: { '1': 'slot-C-1' },
      allPlayers: [MCDAVID],
    });
    expect(screen.getByText('0 players')).toBeTruthy();
  });
});
