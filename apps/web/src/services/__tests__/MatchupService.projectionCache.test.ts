import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getDailyProjections: mocks.fetch } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { MatchupService } from '../MatchupService';
beforeEach(() => {
  vi.clearAllMocks();
  MatchupService._projectionCache.clear();
  MatchupService._projectionInflight.clear();
});
describe('daily projection cache failures and coverage', () => {
  it('rejects unavailable responses without caching a successful empty day', async () => {
    mocks.fetch.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { '1': { player_id: 1 } } });
    await expect(MatchupService.getDailyProjectionsForMatchup([1], '2026-10-01')).rejects.toThrow('unavailable');
    expect((await MatchupService.getDailyProjectionsForMatchup([1], '2026-10-01')).has(1)).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps prior data on failed refresh without advancing freshness', async () => {
    const key = '2026-10-01:1';
    const previous = { result: new Map(), timestamp: 0 };
    MatchupService._projectionCache.set(key, previous);
    mocks.fetch.mockRejectedValue(new Error('Offline'));
    await expect(MatchupService.getDailyProjectionsForMatchup([1], '2026-10-01')).rejects.toThrow('Offline');
    expect(MatchupService._projectionCache.get(key)).toBe(previous);
  });
  it('fetches changed IDs despite an otherwise fresh date', async () => {
    mocks.fetch.mockResolvedValue({ data: {} });
    await MatchupService.getDailyProjectionsForMatchup([1], '2026-10-01');
    await MatchupService.getDailyProjectionsForMatchup([2], '2026-10-01');
    await MatchupService.getDailyProjectionsForMatchup([1], '2026-10-01');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
