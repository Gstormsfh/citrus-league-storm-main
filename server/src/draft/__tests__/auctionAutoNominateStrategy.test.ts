// Phase 4.5 chunk 11g.6 sub-step 6c3 — auction auto-nominate
// strategy chain unit tests. Mirror chunk 11g.4 step 6c
// `autopickStrategy.test.ts` patterns.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  selectAuctionAutoNominate,
  projectionsAuctionStrategy,
  type AuctionAutoNominateStrategy,
} from '../auctionAutoNominateStrategy';

/**
 * PostgREST's `db-max-rows` on this project. Every response is clamped
 * to this many rows, with HTTP 200 and no error.
 */
const PG_MAX_ROWS = 1000;

/**
 * Stub Supabase client. `from(table)` returns a chainable builder
 * whose terminal methods (`.eq()`, `.range()`) resolve with whatever
 * `data` was injected for that table. Mirrors the
 * `autopickStrategy.test.ts` stub shape.
 */
function makeStubSupabase(opts: {
  nominationRows?: Array<{ player_id: string }>;
  projections?: Array<{ player_id: string | number; total_projected_points: number | null }>;
  nominationError?: { message: string };
  projectionsError?: { message: string };
}): SupabaseClient {
  const stub = {
    from: vi.fn((table: string) => {
      if (table === 'auction_nominations') {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() =>
          Promise.resolve({
            data: opts.nominationRows ?? [],
            error: opts.nominationError ?? null,
          }),
        );
        return builder;
      }
      if (table === 'player_ros_projections') {
        // PAGED READ STUB (2026-09-02 scale audit). The strategy reads
        // this table through `readAllPaged`, so the stub must behave like
        // PostgREST does: serve a `.range(from, to)` window and CLAMP it
        // at `db-max-rows` (1,000 on this project) without erroring. A
        // stub that hands back the whole array regardless of range would
        // let the truncation bug back in unnoticed.
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        // Season-sweep 2026-08-24: the strategy filters .eq('season', …).
        builder.eq = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        // The read pages on `player_id` ascending, which is what the
        // database would return; sort here so slices line up with it.
        const ordered = [...(opts.projections ?? [])].sort(
          (a, b) => Number(a.player_id) - Number(b.player_id),
        );
        builder.range = vi.fn((from: number, to: number) => {
          if (opts.projectionsError) {
            return Promise.resolve({ data: null, error: opts.projectionsError });
          }
          const requested = to - from + 1;
          const window = ordered.slice(from, from + Math.min(requested, PG_MAX_ROWS));
          return Promise.resolve({ data: window, error: null });
        });
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
  return stub as unknown as SupabaseClient;
}

describe('projectionsAuctionStrategy (chunk 11g.6 sub-step 6c3)', () => {
  it('returns highest-projected player when nothing is consumed', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [],
      projections: [
        { player_id: '8478402', total_projected_points: 95 },
        { player_id: '8478403', total_projected_points: 88 },
      ],
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    expect(result).toEqual({
      ok: true,
      playerId: '8478402',
      openingBid: 1,
      source: 'projections',
    });
  });

  it('skips already-nominated players and picks the next-highest', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [{ player_id: '8478402' }],
      projections: [
        { player_id: '8478402', total_projected_points: 95 },
        { player_id: '8478403', total_projected_points: 88 },
      ],
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    expect(result).toEqual({
      ok: true,
      playerId: '8478403',
      openingBid: 1,
      source: 'projections',
    });
  });

  it('uses provided auctionMinBid as opening bid', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [],
      projections: [{ player_id: '8478402', total_projected_points: 95 }],
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 5,
      supabase,
    });
    expect(result).toEqual({
      ok: true,
      playerId: '8478402',
      openingBid: 5,
      source: 'projections',
    });
  });

  it('returns no_eligible_players when every projection is consumed', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [{ player_id: '8478402' }, { player_id: '8478403' }],
      projections: [
        { player_id: '8478402', total_projected_points: 95 },
        { player_id: '8478403', total_projected_points: 88 },
      ],
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
  });

  it('returns no_eligible_players on auction_nominations query error', async () => {
    const supabase = makeStubSupabase({
      nominationError: { message: 'simulated DB error' },
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
  });

  it('returns no_eligible_players on projections query error', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [],
      projectionsError: { message: 'simulated DB error' },
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
  });

  it('coerces numeric player_id from projections to string for matching against TEXT player_ids', async () => {
    // auction_nominations.player_id is TEXT; player_ros_projections.player_id
    // is INT. Strategy must coerce for set membership.
    const supabase = makeStubSupabase({
      nominationRows: [{ player_id: '8478402' }],
      projections: [
        { player_id: 8478402, total_projected_points: 95 } as never,
        { player_id: 8478403, total_projected_points: 88 } as never,
      ],
    });
    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });
    // 8478402 (int) is in consumed set as '8478402' (string); coercion
    // handles match → strategy moves to 8478403.
    expect(result).toMatchObject({
      ok: true,
      playerId: '8478403',
      source: 'projections',
    });
  });

  // ── REGRESSION (2026-09-02 scale audit) ────────────────────────────
  // This read was an unbounded `.select()`. PostgREST clamps every
  // response at db-max-rows (1,000 here) and returns 200 with no error,
  // so the auction board silently stopped at the first thousand rows.
  // `player_ros_projections` already holds 1,055 rows for the
  // projections season, and refreshing from prod (1,361) widens the
  // gap. `autopickStrategy.ts` documents the identical defect on the
  // identical table, twice.
  //
  // The stub clamps at 1,000 exactly like the server does, and the
  // best player is placed past the clamp, so an unpaged read cannot
  // pass this test.
  it('pages past the PostgREST row clamp — the best player past row 1,000 is still found', async () => {
    // 1,055 rows, ascending player_id (the page key). The highest
    // projection belongs to the LAST row, which lives on page 2.
    const projections = Array.from({ length: 1055 }, (_, i) => ({
      player_id: 8000000 + i,
      total_projected_points: i, // strictly increasing => last row is best
    }));
    const supabase = makeStubSupabase({ nominationRows: [], projections });

    const result = await projectionsAuctionStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      auctionMinBid: 1,
      supabase,
    });

    expect(result).toEqual({
      ok: true,
      playerId: String(8000000 + 1054),
      openingBid: 1,
      source: 'projections',
    });
  });

  // The read now pages on `player_id`, so the DESC-by-points ordering
  // the strategy depends on is re-applied in memory. Lock that in,
  // including NULLs-last and the `player_id` ascending tiebreaker that
  // makes bootstrap behaviour reproducible.
  it('orders by projected points descending with NULLs last, tiebreaking on player_id', async () => {
    const supabase = makeStubSupabase({
      nominationRows: [],
      projections: [
        // Deliberately supplied out of board order.
        { player_id: 9000001, total_projected_points: null },
        { player_id: 9000002, total_projected_points: 42 },
        { player_id: 9000003, total_projected_points: 99 },
        { player_id: 9000004, total_projected_points: 99 },
      ],
    });

    // Nothing consumed => the board's head wins: the lower player_id of
    // the two 99s.
    const first = await projectionsAuctionStrategy({
      leagueId: 'l', teamId: 't', auctionMinBid: 1, supabase,
    });
    expect(first).toMatchObject({ ok: true, playerId: '9000003' });

    // Consume the whole board except the NULL row: it must come last,
    // after the 42, not first.
    const consumed = makeStubSupabase({
      nominationRows: [
        { player_id: '9000003' },
        { player_id: '9000004' },
      ],
      projections: [
        { player_id: 9000001, total_projected_points: null },
        { player_id: 9000002, total_projected_points: 42 },
        { player_id: 9000003, total_projected_points: 99 },
        { player_id: 9000004, total_projected_points: 99 },
      ],
    });
    const next = await projectionsAuctionStrategy({
      leagueId: 'l', teamId: 't', auctionMinBid: 1, supabase: consumed,
    });
    expect(next).toMatchObject({ ok: true, playerId: '9000002' });
  });
});

describe('selectAuctionAutoNominate (chunk 11g.6 sub-step 6c3)', () => {
  it('returns first ok strategy in chain', async () => {
    const s1: AuctionAutoNominateStrategy = vi.fn(
      async () =>
        ({ ok: false, reason: 'no_eligible_players' }) as const,
    );
    const s2: AuctionAutoNominateStrategy = vi.fn(
      async () =>
        ({
          ok: true,
          playerId: '8478402',
          openingBid: 1,
          source: 'projections',
        }) as const,
    );
    const s3: AuctionAutoNominateStrategy = vi.fn(async () => {
      throw new Error('s3 should not have been called');
    });
    const result = await selectAuctionAutoNominate(
      { leagueId: 'l', teamId: 't', auctionMinBid: 1, supabase: {} as SupabaseClient },
      [s1, s2, s3],
    );
    expect(result).toMatchObject({ ok: true, playerId: '8478402' });
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
    expect(s3).not.toHaveBeenCalled();
  });

  it('returns no_eligible_players when every strategy in the chain returns false', async () => {
    const s1: AuctionAutoNominateStrategy = vi.fn(
      async () =>
        ({ ok: false, reason: 'no_eligible_players' }) as const,
    );
    const s2: AuctionAutoNominateStrategy = vi.fn(
      async () =>
        ({ ok: false, reason: 'no_eligible_players' }) as const,
    );
    const result = await selectAuctionAutoNominate(
      { leagueId: 'l', teamId: 't', auctionMinBid: 1, supabase: {} as SupabaseClient },
      [s1, s2],
    );
    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
  });
});
