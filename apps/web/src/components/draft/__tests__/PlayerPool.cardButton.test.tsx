// V2-PARITY (2026-08-17) — per-row player-card affordance.
//
// Contract under test:
//   1. When `onShowCard` is provided, every available row renders an
//      info button, and clicking it calls back with THAT row's player
//      (and does NOT select or draft — stopPropagation contract).
//   2. When `onShowCard` is absent (every v1 call site today), no info
//      button renders — the prop is strictly additive.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PlayerPool } from '../PlayerPool';
import type { Player } from '@/services/PlayerService';

const mkPlayer = (id: string, name: string): Player =>
  ({
    id,
    full_name: name,
    position: 'C',
    team: 'COL',
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
  } as unknown as Player);

const baseProps = {
  onPlayerSelect: vi.fn(),
  onPlayerDraft: vi.fn(),
  selectedPlayer: null,
  draftedPlayers: [] as string[],
  isDraftActive: true,
  availablePlayers: [mkPlayer('101', 'Nathan MacKinnon'), mkPlayer('102', 'Cale Makar')],
};

afterEach(cleanup);

describe('PlayerPool — per-row card button (V2-PARITY)', () => {
  it('renders an info button per row and reports the clicked row player', () => {
    const onShowCard = vi.fn();
    const onPlayerSelect = vi.fn();
    render(
      <PlayerPool {...baseProps} onPlayerSelect={onPlayerSelect} onShowCard={onShowCard} />,
    );

    // Both breakpoints render (jsdom applies no media queries), so each
    // player row appears twice (mobile + desktop table). Fire the first.
    const buttons = screen.getAllByTestId('pool-row-card-button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const mackinnonButton = screen
      .getAllByLabelText('View Nathan MacKinnon player card')[0];
    fireEvent.click(mackinnonButton);

    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect(onShowCard.mock.calls[0][0].full_name).toBe('Nathan MacKinnon');
    // stopPropagation contract: the card click must not select the row.
    expect(onPlayerSelect).not.toHaveBeenCalled();
  });

  it('renders NO info button when onShowCard is absent (v1 call sites untouched)', () => {
    render(<PlayerPool {...baseProps} />);
    expect(screen.queryByTestId('pool-row-card-button')).toBeNull();
  });
});
