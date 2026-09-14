import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerService } from '../services/PlayerService';
import { CanonicalProjectionService, clearCanonicalProjectionCache } from '../services/CanonicalProjectionService';
import { createChain, createMockSupabase } from './helpers';

const NOW = new Date('2026-09-14T12:00:00Z');
const fixture: Record<string, unknown[]> = {
  player_current_directory: [
    { player_id: 1, full_name: 'Reviewed Skater', position_code: 'C', team_abbrev: 'EDM' },
    { player_id: 2, full_name: 'Sample Goalie', position_code: 'G', team_abbrev: 'COL' },
  ],
  player_season_stats: [
    { player_id: 1, games_played: 10, nhl_goals: 0, nhl_assists: 4, nhl_plus_minus: 0 },
    { player_id: 2, games_played: 10, goalie_gp: 0, nhl_saves: 0, nhl_wins: 0 },
  ],
  player_talent_metrics: [{ player_id: 2, roster_status: 'IR', roster_status_source: 'espn-injuries', roster_status_updated_at: NOW.toISOString() }],
  goalie_gsax_primary: [{ goalie_id: 2, total_gsax: 0 }],
};
const contexts = new Map([['1', { revision: 'reviewed', availability: {
  status: 'out', authority: 'reviewed_report', as_of: NOW.toISOString(), review_after: '2026-09-15T12:00:00Z',
} } as any]]);
function immediateClient() {
  return createMockSupabase(Object.fromEntries(Object.entries(fixture).map(([table, data]) => [table, createChain({ data, error: null })])));
}
function delayedClient(directoryError: unknown = null) {
  const started: Array<{ table: string; at: number }> = [];
  const db = createMockSupabase();
  db.from = vi.fn((table: string) => {
    const chain = createChain();
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      started.push({ table, at: Date.now() - NOW.getTime() });
      return new Promise(r => setTimeout(() => r({ data: fixture[table], error: table === 'player_current_directory' ? directoryError : null }), table === 'player_current_directory' ? 100 : 200)).then(resolve, reject);
    };
    return chain;
  });
  return { db, started };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); PlayerService.clearCache(); clearCanonicalProjectionCache(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('by-ID enrichment overlaps canonical availability after directory success', () => {
  it.each(['published', 'unavailable', 'absent'] as const)('keeps the same JSON and removes a serial stage: %s', async outcome => {
    const published = vi.spyOn(CanonicalProjectionService.prototype, 'getPublishedContexts');
    if (outcome === 'unavailable') published.mockRejectedValue(new Error('source offline'));
    else published.mockResolvedValue(outcome === 'published' ? contexts : new Map());
    // The ordinary getAllPlayers path retains its sequential availability read.
    const baseline = await new PlayerService(immediateClient()).getAllPlayers();
    published.mockClear();
    const contextStarts: number[] = [];
    published.mockImplementation(() => {
      contextStarts.push(Date.now() - NOW.getTime());
      return new Promise((resolve, reject) => setTimeout(() => outcome === 'unavailable'
        ? reject(new Error('source offline')) : resolve(outcome === 'published' ? contexts : new Map()), 150));
    });
    const { db, started } = delayedClient();
    let completed = false;
    const result = new PlayerService(db).getPlayersByIds([1, 2]).then(value => { completed = true; return value; });
    await vi.advanceTimersByTimeAsync(99);
    expect(published).not.toHaveBeenCalled();
    expect(started.map(x => x.table)).toEqual(['player_current_directory']);
    await vi.advanceTimersByTimeAsync(1);
    expect(contextStarts).toEqual([100]);
    expect(started.slice(1).map(x => x.at)).toEqual([100, 100, 100]);
    await vi.advanceTimersByTimeAsync(199);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(completed).toBe(true); // 100 + max(200,150), versus 450 ms serial fixture.
    const actual = await result;
    expect(JSON.stringify(actual)).toBe(JSON.stringify(baseline));
    expect(actual.players[0]).toMatchObject({ goals: 0, plus_minus: 0, is_ir_eligible: outcome === 'published' });
    expect(actual.players[1]).toMatchObject({ games_played: 0, is_goalie: true, is_ir_eligible: true });
    expect(published).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(4);
  });

  it('waits for a slower publication lookup instead of dropping verified availability', async () => {
    const published = vi.spyOn(CanonicalProjectionService.prototype, 'getPublishedContexts')
      .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(contexts), 400)));
    const { db } = delayedClient();
    let completed = false;
    const result = new PlayerService(db).getPlayersByIds([1, 2]).then(value => { completed = true; return value; });
    await vi.advanceTimersByTimeAsync(300);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(completed).toBe(true);
    expect((await result).players[0].is_ir_eligible).toBe(true);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it('returns the original directory error without starting any enrichment or canonical read', async () => {
    const error = { code: '42501', message: 'directory access denied' };
    const published = vi.spyOn(CanonicalProjectionService.prototype, 'getPublishedContexts');
    const { db } = delayedClient(error);
    const result = new PlayerService(db).getPlayersByIds([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ players: [], error });
    expect(published).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('handles an early canonical rejection while enrichment is pending without retrying it', async () => {
    const published = vi.spyOn(CanonicalProjectionService.prototype, 'getPublishedContexts').mockRejectedValue(new Error('pointer unavailable'));
    const { db } = delayedClient();
    const result = new PlayerService(db).getPlayersByIds([1, 2]);
    await vi.advanceTimersByTimeAsync(300);
    expect((await result).players[0].availability?.status).toBe('unknown');
    expect((await result).players[1].is_ir_eligible).toBe(true);
    expect(published).toHaveBeenCalledTimes(1);
  });
});
