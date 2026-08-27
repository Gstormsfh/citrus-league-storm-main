// LINE CHANGE SHEET (2026-08-27)
//
// The menu replaces a flow where eligible slots lit up elsewhere on a
// multi-screen list. What these pin is not the styling but the things that
// would make it WRONG rather than ugly:
//
//   * it must offer exactly the slots Roster.tsx judged legal — never one
//     more, because the only IR gate in the app lives in that computation;
//   * it must name the occupant and the consequence ("Swaps to C1"), because
//     that is the whole reason a sheet beats a highlight;
//   * the bench count must survive the PAGE's data shape, where bench players
//     have no slotAssignments entry at all.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SlotPickerMenu } from '../SlotPickerMenu';
import { slotLabel } from '../slotLabel';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position = 'C', extra: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, ...extra }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C', {
  daily_projection: { total_projected_points: 5.2 } as HockeyPlayer['daily_projection'],
});
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C', {
  daily_projection: { total_projected_points: 4.8 } as HockeyPlayer['daily_projection'],
});
const MAKAR = mk('3', 'Cale Makar', 'D');

// PAGE SHAPE: bench players carry NO entry — the bench is an array on the
// page, not an assignment. Tests use this shape so the component cannot
// quietly depend on a harness-only convenience.
const ASSIGN: Record<string, string> = { '1': 'slot-C-1', '2': 'slot-C-2', '3': 'slot-D-1' };

function renderMenu(over: Partial<React.ComponentProps<typeof SlotPickerMenu>> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SlotPickerMenu
      player={MCDAVID}
      eligibleSlots={new Set(['slot-C-1', 'slot-C-2', 'slot-UTIL', 'bench-grid'])}
      slotAssignments={ASSIGN}
      allPlayers={[MCDAVID, DRAISAITL, MAKAR]}
      open
      onOpenChange={onOpenChange}
      onPick={onPick}
      {...over}
    />,
  );
  return { onPick, onOpenChange };
}

const sheet = () => within(screen.getByRole('dialog', { name: /line change/i }));

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
    // C1 appears twice by design: the header names his current spot, and the
    // C1 row is rendered inert. getAllByText, deliberately.
    for (const label of ['C1', 'C2', 'UTIL', 'BN']) {
      expect(sheet().getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('never invents a slot the caller did not allow', () => {
    // Eligibility is computed once, in Roster.tsx, and it is the only place
    // the IR gate is applied. A sheet that widened the set would silently
    // route round `is_ir_eligible`.
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid']) });
    expect(sheet().queryByText('C2')).toBeNull();
    expect(sheet().queryByText('UTIL')).toBeNull();
    expect(sheet().queryByText('IR')).toBeNull();
  });

  it('offers IR only when the caller included an IR slot', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'ir-slot-1', 'bench-grid']) });
    expect(sheet().getByText('IR')).toBeTruthy();
  });

  it('says so plainly when nothing is available', () => {
    renderMenu({ eligibleSlots: new Set() });
    expect(sheet().getByText(/No other slots are open/i)).toBeTruthy();
  });

  it('renders nothing at all when closed', () => {
    renderMenu({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── Naming the consequence ────────────────────────────────────────────────

describe('SlotPickerMenu — the swap is legible before it happens', () => {
  it('names the player already in a target slot, with the swap spelled out', () => {
    renderMenu();
    // C2 holds Draisaitl. Moving McDavid there sends Draisaitl to C1 —
    // and the row says so in words, before the tap rather than after.
    expect(sheet().getByText('Leon Draisaitl')).toBeTruthy();
    expect(sheet().getByText('Swaps to C1')).toBeTruthy();
  });

  it("shows the occupant's number for tonight — the comparison that decides", () => {
    renderMenu();
    expect(sheet().getByText('4.8')).toBeTruthy();
  });

  it('marks an unoccupied slot as an open spot', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'slot-UTIL']) });
    expect(sheet().getByText('Open spot')).toBeTruthy();
  });

  it('a bench source swaps its occupant back to the bench, and says so', () => {
    // Panarin (no assignment entry = bench) moving onto C2's occupant.
    const PANARIN = mk('6', 'Artemi Panarin', 'LW');
    renderMenu({
      player: PANARIN,
      eligibleSlots: new Set(['slot-C-2']),
      allPlayers: [MCDAVID, DRAISAITL, PANARIN],
    });
    expect(sheet().getByText('Swaps to Bench')).toBeTruthy();
  });
});

// ── Picking ───────────────────────────────────────────────────────────────

describe('SlotPickerMenu — picking', () => {
  it('reports the slot id, not the label', () => {
    const { onPick } = renderMenu();
    fireEvent.click(sheet().getByText('C2').closest('button')!);
    expect(onPick).toHaveBeenCalledWith('slot-C-2');
  });

  it('the slot the player already occupies is inert', () => {
    const { onPick } = renderMenu();
    // The current row is the one that says so — 'C1' alone also matches the
    // header's "from" chip, which is not a button.
    const current = sheet().getByText('Current spot').closest('button')!;
    expect(current.hasAttribute('disabled')).toBe(true);
    fireEvent.click(current);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on pick, so a second tap cannot fire a stale move', () => {
    const { onOpenChange } = renderMenu();
    fireEvent.click(sheet().getByText('BN').closest('button')!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the scrim cancels — same meaning as the cancel bar', () => {
    const { onOpenChange, onPick } = renderMenu();
    const root = screen.getByTestId('slot-sheet-root');
    fireEvent.click(root.firstElementChild!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape cancels', () => {
    const { onOpenChange } = renderMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
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
    const headings = sheet()
      .getAllByText(/^(Forwards|Defense|Goalies|Utility)$/)
      .map((n) => n.textContent);
    expect(headings).toEqual(['Forwards', 'Defense', 'Goalies']);
  });

  it('omits a heading with no eligible slots under it', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid']) });
    expect(sheet().queryByText('Goalies')).toBeNull();
    expect(sheet().queryByText('Utility')).toBeNull();
  });

  it('bench and IR carry no heading — a "Bench" group holding one "Bench" row reads as a bug', () => {
    renderMenu({ eligibleSlots: new Set(['slot-C-1', 'bench-grid', 'ir-slot-1']) });
    expect(sheet().getAllByText('Bench')).toHaveLength(1);
    expect(sheet().queryByText('Injured Reserve')).toBeNull();
    expect(sheet().getByText('IR')).toBeTruthy();
  });
});

// ── The bench count survives the page's data shape ────────────────────────

describe('SlotPickerMenu — bench reports a count, in the page shape', () => {
  it('counts players with NO assignment entry as bench', () => {
    // On the real page the bench is an array; bench players simply have no
    // slotAssignments entry. Counting only explicit 'bench-grid' values
    // reported 0 forever — the harness masked it by inventing entries.
    const P1 = mk('6', 'Artemi Panarin', 'LW');
    const P2 = mk('7', 'Kirill Kaprizov', 'LW');
    renderMenu({
      eligibleSlots: new Set(['slot-C-2', 'bench-grid']),
      allPlayers: [MCDAVID, DRAISAITL, P1, P2],
    });
    expect(sheet().getByText('2 players')).toBeTruthy();
    expect(sheet().queryByText('Empty')).toBeNull();
  });

  it('singularises a bench of one, and counts explicit bench-grid entries too', () => {
    const P1 = mk('6', 'Artemi Panarin', 'LW');
    renderMenu({
      eligibleSlots: new Set(['bench-grid']),
      slotAssignments: { ...ASSIGN, '6': 'bench-grid' },
      allPlayers: [MCDAVID, DRAISAITL, MAKAR, P1],
    });
    expect(sheet().getByText('1 player')).toBeTruthy();
  });

  it('an empty bench says 0 players rather than Empty', () => {
    renderMenu({
      eligibleSlots: new Set(['bench-grid']),
      allPlayers: [MCDAVID, DRAISAITL, MAKAR],
    });
    expect(sheet().getByText('0 players')).toBeTruthy();
  });
});

// ── Header ────────────────────────────────────────────────────────────────

describe('SlotPickerMenu — header carries the decision context', () => {
  it("shows the player being moved, his spot, and tonight's projection", () => {
    renderMenu();
    const header = sheet();
    // His name appears in the header AND on his own inert row — by design.
    expect(header.getAllByText('Connor McDavid').length).toBeGreaterThanOrEqual(1);
    expect(header.getByText('5.2')).toBeTruthy();
    // His current slot, so "from where" survives the sheet opening.
    expect(header.getAllByText('C1').length).toBeGreaterThanOrEqual(1);
  });
});
