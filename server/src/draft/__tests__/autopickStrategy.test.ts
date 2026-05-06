// Phase 4.5 chunk 11g.4 step 6c — autopickStrategy unit tests.
//
// 5 tests covering:
//   - selectAutopickPlayer walks the chain in order; first ok wins
//   - selectAutopickPlayer returns no_eligible_players when every
//     strategy returns ok:false
//   - projectionsStrategy picks highest-projected available
//   - projectionsStrategy excludes already-drafted players
//   - projectionsStrategy returns no_eligible_players when all
//     projected players are already drafted

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  selectAutopickPlayer,
  projectionsStrategy,
  type AutopickStrategy,
} from '../autopickStrategy';

// ── Test helpers ─────────────────────────────────────────────────────

interface MockProjections {
  drafted: number[];
  projections: Array<{ player_id: number; total_projected_points: number }>;
}

function makeMockSupabase(opts: MockProjections): SupabaseClient {
  // Two-table mock: from('draft_picks_v2') returns drafted rows;
  // from('player_ros_projections') returns projection rows. Each
  // returns a chainable thenable that resolves to { data, error }.
  const stub: Record<string, unknown> = {};
  stub.from = (table: string) => {
    if (table === 'draft_picks_v2') {
      const data = opts.drafted.map((player_id) => ({ player_id }));
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.then = (resolve: (val: unknown) => void) =>
        resolve({ data, error: null });
      return chain;
    }
    if (table === 'player_ros_projections') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.order = () => chain;
      chain.then = (resolve: (val: unknown) => void) =>
        resolve({ data: opts.projections, error: null });
      return chain;
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return stub as unknown as SupabaseClient;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('selectAutopickPlayer chain (chunk 11g.4 step 6c)', () => {
  it('walks the chain in order; first ok:true wins', async () => {
    const winningStrategy: AutopickStrategy = vi.fn(async () => ({
      ok: true as const,
      playerId: 100,
      source: 'queue',
    }));
    const fallbackStrategy: AutopickStrategy = vi.fn(async () => ({
      ok: true as const,
      playerId: 200,
      source: 'projections',
    }));

    const result = await selectAutopickPlayer(
      { leagueId: 'league-1', teamId: 'team-1', supabase: {} as SupabaseClient },
      [winningStrategy, fallbackStrategy],
    );

    expect(result).toEqual({ ok: true, playerId: 100, source: 'queue' });
    expect(winningStrategy).toHaveBeenCalledTimes(1);
    expect(fallbackStrategy).not.toHaveBeenCalled();
  });

  it('returns no_eligible_players when every strategy returns ok:false', async () => {
    const stratA: AutopickStrategy = vi.fn(async () => ({
      ok: false as const,
      reason: 'no_eligible_players' as const,
    }));
    const stratB: AutopickStrategy = vi.fn(async () => ({
      ok: false as const,
      reason: 'no_eligible_players' as const,
    }));

    const result = await selectAutopickPlayer(
      { leagueId: 'league-1', teamId: 'team-1', supabase: {} as SupabaseClient },
      [stratA, stratB],
    );

    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
    expect(stratA).toHaveBeenCalledTimes(1);
    expect(stratB).toHaveBeenCalledTimes(1);
  });
});

describe('projectionsStrategy (chunk 11g.4 step 6c)', () => {
  it('picks the highest-projected available player', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 8478402, total_projected_points: 105.5 }, // McDavid
        { player_id: 8478420, total_projected_points: 88.2 },
        { player_id: 8478001, total_projected_points: 60.0 },
      ],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({
      ok: true,
      playerId: 8478402,
      source: 'projections',
    });
  });

  it('excludes already-drafted players and picks the next highest', async () => {
    const supabase = makeMockSupabase({
      drafted: [8478402], // McDavid drafted
      projections: [
        { player_id: 8478402, total_projected_points: 105.5 },
        { player_id: 8478420, total_projected_points: 88.2 }, // → next
        { player_id: 8478001, total_projected_points: 60.0 },
      ],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({
      ok: true,
      playerId: 8478420,
      source: 'projections',
    });
  });

  it('returns no_eligible_players when every projected player is already drafted', async () => {
    const supabase = makeMockSupabase({
      drafted: [8478402, 8478420, 8478001],
      projections: [
        { player_id: 8478402, total_projected_points: 105.5 },
        { player_id: 8478420, total_projected_points: 88.2 },
        { player_id: 8478001, total_projected_points: 60.0 },
      ],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: false, reason: 'no_eligible_players' });
  });
});
