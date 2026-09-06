import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StartersGrid from '../StartersGrid';
import IRSlot from '../IRSlot';
import type { HockeyPlayer } from '../HockeyPlayerCard';

vi.mock('../HockeyPlayerCard', () => ({ default: ({ player }: { player: HockeyPlayer }) => <div>{player.name}</div> }));
const players = [{ id: '1', name: 'First utility', position: 'C' }, { id: '2', name: 'Second utility', position: 'RW' }] as HockeyPlayer[];
const slots = { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 2 };

describe('tablet/desktop commissioner roster slots', () => {
  it('renders both occupied utility slots exactly once', () => {
    render(<StartersGrid players={players} slotAssignments={{ 1: 'slot-UTIL-1', 2: 'slot-UTIL-2' }} rosterSlots={slots} />);
    expect(screen.getAllByText('First utility')).toHaveLength(1);
    expect(screen.getAllByText('Second utility')).toHaveLength(1);
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  });
  it('routes a move to the second utility slot without replacing the first', () => {
    const onSlotTap = vi.fn();
    render(<StartersGrid players={[players[0]]} slotAssignments={{ 1: 'slot-UTIL-1' }} rosterSlots={slots} tapSelectedPlayerId="2" tapEligibleSlots={new Set(['slot-UTIL-2'])} onSlotTap={onSlotTap} />);
    fireEvent.click(screen.getByText('Move here'));
    expect(onSlotTap).toHaveBeenCalledWith('slot-UTIL-2');
    expect(screen.getByText('First utility')).toBeInTheDocument();
  });
  it('retains the established single-utility slot identifier', () => {
    render(<StartersGrid players={[players[0]]} slotAssignments={{ 1: 'slot-UTIL' }} rosterSlots={{ ...slots, UTIL: 1 }} />);
    expect(screen.getByText('First utility')).toBeInTheDocument();
  });
  it.each([0, 1, 2, 4])('renders exactly %i commissioner-configured IR slots', count => {
    render(<IRSlot players={[]} irSlotCount={count} />);
    expect(screen.queryAllByText(/^IR \d+$/)).toHaveLength(count);
    expect(screen.getByText(`0/${count}`)).toBeInTheDocument();
  });
});
