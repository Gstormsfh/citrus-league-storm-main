// Roster row headshots (2026-09-01, audit R3).
//
// The phone roster row showed the team crest where Sleeper shows the face,
// although `player.image` was on every row already (the desktop card and the
// swap sheet used it). What this pins:
//
//   * the row's picture is the Mug: headshot with alt = player name, lazy +
//     async, in the same 28px box the crest occupied, with the crest as a
//     14px badge;
//   * crest → initials when the CDN fails, never a broken image;
//   * DOM order chip · mug · name, so the eye lands on face → name → number;
//   * the locked chip (audit R5) is untouched — no overlay returns with the
//     picture, and the row stays fully legible.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import MobileRosterList from '../MobileRosterList';
import { teamCrestUrl } from '../headshot';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png';

const mk = (id: string, name: string, position: string, over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({ id, name, position, number: 97, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {}, image: MUG, ...over }) as HockeyPlayer;

const MCDAVID = mk('1', 'Connor McDavid', 'C');
const DRAISAITL = mk('2', 'Leon Draisaitl', 'C', { image: undefined });
const PANARIN = mk('6', 'Artemi Panarin', 'LW', { image: undefined, team: 'New York Rangers', teamAbbreviation: undefined });

const ASSIGN: Record<string, string> = { '1': 'slot-C-1', '2': 'slot-C-2' };

function renderList(over: Partial<React.ComponentProps<typeof MobileRosterList>> = {}) {
  return render(
    <MobileRosterList
      starters={[MCDAVID, DRAISAITL]}
      bench={[PANARIN]}
      ir={[]}
      slotAssignments={ASSIGN}
      positionType="individual"
      {...over}
    />,
  );
}

/** The row is the nearest `flex items-center gap-2.5` ancestor of the name. */
const rowFor = (name: string) => screen.getByText(name).closest('div.flex.items-center.gap-2\\.5') as HTMLElement;

describe('the roster row wears the headshot', () => {
  it('renders the mug with alt = player name, lazy + async, 28px, crest badge', () => {
    renderList();
    const row = rowFor('Connor McDavid');
    const mug = row.querySelector('[data-mug-state]') as HTMLElement;
    expect(mug).toBeTruthy();
    expect(mug.className).toContain('w-7 h-7');
    expect(mug.getAttribute('data-mug-state')).toBe('image');
    const img = within(row).getByAltText('Connor McDavid') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(within(row).getByTestId('mug-crest-badge').getAttribute('src')).toBe(teamCrestUrl('EDM'));
  });

  it('the old crest-in-a-circle is gone — the crest is the badge, not the picture', () => {
    renderList();
    const row = rowFor('Connor McDavid');
    // Only the badge carries the crest URL; nothing else on the row is an <img>.
    const imgs = Array.from(row.querySelectorAll('img'));
    expect(imgs.length).toBe(2);
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['Connor McDavid', '']);
  });

  it('a row with no headshot on file shows the crest, and one with no team either shows initials', () => {
    renderList();
    const dr = rowFor('Leon Draisaitl');
    expect((dr.querySelector('[data-mug-state]') as HTMLElement).getAttribute('data-mug-state')).toBe('crest');
    expect(within(dr).getByAltText('EDM').getAttribute('src')).toBe(teamCrestUrl('EDM'));
    expect(within(dr).queryByTestId('mug-crest-badge')).toBeNull();

    const pa = rowFor('Artemi Panarin');
    expect((pa.querySelector('[data-mug-state]') as HTMLElement).getAttribute('data-mug-state')).toBe('initials');
    expect(pa.querySelector('img')).toBeNull();
    expect(within(pa).getByRole('img', { name: 'Artemi Panarin' }).textContent).toBe('AP');
  });

  it('a headshot that fails falls back to the crest, then to initials — never a broken image', () => {
    renderList();
    const row = rowFor('Connor McDavid');
    fireEvent.error(within(row).getByAltText('Connor McDavid'));
    expect(within(row).queryByAltText('Connor McDavid')).toBeNull();
    expect(within(row).getByAltText('EDM')).toBeTruthy();
    fireEvent.error(within(row).getByAltText('EDM'));
    expect(row.querySelector('img')).toBeNull();
    expect(within(row).getByRole('img', { name: 'Connor McDavid' }).textContent).toBe('CM');
  });

  it('runs chip · face · name, left to right', () => {
    renderList();
    const row = rowFor('Connor McDavid');
    const chip = row.querySelector('[class*="w-8 h-8"]') as HTMLElement;
    const mug = row.querySelector('[data-mug-state]') as HTMLElement;
    expect(chip.nextElementSibling).toBe(mug);
    expect(mug.nextElementSibling!.contains(screen.getByText('Connor McDavid'))).toBe(true);
  });

  it('an empty row has no picture', () => {
    renderList();
    const empty = screen.getByRole('button', { name: /Empty LW1, tap to fill/ });
    expect(empty.querySelector('[data-mug-state]')).toBeNull();
    expect(empty.querySelector('img')).toBeNull();
  });

  it('a locked player keeps the locked chip and a fully legible row, mug included', () => {
    renderList({ lockedPlayerIds: new Set(['1']) });
    const row = rowFor('Connor McDavid');
    const chip = row.querySelector('[class*="w-8 h-8"]') as HTMLElement;
    expect(chip.getAttribute('data-locked')).toBe('true');
    expect(within(chip).getByTestId('chip-lock')).toBeTruthy();
    expect(row.className).not.toMatch(/opacity-/);
    expect(row.querySelector('[class*="opacity-60"]')).toBeNull();
    // No lock glyph is drawn over the picture any more — the chip carries it.
    const mug = row.querySelector('[data-mug-state]') as HTMLElement;
    expect(mug.querySelector('svg')).toBeNull();
    expect(within(row).getByAltText('Connor McDavid')).toBeTruthy();
  });
});
