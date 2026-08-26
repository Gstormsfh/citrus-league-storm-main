// GAME LOG (2026-08-26) — reported from an iPhone as "'Game Log' takes a long
// ass time to open as well".
//
// It was an N+1 in the client. PlayerStatsModal fetched a player's season by
// calling /daily-game-stats once per PAST game date, in serial batches of ten,
// and /projections/daily once per FUTURE date. A full season is up to 82 of
// each — 164 requests to open one modal, the past half spread across nine
// serial round trips. On the ~350ms a phone sees, that is most of a minute.
//
// player_game_stats carries `game_date` directly, so no join is needed and the
// whole log is one range query. Measured against production with EXPLAIN
// ANALYZE: 82 rows for a full season in 12.9ms.
//
// These tests pin the two things that make that safe: it really is ONE query
// with the right bounds, and it hands back the SAME field names
// get_daily_game_stats returns — because ScoringCalculator and every other
// consumer are written against those, and raw nhl_* columns would score zero
// rather than fail.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchupService } from '../services/MatchupService';
import { createChain } from './helpers';

const GAME_ROWS = [
  {
    player_id: 8476883, game_id: 2025020101, game_date: '2025-10-09', is_goalie: true,
    nhl_goals: 0, nhl_assists: 1, nhl_points: 1, nhl_shots_on_goal: 0, nhl_hits: 0,
    nhl_blocks: 0, nhl_pim: 2, nhl_plus_minus: 0, nhl_toi_seconds: 3600, nhl_ppp: 0,
    nhl_shp: 0, nhl_wins: 1, nhl_losses: 0, nhl_ot_losses: 0, nhl_saves: 31,
    nhl_shots_faced: 33, nhl_goals_against: 2, nhl_shutouts: 0, nhl_save_pct: 0.939,
  },
];

const PROJECTION_ROWS = [
  { player_id: 8476883, projection_date: '2026-04-01', total_projected_points: 7.4, is_goalie: true },
];

function serviceWith(gameRows: unknown[], projRows: unknown[]) {
  const gameChain = createChain({ data: gameRows, error: null });
  const projChain = createChain({ data: projRows, error: null });
  const supabase: any = {
    from: vi.fn((table: string) =>
      table === 'player_game_stats' ? gameChain : projChain,
    ),
  };
  return { service: new MatchupService(supabase), supabase, gameChain, projChain };
}

beforeEach(() => vi.clearAllMocks());

describe('MatchupService.getPlayerGameLog', () => {
  it('reads the whole season in ONE query, not one per date', async () => {
    const { service, supabase } = serviceWith(GAME_ROWS, []);
    await service.getPlayerGameLog(8476883, '2025-10-01', '2026-06-30');
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('player_game_stats');
  });

  it('bounds the query by player and date range', async () => {
    const { service, gameChain } = serviceWith(GAME_ROWS, []);
    await service.getPlayerGameLog(8476883, '2025-10-01', '2026-06-30');
    expect(gameChain.eq).toHaveBeenCalledWith('player_id', 8476883);
    expect(gameChain.gte).toHaveBeenCalledWith('game_date', '2025-10-01');
    expect(gameChain.lte).toHaveBeenCalledWith('game_date', '2026-06-30');
    expect(gameChain.order).toHaveBeenCalledWith('game_date', { ascending: true });
  });

  it('asks only for nhl_* columns, as get_daily_game_stats does', async () => {
    // The PBP-derived columns beside them are not interchangeable, and the RPC
    // this replaces is explicit about that.
    const { service, gameChain } = serviceWith(GAME_ROWS, []);
    await service.getPlayerGameLog(8476883, '2025-10-01', '2026-06-30');
    const selected = gameChain.select.mock.calls[0][0] as string;
    expect(selected).toContain('nhl_goals');
    expect(selected).toContain('nhl_save_pct');
    expect(selected).toContain('game_date');
    expect(selected).not.toMatch(/(^|[ ,])goals([ ,]|$)/);
  });

  it('returns the field names every consumer is written against', async () => {
    // ScoringCalculator reads `goals`, not `nhl_goals`. Handing back raw
    // columns would score every game zero, silently.
    const { service } = serviceWith(GAME_ROWS, []);
    const { games } = await service.getPlayerGameLog(8476883, '2025-10-01', '2026-06-30');
    const g = games[0] as Record<string, unknown>;

    expect(g.assists).toBe(1);
    expect(g.saves).toBe(31);
    expect(g.shots_faced).toBe(33);
    expect(g.goals_against).toBe(2);
    expect(g.pim).toBe(2);
    expect(g.toi_seconds).toBe(3600);
    expect(g.is_goalie).toBe(true);
    expect(g.game_date).toBe('2025-10-09');
    expect(g).not.toHaveProperty('nhl_goals');
  });

  it('coerces missing numbers to 0 rather than undefined', async () => {
    const { service } = serviceWith([{ player_id: 1, game_date: '2025-10-09' }], []);
    const { games } = await service.getPlayerGameLog(1, '2025-10-01', '2026-06-30');
    const g = games[0] as Record<string, unknown>;
    expect(g.goals).toBe(0);
    expect(g.saves).toBe(0);
    expect(g.is_goalie).toBe(false);
  });

  it('returns an empty log rather than throwing when there are no rows', async () => {
    const { service } = serviceWith([], []);
    const { games, error } = await service.getPlayerGameLog(1, '2025-10-01', '2026-06-30');
    expect(games).toEqual([]);
    expect(error).toBeNull();
  });
});

describe('MatchupService.getPlayerProjectionLog', () => {
  it('reads the range in one query, bounded by player and date', async () => {
    const { service, supabase, projChain } = serviceWith([], PROJECTION_ROWS);
    const { projections } = await service.getPlayerProjectionLog(8476883, '2026-01-01', '2026-06-30');

    expect(supabase.from).toHaveBeenCalledWith('player_projected_stats');
    expect(projChain.eq).toHaveBeenCalledWith('player_id', 8476883);
    expect(projChain.gte).toHaveBeenCalledWith('projection_date', '2026-01-01');
    expect(projChain.lte).toHaveBeenCalledWith('projection_date', '2026-06-30');
    expect(projections).toHaveLength(1);
  });
});
