// DR-3 (2026-07-29) — usePreloadedPlayers tests.
//
// Covers the non-blocking contract:
//   - initial render returns an empty map (never null) + isLoading=true
//     so the room + adapters can consume immediately with #<id>
//     fallbacks
//   - after resolution, playersById is populated + isLoading=false
//   - fetch error → error set but map stays usable (still empty; no
//     throw upstream)

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn(),
  },
}));

import { PlayerService } from '@/services/PlayerService';
import { usePreloadedPlayers } from '../usePreloadedPlayers';

const getAllPlayersMock = PlayerService.getAllPlayers as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

function mkPlayer(id: string, name: string) {
  return {
    id,
    full_name: name,
    position: 'C',
    eligible_positions: ['C'],
    team: 'BOS',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
  };
}

describe('usePreloadedPlayers', () => {
  it('returns an empty (usable) map + isLoading=true on initial render', () => {
    getAllPlayersMock.mockImplementation(() => new Promise(() => {})); // never resolves
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
    getAllPlayersMock.mockResolvedValue([
      mkPlayer('8478050', 'Auston Matthews'),
      mkPlayer('8478402', 'Connor McDavid'),
    ]);
    const { result } = renderHook(() => usePreloadedPlayers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.playersById.size).toBe(2);
    expect(result.current.playersById.get('8478050')?.full_name).toBe('Auston Matthews');
    expect(result.current.playersById.get('8478402')?.full_name).toBe('Connor McDavid');
    expect(result.current.error).toBeNull();
  });

  it('sets error and keeps map empty on fetch failure (non-fatal)', async () => {
    getAllPlayersMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => usePreloadedPlayers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('network down');
    // Map stays usable — adapters render #<id> chips for every pick.
    expect(result.current.playersById.size).toBe(0);
    expect(result.current.playersById.get('8478050')).toBeUndefined();
  });
});
