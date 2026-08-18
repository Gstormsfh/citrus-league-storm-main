/**
 * QUEUE-REACH (2026-08-13) — the star that puts a player in the queue.
 *
 * THE BUG THIS EXISTS FOR. `PlayerPool` has supported the queue since
 * long before v2: it accepts `queue` and `onAddToQueue`, and renders a
 * per-row star. But `onAddToQueue` is OPTIONAL, and the star is gated
 * on it being defined. `DraftRoomV2` never passed it. So the v2 draft
 * room — the room THE TWELVE will actually use — rendered a queue
 * panel whose own empty state says "Click the star icon on players to
 * add them to your queue" beside a pool containing no stars at all.
 *
 * Nothing failed. Every existing test passed, because every existing
 * test rendered `PlayerPool` with its own props rather than the ones
 * the room passes. An absent affordance has no selector to assert on,
 * which is exactly why it survived: you cannot notice the absence of a
 * thing you never looked for. So the first test below asserts a COUNT
 * of zero under the old wiring, and the rest assert the count is
 * non-zero under the new wiring — a count is the only shape of
 * assertion that can see this class of bug.
 *
 * Why it mattered beyond the UI: `set_draft_queue` and the autopick
 * `queueStrategy` both shipped 2026-08-12 and are driven ENTIRELY by
 * this list. With no way to fill it, a manager who misses their clock
 * falls through to projections-only autopick — the precise outcome the
 * queue was built to prevent. The chain was wired end to end except
 * its first inch.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerPool } from '../PlayerPool';
import type { Player } from '@/services/PlayerService';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Mirrors the fixture in PlayerPool.isYourTurn.test.tsx. The desktop
// table reads every stat field unguarded (`.toFixed` on raw values), so
// a sparse fixture crashes the render rather than failing an
// assertion — worth knowing if you extend this file.
const mkPlayer = (id: string, name: string, pos = 'C'): Player => ({
  id,
  full_name: name,
  position: pos,
  eligible_positions: [pos],
  team: 'EDM',
  jersey_number: null,
  status: null,
  headshot_url: null,
  last_updated: null,
  games_played: 82,
  goals: 30,
  assists: 40,
  points: 70,
  plus_minus: 10,
  shots: 200,
  hits: 40,
  blocks: 20,
  xGoals: 28,
  wins: null,
  losses: null,
  ot_losses: null,
  saves: null,
  goals_against_average: null,
  save_percentage: null,
  highDangerSavePct: 0,
  goalsSavedAboveExpected: 0,
});

const PLAYERS = [
  mkPlayer('8478402', 'Connor McDavid'),
  mkPlayer('8477934', 'Leon Draisaitl'),
  mkPlayer('8471675', 'Sidney Crosby'),
];

type Props = React.ComponentProps<typeof PlayerPool>;

function renderPool(over: Partial<Props> = {}) {
  return render(
    <PlayerPool
      onPlayerSelect={vi.fn()}
      onPlayerDraft={vi.fn()}
      selectedPlayer={null}
      draftedPlayers={[]}
      isDraftActive
      availablePlayers={PLAYERS}
      isYourTurn={false}
      isSubmitPending={false}
      {...over}
    />,
  );
}

describe('PlayerPool — the queue affordance', () => {
  it('renders NO queue star when onAddToQueue is omitted (the v2 regression)', () => {
    // This is the state DraftRoomV2 shipped in. Locking it as an
    // explicit expectation means the next person to read this file
    // learns that omitting the prop silently removes the control,
    // rather than discovering it during a live draft.
    renderPool();
    expect(screen.queryAllByTestId('pool-queue-star')).toHaveLength(0);
  });

  it('renders one queue star per player once onAddToQueue is provided', () => {
    renderPool({ onAddToQueue: vi.fn(), queue: [] });
    // Both the mobile card list and the desktop table render rows;
    // jsdom has no viewport so both branches mount. The invariant that
    // matters is "at least one star per player", not the exact count.
    const stars = screen.getAllByTestId('pool-queue-star');
    expect(stars.length).toBeGreaterThanOrEqual(PLAYERS.length);
  });

  it('clicking a star reports THAT player id to the parent', () => {
    const onAddToQueue = vi.fn();
    renderPool({ onAddToQueue, queue: [] });

    fireEvent.click(
      screen.getAllByLabelText('Add Connor McDavid to your queue')[0],
    );

    expect(onAddToQueue).toHaveBeenCalledTimes(1);
    expect(onAddToQueue).toHaveBeenCalledWith('8478402');
  });

  it('does not select or draft the player as a side effect of queuing', () => {
    // The star sits inside the row, and the row is clickable. Both
    // handlers stopPropagation; if that ever regresses, starring a
    // player while on the clock would DRAFT him. That is unrecoverable
    // in a live draft — there is no undo route wired in v2 (KI-012).
    const onPlayerSelect = vi.fn();
    const onPlayerDraft = vi.fn();
    renderPool({
      onAddToQueue: vi.fn(),
      queue: [],
      onPlayerSelect,
      onPlayerDraft,
      isYourTurn: true,
    });

    fireEvent.click(
      screen.getAllByLabelText('Add Leon Draisaitl to your queue')[0],
    );

    expect(onPlayerDraft).not.toHaveBeenCalled();
    expect(onPlayerSelect).not.toHaveBeenCalled();
  });
});

describe('PlayerPool — queued state is legible', () => {
  it('a queued player announces itself as queued, not as "button"', () => {
    // Icon-only controls with no accessible name are announced as
    // bare "button" — indistinguishable from the Draft button beside
    // them. On a clock, that is a real hazard, not a checklist item.
    renderPool({ onAddToQueue: vi.fn(), queue: ['8478402'] });

    const queued = screen.getAllByLabelText(
      'Remove Connor McDavid from your queue',
    );
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('an unqueued player is not marked pressed', () => {
    renderPool({ onAddToQueue: vi.fn(), queue: ['8478402'] });

    const notQueued = screen.getAllByLabelText(
      'Add Sidney Crosby to your queue',
    );
    expect(notQueued[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('every star is reachable by name — no unnamed queue controls', () => {
    renderPool({ onAddToQueue: vi.fn(), queue: [] });
    for (const star of screen.getAllByTestId('pool-queue-star')) {
      expect(star.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
