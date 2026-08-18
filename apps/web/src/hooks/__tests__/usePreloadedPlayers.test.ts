// DR-3 (2026-07-29) — usePreloadedPlayers tests.
//
// Entry 87 Fix B (2026-08-10): rewired to mock the supabase client's
// direct player_directory query, replacing the former
// PlayerService.getAllPlayers() mock.
//
// Entry 92 PLAYER-RES-1b (2026-08-10): fluent chain grew `.order`
// between `.eq` and `.range`, and the hook now paginates through
// ≤1000-row windows until a short page signals end-of-data (defeats
// the Supabase Data-API 1000-row default cap that was silently
// truncating the 2035-row directory to an arbitrary ~1000-row
// physical-order subset, dropping stars like MacKinnon + McDavid
// out of the browser map on Run 4).
//
// Contract enforced:
//   - initial render returns an empty map (never null) + isLoading=true
//     so the room + adapters can consume immediately with #<id>
//     fallbacks
//   - after resolution, playersById is populated + isLoading=false
//     with String(player_id) as keys (satisfies v1Adapters.resolvePlayerDisplay
//     which looks up `.get(String(numericId))`)
//   - fetch error → error set but map stays usable (still empty; no
//     throw upstream)
//   - PAGINATION: hook loops `.range(offset, offset+999)` until a
//     short page arrives; every returned page's rows are merged
//   - ORDERING: `.order('player_id', { ascending: true })` is called
//     each iteration so pages don't overlap or gap

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock supabase client BEFORE the hook module is imported. The hook
// calls
//   supabase.from('player_directory')
//     .select(...)
//     .eq(...)
//     .order(...)   // ← Entry 92 added
//     .range(...)   // ← looped, ≤1000-row pages
// and awaits the terminal `.range` result. We replicate that fluent
// chain with a rig whose per-call range result is configurable so
// tests can drive multi-page fetches.
//
// `rangeMock` is the terminal call. Default impl: return whatever
// terminalResult holds (single-page). Multi-page tests override with
// mockImplementation to return DIFFERENT results per call.
const terminalResult = { data: [] as unknown[], error: null as unknown };
const rangeMock = vi.fn(() => Promise.resolve(terminalResult));
const orderMock = vi.fn(() => ({ range: rangeMock }));
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));

// PLAYER-POOL (2026-08-12): the hook now makes a SECOND paged pass over
// `player_season_stats` to merge real production onto the directory rows.
// The mock is therefore table-aware — a single shared `rangeMock` would
// conflate the two loops and turn every directory-pagination assertion
// below into a count of both.
const statsResult = { data: [] as unknown[], error: null as unknown };
const statsRangeMock = vi.fn(() => Promise.resolve(statsResult));
const statsOrderMock = vi.fn(() => ({ range: statsRangeMock }));
const statsEqMock = vi.fn(() => ({ order: statsOrderMock }));
const statsSelectMock = vi.fn(() => ({ eq: statsEqMock }));

const fromMock = vi.fn((table: string) =>
  table === 'player_season_stats'
    ? { select: statsSelectMock }
    : { select: selectMock },
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

import { usePreloadedPlayers } from '../usePreloadedPlayers';

function mkRow(player_id: number, full_name: string) {
  return {
    player_id,
    full_name,
    position_code: 'C',
    team_abbrev: 'BOS',
    jersey_number: null,
    headshot_url: null,
    is_goalie: false,
    eligible_positions: 'C',
  };
}

beforeEach(() => {
  terminalResult.data = [];
  terminalResult.error = null;
  fromMock.mockClear();
  selectMock.mockClear();
  eqMock.mockClear();
  orderMock.mockClear();
  // mockReset (not just mockClear) restores the DEFAULT implementation
  // so per-test `mockImplementation` calls (e.g., the never-resolves
  // pattern used to test isLoading=true, or the multi-page pattern
  // used to test pagination) don't leak into later tests.
  rangeMock.mockReset();
  rangeMock.mockImplementation(() => Promise.resolve(terminalResult));

  statsResult.data = [];
  statsResult.error = null;
  statsSelectMock.mockClear();
  statsEqMock.mockClear();
  statsOrderMock.mockClear();
  statsRangeMock.mockReset();
  statsRangeMock.mockImplementation(() => Promise.resolve(statsResult));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePreloadedPlayers (Entry 87 Fix B — direct player_directory)', () => {
  it('returns an empty (usable) map + isLoading=true on initial render', () => {
    // Never-resolving promise for the terminal await.
    rangeMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => usePreloadedPlayers());
    expect(result.current.playersById).toBeInstanceOf(Map);
    expect(result.current.playersById.size).toBe(0);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    // The empty map must be immediately usable — .get(id) returns
    // undefined without throwing, so adapters can render #<id> chips.
    expect(result.current.playersById.get('8478050')).toBeUndefined();
  });

  it('populates playersById and clears isLoading after fetch resolves', async () => {
    terminalResult.data = [
      mkRow(8478050, 'Auston Matthews'),
      mkRow(8478402, 'Connor McDavid'),
    ];
    const { result } = renderHook(() => usePreloadedPlayers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.playersById.size).toBe(2);
    // Entry 87 Fix B key contract: numeric player_id, stringified.
    // Consumer at v1Adapters:100 looks up with String(entry.playerId).
    expect(result.current.playersById.get('8478050')?.full_name).toBe(
      'Auston Matthews',
    );
    expect(result.current.playersById.get('8478402')?.full_name).toBe(
      'Connor McDavid',
    );
    expect(result.current.error).toBeNull();
  });

  it('sets error and keeps map empty on fetch failure (non-fatal)', async () => {
    terminalResult.error = { message: 'network down' };
    const { result } = renderHook(() => usePreloadedPlayers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('network down');
    // Map stays usable — adapters render #<id> chips for every pick.
    expect(result.current.playersById.size).toBe(0);
    expect(result.current.playersById.get('8478050')).toBeUndefined();
  });

  it('queries player_directory table for the current season', async () => {
    terminalResult.data = [];
    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fromMock).toHaveBeenCalledWith('player_directory');
    // The .eq('season', N) call is the current-season slice guard.
    // We don't lock the literal value (CURRENT_SEASON derives from
    // packages/shared/constants/season.ts and rolls yearly), but we
    // assert the shape.
    expect(eqMock).toHaveBeenCalledWith('season', expect.any(Number));
  });

  it('maps row fields to Player shape: id=String(player_id), name, position, team', async () => {
    terminalResult.data = [
      {
        player_id: 8478050,
        full_name: 'Auston Matthews',
        position_code: 'C',
        team_abbrev: 'TOR',
        jersey_number: '34',
        headshot_url: null,
        is_goalie: false,
        eligible_positions: 'C,LW',
      },
    ];
    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const p = result.current.playersById.get('8478050');
    expect(p).toBeDefined();
    expect(p!.id).toBe('8478050');
    expect(p!.full_name).toBe('Auston Matthews');
    expect(p!.position).toBe('C');
    expect(p!.team).toBe('TOR');
    expect(p!.eligible_positions).toEqual(['C', 'LW']);
  });

  // Entry 92 PLAYER-RES-1b (2026-08-10) — pagination pins.
  //
  // Run 4 root cause: Supabase Data-API caps ranged responses at
  // 1000 rows server-side. A single `.range(0, 4999)` returned an
  // arbitrary ~1000-row physical-order subset of the 2035-row
  // player_directory, so autopicked stars in the >1000 tail
  // (MacKinnon, McDavid) rendered `#id` fallbacks despite being
  // present in the table. Fix: loop `.range(offset, offset+999)`
  // until a short page arrives.
  describe('Entry 92 — pagination + ordering', () => {
    it('orders by player_id ascending each iteration (deterministic paging)', async () => {
      terminalResult.data = [mkRow(8478050, 'Auston Matthews')];
      renderHook(() => usePreloadedPlayers());
      await waitFor(() => expect(orderMock).toHaveBeenCalled());
      // Shape lock: order('player_id', { ascending: true }). If a
      // future edit swaps to descending or a different column, pages
      // would overlap/gap and the merged map would be non-deterministic.
      expect(orderMock).toHaveBeenCalledWith('player_id', {
        ascending: true,
      });
    });

    it('short first page (rows < 1000) → single call, no second range', async () => {
      // Represents the current directory size scenario before more
      // rows are added: 500-row response ends pagination immediately.
      terminalResult.data = Array.from({ length: 500 }, (_, i) =>
        mkRow(8000000 + i, `Player ${i}`),
      );
      const { result } = renderHook(() => usePreloadedPlayers());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.playersById.size).toBe(500);
      // Exactly one range() call — the second-page fetch is skipped
      // because the first page was short.
      expect(rangeMock).toHaveBeenCalledTimes(1);
      expect(rangeMock).toHaveBeenCalledWith(0, 999);
    });

    it('full first page (rows === 1000) triggers second range call', async () => {
      // Simulates Run 4's actual condition: page-cap-hit on first
      // page → hook must fire a second range() to fetch the tail.
      const page1 = Array.from({ length: 1000 }, (_, i) =>
        mkRow(8000000 + i, `EarlyPhysicalRow ${i}`),
      );
      const page2 = [
        mkRow(8477492, 'Nathan MacKinnon'),
        mkRow(8478402, 'Connor McDavid'),
      ];
      // Sequential range() responses: first call → page1, second → page2.
      rangeMock.mockReset();
      rangeMock
        .mockImplementationOnce(() =>
          Promise.resolve({ data: page1, error: null }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ data: page2, error: null }),
        );

      const { result } = renderHook(() => usePreloadedPlayers());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Map contains BOTH pages — the pre-Entry-92 bug lost the
      // second page entirely because there was no loop.
      expect(result.current.playersById.size).toBe(1002);
      // Star lookups (the Run 4 field-evidence regression pin) —
      // these IDs were in the physical-row tail on live prod and
      // fell out of the pre-patch fetch.
      expect(result.current.playersById.get('8477492')?.full_name).toBe(
        'Nathan MacKinnon',
      );
      expect(result.current.playersById.get('8478402')?.full_name).toBe(
        'Connor McDavid',
      );
      // Two range() calls, correctly offset.
      expect(rangeMock).toHaveBeenCalledTimes(2);
      expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999);
      expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999);
    });

    it('third page fires if second is also full (any-size directory)', async () => {
      // Belt-and-suspenders: pagination doesn't hard-cap at 2 pages.
      // If future roster expansion pushes past 2000, the loop still
      // pulls the rest until a short page arrives.
      const full = Array.from({ length: 1000 }, (_, i) =>
        mkRow(9000000 + i, `Row ${i}`),
      );
      const shortTail = [mkRow(9500001, 'FinalRow')];
      rangeMock.mockReset();
      rangeMock
        .mockImplementationOnce(() => Promise.resolve({ data: full, error: null }))
        .mockImplementationOnce(() =>
          Promise.resolve({ data: full.map((r, i) => ({ ...r, player_id: 9100000 + i })), error: null }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ data: shortTail, error: null }),
        );

      const { result } = renderHook(() => usePreloadedPlayers());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(rangeMock).toHaveBeenCalledTimes(3);
      expect(rangeMock).toHaveBeenNthCalledWith(3, 2000, 2999);
      expect(result.current.playersById.get('9500001')?.full_name).toBe(
        'FinalRow',
      );
    });

    it('empty first page (rows === 0) exits loop immediately', async () => {
      // Table empty / season not yet seeded: pagination must NOT
      // spin forever. Rows === 0 < PAGE_SIZE ⇒ break on first pass.
      terminalResult.data = [];
      const { result } = renderHook(() => usePreloadedPlayers());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.playersById.size).toBe(0);
      expect(rangeMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ── PLAYER-POOL (2026-08-12) — the season-stats merge ─────────────────
//
// Before this, every player came back with goals/assists/shots/wins = 0.
// PlayerPool ranks on those via ScoringCalculator, so the sort was a no-op
// and the list fell back to arrival order = player_id ascending = OLDEST
// FIRST. The board opened on a 54-year-old Jaromir Jagr.
describe('usePreloadedPlayers — season-stats merge', () => {
  function mkStats(player_id: number, over: Record<string, unknown> = {}) {
    return {
      player_id,
      games_played: 82,
      nhl_goals: 48,
      nhl_assists: 90,
      nhl_points: 138,
      nhl_shots_on_goal: 306,
      nhl_hits: 40,
      nhl_blocks: 29,
      nhl_pim: 20,
      nhl_ppp: 54,
      nhl_shp: 2,
      nhl_plus_minus: 21,
      nhl_wins: null,
      nhl_losses: null,
      nhl_ot_losses: null,
      nhl_saves: null,
      nhl_goals_against: null,
      nhl_shutouts: null,
      nhl_save_pct: null,
      nhl_gaa: null,
      ...over,
    };
  }

  it('merges real production onto the matching directory row', async () => {
    terminalResult.data = [mkRow(8478402, 'Connor McDavid')];
    statsResult.data = [mkStats(8478402)];

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const p = result.current.playersById.get('8478402');
    expect(p?.points).toBe(138);
    expect(p?.goals).toBe(48);
    expect(p?.assists).toBe(90);
    expect(p?.shots).toBe(306);
    expect(p?.games_played).toBe(82);
  });

  it('queries player_season_stats as a separate table', async () => {
    terminalResult.data = [mkRow(8478402, 'Connor McDavid')];
    statsResult.data = [mkStats(8478402)];

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('player_directory');
    expect(fromMock).toHaveBeenCalledWith('player_season_stats');
  });

  it('leaves a player with no stats row at zero — they sort to the bottom', async () => {
    // This is exactly what happens to Jagr and Thornton now: present in the
    // directory so their names still resolve, but unranked.
    terminalResult.data = [mkRow(8466138, 'Joe Thornton')];
    statsResult.data = [];

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const p = result.current.playersById.get('8466138');
    expect(p?.full_name).toBe('Joe Thornton');
    expect(p?.points).toBe(0);
  });

  it('pages the stats table too (1,066 rows > the 1000-row cap)', async () => {
    terminalResult.data = [mkRow(1, 'A')];
    const full = Array.from({ length: 1000 }, (_, i) => mkStats(i + 1));
    statsRangeMock
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [mkStats(1001)], error: null });

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(statsRangeMock).toHaveBeenCalledTimes(2);
  });

  it('SURVIVES a stats failure with the directory intact', async () => {
    // The safety property. The directory map resolves NAMES for drafted
    // players — losing it turns a finished roster into `#8466138 / ? / -`.
    // A stats outage may cost ranking; it must never cost the names.
    terminalResult.data = [mkRow(8478402, 'Connor McDavid')];
    statsRangeMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.playersById.size).toBe(1);
    expect(result.current.playersById.get('8478402')?.full_name).toBe('Connor McDavid');
    expect(result.current.error).toBeNull();
  });

  it('merges goalie production onto a goalie row', async () => {
    const goalieRow = { ...mkRow(8476945, 'Connor Hellebuyck'), is_goalie: true, position_code: 'G' };
    terminalResult.data = [goalieRow];
    statsResult.data = [
      mkStats(8476945, { nhl_wins: 23, nhl_saves: 1369, nhl_shutouts: 0, nhl_goals_against: 120 }),
    ];

    const { result } = renderHook(() => usePreloadedPlayers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const p = result.current.playersById.get('8476945');
    expect(p?.wins).toBe(23);
    expect(p?.saves).toBe(1369);
  });
});
