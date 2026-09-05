// DR-3.1 (2026-07-29) — PlayerPool `isYourTurn` gate tests.
//
// Contract: when the caller is on the clock, EVERY available row gets
// an inline Draft button (no select-first step required). When
// off-clock, the button only shows after selection (original v1
// behavior). This test asserts the exact toggle:
//
//   isYourTurn=true  + isDraftActive=true → Draft button on every row
//   isYourTurn=false + isDraftActive=true → no Draft button until selected
//   isYourTurn=true  + isDraftActive=false → no Draft button (paused/complete)
//   drafted player                        → no Draft button ever

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PlayerPool } from '../PlayerPool';
import type { Player } from '@/services/PlayerService';

afterEach(() => {
  cleanup();
});

function mkPlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    full_name: `Player ${id}`,
    position: 'C',
    eligible_positions: ['C'],
    team: 'BOS',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 10,
    goals: 5,
    assists: 5,
    points: 10,
    plus_minus: 0,
    shots: 20,
    hits: 5,
    blocks: 3,
    xGoals: 4,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    ...over,
  };
}

const POOL = [
  mkPlayer('101', { full_name: 'Alpha' }),
  mkPlayer('102', { full_name: 'Bravo' }),
  mkPlayer('103', { full_name: 'Charlie' }),
];

// PlayerPool renders BOTH the mobile card layout AND the desktop
// table layout in the DOM simultaneously (responsive CSS hides one at
// a time via media queries; jsdom sees both). So every "row" appears
// twice — button counts are multiplied by 2.
const LAYOUTS = 2;

describe('PlayerPool — isYourTurn inline Draft button gate (DR-3.1 F8 fix)', () => {
  it('renders an inline Draft button on every non-drafted row when isYourTurn=true', () => {
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={null}
        draftedPlayers={[]}
        isDraftActive={true}
        availablePlayers={POOL}
        isYourTurn={true}
      />,
    );
    const buttons = screen.getAllByTestId('pool-row-draft-button');
    expect(buttons.length).toBe(POOL.length * LAYOUTS);
  });

  // THE VERB ON EVERY ROW (2026-09-05): the phone row draws Draft on every
  // undrafted row and is LIVE only on the turn — off it the button is
  // disabled and titled "Not your turn". The desktop table keeps the
  // original gate (buttons only on the turn or the selected row).
  const phoneButtons = () =>
    screen.getAllByTestId('pool-row-draft-button').filter((b) => b.closest('[data-testid="draft-pool-row"]'));
  const desktopButtons = () =>
    screen.queryAllByTestId('pool-row-draft-button').filter((b) => !b.closest('[data-testid="draft-pool-row"]'));

  it('off the turn with nothing selected: every phone row shows a dimmed, inert Draft; the desktop table shows none', () => {
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={null}
        draftedPlayers={[]}
        isDraftActive={true}
        availablePlayers={POOL}
        isYourTurn={false}
      />,
    );
    const phone = phoneButtons();
    expect(phone.length).toBe(POOL.length);
    for (const b of phone) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('Not your turn');
    }
    expect(desktopButtons().length).toBe(0);
  });

  it('off the turn a selected row is not a live button on the phone (the turn is the only gate)', () => {
    const selected = POOL[1];
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={selected}
        draftedPlayers={[]}
        isDraftActive={true}
        availablePlayers={POOL}
        isYourTurn={false}
      />,
    );
    expect(phoneButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    // The desktop table keeps v1's select-first affordance: one row.
    expect(desktopButtons().length).toBe(1);
  });

  it('with the draft not active nothing is live, on either layout', () => {
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={null}
        draftedPlayers={[]}
        isDraftActive={false}
        availablePlayers={POOL}
        isYourTurn={true}
      />,
    );
    expect(phoneButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(desktopButtons().length).toBe(0);
  });

  // DR-4 F11 fix (2026-07-30) — isSubmitPending guard.
  it('disables inline Draft buttons and shows "Submitting…" when isSubmitPending=true', () => {
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={null}
        draftedPlayers={[]}
        isDraftActive={true}
        availablePlayers={POOL}
        isYourTurn={true}
        isSubmitPending={true}
      />,
    );
    const buttons = screen.getAllByTestId(
      'pool-row-draft-button',
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(POOL.length * LAYOUTS);
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toContain('Submitting…');
    }
  });

  it('does NOT render Draft button on drafted rows even when isYourTurn=true', () => {
    render(
      <PlayerPool
        onPlayerSelect={vi.fn()}
        onPlayerDraft={vi.fn()}
        selectedPlayer={null}
        // Mark player 102 as drafted.
        draftedPlayers={['102']}
        isDraftActive={true}
        availablePlayers={POOL}
        isYourTurn={true}
      />,
    );
    // 3 players total, 1 drafted → 2 remaining * both layouts = 4 buttons.
    expect(screen.getAllByTestId('pool-row-draft-button').length).toBe(2 * LAYOUTS);
  });
});
