// Mobile score stack lock (2026-09-01, audit items M5 + M6).
//
// On a phone the matchup row used to show ONE number, forced orange by an
// !important rule in index.css whether it was a projection or a final
// score, under an 8px label, pinned to the right of BOTH cards — so the
// left card's number sat at the gutter and the right card's at the screen
// edge. This pins the replacement:
//
//   * one colour pair app-wide: sage = happened (live/final), orange =
//     forecast — the same "sage = ahead" the ScoreCard uses;
//   * once a game is live/final the actual (15px mono) stacks over
//     "proj 4.2" (10px, /55) so beat/miss reads at a glance;
//   * the opponent card is mirrored — its stack is left-aligned, at the
//     gutter (the stylesheet reverses the row; the DOM carries the intent);
//   * every label is >= 10px;
//   * bench rows: opacity-70, no grayscale, no full-card "BENCHED" overlay,
//     cream (stateless) number.
//
// jsdom has no cascade; these are DOM/class contracts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import type { MatchupPlayer } from '../types';
import type { NHLGame } from '@/services/ScheduleService';

// A date safely in the future so nothing is "past" and nothing is "today".
const DATE = '2099-03-01';

const game = (over: Partial<NHLGame> = {}): NHLGame => ({
  id: 'g1',
  game_id: 1,
  game_date: DATE,
  game_time: '19:00',
  home_team: 'TOR',
  away_team: 'BOS',
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 2026,
  game_type: 'regular',
  ...over,
});

const player = (over: Partial<MatchupPlayer> = {}): MatchupPlayer => ({
  id: 1,
  name: 'Auston Matthews',
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 1,
  status: null,
  isStarter: true,
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
  games: [game()],
  gameInfo: { opponent: 'vs BOS', time: '7:00 PM' },
  ...over,
});

const projection = (pts: number): NonNullable<MatchupPlayer['daily_projection']> => ({
  total_projected_points: pts,
  projected_goals: 0.4,
  projected_assists: 0.5,
  projected_sog: 3.2,
  projected_blocks: 0.5,
  projected_xg: 0.4,
  base_ppg: 4,
  shrinkage_weight: 1,
  finishing_multiplier: 1,
  opponent_adjustment: 1,
  b2b_penalty: 1,
  home_away_adjustment: 1,
  confidence_score: 0.7,
  calculation_method: 'test',
});

// The projection / breakdown popovers fall back to a Radix Tooltip on their
// first render (before the viewport hook resolves), and Radix requires the
// provider App.tsx supplies.
const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const stack = (container: HTMLElement) => container.querySelector('.player-mobile-score') as HTMLElement;
const value = (container: HTMLElement) => container.querySelector('.player-score-value') as HTMLElement | null;

let originalWidth: number;
beforeEach(() => {
  originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
});
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth });
});

describe('PlayerCard — mobile score stack: states', () => {
  it('yet to play: the projection in orange, labelled proj', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam selectedDate={DATE} />,
    );
    const v = value(container)!;
    expect(v.textContent).toBe('4.2');
    expect(v.className).toContain('text-pastel-orange');
    expect(v.className).not.toContain('text-pastel-sage');
    expect(v.className).toContain('font-jbmono');
    expect(v.className).toContain('text-[15px]');
    expect(stack(container).textContent).toContain('proj');
  });

  it('live: the actual in sage stacked over "proj 4.2"', () => {
    const { container } = render(
      <PlayerCard
        player={player({
          games: [game({ status: 'live', home_score: 2, away_score: 1, period: '2nd' })],
          daily_total_points: 6.5,
          daily_projection: projection(4.2),
        })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    const v = value(container)!;
    expect(v.textContent).toBe('6.5');
    expect(v.className).toContain('text-pastel-sage');
    expect(v.className).not.toContain('text-pastel-orange');
    const proj = container.querySelector('.player-score-proj')!;
    expect(proj.textContent).toBe('proj 4.2');
    expect(proj.className).toContain('text-[10px]');
    expect(proj.className).toContain('text-white/55');
    // The live score line the row already carried is still there (K12).
    expect(container.textContent).toContain('TOR 2-1, 2nd');
  });

  it('final: same pair — actual sage over proj; a zero is still a real number', () => {
    const { container } = render(
      <PlayerCard
        player={player({
          games: [game({ status: 'final', home_score: 3, away_score: 4 })],
          daily_total_points: 0,
          daily_projection: projection(3.1),
        })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    expect(value(container)!.textContent).toBe('0.0');
    expect(value(container)!.className).toContain('text-pastel-sage');
    expect(container.querySelector('.player-score-proj')!.textContent).toBe('proj 3.1');
    expect(stack(container).textContent).not.toContain('Daily');
  });

  it('final with no projection on file: the status word replaces the proj line', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ status: 'final', home_score: 1, away_score: 0 })], daily_total_points: 2 })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    expect(value(container)!.textContent).toBe('2.0');
    expect(container.querySelector('.player-score-label')!.textContent).toBe('final');
  });

  it('live with no projection on file: says live', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ status: 'live', period: '1st' })], daily_total_points: 0 })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    expect(container.querySelector('.player-score-label')!.textContent).toBe('live');
  });

  it('the actual number keeps its scoring-breakdown tap (PointsTooltip)', () => {
    const { container } = render(
      <PlayerCard
        player={player({
          games: [game({ status: 'final', home_score: 3, away_score: 1 })],
          daily_total_points: 7.5,
          daily_stats_breakdown: { goals: { count: 1, points: 6 }, sog: { count: 2, points: 1.5 } },
        })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    const v = value(container)!;
    expect(v.textContent).toBe('7.5');
    expect(v.className).toContain('text-pastel-sage');
    // Wrapped in the popover trigger, not a bare span.
    expect(v.closest('button')).toBeTruthy();
  });

  it('no game on the date: says so instead of 0.0', () => {
    const { container } = render(
      <PlayerCard player={player({ games: [] })} isUserTeam selectedDate={DATE} />,
    );
    expect(stack(container).textContent).toBe('No game');
    expect(value(container)).toBeNull();
  });

  it('game but no projection yet: TBD under a proj label', () => {
    const { container } = render(<PlayerCard player={player()} isUserTeam selectedDate={DATE} />);
    expect(container.querySelector('.player-score-tbd')!.textContent).toBe('TBD');
    expect(container.querySelector('.player-score-label')!.textContent).toBe('proj');
  });

  it('dropped-but-counting players keep their Dropped badge', () => {
    render(
      <PlayerCard
        player={player({ wasDropped: true, games: [game({ status: 'final' })], daily_total_points: 3 })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    expect(screen.getByText('Dropped')).toBeTruthy();
  });

  it('every label in the stack is at least 10px', () => {
    const cases = [
      player({ daily_projection: projection(4.2) }),
      player({ games: [game({ status: 'live' })], daily_total_points: 1, daily_projection: projection(4.2) }),
      player({ games: [game({ status: 'final' })], daily_total_points: 1 }),
      player(),
      player({ games: [] }),
    ];
    for (const p of cases) {
      const { container, unmount } = render(<PlayerCard player={p} isUserTeam selectedDate={DATE} />);
      for (const el of Array.from(stack(container).querySelectorAll('*'))) {
        for (const m of el.className.toString().matchAll(/text-\[(\d+)px\]/g)) {
          expect(Number(m[1]), `${el.className} in stack`).toBeGreaterThanOrEqual(10);
        }
      }
      unmount();
    }
  });
});

describe('PlayerCard — mirrored sides', () => {
  it('the user card stacks toward the gutter on its right; the opponent card on its left', () => {
    const mine = render(<PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam selectedDate={DATE} />);
    const theirs = render(
      <PlayerCard player={player({ id: 2, daily_projection: projection(3.3) })} isUserTeam={false} selectedDate={DATE} />,
    );

    const mineStack = stack(mine.container);
    const theirStack = stack(theirs.container);
    expect(mineStack.className).toContain('items-end');
    expect(mineStack.getAttribute('data-side')).toBe('user');
    expect(theirStack.className).toContain('items-start');
    expect(theirStack.getAttribute('data-side')).toBe('opponent');

    // The cards carry the side classes the stylesheet mirrors on.
    expect(mine.container.firstElementChild!.className).toContain('user-team');
    expect(theirs.container.firstElementChild!.className).toContain('opponent-team');
    // Same DOM order on both sides (content, then stack) — the reversal is
    // the stylesheet's row-reverse, pinned in matchupMobileRowsGuard.
    const theirCard = theirs.container.firstElementChild!;
    expect(theirCard.lastElementChild!.className).toContain('player-mobile-score');
    // The meta row is addressable so the opponent copy can right-align.
    expect(theirs.container.querySelector('.player-meta-row')).toBeTruthy();
  });
});

describe('PlayerCard — bench', () => {
  it('bench rows are subdued but legible: opacity-70, no grayscale, no overlay', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ status: 'final' })], daily_total_points: 8.2, daily_projection: projection(4) })}
        isUserTeam
        isBench
        selectedDate={DATE}
      />,
    );
    const card = container.firstElementChild!;
    expect(card.className).toContain('opacity-70');
    expect(card.className).not.toContain('grayscale');
    expect(card.className).not.toContain('opacity-40');
    expect(container.textContent).not.toContain('BENCHED');
    expect(container.textContent).not.toContain("don't count");
    // Muted points: no state colour on a number that does not count.
    const v = value(container)!;
    expect(v.textContent).toBe('8.2');
    expect(v.className).toContain('text-pastel-cream');
    expect(v.className).not.toContain('text-pastel-sage');
    expect(v.className).not.toContain('text-pastel-orange');
  });

  it('a benched projection is cream too', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(4) })} isUserTeam isBench selectedDate={DATE} />,
    );
    expect(value(container)!.className).toContain('text-pastel-cream');
  });
});

describe('PlayerCard — empty slot', () => {
  it('says Empty (the chip names the slot) on both sides', () => {
    const mine = render(<PlayerCard player={null} isUserTeam />);
    const theirs = render(<PlayerCard player={null} isUserTeam={false} />);
    expect(mine.container.querySelector('.player-name')!.textContent).toBe('Empty');
    expect(theirs.container.querySelector('.player-name')!.textContent).toBe('Empty');
    expect(mine.container.textContent).not.toContain('Empty Slot');
    expect(mine.container.firstElementChild!.className).toContain('player-card-empty');
    expect(theirs.container.firstElementChild!.className).toContain('opponent-team');
  });
});
