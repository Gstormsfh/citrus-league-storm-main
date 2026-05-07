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
 * Stub Supabase client. `from(table)` returns a chainable builder
 * whose terminal methods (`.eq()`, `.order()`) resolve with whatever
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
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        // After two .order() calls, the builder resolves with data.
        // We model this by making `.order()` thenable on the second call.
        // Simpler: make `.order` return a chainable that ALSO has a `then`.
        let orderCallCount = 0;
        builder.order = vi.fn(() => {
          orderCallCount++;
          if (orderCallCount >= 2) {
            return Promise.resolve({
              data: opts.projections ?? [],
              error: opts.projectionsError ?? null,
            });
          }
          return builder;
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
