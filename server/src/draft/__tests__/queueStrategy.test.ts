/**
 * QUEUE (2026-08-12) — tests for the queue-first autopick strategy.
 *
 * The defect being closed: `DraftQueue.tsx` persisted the manager's
 * ranking to `localStorage` and NOTHING on the server ever read it.
 * `draft_queues` existed with correct RLS and held zero rows. The one
 * moment a queue is for — manager away, clock expires, autopick fires —
 * was the one moment it did nothing.
 *
 * Two properties are under test, and only one of them is "picks the
 * right player":
 *
 *   1. It honours the manager's stated order, skipping entries that
 *      other teams have already taken.
 *   2. **It never throws, under any failure.** Every error path must
 *      return ok:false so the chain falls through to projections. A bad
 *      pick is a disappointment; an exception here is a dead clock with
 *      twelve people watching it. The failure tests matter more than
 *      the happy path.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  queueStrategy,
  projectionsStrategy,
  selectAutopickPlayer,
  DEFAULT_STRATEGIES,
} from '../autopickStrategy';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';

interface MockOpts {
  /** Rows returned for draft_queues, in the order the DB would yield. */
  queue?: Array<{ player_id: number; position: number }>;
  /** player_ids already taken in this league. */
  drafted?: number[];
  queueError?: { message: string } | null;
  draftedError?: { message: string } | null;
  /** Make the draft_queues call throw outright, not return an error. */
  queueThrows?: boolean;
  /** Records the arguments the strategy filtered/ordered by. */
  spy?: { orderedBy?: string; ascending?: boolean; teamFilter?: string };
}

function makeSupabase(opts: MockOpts): SupabaseClient {
  const stub: Record<string, unknown> = {};
  stub.from = (table: string) => {
    if (table === 'draft_queues') {
      if (opts.queueThrows) {
        throw new Error('connection reset by peer');
      }
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: string) => {
        if (opts.spy && col === 'team_id') opts.spy.teamFilter = val;
        return chain;
      };
      chain.order = (col: string, o?: { ascending?: boolean }) => {
        if (opts.spy) {
          opts.spy.orderedBy = col;
          opts.spy.ascending = o?.ascending;
        }
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(
          opts.queueError
            ? { data: null, error: opts.queueError }
            : { data: opts.queue ?? [], error: null },
        );
      return chain;
    }
    if (table === 'draft_picks_v2') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(
          opts.draftedError
            ? { data: null, error: opts.draftedError }
            : {
                data: (opts.drafted ?? []).map((player_id) => ({ player_id })),
                error: null,
              },
        );
      return chain;
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return stub as unknown as SupabaseClient;
}

const run = (opts: MockOpts) =>
  queueStrategy({ leagueId: LEAGUE, teamId: TEAM, supabase: makeSupabase(opts) });

describe('queueStrategy — honouring the manager', () => {
  it('picks the top of the queue when nobody has taken them', async () => {
    const r = await run({
      queue: [
        { player_id: 8478402, position: 1 },
        { player_id: 8477934, position: 2 },
      ],
      drafted: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.playerId).toBe(8478402);
      expect(r.source).toBe('queue');
    }
  });

  it('skips queued players other teams already drafted', async () => {
    // The common case, not an edge case: the top of everyone's queue is
    // the same handful of players.
    const r = await run({
      queue: [
        { player_id: 8478402, position: 1 },
        { player_id: 8477934, position: 2 },
        { player_id: 8471675, position: 3 },
      ],
      drafted: [8478402, 8477934],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.playerId).toBe(8471675);
  });

  it('asks the database for the queue in position order, for THIS team', async () => {
    // If the ordering is dropped the strategy still "works" — it just
    // silently returns an arbitrary queued player instead of the
    // manager's #1, which is the kind of bug nobody notices until the
    // draft is over. Pin the query shape.
    const spy: NonNullable<MockOpts['spy']> = {};
    await run({ queue: [{ player_id: 1, position: 1 }], drafted: [], spy });
    expect(spy.teamFilter).toBe(TEAM);
    expect(spy.orderedBy).toBe('position');
    expect(spy.ascending).toBe(true);
  });

  it('defers when the queue is empty', async () => {
    const r = await run({ queue: [], drafted: [] });
    expect(r.ok).toBe(false);
  });

  it('defers when every queued player is gone', async () => {
    const r = await run({
      queue: [
        { player_id: 8478402, position: 1 },
        { player_id: 8477934, position: 2 },
      ],
      drafted: [8478402, 8477934],
    });
    // Whole-object assertion — sidesteps discriminated-union narrowing
    // and pins the exact deferral shape the chain depends on.
    expect(r).toEqual({ ok: false, reason: 'no_eligible_players' });
  });
});

describe('queueStrategy — it must never throw', () => {
  // Each of these would, unhandled, take down handleAutopickTimeout and
  // leave the clock dead. All must degrade to "let projections decide."

  it('a failed queue read defers instead of throwing', async () => {
    const r = await run({ queueError: { message: 'permission denied' } });
    expect(r.ok).toBe(false);
  });

  it('a failed drafted-set lookup defers rather than risking a taken player', async () => {
    // Fail CLOSED. Without a trustworthy drafted set we could hand back
    // someone already on another roster; submit_pick_v2 would reject it
    // as player_taken and the autopick would fail outright. Projections
    // does its own lookup, so deferring is strictly safer than guessing.
    const r = await run({
      queue: [{ player_id: 8478402, position: 1 }],
      draftedError: { message: 'statement timeout' },
    });
    expect(r.ok).toBe(false);
  });

  it('an exception from the client is caught and deferred', async () => {
    await expect(run({ queueThrows: true })).resolves.toEqual({
      ok: false,
      reason: 'no_eligible_players',
    });
  });

  it('tolerates null/garbage player_ids without throwing', async () => {
    const r = await run({
      queue: [
        { player_id: null as unknown as number, position: 1 },
        { player_id: 8471675, position: 2 },
      ],
      drafted: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.playerId).toBe(8471675);
  });
});

describe('the chain — queue outranks projections', () => {
  it('DEFAULT_STRATEGIES puts the queue first', () => {
    // Order IS the feature. A chain with projections first would make
    // the queue unreachable while every test above still passed.
    expect(DEFAULT_STRATEGIES[0]).toBe(queueStrategy);
    expect(DEFAULT_STRATEGIES[1]).toBe(projectionsStrategy);
    expect(DEFAULT_STRATEGIES).toHaveLength(2);
  });

  it('a queue hit short-circuits the chain — projections is never consulted', async () => {
    const projections = vi.fn(async () => ({
      ok: true as const,
      playerId: 999,
      source: 'projections',
    }));
    const result = await selectAutopickPlayer(
      {
        leagueId: LEAGUE,
        teamId: TEAM,
        supabase: makeSupabase({
          queue: [{ player_id: 8478402, position: 1 }],
          drafted: [],
        }),
      },
      [queueStrategy, projections],
    );
    expect(result).toEqual({ ok: true, playerId: 8478402, source: 'queue' });
    expect(projections).not.toHaveBeenCalled();
  });

  it('an empty queue falls through to the next strategy', async () => {
    const projections = vi.fn(async () => ({
      ok: true as const,
      playerId: 999,
      source: 'projections',
    }));
    const result = await selectAutopickPlayer(
      {
        leagueId: LEAGUE,
        teamId: TEAM,
        supabase: makeSupabase({ queue: [], drafted: [] }),
      },
      [queueStrategy, projections],
    );
    expect(projections).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, playerId: 999, source: 'projections' });
  });
});
