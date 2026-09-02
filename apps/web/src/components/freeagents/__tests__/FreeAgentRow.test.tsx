// FREE AGENTS, PHONE (2026-09-02).
//
// Measured in Chromium at 393x852 against the real page: the Free Agents
// screen spent its first ~250px on a marketing hero, wrapped its position
// filters onto three lines, and then offered rows carrying a name, a
// position and an add count — nothing a manager could pick a player WITH.
// Search and "See All" landed on a 600px table inside `overflow-x-auto`,
// so the projection was off the right edge of the phone entirely.
//
// FreeAgentRow is the replacement, used by every phone list on the page.
// What this file pins is the row's CONTRACT — the parts a manager reads to
// decide — plus the pure derivations behind it: which transaction the
// button is, what the game line says, and the order the list arrives in.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// The row's game line goes through ScheduleService.getGameInfo (pure), but
// importing that module pulls the API client, whose Supabase client throws at
// module scope under the suite's hermetic (empty) env. Same stub gameDay.test
// uses for the same reason.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

import { FreeAgentRow, type FreeAgentRowPlayer } from '../FreeAgentRow';
import {
  ACTION_GLYPH,
  FA_CHIP_ROW,
  freeAgentAction,
  nextGameLine,
  sortByProjection,
  statusChipFor,
  waiverClearsLabel,
} from '../freeAgentRow';
import type { NHLGame } from '@/services/ScheduleService';

const TODAY = '2026-09-01';

const game = (over: Partial<NHLGame> = {}): NHLGame => ({
  id: 'g1',
  game_id: 1,
  game_date: '2026-09-02',
  game_time: '2026-09-03T01:00:00.000Z',
  home_team: 'EDM',
  away_team: 'BOS',
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 20252026,
  game_type: 'regular',
  ...over,
});

const player = (over: Partial<FreeAgentRowPlayer> = {}): FreeAgentRowPlayer => ({
  id: '8478402',
  full_name: 'Connor McDavid',
  position: 'C',
  team: 'EDM',
  headshot_url: null,
  status: null,
  ...over,
});

const row = (over: Partial<React.ComponentProps<typeof FreeAgentRow>> = {}) =>
  render(
    <FreeAgentRow
      rank={1}
      player={player()}
      projection={34.8}
      games={[game()]}
      todayStr={TODAY}
      action="add"
      onOpen={() => {}}
      onAction={() => {}}
      {...over}
    />,
  );

describe('FreeAgentRow — everything the decision needs, on one 64px line', () => {
  it('prints the rank as a tabular figure', () => {
    row({ rank: 7 });
    const rank = screen.getByTestId('fa-rank');
    expect(rank.textContent).toBe('7');
    // Tabular + jbmono, so the column edge stays straight from 1 to 100.
    expect(rank.className).toMatch(/font-jbmono/);
    expect(rank.className).toMatch(/tabular-nums/);
  });

  it('draws the shared 44px Mug, not a private <img>', () => {
    const { container } = row();
    const mug = container.querySelector('[data-mug-state]') as HTMLElement;
    expect(mug).toBeTruthy();
    // No headshot on file → the crest carries it, in a fixed 44px box.
    expect(mug.className).toContain('w-11 h-11');
    expect(mug.getAttribute('data-mug-state')).toBe('crest');
  });

  it('leads with the name, at the phone scale', () => {
    row();
    const name = screen.getByText('Connor McDavid');
    expect(name.className).toMatch(/text-\[15px\]/);
    expect(name.className).toMatch(/text-pastel-cream/);
  });

  it('wears the status chip only when the player carries a status', () => {
    const clean = row();
    expect(clean.queryByTestId('fa-status-chip')).toBeNull();
    clean.unmount();

    row({ player: player({ status: 'IR' }) });
    expect(screen.getByTestId('fa-status-chip').textContent).toBe('IR');
  });

  it("an 'ACT' player is not a status — no chip for the ordinary case", () => {
    row({ player: player({ status: 'ACT' }) });
    expect(screen.queryByTestId('fa-status-chip')).toBeNull();
  });

  it('reuses the roster position palette rather than inventing a second one', () => {
    row({ player: player({ position: 'LW' }) });
    const chip = screen.getByTestId('fa-position-chip');
    expect(chip.textContent).toBe('LW');
    // The exact pair positionChip.ts documents for LW — sage-soft fill with
    // deep-forest text, which is the whole point of that module.
    expect(chip.className).toContain('bg-pastel-sage-soft');
    expect(chip.className).toContain('text-pastel-forest');
    // ...shrunk to the second line. tailwind-merge drops the 32px geometry.
    expect(chip.className).not.toMatch(/\bw-8\b/);
    expect(chip.className).not.toMatch(/\bh-8\b/);
  });

  it('prints the team and a HOME game as "vs OPP" with the face-off time', () => {
    row();
    expect(screen.getByText('EDM')).toBeTruthy();
    expect(screen.getByTestId('fa-game-line').textContent).toBe('vs BOS');
    expect(screen.getByTestId('fa-game-time').textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
    expect(screen.queryByTestId('fa-no-game')).toBeNull();
  });

  it('prints an AWAY game as "@ OPP"', () => {
    // EDM is the away side, so the opponent is the home team.
    row({ games: [game({ home_team: 'BOS', away_team: 'EDM' })] });
    expect(screen.getByTestId('fa-game-line').textContent).toBe('@ BOS');
  });

  it('says "No game" rather than a placeholder when the week is empty', () => {
    row({ games: [] });
    expect(screen.getByTestId('fa-no-game').textContent).toBe('No game');
    expect(screen.queryByTestId('fa-game-line')).toBeNull();
    // Muted, and never below the readable alpha (dark-theme contrast guard).
    expect(screen.getByTestId('fa-no-game').className).toContain('text-white/55');
  });

  it('makes the projection the headline number: 17px, tabular, one decimal', () => {
    row({ projection: 34.84 });
    const proj = screen.getByTestId('fa-projection');
    expect(proj.textContent).toBe('34.8');
    expect(proj.className).toMatch(/text-\[17px\]/);
    expect(proj.className).toMatch(/font-jbmono/);
    expect(proj.className).toMatch(/tabular-nums/);
  });

  it('puts the roster percentage under the projection when the page has one', () => {
    row({ rosteredPct: 96.4 });
    expect(screen.getByTestId('fa-sub').textContent).toBe('96% ros');
  });

  it('falls back to the caller\'s sub-label when there is no roster percentage', () => {
    row({ subLabel: '3 games' });
    expect(screen.getByTestId('fa-sub').textContent).toBe('3 games');
  });

  it('shows nothing under the projection when the page has neither', () => {
    row();
    expect(screen.queryByTestId('fa-sub')).toBeNull();
  });
});

describe('FreeAgentRow — the button says which transaction the tap is', () => {
  it('add: a plain +', () => {
    row({ action: 'add' });
    const btn = screen.getByTestId('fa-action');
    expect(within(btn).getByText('+')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Add Connor McDavid');
    expect(screen.getByTestId('free-agent-row').dataset.action).toBe('add');
  });

  it('claim: W, and WHEN it clears', () => {
    row({
      action: 'claim',
      player: player({ is_on_waivers: true, waiver_clears_at: '2026-09-03T09:00:00.000Z' }),
    });
    const btn = screen.getByTestId('fa-action');
    expect(within(btn).getByText('W')).toBeTruthy();
    expect(btn.textContent).toMatch(/clears \w{3}/);
    expect(btn.getAttribute('aria-label')).toMatch(/^Claim Connor McDavid — clears \w{3}$/);
  });

  it('claim with no clear time on file: still W, never "Invalid Date"', () => {
    row({ action: 'claim', player: player({ is_on_waivers: true, waiver_clears_at: null }) });
    const btn = screen.getByTestId('fa-action');
    expect(btn.textContent).toBe('W');
    expect(btn.getAttribute('aria-label')).toBe('Claim Connor McDavid');
  });

  it('swap: ⇄, and the label says a drop is coming', () => {
    row({ action: 'swap' });
    const btn = screen.getByTestId('fa-action');
    expect(within(btn).getByText('⇄')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Add Connor McDavid with a drop');
  });

  it('is at least a 44px touch target in every state', () => {
    for (const action of ['add', 'claim', 'swap'] as const) {
      const r = row({ action });
      expect(screen.getByTestId('fa-action').className).toMatch(/min-w-\[44px\]/);
      expect(screen.getByTestId('fa-action').className).toMatch(/\bh-11\b/);
      r.unmount();
    }
  });

  it('this row pending: a spinner, no glyph, and no second tap', () => {
    const onAction = vi.fn();
    row({ pending: true, onAction });
    const btn = screen.getByTestId('fa-action') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('');
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('another row pending: disabled, but still says what it would do', () => {
    row({ disabled: true });
    const btn = screen.getByTestId('fa-action') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('+');
  });
});

describe('FreeAgentRow — the tap targets', () => {
  it('the whole row bar the button opens the player card', () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    row({ onOpen, onAction });
    fireEvent.click(screen.getByText('Connor McDavid'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('opens on Enter and Space, so the row is reachable without a pointer', () => {
    const onOpen = vi.fn();
    row({ onOpen });
    const target = screen.getByTestId('fa-open');
    expect(target.getAttribute('role')).toBe('button');
    expect(target.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyDown(target, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('the button acts, and does NOT also open the card', () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    row({ onOpen, onAction });
    fireEvent.click(screen.getByTestId('fa-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('freeAgentAction — which transaction a tap would be', () => {
  it('a free player with room on the roster is an add', () => {
    expect(freeAgentAction({}, false)).toBe('add');
  });

  it('a full roster turns the add into a swap, BEFORE the tap', () => {
    expect(freeAgentAction({}, true)).toBe('swap');
  });

  it('waivers win over a full roster — the drop is chosen when the claim processes', () => {
    expect(freeAgentAction({ is_on_waivers: true }, true)).toBe('claim');
    expect(freeAgentAction({ is_on_waivers: true }, false)).toBe('claim');
  });

  it('the glyph for each state is the one the row prints', () => {
    expect(ACTION_GLYPH).toEqual({ add: '+', claim: 'W', swap: '⇄' });
  });
});

describe('waiverClearsLabel', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('inside the week: the day name, which is what a manager reasons about', () => {
    expect(waiverClearsLabel('2026-09-03T09:00:00.000Z', now)).toMatch(/^clears \w{3}$/);
  });

  it('beyond the week: a date, because "clears Thu" would be ambiguous', () => {
    expect(waiverClearsLabel('2026-09-20T09:00:00.000Z', now)).toMatch(/^clears \w{3} \d{1,2}$/);
  });

  it('missing or unparseable: nothing, never "Invalid Date"', () => {
    expect(waiverClearsLabel(null, now)).toBeNull();
    expect(waiverClearsLabel(undefined, now)).toBeNull();
    expect(waiverClearsLabel('not a date', now)).toBeNull();
  });
});

describe('nextGameLine — the next game, from the week the page already fetched', () => {
  it('picks the earliest game from today forward, not the first in the array', () => {
    const games = [
      game({ id: 'later', game_date: '2026-09-05', home_team: 'EDM', away_team: 'CGY' }),
      game({ id: 'next', game_date: '2026-09-02', home_team: 'VAN', away_team: 'EDM' }),
    ];
    expect(nextGameLine(games, 'EDM', TODAY)?.opponent).toBe('@ VAN');
  });

  it('a game already played is not the next one', () => {
    const games = [game({ game_date: '2026-08-28' })];
    expect(nextGameLine(games, 'EDM', TODAY)).toBeNull();
  });

  it('a postponed game is no game', () => {
    expect(nextGameLine([game({ status: 'postponed' })], 'EDM', TODAY)).toBeNull();
  });

  it("a fixture the player's team is not in is skipped, never printed as an opponent", () => {
    // Stale schedule rows do reach this list; "vs undefined" is the failure.
    expect(nextGameLine([game({ home_team: 'TOR', away_team: 'BOS' })], 'EDM', TODAY)).toBeNull();
  });

  it('no games, no team: null', () => {
    expect(nextGameLine([], 'EDM', TODAY)).toBeNull();
    expect(nextGameLine(undefined, 'EDM', TODAY)).toBeNull();
    expect(nextGameLine([game()], null, TODAY)).toBeNull();
  });
});

describe('sortByProjection — the phone list default order', () => {
  const p = (full_name: string, weeklyProjection?: number) => ({ full_name, weeklyProjection });

  it('orders by projection, highest first', () => {
    const out = sortByProjection([p('Low', 4), p('High', 30), p('Mid', 12)]);
    expect(out.map((r) => r.full_name)).toEqual(['High', 'Mid', 'Low']);
  });

  it('a missing projection sorts as zero rather than throwing the order out', () => {
    const out = sortByProjection([p('None'), p('Some', 1)]);
    expect(out.map((r) => r.full_name)).toEqual(['Some', 'None']);
  });

  it('ties break on name, so a live projection refresh cannot reshuffle the list', () => {
    const out = sortByProjection([p('Zeller', 10), p('Aho', 10)]);
    expect(out.map((r) => r.full_name)).toEqual(['Aho', 'Zeller']);
  });

  it('does not mutate its input', () => {
    const input = [p('Low', 1), p('High', 9)];
    sortByProjection(input);
    expect(input.map((r) => r.full_name)).toEqual(['Low', 'High']);
  });
});

describe('statusChipFor', () => {
  it('maps the statuses a free agent can carry', () => {
    expect(statusChipFor('IR')?.label).toBe('IR');
    expect(statusChipFor('gtd')?.label).toBe('GTD');
  });

  it('says nothing for an ordinary player or an unknown code', () => {
    expect(statusChipFor(null)).toBeNull();
    expect(statusChipFor('')).toBeNull();
    expect(statusChipFor('Active')).toBeNull();
    // Never print raw database text at 8px beside a player's name.
    expect(statusChipFor('SOME_NEW_CODE')).toBeNull();
  });
});

describe('the position filter row is ONE row that scrolls, never three that wrap', () => {
  // jsdom has no layout engine, so it cannot observe a wrap — this is a
  // source contract on the class string the page applies, the same approach
  // MobileRosterList.statusChip.test.ts takes for a flex-shrink defect.
  // Measured in Chromium at 393x852: seven chips, three lines, 96px of
  // chrome above the first player.
  it('never wraps below lg, and goes back to wrapping at lg', () => {
    expect(FA_CHIP_ROW).toContain('flex-nowrap');
    expect(FA_CHIP_ROW).toContain('lg:flex-wrap');
    // The wrapping class must not be present unprefixed — `flex-wrap` and
    // `flex-nowrap` in the same string is exactly how this regresses.
    expect(FA_CHIP_ROW).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
  });

  it('scrolls sideways, with momentum and no visible scrollbar', () => {
    expect(FA_CHIP_ROW).toContain('overflow-x-auto');
    expect(FA_CHIP_ROW).toContain('scrollbar-hide');
    // `.ios-scroll` is index.css's -webkit-overflow-scrolling: touch.
    expect(FA_CHIP_ROW).toContain('ios-scroll');
    // Without this a flick past the last chip hands the gesture to the page
    // and fires iOS's back-swipe.
    expect(FA_CHIP_ROW).toContain('overscroll-x-contain');
  });

  it('keeps a hidden scrollbar honest: the last chip is never flush with the clip', () => {
    // The 2026-08-19 ArmchairGM finding — a hidden scrollbar with no visual
    // overflow cue hid two whole features. Padding guarantees the next chip
    // peeks past the edge.
    expect(FA_CHIP_ROW).toContain('pr-6');
  });
});
