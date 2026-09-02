// VISIBLE SWAP AFFORDANCE + LOCKED CHIPS (2026-09-01, audit R2 + R5)
//
// On the phone the position chip is the only way to start a lineup change,
// and nothing on the row said so. What this pins:
//
//   * every chip carries the ⇄ glyph — in a CHILD span, so the chip's base
//     class and the posColor / posRingColor maps (locked by the positionRing
//     test) are untouched;
//   * a locked player's chip swaps the glyph for a lock and goes neutral,
//     while the ROW stays fully legible (no opacity dimming);
//   * an empty starter row is one tap target: "Empty · tap to fill" opens
//     the Fill flow (onFillSlot) with nothing selected, and is the move
//     target (onSlotTap) once a player is selected;
//   * the first-run hint fires once, and only when the list is editable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import MobileRosterList from '../MobileRosterList';
import { resetSwapHintForTests, SWAP_HINT_STORAGE_KEY } from '@/hooks/useSwapHint';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (id: string, name: string, position: string): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {} }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C');
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C');
const PANARIN = mk('6', 'Artemi Panarin', 'LW');

// C1 and C2 filled, everything else (LW1, LW2, RW1 …) empty.
const ASSIGN: Record<string, string> = { '1': 'slot-C-1', '2': 'slot-C-2' };

function renderList(over: Partial<React.ComponentProps<typeof MobileRosterList>> = {}) {
  const onSlotTap = vi.fn();
  const onFillSlot = vi.fn();
  const onPlayerTap = vi.fn();
  const utils = render(
    <MobileRosterList
      starters={[MCDAVID, DRAISAITL]}
      bench={[PANARIN]}
      ir={[]}
      slotAssignments={ASSIGN}
      tapSelectedPlayerId={null}
      tapEligibleSlots={new Set()}
      onSlotTap={onSlotTap}
      onFillSlot={onFillSlot}
      onPlayerTap={onPlayerTap}
      positionType="individual"
      {...over}
    />,
  );
  return { onSlotTap, onFillSlot, onPlayerTap, ...utils };
}

/** The chip is the element that owns the position text; walk up from it. */
const chipFor = (name: string) => {
  const row = screen.getByText(name).closest('div.flex.items-center.gap-2\\.5') as HTMLElement;
  expect(row, `row for ${name}`).toBeTruthy();
  return { row, chip: row.querySelector('[class*="w-8 h-8"]') as HTMLElement };
};

beforeEach(() => {
  toastSpy.mockClear();
  localStorage.removeItem(SWAP_HINT_STORAGE_KEY);
  resetSwapHintForTests();
});

describe('the position chip says it is a control', () => {
  it('every chip carries the ⇄ glyph in a child span', () => {
    renderList();
    const glyphs = screen.getAllByTestId('chip-swap-glyph');
    // 13 starter rows (2 filled + 11 empty) + 1 bench row.
    expect(glyphs.length).toBe(14);
    for (const g of glyphs) {
      expect(g.tagName).toBe('SPAN');
      expect(g).toHaveTextContent('⇄');
      expect(g).toHaveAttribute('aria-hidden', 'true');
      expect(g.className).toMatch(/text-\[10px\]/);
      // A child of the chip, never the chip itself.
      expect(g.parentElement?.className).toMatch(/w-8 h-8/);
    }
  });

  it('the glyph does not disturb the chip text the wiring tests query by', () => {
    renderList();
    // Own-text match: the chip still answers a bare query for its position.
    expect(screen.getByText('UTIL')).toBeInTheDocument();
    expect(screen.getAllByText('C').length).toBe(2);
  });

  it('tapping the chip still selects the player', () => {
    const { onPlayerTap } = renderList();
    fireEvent.click(chipFor('Connor McDavid').chip);
    expect(onPlayerTap).toHaveBeenCalledWith(MCDAVID);
  });
});

describe('locked players', () => {
  it('wear the locked chip variant with a lock glyph instead of ⇄', () => {
    renderList({ lockedPlayerIds: new Set(['1']) });
    const { chip } = chipFor('Connor McDavid');
    expect(chip).toHaveAttribute('data-locked', 'true');
    expect(chip.className).toMatch(/bg-white\/10/);
    expect(chip.className).toMatch(/text-white\/55/);
    expect(chip.className).not.toMatch(/bg-pastel-sage\b/);
    expect(within(chip).getByTestId('chip-lock')).toBeInTheDocument();
    expect(within(chip).queryByTestId('chip-swap-glyph')).toBeNull();

    // The other centre keeps his colour and his glyph.
    const other = chipFor('Leon Draisaitl').chip;
    expect(other.className).toMatch(/bg-pastel-sage text-pastel-forest/);
    expect(within(other).getByTestId('chip-swap-glyph')).toBeInTheDocument();
  });

  it('keep a fully legible row — no opacity dimming anywhere on it', () => {
    renderList({ lockedPlayerIds: new Set(['1']) });
    const { row } = chipFor('Connor McDavid');
    expect(row.className).not.toMatch(/opacity-/);
    expect(row.querySelector('[class*="opacity-60"]')).toBeNull();
    expect(screen.getByText('Connor McDavid')).toHaveClass('text-pastel-cream');
  });
});

describe('an empty starter row is one target', () => {
  const emptyRow = () => screen.getByRole('button', { name: /Empty LW1, tap to fill/ });

  it('is labelled "Empty · tap to fill" and exposed as a button', () => {
    renderList();
    const row = emptyRow();
    expect(row).toHaveTextContent(/Empty/);
    expect(row).toHaveTextContent(/tap to fill/);
  });

  it('with nothing selected, tapping anywhere on the row opens the Fill flow', () => {
    const { onFillSlot, onSlotTap } = renderList();
    fireEvent.click(emptyRow());
    expect(onFillSlot).toHaveBeenCalledWith('slot-LW-1');
    expect(onSlotTap).not.toHaveBeenCalled();
  });

  it('with nothing selected, tapping the chip opens the Fill flow too', () => {
    const { onFillSlot } = renderList();
    const chip = emptyRow().querySelector('[class*="w-8 h-8"]') as HTMLElement;
    fireEvent.click(chip);
    expect(onFillSlot).toHaveBeenCalledTimes(1);
    expect(onFillSlot).toHaveBeenCalledWith('slot-LW-1');
  });

  it('with a player selected, the row is the move target and reads so', () => {
    const { onFillSlot, onSlotTap } = renderList({
      tapSelectedPlayerId: '6',
      tapEligibleSlots: new Set(['slot-LW-1', 'bench-grid']),
    });
    const row = screen.getByRole('button', { name: /Move here: LW1/ });
    expect(row).toHaveTextContent(/Tap to move here/);
    fireEvent.click(row);
    expect(onSlotTap).toHaveBeenCalledWith('slot-LW-1');
    expect(onFillSlot).not.toHaveBeenCalled();
  });
});

describe('the first-run hint', () => {
  it('fires once when the list is editable, and not again on re-render', () => {
    const { rerender } = renderList({ swapHint: true });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toMatchObject({ title: 'Tap a position to swap' });
    rerender(
      <MobileRosterList
        starters={[MCDAVID, DRAISAITL]}
        bench={[PANARIN]}
        ir={[]}
        slotAssignments={ASSIGN}
        swapHint
        positionType="individual"
      />,
    );
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('never fires on a read-only list (the default)', () => {
    renderList();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('never fires on an empty roster — there is nothing to swap', () => {
    renderList({ starters: [], bench: [], slotAssignments: {}, swapHint: true });
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
