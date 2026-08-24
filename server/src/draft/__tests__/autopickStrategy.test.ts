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
  projections: Array<{
    player_id: number;
    total_projected_points: number;
    /** E117: per-game rate — the draft-value ranking's primary input. */
    avg_points_per_game?: number;
  }>;
  /**
   * E117: prior-season games played per player. Absent players fall
   * back to DEFAULT_EXPECTED_GAMES (55) inside the strategy.
   */
  seasonGames?: Array<{ player_id: number; games_played: number }>;
  /** AUTOPICK-TRUNCATION-2: simulate a failed player_ros_projections read. */
  projectionsError?: { message?: string | null };
  /** E117: simulate a failed player_season_stats read. */
  seasonStatsError?: { message: string };
  /**
   * E118 roster-shape guard: position per player_id, as the
   * player_directory would report it (C/LW/RW/D/G).
   */
  positions?: Record<number, string>;
  /**
   * CAPS-INFLATION FIX (2026-08-23): player_directory is a per-season
   * index — prod carries ~2 rows per player. Setting this to N serves
   * every directory row N times, which is what the owned-positions
   * read actually sees in production.
   */
  directoryDuplicateSeasons?: number;
  /** E118: player_ids this team already holds. */
  teamOwned?: number[];
  /** E118: league settings.rosterSlots override. */
  rosterSlots?: Record<string, number>;
}

function makeMockSupabase(opts: MockProjections): SupabaseClient {
  // Two-table mock: from('draft_picks_v2') returns drafted rows;
  // from('player_ros_projections') returns projection rows. Each
  // returns a chainable thenable that resolves to { data, error }.
  const stub: Record<string, unknown> = {};
  stub.from = (table: string) => {
    if (table === 'draft_picks_v2') {
      // E118: the strategy issues TWO reads of this table — the
      // league-wide drafted set (one .eq) and the team's own picks
      // (two .eq calls). Count .eq calls to tell them apart.
      let eqCount = 0;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => {
        eqCount += 1;
        return chain;
      };
      chain.then = (resolve: (val: unknown) => void) => {
        const data =
          eqCount >= 2
            ? (opts.teamOwned ?? []).map((player_id) => ({ player_id }))
            : opts.drafted.map((player_id) => ({ player_id }));
        return resolve({ data, error: null });
      };
      return chain;
    }
    // E118: league roster-slot config.
    if (table === 'leagues') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: opts.rosterSlots
            ? { settings: { rosterSlots: opts.rosterSlots } }
            : { settings: {} },
          error: null,
        });
      return chain;
    }
    // E118: positions for cap accounting.
    //
    // AUTOPICK-TRUNCATION (2026-08-12) — two DIFFERENT query shapes hit
    // this table and the mock must serve both:
    //   a) the team's own picks .....  .select().in('player_id', owned)
    //   b) the board-wide position map .select().order().range()  <- paged
    //
    // (b) used to be an unbounded .select() and silently truncated at
    // PostgREST's 1,000-row default against a 2,035-row table. `range` is
    // honoured here rather than ignored so the paging loop is genuinely
    // exercised — a mock that returns everything regardless of range
    // would pass a loop that pages wrongly.
    if (table === 'player_directory') {
      const perPlayer = Object.entries(opts.positions ?? {}).map(([id, pos]) => ({
        player_id: Number(id),
        position_code: pos,
      }));
      // CAPS-INFLATION FIX (2026-08-23): serve one row per season per
      // player, like the real per-season directory does.
      const copies = Math.max(1, opts.directoryDuplicateSeasons ?? 1);
      const all = perPlayer.flatMap((row) => Array.from({ length: copies }, () => ({ ...row })));
      const chain: Record<string, unknown> = {};
      let rangeFrom: number | null = null;
      let rangeTo = 0;
      // CAPS-INFLATION FIX (2026-08-23): the owned-positions read filters
      // with .in('player_id', ownedIds); a mock that ignores the filter
      // hands the guard every player's rows and silently breaks the cap
      // accounting the regression test exists to pin. Honour the filter.
      let inFilter: number[] | null = null;
      chain.select = () => chain;
      chain.in = (_col: string, ids: number[]) => {
        inFilter = ids;
        return chain;
      };
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return chain;
      };
      chain.then = (resolve: (val: unknown) => void) => {
        const filtered = inFilter === null
          ? all
          : all.filter((row) => (inFilter as number[]).includes(row.player_id));
        return resolve({
          data: rangeFrom === null ? filtered : filtered.slice(rangeFrom, rangeTo + 1),
          error: null,
        });
      };
      return chain;
    }
    // AUTOPICK-TRUNCATION-2 (2026-08-13) — the projections read is paged
    // now too. `range` is HONOURED here, not ignored: a mock that returns
    // the full set regardless of range would happily pass a paging loop
    // that pages wrongly, which is the entire failure mode being guarded.
    // See player_directory above for the same reasoning.
    if (table === 'player_ros_projections') {
      const all = opts.projections ?? [];
      const chain: Record<string, unknown> = {};
      let rangeFrom: number | null = null;
      let rangeTo = 0;
      chain.select = () => chain;
      // Season-sweep 2026-08-24: the strategy now filters .eq('season', …).
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return chain;
      };
      // Faithful to PostgREST: a select with NO range is clamped
      // server-side at `db-max-rows` (1,000). Returning `all` here
      // instead would let an unpaged read pass — which is precisely the
      // hole that let the original bug ship, and which a first cut of
      // this mock reproduced exactly.
      chain.then = (resolve: (val: unknown) => void) =>
        resolve(
          opts.projectionsError
            ? { data: null, error: opts.projectionsError }
            : {
                data:
                  rangeFrom === null
                    ? all.slice(0, 1000)
                    : all.slice(rangeFrom, rangeTo + 1),
                error: null,
              },
        );
      return chain;
    }
    // E117 draft-value ranking reads prior-season games played.
    // AUTOPICK-TRUNCATION (2026-08-12) — now paged; see player_directory
    // above for why range() is honoured rather than ignored. The error
    // fixture must still short-circuit on the FIRST page, which is what
    // pins that a read failure degrades to DEFAULT_EXPECTED_GAMES rather
    // than looping.
    if (table === 'player_season_stats') {
      const all = opts.seasonGames ?? [];
      const chain: Record<string, unknown> = {};
      let rangeFrom: number | null = null;
      let rangeTo = 0;
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return chain;
      };
      chain.then = (resolve: (val: unknown) => void) =>
        resolve(
          opts.seasonStatsError
            ? { data: null, error: opts.seasonStatsError }
            : {
                data: rangeFrom === null ? all : all.slice(rangeFrom, rangeTo + 1),
                error: null,
              },
        );
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
      source: 'draft_value',
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
      source: 'draft_value',
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
      source: 'draft_value',
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

  // ── E117 draft-value ranking (2026-08-12) ────────────────────────
  //
  // Field defect these pin: ordering by `total_projected_points`
  // collapses to PER-GAME rate in the preseason window (games_remaining
  // is uniform), which put FOUR goalies — two of them backups — in the
  // top 12 of the live staging board. Ranking by per-game x expected
  // games (prior-season GP, capped 82) is what a real draft board does.

  it('E117: ranks by per-game x prior-season games, not per-game alone', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        // Backup goalie: elite per-game rate, third of a season played.
        { player_id: 900001, total_projected_points: 17.8, avg_points_per_game: 5.9 },
        // Workhorse forward: lower rate, full season.
        { player_id: 900002, total_projected_points: 16.0, avg_points_per_game: 5.3 },
      ],
      seasonGames: [
        { player_id: 900001, games_played: 25 }, // 5.9 x 25 = 147.5
        { player_id: 900002, games_played: 82 }, // 5.3 x 82 = 434.6  ← wins
      ],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 900002, source: 'draft_value' });
  });

  it('E117: caps expected games at a full 82-game season', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 900003, total_projected_points: 1, avg_points_per_game: 4.0 },
        { player_id: 900004, total_projected_points: 1, avg_points_per_game: 3.9 },
      ],
      seasonGames: [
        // A corrupt/over-length row must not buy extra value.
        { player_id: 900004, games_played: 200 }, // capped to 82 → 319.8
        { player_id: 900003, games_played: 82 }, //             → 328.0 ← wins
      ],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 900003, source: 'draft_value' });
  });

  // AUTOPICK-TRUNCATION-2 (2026-08-13) — the regression guard.
  //
  // `player_ros_projections` is 926 rows on staging, i.e. UNDER
  // PostgREST's 1,000-row cap, so an unpaged read looks perfectly
  // healthy there. Prod's copy is 1,361. The obvious pre-draft move —
  // freshen staging's projections from prod — is exactly what would
  // have armed the bug, silently and on draft night.
  //
  // So this fixture is deliberately 1,200 rows: bigger than the cap,
  // and the correct answer lives at index 1,150, past it. If the read
  // ever reverts to unpaged, the mock returns the first 1,000 rows and
  // the best player is simply not in the board.
  // AUTOPICK-TRUNCATION-2 (2026-08-13) — the regression guard.
  //
  // `player_ros_projections` is 926 rows on staging, i.e. UNDER
  // PostgREST's 1,000-row cap, so an unpaged read looks perfectly
  // healthy there. Prod's copy is 1,361. The obvious pre-draft move —
  // freshen staging's projections from prod — is exactly what would
  // have armed this bug, silently, on draft night.
  //
  // The fixture is deliberately 1,200 rows with the correct answer at
  // index 1,150, past the cap. Revert the read to unpaged and the mock
  // hands back only the first 1,000 rows, so the best player is simply
  // absent from the board and this fails.
  it('AUTOPICK-TRUNCATION-2: reads past the 1,000-row cap', async () => {
    const projections = Array.from({ length: 1200 }, (_, i) => ({
      player_id: 90000 + i,
      total_projected_points: 10,
    }));
    projections[1150] = { player_id: 91150, total_projected_points: 400 };

    const supabase = makeMockSupabase({ drafted: [], projections });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({
      ok: true,
      playerId: 91150,
      source: 'draft_value',
    });
  });

  it('ROOKIE-VALUE FIX (2026-08-23): no prior-season row ranks conservatively, never beats a proven starter on rate alone', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        // Rookie, no season row → conservative legacy value (1). Under the
        // pre-fix behaviour this was 6.0 × 55 = 330 and prospect goalies
        // drained the live board (prod, 2026-08-23: nine straight goalie
        // autopicks after caps exhausted).
        { player_id: 900005, total_projected_points: 1, avg_points_per_game: 6.0 },
        // Veteran with a real row → 2.0 x 82 = 164 — must outrank the rookie.
        { player_id: 900006, total_projected_points: 1, avg_points_per_game: 2.0 },
      ],
      seasonGames: [{ player_id: 900006, games_played: 82 }],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 900006, source: 'draft_value' });
  });

  it('ROOKIE-VALUE FIX: a rookie alone on the board is still ranked and picked, never zeroed', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 900005, total_projected_points: 1, avg_points_per_game: 6.0 },
      ],
      seasonGames: [],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 900005, source: 'draft_value' });
  });

  it('E117: season-stats read failure degrades to conservative ROS order, still picks', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 900007, total_projected_points: 5, avg_points_per_game: 7.0 },
        { player_id: 900008, total_projected_points: 9, avg_points_per_game: 3.0 },
      ],
      seasonStatsError: { message: 'boom' },
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    // With no durability signal at all, everyone falls back to the
    // conservative legacy column (never per-game × an assumed 55 games,
    // which is how prospect goalies used to jump the board) — degraded,
    // but never stuck (a stuck autopick freezes a draft).
    expect(result).toEqual({ ok: true, playerId: 900008, source: 'draft_value' });
  });

  it('E117: falls back to total_projected_points when per-game is absent', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 900009, total_projected_points: 42 },
        { player_id: 900010, total_projected_points: 41 },
      ],
      seasonGames: [],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 900009, source: 'draft_value' });
  });

  // ── E118 roster-shape guard (2026-08-12) ─────────────────────────
  //
  // Value ranking alone is position-blind: a manager who misses every
  // pick could end up with twelve goalies. These pin the guard that
  // shapes the roster WITHOUT ever letting the draft stall.

  it('E118: skips a position whose cap this team has already filled', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 700001, total_projected_points: 1, avg_points_per_game: 9.0 }, // G, best
        { player_id: 700002, total_projected_points: 1, avg_points_per_game: 8.0 }, // C
      ],
      seasonGames: [
        { player_id: 700001, games_played: 82 },
        { player_id: 700002, games_played: 82 },
      ],
      positions: { 700001: 'G', 700002: 'C', 700010: 'G', 700011: 'G' },
      teamOwned: [700010, 700011], // two goalies already → G cap (2) met
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 700002, source: 'draft_value' });
  });

  it('E118: honours a league-configured rosterSlots cap over the default', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 700003, total_projected_points: 1, avg_points_per_game: 9.0 }, // G
        { player_id: 700004, total_projected_points: 1, avg_points_per_game: 8.0 }, // D
      ],
      seasonGames: [
        { player_id: 700003, games_played: 82 },
        { player_id: 700004, games_played: 82 },
      ],
      positions: { 700003: 'G', 700004: 'D', 700012: 'G' },
      teamOwned: [700012], // one goalie
      rosterSlots: { G: 1, D: 6 }, // league allows only ONE goalie
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 700004, source: 'draft_value' });
  });

  it('E118: when every remaining position is capped it still picks (never stalls)', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 700005, total_projected_points: 1, avg_points_per_game: 9.0 },
        { player_id: 700006, total_projected_points: 1, avg_points_per_game: 8.0 },
      ],
      seasonGames: [
        { player_id: 700005, games_played: 82 },
        { player_id: 700006, games_played: 82 },
      ],
      positions: { 700005: 'G', 700006: 'G', 700013: 'G', 700014: 'G' },
      teamOwned: [700013, 700014], // G cap met, and only goalies remain
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    // Best available anyway — an unbalanced bench beats a frozen draft.
    expect(result).toEqual({
      ok: true,
      playerId: 700005,
      source: 'draft_value_caps_exhausted',
    });
  });

  it('E118: an unknown position code is never blocked', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 700007, total_projected_points: 1, avg_points_per_game: 9.0 },
      ],
      seasonGames: [{ player_id: 700007, games_played: 82 }],
      positions: { 700007: 'XYZ' }, // not in the capped vocabulary
      teamOwned: [],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 700007, source: 'draft_value' });
  });

  it('E118: with an empty roster the best player is still the pick', async () => {
    const supabase = makeMockSupabase({
      drafted: [],
      projections: [
        { player_id: 700008, total_projected_points: 1, avg_points_per_game: 9.0 },
        { player_id: 700009, total_projected_points: 1, avg_points_per_game: 8.0 },
      ],
      seasonGames: [
        { player_id: 700008, games_played: 82 },
        { player_id: 700009, games_played: 82 },
      ],
      positions: { 700008: 'G', 700009: 'C' },
      teamOwned: [],
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 700008, source: 'draft_value' });
  });

  it('CAPS-INFLATION FIX (2026-08-23): per-season directory duplicates must not double-count positions toward caps', async () => {
    // Prod regression (Claude Linear League, 2026-08-23): the directory
    // carries ~2 season rows per player, so a team holding ONE center
    // counted as TWO and every cap looked exhausted mid-draft — the guard
    // fell through to the value board and an ownerless seat drafted eleven
    // goalies. Setup: cap C=2, team owns ONE center, directory serves TWO
    // rows per player. The best available is another center: with the
    // dedupe he MUST be eligible (held 1 < cap 2) and picked; the pre-fix
    // code counted held=2 and skipped him for the defenseman.
    const supabase = makeMockSupabase({
      drafted: [800001],
      projections: [
        { player_id: 800002, total_projected_points: 1, avg_points_per_game: 9.0 }, // C — best available
        { player_id: 800003, total_projected_points: 1, avg_points_per_game: 5.0 }, // D — the wrong pick
      ],
      seasonGames: [
        { player_id: 800002, games_played: 82 },
        { player_id: 800003, games_played: 82 },
      ],
      positions: { 800001: 'C', 800002: 'C', 800003: 'D' },
      teamOwned: [800001],
      rosterSlots: { C: 2, D: 4 },
      directoryDuplicateSeasons: 2,
    });

    const result = await projectionsStrategy({
      leagueId: 'league-1',
      teamId: 'team-1',
      supabase,
    });

    expect(result).toEqual({ ok: true, playerId: 800002, source: 'draft_value' });
  });
});
