// Collapsible bench lock (2026-09-01, audit item M6).
//
// The bench used to be always expanded: 4–6 rows × 2 columns of 40%-opacity
// grayscale cards under the lineup, each with a full-card "BENCHED" overlay
// when the player scored. On a phone that is a screen of noise below the
// number the manager came for. It is now a "Bench (n)" section, collapsed by
// default below the lg breakpoint, open on desktop, and the viewer's last
// choice is remembered in localStorage — guarded, because storage can throw.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The rows themselves have their own coverage; here the marker tells us
// whether the bench group rendered at all, and with which flag.
vi.mock('../MatchupPositionGroup', () => ({
  MatchupPositionGroup: (props: { isBench?: boolean }) => (
    <div data-testid={props.isBench ? 'bench-rows' : 'starter-rows'} />
  ),
}));

import { MatchupComparison, BENCH_OPEN_STORAGE_KEY } from '../MatchupComparison';
import type { MatchupPlayer } from '../types';

const p = (id: number): MatchupPlayer => ({
  id,
  name: `Player ${id}`,
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 0,
  status: null,
  isStarter: false,
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
});

const baseProps = {
  userStarters: [],
  opponentStarters: [],
  userSlotAssignments: {},
  opponentSlotAssignments: {},
};

let originalWidth: number;
const setWidth = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  originalWidth = window.innerWidth;
  window.localStorage.clear();
});
afterEach(() => {
  setWidth(originalWidth);
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('MatchupComparison — collapsible bench', () => {
  it('renders no bench section when both benches are empty', () => {
    render(<MatchupComparison {...baseProps} />);
    expect(screen.queryByTestId('matchup-bench')).toBeNull();
  });

  it('counts ROWS, not players: Bench (max of the two sides)', () => {
    setWidth(1280);
    render(<MatchupComparison {...baseProps} userBench={[p(1), p(2), p(3)]} opponentBench={[p(4)]} />);
    expect(screen.getByText('Bench (3)')).toBeTruthy();
  });

  it('mobile: collapsed by default, opens on tap, remembers the choice', () => {
    setWidth(390);
    render(<MatchupComparison {...baseProps} userBench={[p(1), p(2)]} opponentBench={[p(3)]} />);

    const toggle = screen.getByRole('button', { name: /bench \(2\)/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('bench-rows')).toBeNull();
    // Starters are never hidden by the bench toggle.
    expect(screen.getByTestId('starter-rows')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('bench-rows')).toBeTruthy();
    expect(window.localStorage.getItem(BENCH_OPEN_STORAGE_KEY)).toBe('1');

    fireEvent.click(toggle);
    expect(screen.queryByTestId('bench-rows')).toBeNull();
    expect(window.localStorage.getItem(BENCH_OPEN_STORAGE_KEY)).toBe('0');
  });

  it('desktop: open by default', () => {
    setWidth(1280);
    render(<MatchupComparison {...baseProps} userBench={[p(1)]} opponentBench={[]} />);
    expect(screen.getByRole('button', { name: /bench \(1\)/i }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('bench-rows')).toBeTruthy();
  });

  it('a stored preference beats the viewport default in both directions', () => {
    window.localStorage.setItem(BENCH_OPEN_STORAGE_KEY, '1');
    setWidth(390);
    const opened = render(<MatchupComparison {...baseProps} userBench={[p(1)]} />);
    expect(opened.getByTestId('bench-rows')).toBeTruthy();
    opened.unmount();

    window.localStorage.setItem(BENCH_OPEN_STORAGE_KEY, '0');
    setWidth(1280);
    const closed = render(<MatchupComparison {...baseProps} userBench={[p(1)]} />);
    expect(closed.queryByTestId('bench-rows')).toBeNull();
  });

  it('survives a localStorage that throws (Safari private mode) — falls back to the viewport default', () => {
    setWidth(390);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(<MatchupComparison {...baseProps} userBench={[p(1)]} />);
    const toggle = screen.getByRole('button', { name: /bench \(1\)/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(getItem).toHaveBeenCalled();

    // Toggling still works; the failed write is swallowed.
    fireEvent.click(toggle);
    expect(screen.getByTestId('bench-rows')).toBeTruthy();
    expect(setItem).toHaveBeenCalled();
  });

  it('the total row carries the neutral TOT / DAY chip on mobile', () => {
    setWidth(390);
    const { container, rerender } = render(<MatchupComparison {...baseProps} />);
    const chip = container.querySelector('.matchup-total-center .matchup-slot-chip')!;
    expect(chip.textContent).toBe('TOT');
    expect(chip.className).toContain('lg:hidden');
    rerender(<MatchupComparison {...baseProps} selectedDate="2026-01-05" />);
    expect(container.querySelector('.matchup-total-center .matchup-slot-chip')!.textContent).toBe('DAY');
  });
});

describe('MatchupComparison — Press Box bench in view (2026-09-05)', () => {
  it('LINEUPS shows the bench under the starters, dimmed, with its count', () => {
    render(
      <MatchupComparison {...baseProps} variant="pressbox" section="lineups" userBench={[p(1), p(2)]} opponentBench={[p(3)]} />,
    );
    expect(screen.getByTestId('starter-rows')).toBeInTheDocument();
    const inline = screen.getByTestId('matchup-bench-inline');
    expect(inline.textContent).toContain('Bench');
    expect(inline.textContent).toContain('· 2');
    expect(inline.textContent).toContain("PTS DON'T COUNT");
    expect(screen.getByTestId('bench-rows')).toBeInTheDocument();
  });
  it('LINEUPS draws no bench block when both benches are empty', () => {
    render(<MatchupComparison {...baseProps} variant="pressbox" section="lineups" />);
    expect(screen.queryByTestId('matchup-bench-inline')).toBeNull();
  });
  it('BENCH shows the bench alone', () => {
    render(<MatchupComparison {...baseProps} variant="pressbox" section="bench" userBench={[p(1)]} />);
    expect(screen.queryByTestId('starter-rows')).toBeNull();
    expect(screen.getByTestId('bench-rows')).toBeInTheDocument();
    expect(screen.queryByTestId('matchup-bench-inline')).toBeNull();
  });
});
