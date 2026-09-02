// The phone matchup row's name (2026-09-01 audit M11, rewritten 2026-09-02).
//
// TWO CONTRACTS LIVE HERE.
//
// 1. WHICH FORM. `compactPlayerName` returns the FAMILY NAME on the phone
//    row and the full name on desktop. The rule it replaced was "F. Last",
//    which spent ~19px of an 82.5px column on a first initial and then let
//    the ellipsis eat the surname: measured over 57 real NHL names at 15px
//    bold, "F. Last" fitted 34 of 57 and "Last" fits 54 of 57. The module's
//    header carries the geometry and the full measurement.
//
//    The invariant worth pinning is the one that makes the change SAFE: the
//    compact form is a suffix of the old form, so no name can come out
//    wider than it was. That is asserted below over a name list rather than
//    asserted once.
//
// 2. WHERE THE ANSWER COMES FROM. `formatPlayerName` used to read
//    `window.innerWidth` inside itself, on every render of every row — and
//    only on a render, so a rotation across the breakpoint left every name
//    in the old shape until something else re-rendered the page. The card
//    takes the answer from the shared `useIsMobile()` hook: right on the
//    first paint, and a resize across the line re-renders the name on its
//    own. That behaviour is retested here because it is the reason the
//    function is pure and takes `compact` as an argument.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, act } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import { compactPlayerName } from '../compactPlayerName';
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

/** The names the 2026-09-02 measurement was run over, in both shapes. */
const NAMES = [
  'Auston Matthews',
  'Nathan MacKinnon',
  'Nikita Kucherov',
  'Macklin Celebrini',
  'William Nylander',
  'Jeremy Swayman',
  'Jake Oettinger',
  'Brad Marchand',
  'Connor Hellebuyck',
  'Andrei Vasilevskiy',
  'Elias Pettersson',
  'Mika Zibanejad',
  'Ryan Nugent-Hopkins',
  'Pierre-Luc Dubois',
  'Jean-Gabriel Pageau',
  'Cale Makar',
  'Adam Fox',
];

describe('compactPlayerName — the family name is what the 82.5px column shows', () => {
  it('drops the given name on the phone row', () => {
    expect(compactPlayerName('Auston Matthews', true)).toBe('Matthews');
    expect(compactPlayerName('Nathan MacKinnon', true)).toBe('MacKinnon');
  });

  it('keeps the full name when not compact', () => {
    for (const n of NAMES) expect(compactPlayerName(n, false)).toBe(n);
    expect(compactPlayerName('Auston Matthews')).toBe('Auston Matthews');
  });

  it('particles and hyphens survive whole — only the first token goes', () => {
    expect(compactPlayerName('Jean Van Damme', true)).toBe('Van Damme');
    expect(compactPlayerName('Ryan Nugent-Hopkins', true)).toBe('Nugent-Hopkins');
    expect(compactPlayerName('Pierre-Luc Dubois', true)).toBe('Dubois');
  });

  it('a single-token name is returned, not mangled', () => {
    expect(compactPlayerName('Cher', true)).toBe('Cher');
    expect(compactPlayerName('  Cher  ', true)).toBe('Cher');
    expect(compactPlayerName('', true)).toBe('');
  });

  /**
   * THE SAFETY INVARIANT. The old rule was `first initial + ". " + family`;
   * the new one is `family`, a suffix of it. A suffix cannot be wider than
   * the string it ends, so no row can render a name that truncates where it
   * did not before — which is what makes this change strictly a win rather
   * than a trade.
   */
  it('is always a suffix of the "F. Last" form it replaces, so no name gets wider', () => {
    for (const n of NAMES) {
      const parts = n.trim().split(' ');
      const old = parts.length >= 2 ? `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}` : n.trim();
      const next = compactPlayerName(n, true);
      expect(old.endsWith(next), `${n}: "${next}" is not a suffix of "${old}"`).toBe(true);
      expect(next.length).toBeLessThanOrEqual(old.length);
    }
  });

  it('no longer emits the "X. " prefix at all', () => {
    for (const n of NAMES) expect(compactPlayerName(n, true)).not.toMatch(/^[A-Z]\.\s/);
  });
});

describe('PlayerCard — the family name on a phone, the full name on desktop', () => {
  it('phone: family name, full name kept in the title', () => {
    setWidth(390);
    const { container } = render(<PlayerCard player={player()} isUserTeam />);
    expect(nameOf(container).textContent).toBe('Matthews');
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
    expect(nameOf(container).textContent).toBe('Dubois');
    const vd = render(<PlayerCard player={player({ id: 2, name: 'Jean Van Damme' })} isUserTeam />);
    expect(nameOf(vd.container).textContent).toBe('Van Damme');
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
    expect(nameOf(container).textContent).toBe('Matthews');

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
