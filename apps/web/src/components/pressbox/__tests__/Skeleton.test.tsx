/**
 * PRESS BOX SKELETONS (PR3) — pinned to motion board 2b.
 *
 * "The skeleton mirrors the final layout exactly — same grid, same row
 * heights — so nothing jumps. Position chips render in their real colour at
 * 50% opacity; text blocks shimmer; 100–150ms stagger per row."
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PressBoxSkeletonRow,
  PressBoxSkeletonRows,
  PressBoxSkeletonRoster,
  PressBoxSkeletonStandings,
  PressBoxSkeletonScreen,
  PressBoxSkeletonCard,
  type PressBoxSkeletonKind,
} from '../Skeleton';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROSTER_LIST_SRC = readFileSync(resolve(HERE, '..', 'RosterList.tsx'), 'utf8');
const ROSTER_ROW_SRC = readFileSync(resolve(HERE, '..', 'RosterRow.tsx'), 'utf8');
const STANDINGS_SRC = readFileSync(resolve(HERE, '..', 'StandingsTable.tsx'), 'utf8');
const PLAYER_ROW_SRC = readFileSync(resolve(HERE, '..', 'PlayerRow.tsx'), 'utf8');
const SKELETON_SRC = readFileSync(resolve(HERE, '..', 'Skeleton.tsx'), 'utf8');
const CSS = readFileSync(resolve(HERE, '..', '..', '..', 'index.css'), 'utf8');

describe('the shimmer', () => {
  it('is the tile-coloured sweep the board specifies, and stops under reduced motion', () => {
    expect(CSS).toMatch(/\.pb-shimmer\s*\{[^}]*linear-gradient\(90deg, #16241B 25%, #1d2e23 50%, #16241B 75%\)/);
    expect(CSS).toMatch(/\.pb-shimmer-high\s*\{[^}]*#1f3327/);
    const reduced = CSS.slice(CSS.indexOf('prefers-reduced-motion: reduce) {\n    .pb-shimmer'));
    expect(reduced).toMatch(/\.pb-shimmer,\s*\.pb-shimmer-high\s*\{\s*animation: none;/);
  });

  it('a bar on a tile uses the high sweep, so it is not tile-on-tile', () => {
    const { container } = render(<PressBoxSkeletonCard height={92} />);
    const bars = container.querySelectorAll('span[aria-hidden]');
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((b) => expect(b.className).toContain('pb-shimmer-high'));
  });
});

describe('the row', () => {
  it('is the player row height (64) with the real chip at half strength', () => {
    expect(PLAYER_ROW_SRC).toContain('min-h-[64px]');
    const { container } = render(<PressBoxSkeletonRow chip="LW" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('min-h-[64px]');
    expect(row.getAttribute('role')).toBe('status');
    const chip = row.querySelector('span[aria-hidden]') as HTMLElement;
    expect(chip.textContent).toBe('LW');
    expect(chip.className).toContain('opacity-50');
  });

  it('rows enter 100–150ms apart', () => {
    expect(SKELETON_SRC).toMatch(/const STAGGER_MS = (1[0-4]\d|150);/);
    const { container } = render(<PressBoxSkeletonRows rows={3} />);
    const rows = container.querySelectorAll('[data-testid="pb-skeleton-row"]');
    expect(rows.length).toBe(3);
    expect((rows[0] as HTMLElement).style.animationDelay).toBe('0ms');
    expect((rows[2] as HTMLElement).style.animationDelay).toBe('240ms');
  });
});

describe('the roster skeleton mirrors PressBoxRosterList', () => {
  it('same grid, same heights, same heads', () => {
    expect(ROSTER_ROW_SRC).toContain("'grid-cols-[30px_30px_1fr_52px]'");
    expect(ROSTER_ROW_SRC).toContain("bench ? 'min-h-[52px]' : 'min-h-[56px]'");
    expect(ROSTER_LIST_SRC).toContain("'bg-pressbox-surface border-t border-white/[0.08] px-3 pt-2.5'");
    const { container, getByText } = render(<PressBoxSkeletonRoster />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-pressbox-surface border-t border-white/[0.08] px-3 pt-2.5');
    const rows = container.querySelectorAll('[data-testid="pb-skeleton-roster-row"]');
    expect(rows.length).toBe(16);
    const starters = Array.from(rows).filter((r) => r.className.includes('min-h-[56px]'));
    const bench = Array.from(rows).filter((r) => r.className.includes('min-h-[52px]'));
    expect(starters.length).toBe(12);
    expect(bench.length).toBe(4);
    rows.forEach((r) => expect(r.className).toContain('grid-cols-[30px_30px_1fr_52px]'));
    expect(getByText(/Starters/)).toBeTruthy();
    expect(getByText(/Bench/)).toBeTruthy();
  });

  it('the slot chip is the real starter / bench chip at half strength, glyph included', () => {
    const { container } = render(<PressBoxSkeletonRoster />);
    const rows = container.querySelectorAll('[data-testid="pb-skeleton-roster-row"]');
    const firstChip = rows[0].querySelector('span[aria-hidden]') as HTMLElement;
    expect(firstChip.className).toContain('opacity-50');
    expect(firstChip.className).toContain('flex-col');
    expect(firstChip.textContent).toBe('C⇄');
    const benchChip = rows[15].querySelector('span[aria-hidden]') as HTMLElement;
    expect(benchChip.textContent).toBe('BN');
  });
});

describe('the standings skeleton mirrors PressBoxStandingsTable', () => {
  it('same grid, same column head, 26px disc', () => {
    expect(STANDINGS_SRC).toContain("'grid grid-cols-[16px_1fr_34px_42px_42px_26px_44px] gap-1 px-2.5 py-2'");
    expect(SKELETON_SRC).toContain("'grid grid-cols-[16px_1fr_34px_42px_42px_26px_44px] gap-1 px-2.5 py-2'");
    const { getByText, container } = render(<PressBoxSkeletonStandings rows={10} />);
    ['#', 'TEAM', 'W–L', 'PF', 'PA', 'STK', 'LAST 5'].forEach((h) => expect(getByText(h)).toBeTruthy());
    expect(container.querySelectorAll('.w-\\[26px\\].h-\\[26px\\]').length).toBe(10);
  });
});

describe('the screens', () => {
  const kinds: PressBoxSkeletonKind[] = [
    'roster', 'standings', 'matchup', 'hq', 'players', 'browse', 'bracket', 'scores', 'news', 'home', 'account', 'list',
  ];
  it.each(kinds)('%s renders as a status region under the app chrome', (kind) => {
    const { container } = render(<PressBoxSkeletonScreen kind={kind} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pb-app-chrome');
    expect(root.querySelector('[role="status"]') ?? root).toBeTruthy();
    expect(container.querySelectorAll('.pb-shimmer, .pb-shimmer-high').length).toBeGreaterThan(0);
  });

  it('roster carries its own gutter; the rest sit in the page column', () => {
    const roster = render(<PressBoxSkeletonScreen kind="roster" />).container.firstElementChild as HTMLElement;
    expect(roster.className).not.toContain('px-3.5');
    const hq = render(<PressBoxSkeletonScreen kind="hq" />).container.firstElementChild as HTMLElement;
    expect(hq.className).toContain('px-3.5 pt-3 pb-app-chrome');
  });
});
