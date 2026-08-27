// SLOT MENU WIRING (2026-08-27)
//
// The component itself is covered by SlotPickerMenu.test.tsx. What this file
// pins is the WIRING, and specifically the ways the wiring could be wrong
// without anything looking broken:
//
//   * a menu that renders for more than one row at a time, or for none;
//   * a pick that reports something other than the slot id the page's own
//     `handleMobileTapSlot` expects;
//   * a menu that offers slots the page did not judge legal — the IR gate
//     lives in Roster.tsx's `tapEligibleSlots` and nowhere else.
//
// The interaction this design turns on — that a tap on a highlighted slot
// UNDERNEATH an open menu still completes the move — is NOT provable here.
// jsdom has no real pointer sequencing and Radix's dismissal path behaves
// differently under it. That one is verified in a browser via
// harness/slot.tsx; this file pins the prop contract that makes it possible.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MobileRosterList from '../MobileRosterList';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position: string): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {} }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C');
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C');
const PANARIN = mk('6', 'Artemi Panarin', 'LW');

const ASSIGN: Record<string, string> = {
  '1': 'slot-C-1',
  '2': 'slot-C-2',
  '6': 'bench-grid',
};

function renderList(over: Partial<React.ComponentProps<typeof MobileRosterList>> = {}) {
  const onSlotTap = vi.fn();
  const onCancelSelection = vi.fn();
  const utils = render(
    <MobileRosterList
      starters={[MCDAVID, DRAISAITL]}
      bench={[PANARIN]}
      ir={[]}
      slotAssignments={ASSIGN}
      tapSelectedPlayerId={null}
      tapEligibleSlots={new Set()}
      onSlotTap={onSlotTap}
      onCancelSelection={onCancelSelection}
      positionType="individual"
      {...over}
    />,
  );
  return { onSlotTap, onCancelSelection, ...utils };
}

/** The menu's own header — "MOVE" over the player's name. Absent = no menu. */
const menuHeading = () => screen.queryByText('Move');

/**
 * The popover body, so assertions can say "inside the menu" rather than
 * "somewhere on the page". Without this scoping the roster's OWN slot badges
 * answer the query: `queryByText('UTIL')` matches the page's empty UTIL row
 * whether or not the menu offers UTIL, and the test passes for the wrong
 * reason — or, as first written, fails for the wrong one.
 */
const menu = () => {
  const el = screen.getByText('Move').closest('div')!.parentElement!;
  return within(el);
};

/** Just the menu's header block — "MOVE" over the name of the player being
 *  moved. Scoped separately because that player is frequently ALSO an
 *  occupant listed in the rows below, so a menu-wide `getByText` on his name
 *  matches twice and throws. */
const menuHeader = () => within(screen.getByText('Move').closest('div')!);

describe('MobileRosterList — when the menu appears', () => {
  it('renders no menu while nothing is selected', () => {
    renderList();
    expect(menuHeading()).toBeNull();
  });

  it('renders the menu for the selected player', () => {
    renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-1', 'slot-C-2', 'bench-grid']),
    });
    expect(menuHeading()).toBeTruthy();
    expect(menuHeader().getByText('Connor McDavid')).toBeTruthy();
  });

  it('renders exactly one menu even though every row could host one', () => {
    renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-1', 'slot-C-2', 'bench-grid']),
    });
    expect(screen.getAllByText('Move')).toHaveLength(1);
  });

  it('opens for a bench player too — promoting is the common move', () => {
    renderList({
      tapSelectedPlayerId: '6',
      tapEligibleSlots: new Set(['slot-LW-1', 'bench-grid']),
    });
    expect(menuHeading()).toBeTruthy();
    expect(menuHeader().getByText('Artemi Panarin')).toBeTruthy();
  });
});

describe('MobileRosterList — what the menu reports', () => {
  it('picks report the slot id, which is what handleMobileTapSlot takes', () => {
    const { onSlotTap } = renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-1', 'slot-C-2', 'bench-grid']),
    });
    fireEvent.click(menu().getByText('C2').closest('button')!);
    expect(onSlotTap).toHaveBeenCalledWith('slot-C-2');
  });

  it('offers only what the page judged legal', () => {
    // Roster.tsx applies the is_ir_eligible gate when it builds this set. A
    // menu that widened it would route round the only IR check in the app.
    renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-2']),
    });
    expect(menu().getByText('C2')).toBeTruthy();
    expect(menu().queryByText('UTIL')).toBeNull();
    expect(menu().queryByText('IR')).toBeNull();
    // ...and the page's own UTIL row is untouched by that — proving the
    // assertion above is about the menu and not about the page.
    expect(screen.getByText('UTIL')).toBeTruthy();
  });

  it('names the occupant, so the swap is legible before the tap', () => {
    renderList({
      tapSelectedPlayerId: '1',
      tapEligibleSlots: new Set(['slot-C-1', 'slot-C-2']),
    });
    expect(menu().getByText('Leon Draisaitl')).toBeTruthy();
  });
});
