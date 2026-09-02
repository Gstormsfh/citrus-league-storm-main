// Mobile slot chip lock (2026-09-01, audit item M3).
//
// Below 1024px a matchup row used to carry NO slot label — the centre column
// was display:none and a player's position was a 4px border colour. The
// centre column now renders the same 32px chip the roster list uses, so the
// two pages a manager flips between share one slot vocabulary. Desktop keeps
// its text label untouched.
//
// jsdom has no cascade, so what is checkable is the DOM contract: the chip
// exists, says the SLOT, and wears the roster's own colour classes.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { CenterColumn } from '../CenterColumn';
import { MatchupComparisonRow } from '../MatchupComparisonRow';
import { MatchupPositionGroup } from '../MatchupPositionGroup';
import {
  posColor,
  posRingColor,
  NEUTRAL_CHIP,
  positionChipKey,
} from '@/components/roster/positionChip';
import type { MatchupPlayer } from '../types';

const chipOf = (container: HTMLElement) =>
  container.querySelector('.matchup-slot-chip') as HTMLElement | null;

const player = (over: Partial<MatchupPlayer>): MatchupPlayer => ({
  id: 1,
  name: 'Auston Matthews',
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 0,
  status: null,
  isStarter: true,
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
  ...over,
});

describe('CenterColumn — mobile slot chip', () => {
  it.each(['C', 'LW', 'RW', 'D', 'G'])('%s slot: chip says the slot and wears the roster colour pair', (pos) => {
    const { container } = render(<CenterColumn position={pos} />);
    const chip = chipOf(container);
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe(pos);
    // The roster list's own classes — one palette, not two.
    for (const cls of posColor[pos].split(' ')) expect(chip!.className).toContain(cls);
    expect(chip!.className).toContain(posRingColor[pos]);
    // 32px square, hidden on desktop where the text label takes over.
    expect(chip!.className).toMatch(/\bw-8\b/);
    expect(chip!.className).toMatch(/\bh-8\b/);
    expect(chip!.className).toMatch(/\blg:hidden\b/);
  });

  it('keeps the desktop text label alongside the chip', () => {
    const { container } = render(<CenterColumn position="LW" />);
    const label = container.querySelector('.position-label');
    expect(label?.textContent).toBe('LW');
    expect(container.querySelector('.matchup-center-column')).toBeTruthy();
  });

  it('UTIL: labelled UTIL, coloured by the occupant\'s real position', () => {
    const { container } = render(
      <CenterColumn position="UTIL" userPlayer={{ position: 'D' }} opponentPlayer={{ position: 'C' }} />,
    );
    const chip = chipOf(container)!;
    expect(chip.textContent).toBe('UTIL');
    for (const cls of posColor.D.split(' ')) expect(chip.className).toContain(cls);
    // Not the generic UTIL sage.
    expect(chip.className).not.toContain('text-pastel-forest');
    // Desktop label still reads "Util".
    expect(container.querySelector('.position-label')?.textContent).toBe('Util');
  });

  it('UTIL with an empty user side takes the opponent\'s colour; empty both sides falls back to UTIL', () => {
    const viaOpponent = render(<CenterColumn position="UTIL" userPlayer={null} opponentPlayer={{ position: 'RW' }} />);
    for (const cls of posColor.RW.split(' ')) expect(chipOf(viaOpponent.container)!.className).toContain(cls);

    const nobody = render(<CenterColumn position="UTIL" userPlayer={null} opponentPlayer={null} />);
    for (const cls of posColor.UTIL.split(' ')) expect(chipOf(nobody.container)!.className).toContain(cls);
    expect(chipOf(nobody.container)!.textContent).toBe('UTIL');
  });

  it('normalises raw position strings the way the roster does', () => {
    expect(positionChipKey('Goalie')).toBe('G');
    expect(positionChipKey('Left Wing')).toBe('LW');
    expect(positionChipKey('rightwing')).toBe('RW');
    expect(positionChipKey('Defense')).toBe('D');
    expect(positionChipKey('utility')).toBe('UTIL');
    expect(positionChipKey('F')).toBe('F');
    expect(positionChipKey('')).toBe('');
    // Unknown schemes render something reportable, not a blank chip.
    expect(positionChipKey('Bench')).toBe('BE');

    const { container } = render(<CenterColumn position="Goalie" />);
    expect(chipOf(container)!.textContent).toBe('G');
    for (const cls of posColor.G.split(' ')) expect(chipOf(container)!.className).toContain(cls);
  });

  it('bench: a neutral BN chip, no position colour, on both breakpoints', () => {
    const { container } = render(<CenterColumn position="C" isBench />);
    const chip = chipOf(container)!;
    expect(chip.textContent).toBe('BN');
    for (const cls of NEUTRAL_CHIP.split(' ')) expect(chip.className).toContain(cls);
    expect(chip.className).not.toContain('bg-pastel-sage');
    expect(container.querySelector('.position-label')?.textContent).toBe('BN');
  });
});

describe('MatchupComparisonRow / MatchupPositionGroup — the chip reaches every row', () => {
  it('a starter row renders exactly one chip, between the two cards', () => {
    const { container } = render(
      <MatchupComparisonRow userPlayer={player({})} opponentPlayer={player({ id: 2, name: 'Connor McDavid' })} position="C" />,
    );
    const row = container.querySelector('.matchup-comparison-row')!;
    expect(row.children).toHaveLength(3);
    expect(row.children[0].className).toContain('user-team');
    expect(row.children[1].className).toContain('matchup-center-column');
    expect(row.children[2].className).toContain('opponent-team');
    expect(container.querySelectorAll('.matchup-slot-chip')).toHaveLength(1);
  });

  it('a bench row gets the BN chip too (it used to get a raw position label)', () => {
    const { container } = render(
      <MatchupComparisonRow userPlayer={player({})} opponentPlayer={null} position="C" isBench />,
    );
    expect(chipOf(container)!.textContent).toBe('BN');
  });

  it('a row that is empty on BOTH sides still knows its slot', () => {
    const { container } = render(
      <MatchupPositionGroup
        userPlayers={[null, null]}
        opponentPlayers={[null, null]}
        isUtilSlot={[false, true]}
        slotPositions={['G', 'Util']}
      />,
    );
    const chips = Array.from(container.querySelectorAll('.matchup-slot-chip')).map((c) => c.textContent);
    expect(chips).toEqual(['G', 'UTIL']);
    // Empty cards say "Empty" — the chip already says which slot.
    const empties = Array.from(container.querySelectorAll('.player-card-empty .player-name')).map((n) => n.textContent);
    expect(empties).toEqual(['Empty', 'Empty', 'Empty', 'Empty']);
    expect(container.textContent).not.toContain('Empty Slot');
  });

  it('the slot wins over the occupant when the two disagree', () => {
    // A C-eligible player parked in an LW slot: the row IS the LW slot.
    const { container } = render(
      <MatchupPositionGroup
        userPlayers={[player({ position: 'C' })]}
        opponentPlayers={[null]}
        isUtilSlot={[false]}
        slotPositions={['LW']}
      />,
    );
    expect(chipOf(container)!.textContent).toBe('LW');
  });

  it('without slot positions the occupant still supplies the label (bench rows)', () => {
    const { container } = render(
      <MatchupPositionGroup userPlayers={[player({ position: 'D' })]} opponentPlayers={[null]} />,
    );
    expect(chipOf(container)!.textContent).toBe('D');
  });
});
