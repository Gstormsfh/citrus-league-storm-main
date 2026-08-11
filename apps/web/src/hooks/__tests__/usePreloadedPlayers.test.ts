// DR-3 (2026-07-29) — usePreloadedPlayers tests.
//
// Entry 87 Fix B (2026-08-10): rewired to mock the supabase client's
// direct player_directory query, replacing the former
// PlayerService.getAllPlayers() mock. Same non-blocking contract:
//   - initial render returns an empty map (never null) + isLoading=true
//     so the room + adapters can consume immediately with #<id>
//     fallbacks
//   - after resolution, playersById is populated + isLoading=false
//     with String(player_id) as keys (satisfies v1Adapters.resolvePlayerDisplay
//     which looks up `.get(String(numericId))`)
//   - fetch error → error set but map stays usable (still empty; no
//     throw upstream)

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock supabase client BEFORE the hook module is imported. The hook
// calls `supabase.from('player_directory').select(...).eq(...).range(...)`
// and awaits the returned thenable; we replicate that fluent chain
// with a rig whose terminal call is configurable per-test.
const terminalResult = { data: [] as unknown[], error: null as unknown };
const rangeMock = vi.fn(() => Promise.resolve(terminalResult));
const eqMock = vi.fn(() => ({ range: rangeMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn((_table: string) => ({ select: selectMock }));

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
  // mockReset (not just mockClear) restores the DEFAULT implementation
  // so per-test `mockImplementation` calls (e.g., the never-resolves
  // pattern used to test isLoading=true) don't leak into later tests.
  rangeMock.mockReset();
  rangeMock.mockImplementation(() => Promise.resolve(terminalResult));
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
});
