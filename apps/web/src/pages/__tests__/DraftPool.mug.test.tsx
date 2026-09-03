// ONE FACE ON BOTH HALVES OF THE DRAFT POOL (2026-09-03 headshot audit).
//
// The phone list under `md` was rebuilt on 2026-09-02 as `DraftPoolRow` and
// draws the shared `Mug`. The desktop table above it never was: it kept a
// hand-rolled <img> whose onError set `display: none` on itself. Two
// consequences, both in the room where a manager is on the clock:
//
//   * a headshot the CDN refuses leaves NO face at all, and the sticky name
//     column reflows around the hole;
//   * a player the directory has no headshot for renders nothing, so the
//     same list shows a face for some rows and a gap for others.
//
// `Mug` answers both: headshot -> team crest -> initials, a fixed box that
// never moves, and the failure remembered per URL so a later enrichment gets
// its own attempt. Free Agents shipped the identical defect and this is the
// same fix it got.
//
// This file lives in pages/__tests__ beside the other draft-room tests
// because the pool is a draft-room surface; it renders the real `PlayerPool`
// rather than asserting on its source, so the assertion is about what a
// manager sees.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { PlayerPool } from '@/components/draft/PlayerPool';
import { teamCrestUrl } from '@/components/roster/headshot';
import type { Player } from '@/services/PlayerService';

const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/COL/8477492.png';

const mkPlayer = (id: string, name: string, over: Partial<Player> = {}): Player =>
  ({
    id,
    full_name: name,
    position: 'C',
    team: 'COL',
    headshot_url: MUG,
    games_played: 82,
    points: 100,
    goals: 40,
    assists: 60,
    plus_minus: 12,
    ppp: 30,
    shp: 1,
    shots: 250,
    hits: 40,
    blocks: 30,
    pim: 20,
    xGoals: 35.5,
    icetime_seconds: 82 * 20 * 60,
    ...over,
  } as unknown as Player);

const baseProps = {
  onPlayerSelect: vi.fn(),
  onPlayerDraft: vi.fn(),
  selectedPlayer: null,
  draftedPlayers: [] as string[],
  isDraftActive: true,
};

/**
 * The desktop table's row for a player. jsdom applies no media queries, so
 * the phone list renders alongside it and every player appears twice; the
 * <tr> is the half this file is about.
 */
const desktopRow = (name: string) =>
  (screen.getAllByText(name).map((n) => n.closest('tr')).find(Boolean)) as HTMLElement;

afterEach(cleanup);

describe('the desktop pool row wears the shared Mug', () => {
  it('draws the headshot the directory carries', () => {
    render(
      <PlayerPool {...baseProps} availablePlayers={[mkPlayer('101', 'Nathan MacKinnon')]} />,
    );
    const row = desktopRow('Nathan MacKinnon');
    const img = within(row).getByAltText('Nathan MacKinnon') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('a failed headshot is REPLACED by the crest, not hidden', () => {
    // The exact regression: `onError` used to set display:none, so the row
    // lost its face and the name column shifted left.
    render(
      <PlayerPool {...baseProps} availablePlayers={[mkPlayer('101', 'Nathan MacKinnon')]} />,
    );
    const row = desktopRow('Nathan MacKinnon');
    fireEvent.error(within(row).getByAltText('Nathan MacKinnon'));

    expect(within(row).queryByAltText('Nathan MacKinnon')).toBeNull();
    expect(row.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('crest');
    expect((within(row).getByAltText('COL') as HTMLImageElement).getAttribute('src')).toBe(
      teamCrestUrl('COL'),
    );
    // And nothing in the row is hiding itself.
    expect(row.querySelector('[style*="display: none"]')).toBeNull();
  });

  it('a player with no headshot on file still gets a face', () => {
    render(
      <PlayerPool
        {...baseProps}
        availablePlayers={[mkPlayer('102', 'Cale Makar', { headshot_url: null })]}
      />,
    );
    const row = desktopRow('Cale Makar');
    expect(row.querySelector('[data-mug-state]')?.getAttribute('data-mug-state')).toBe('crest');
  });

  it('falls all the way to initials when the crest fails too', () => {
    render(
      <PlayerPool
        {...baseProps}
        availablePlayers={[mkPlayer('102', 'Cale Makar', { headshot_url: null })]}
      />,
    );
    const row = desktopRow('Cale Makar');
    fireEvent.error(within(row).getByAltText('COL'));
    expect(within(row).getByRole('img', { name: 'Cale Makar' }).textContent).toBe('CM');
    expect(row.querySelector('img')).toBeNull();
  });
});
