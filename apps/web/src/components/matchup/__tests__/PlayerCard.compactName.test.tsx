// Compact names follow the viewport hook (2026-09-01, audit M11).
//
// `formatPlayerName` used to read `window.innerWidth` inside the function,
// on every render of every row — and only on a render, so a rotation that
// crossed the breakpoint left every name in the old shape until something
// else happened to re-render the page. The card now takes the answer from
// the shared `useIsMobile()` hook: right on the first paint, and a resize
// across the line re-renders the name on its own.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, act } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
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
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
  ...over,
});

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
const nameOf = (c: HTMLElement) => c.querySelector('.player-name') as HTMLElement;

let originalWidth: number;
const setWidth = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  originalWidth = window.innerWidth;
});
afterEach(() => {
  setWidth(originalWidth);
});

describe('PlayerCard — "F. Last" on a phone, the full name on desktop', () => {
  it('phone: first initial + last name, full name kept in the title', () => {
    setWidth(390);
    const { container } = render(<PlayerCard player={player()} isUserTeam />);
    expect(nameOf(container).textContent).toBe('A. Matthews');
    expect(nameOf(container).getAttribute('title')).toBe('Auston Matthews');
  });

  it('desktop: the full name', () => {
    setWidth(1280);
    const { container } = render(<PlayerCard player={player()} isUserTeam />);
    expect(nameOf(container).textContent).toBe('Auston Matthews');
  });

  it('multi-word surnames keep every word after the first', () => {
    setWidth(390);
    const { container } = render(<PlayerCard player={player({ name: 'Pierre-Luc Dubois' })} isUserTeam />);
    expect(nameOf(container).textContent).toBe('P. Dubois');
    const vd = render(<PlayerCard player={player({ id: 2, name: 'Jean Van Damme' })} isUserTeam />);
    expect(nameOf(vd.container).textContent).toBe('J. Van Damme');
  });

  it('a single-word name is never mangled', () => {
    setWidth(390);
    const { container } = render(<PlayerCard player={player({ name: 'Cher' })} isUserTeam />);
    expect(nameOf(container).textContent).toBe('Cher');
  });

  it('a resize across the breakpoint re-renders the name without a parent re-render', () => {
    setWidth(1280);
    const { container } = render(<PlayerCard player={player()} isUserTeam />);
    expect(nameOf(container).textContent).toBe('Auston Matthews');

    act(() => {
      setWidth(390);
      window.dispatchEvent(new Event('resize'));
    });
    expect(nameOf(container).textContent).toBe('A. Matthews');

    act(() => {
      setWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(nameOf(container).textContent).toBe('Auston Matthews');
  });

  it('an empty slot renders with the hook in place (hooks before the early return)', () => {
    setWidth(390);
    const { container } = render(<PlayerCard player={null} isUserTeam />);
    expect(nameOf(container).textContent).toBe('Empty');
  });
});
