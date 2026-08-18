/**
 * QUEUE (2026-08-12) — server persistence for the draft queue.
 *
 * Until today `DraftQueue` wrote `localStorage['draft-queue-<leagueId>']`
 * and nothing on the server ever read it. `draft_queues` existed, with
 * correct RLS, holding zero rows. So the one moment a queue is FOR — the
 * manager is away, their clock expires, autopick fires — was the one
 * moment it did nothing.
 *
 * The single most important test in this file is the FIRST one.
 *
 * `queue` starts as `[]`. The save effect runs on first render. Without
 * the `hydrated` gate it would fire `set_draft_queue(teamId, [])` about
 * 600ms after the manager opens the draft room — DELETING the queue they
 * spent the previous evening building. The feature would have destroyed
 * the exact data it exists to protect, silently, on the happy path.
 *
 * The rest cover the seams: a v1 room with no teamId must not regress to
 * a broken state, a server read failure must fall back rather than lose
 * the queue, and a UUID player id must never be cast into the INTEGER
 * column (KI-042).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DraftQueue } from '../DraftQueue';
import type { Player } from '@/services/PlayerService';

// ── Supabase double ───────────────────────────────────────────────────
// Typed with its real signature. A bare `vi.fn(async () => ...)` infers
// a 0-arg call signature, so `rpcSpy.mock.calls` becomes `[]` and every
// destructure of [fn, args] below is a type error — which is exactly
// what tsc caught. The args ARE the assertion here, so they must be typed.
const rpcSpy = vi.fn(
  async (_fn: string, _args: { p_team_id: string; p_player_ids: number[] }) => ({
    data: 0,
    error: null as { message?: string } | null,
  }),
);
const orderSpy = vi.fn();
let serverRows: Array<{ player_id: number; position: number }> = [];
let serverError: { message: string } | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (...args: unknown[]) => {
            orderSpy(...args);
            return Promise.resolve(
              serverError
                ? { data: null, error: serverError }
                : { data: serverRows, error: null },
            );
          },
        }),
      }),
    }),
    rpc: (fn: string, args: { p_team_id: string; p_player_ids: number[] }) =>
      rpcSpy(fn, args),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const LEAGUE = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM = 'bbbbbbbb-0000-4000-8000-000000000002';

const player = (id: string, name: string): Player =>
  ({
    id,
    full_name: name,
    position: 'C',
    team: 'EDM',
  }) as unknown as Player;

const PLAYERS = [
  player('8478402', 'Connor McDavid'),
  player('8477934', 'Leon Draisaitl'),
];

function renderQueue(over: Partial<React.ComponentProps<typeof DraftQueue>> = {}) {
  const onQueueChange = vi.fn();
  const utils = render(
    <DraftQueue
      queue={[]}
      players={PLAYERS}
      draftedPlayers={[]}
      onQueueChange={onQueueChange}
      onDraftFromQueue={vi.fn()}
      isDraftActive
      isYourTurn={false}
      leagueId={LEAGUE}
      teamId={TEAM}
      {...over}
    />,
  );
  return { ...utils, onQueueChange };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  rpcSpy.mockClear();
  orderSpy.mockClear();
  serverRows = [];
  serverError = null;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DraftQueue — the wipe hazard', () => {
  it('NEVER writes an empty queue to the server before the restore lands', async () => {
    // The regression this whole gate exists for. A manager with a saved
    // queue opens the room; `queue` is [] for the first render. If the
    // debounced save fires against that empty initial state, their queue
    // is gone.
    serverRows = [
      { player_id: 8478402, position: 1 },
      { player_id: 8477934, position: 2 },
    ];

    const { onQueueChange } = renderQueue();

    // Push well past the debounce window.
    await vi.advanceTimersByTimeAsync(3000);

    const emptyWrites = rpcSpy.mock.calls.filter(
      ([, args]) =>
        (args as { p_player_ids: number[] }).p_player_ids.length === 0,
    );
    expect(emptyWrites).toHaveLength(0);

    // And it did restore what the server held, in order.
    await waitFor(() =>
      expect(onQueueChange).toHaveBeenCalledWith(['8478402', '8477934']),
    );
  });

  it('reads the queue in position order', async () => {
    serverRows = [{ player_id: 8478402, position: 1 }];
    renderQueue();
    await waitFor(() => expect(orderSpy).toHaveBeenCalled());
    expect(orderSpy).toHaveBeenCalledWith('position', { ascending: true });
  });
});

describe('DraftQueue — persisting changes', () => {
  it('writes the queue to the server, debounced, once hydrated', async () => {
    const { rerender, onQueueChange } = renderQueue();
    await waitFor(() => expect(orderSpy).toHaveBeenCalled());

    rerender(
      <DraftQueue
        queue={['8478402', '8477934']}
        players={PLAYERS}
        draftedPlayers={[]}
        onQueueChange={onQueueChange}
        onDraftFromQueue={vi.fn()}
        isDraftActive
        isYourTurn={false}
        leagueId={LEAGUE}
        teamId={TEAM}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled());
    const [fn, args] = rpcSpy.mock.calls.at(-1)!;
    expect(fn).toBe('set_draft_queue');
    expect(args).toEqual({
      p_team_id: TEAM,
      p_player_ids: [8478402, 8477934],
    });
  });

  it('drops UUID-domain player ids rather than casting them (KI-042)', async () => {
    // draft_queues.player_id is INTEGER. A UUID beginning with digits
    // would silently truncate to a valid-looking integer for the WRONG
    // player, which is far worse than dropping it.
    const { rerender, onQueueChange } = renderQueue();
    await waitFor(() => expect(orderSpy).toHaveBeenCalled());

    rerender(
      <DraftQueue
        queue={['550e8400-e29b-41d4-a716-446655440000', '8478402']}
        players={PLAYERS}
        draftedPlayers={[]}
        onQueueChange={onQueueChange}
        onDraftFromQueue={vi.fn()}
        isDraftActive
        isYourTurn={false}
        leagueId={LEAGUE}
        teamId={TEAM}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(rpcSpy).toHaveBeenCalled());
    const [, args] = rpcSpy.mock.calls.at(-1)!;
    expect((args as { p_player_ids: number[] }).p_player_ids).toEqual([8478402]);
  });
});

describe('DraftQueue — the fallbacks', () => {
  it('migrates an existing localStorage queue when the server has none', async () => {
    serverRows = [];
    localStorage.setItem(
      `draft-queue-${LEAGUE}`,
      JSON.stringify(['8478402', '8477934']),
    );

    const { onQueueChange } = renderQueue();

    await waitFor(() =>
      expect(onQueueChange).toHaveBeenCalledWith(['8478402', '8477934']),
    );
  });

  it('falls back to localStorage when the server read fails', async () => {
    serverError = { message: 'permission denied' };
    localStorage.setItem(`draft-queue-${LEAGUE}`, JSON.stringify(['8478402']));

    const { onQueueChange } = renderQueue();

    await waitFor(() => expect(onQueueChange).toHaveBeenCalledWith(['8478402']));
  });

  it('never touches the server when teamId is absent (the v1 room)', async () => {
    // v1 mounts DraftQueue without a teamId. It must behave exactly as
    // it did before this change — localStorage only, no RPC, no read.
    localStorage.setItem(`draft-queue-${LEAGUE}`, JSON.stringify(['8478402']));

    const { onQueueChange } = renderQueue({ teamId: undefined });

    await waitFor(() => expect(onQueueChange).toHaveBeenCalledWith(['8478402']));
    await vi.advanceTimersByTimeAsync(3000);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(orderSpy).not.toHaveBeenCalled();
  });
});
