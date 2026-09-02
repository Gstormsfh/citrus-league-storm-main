// The row hands its players down untouched (2026-09-01, audit M11).
//
// `MatchupComparisonRow` used to build a `ScoringCalculator` per row and a
// season points-per-game figure per side, spread onto a fresh copy of each
// player as `projectedPoints` — a field nothing rendered — and the fresh
// copy defeated `PlayerCard`'s `memo` on every one of the ~52 cards of a
// live refresh. What this pins: the very same object reaches the card, and
// the row imports no scoring machinery.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cardProps: Array<{ player: unknown; isUserTeam: boolean }> = [];
vi.mock('../PlayerCard', () => ({
  PlayerCard: (props: { player: unknown; isUserTeam: boolean }) => {
    cardProps.push({ player: props.player, isUserTeam: props.isUserTeam });
    return <div data-testid="card" />;
  },
}));

import { MatchupComparisonRow } from '../MatchupComparisonRow';
import type { MatchupPlayer } from '../types';

const player = (over: Partial<MatchupPlayer> = {}): MatchupPlayer => ({
  id: 1,
  name: 'Auston Matthews',
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 0,
  status: null,
  isStarter: true,
  stats: { goals: 40, assists: 30, sog: 300, blk: 20, gamesPlayed: 70 },
  ...over,
});

const HERE = resolve(fileURLToPath(import.meta.url), '..');

describe('MatchupComparisonRow — pass-through', () => {
  it('the cards receive the same player objects the row was given', () => {
    cardProps.length = 0;
    const mine = player();
    const theirs = player({ id: 2, name: 'Connor McDavid', team: 'EDM' });
    render(<MatchupComparisonRow userPlayer={mine} opponentPlayer={theirs} position="C" />);
    expect(cardProps).toHaveLength(2);
    expect(cardProps[0].isUserTeam).toBe(true);
    expect(cardProps[0].player).toBe(mine);
    expect(cardProps[1].isUserTeam).toBe(false);
    expect(cardProps[1].player).toBe(theirs);
    // Nothing was grafted on.
    expect('projectedPoints' in mine).toBe(false);
  });

  it('a re-render with the same props hands the same references down again (memo can hold)', () => {
    cardProps.length = 0;
    const mine = player();
    const { rerender } = render(<MatchupComparisonRow userPlayer={mine} opponentPlayer={null} position="C" />);
    rerender(<MatchupComparisonRow userPlayer={mine} opponentPlayer={null} position="C" />);
    expect(cardProps.filter((c) => c.isUserTeam).every((c) => c.player === mine)).toBe(true);
    expect(cardProps.filter((c) => !c.isUserTeam).every((c) => c.player === null)).toBe(true);
  });

  it('the row imports no scoring calculator', () => {
    // Comments stripped: the file's own note names what it no longer does.
    const src = readFileSync(resolve(HERE, '..', 'MatchupComparisonRow.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/ScoringCalculator/);
    expect(src).not.toMatch(/calculatePointsPerGame/);
    expect(src).not.toMatch(/scoringUtils/);
    expect(src).not.toMatch(/projectedPoints/);
  });
});
