// Matchup row headshots (2026-09-01, audit M4).
//
// A phone matchup row carried no face — `MatchupPlayer` had no image field
// and the service dropped it at the transform. What this pins:
//
//   * every populated card renders the Mug with the player's `image`, alt =
//     player name, lazy + async; crest → initials when the CDN fails;
//   * the mug is a mobile-only (`lg:hidden`) element placed immediately
//     BEFORE the score stack on BOTH cards — one DOM order, mirrored by the
//     stylesheet's row-reverse (pinned in matchupMobileRowsGuard) — so the
//     row reads name · face · number into the slot chip on either side;
//   * the score stack stays the card's last child (the stack test's own
//     contract) and its proj line still reads "proj 4.2";
//   * an empty slot has no mug, and the desktop card gets none.
//
// jsdom has no cascade; these are DOM/class contracts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import type { MatchupPlayer } from '../types';
import type { NHLGame } from '@/services/ScheduleService';
import { teamCrestUrl } from '@/components/roster/headshot';

const DATE = '2099-03-01';
const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/TOR/8479318.png';

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
  image: MUG,
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

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
const mug = (container: HTMLElement) => container.querySelector('.player-mug') as HTMLElement | null;
const stack = (container: HTMLElement) => container.querySelector('.player-mobile-score') as HTMLElement;

let originalWidth: number;
beforeEach(() => {
  originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
});
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth });
});

describe('PlayerCard — the mobile mug', () => {
  it('renders the headshot: alt is the player name, lazy, async, 28px, mobile only', () => {
    const { container } = render(<PlayerCard player={player()} isUserTeam selectedDate={DATE} />);
    const el = mug(container)!;
    expect(el).toBeTruthy();
    expect(el.className).toContain('lg:hidden');
    expect(el.className).toContain('w-7 h-7');
    const img = screen.getByAltText('Auston Matthews') as HTMLImageElement;
    expect(el.contains(img)).toBe(true);
    expect(img.getAttribute('src')).toBe(MUG);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    // The team crest rides on the mug's shoulder.
    expect(screen.getByTestId('mug-crest-badge').getAttribute('src')).toBe(teamCrestUrl('TOR'));
  });

  it('falls back to the crest when the headshot fails, then to initials', () => {
    const { container } = render(<PlayerCard player={player()} isUserTeam selectedDate={DATE} />);
    fireEvent.error(screen.getByAltText('Auston Matthews'));
    expect(screen.queryByAltText('Auston Matthews')).toBeNull();
    expect(mug(container)!.getAttribute('data-mug-state')).toBe('crest');
    expect(screen.getByAltText('TOR').getAttribute('src')).toBe(teamCrestUrl('TOR'));
    fireEvent.error(screen.getByAltText('TOR'));
    expect(mug(container)!.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Auston Matthews' }).textContent).toBe('AM');
  });

  it('with no image on the payload, the crest carries the row; with no team either, initials', () => {
    const crestOnly = render(<PlayerCard player={player({ image: undefined })} isUserTeam selectedDate={DATE} />);
    expect(mug(crestOnly.container)!.getAttribute('data-mug-state')).toBe('crest');
    expect(screen.getByAltText('TOR')).toBeTruthy();
    crestOnly.unmount();

    const bare = render(
      <PlayerCard player={player({ image: undefined, team: '' })} isUserTeam selectedDate={DATE} />,
    );
    expect(mug(bare.container)!.getAttribute('data-mug-state')).toBe('initials');
    expect(bare.container.querySelector('.player-mug img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Auston Matthews' }).textContent).toBe('AM');
  });

  it('sits immediately before the score stack on BOTH cards — the side is the stylesheet mirror', () => {
    const mine = render(<PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam selectedDate={DATE} />);
    const theirs = render(
      <PlayerCard player={player({ id: 2, name: 'David Pastrnak', team: 'BOS', daily_projection: projection(3.3) })} isUserTeam={false} selectedDate={DATE} />,
    );
    for (const [r, side] of [[mine, 'user-team'], [theirs, 'opponent-team']] as const) {
      const card = r.container.firstElementChild!;
      expect(card.className).toContain(side);
      const m = mug(r.container)!;
      expect(m.parentElement).toBe(card);
      expect(m.nextElementSibling).toBe(stack(r.container));
      // The stack keeps its own contract: last child of the card.
      expect(card.lastElementChild!.className).toContain('player-mobile-score');
      // The name block precedes the mug: name · face · number.
      expect(m.previousElementSibling!.className).toContain('player-card-content');
    }
    expect(screen.getByAltText('David Pastrnak')).toBeTruthy();
    expect(screen.getByAltText('Auston Matthews')).toBeTruthy();

    // The crest badge faces the gutter on both sides: bottom-right on the
    // user card, bottom-left on the mirrored opponent card.
    const mineBadge = mine.container.querySelector('[data-testid="mug-crest-badge"]')!;
    const theirBadge = theirs.container.querySelector('[data-testid="mug-crest-badge"]')!;
    expect(mineBadge.getAttribute('data-side')).toBe('right');
    expect(mineBadge.className).toContain('-right-0.5');
    expect(theirBadge.getAttribute('data-side')).toBe('left');
    expect(theirBadge.className).toContain('-left-0.5');
    expect(theirBadge.className).not.toContain('-right-0.5');
  });

  it('an empty slot has no mug', () => {
    const { container } = render(<PlayerCard player={null} isUserTeam />);
    expect(mug(container)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('the bench mug is the same element — the card, not the mug, is what dims', () => {
    const { container } = render(<PlayerCard player={player()} isUserTeam isBench selectedDate={DATE} />);
    expect(mug(container)).toBeTruthy();
    expect(mug(container)!.className).not.toMatch(/opacity-/);
    expect(container.firstElementChild!.className).toContain('opacity-70');
  });
});

describe('PlayerCard — the score column beside the mug', () => {
  it('the live proj line is label over number and still reads "proj 4.2"', () => {
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
    const proj = container.querySelector('.player-score-proj')!;
    expect(proj.textContent).toBe('proj 4.2');
    expect(proj.className).toContain('flex-col');
    expect(proj.children.length).toBe(2);
    expect(proj.children[0].textContent).toBe('proj');
    expect(proj.children[1].textContent).toBe('4.2');
  });

  it('exactly one mug and one stack per populated card', () => {
    const { container } = render(<PlayerCard player={player({ daily_projection: projection(4.2) })} isUserTeam selectedDate={DATE} />);
    expect(container.querySelectorAll('.player-mug').length).toBe(1);
    expect(container.querySelectorAll('.player-mobile-score').length).toBe(1);
  });
});
