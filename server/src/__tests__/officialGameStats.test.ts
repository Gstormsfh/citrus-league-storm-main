import { describe, expect, it } from 'vitest';
import { officialGameStats, OFFICIAL_GAME_STAT_SELECT } from '../services/officialGameStats';
import { MatchupService } from '../services/MatchupService';
import { createChain, createMockSupabase } from './helpers';

describe('Official live earned game stats', () => {
  it('never replaces official goalie zero corrections with stale PBP counters', () => {
    const row = officialGameStats({ player_id: 1, is_goalie: true,
      nhl_wins: 0, nhl_saves: 0, nhl_goals_against: 0, nhl_shutouts: 0,
      wins: 1, saves: 30, goals_against: 4, shutouts: 1 });
    expect(row).toMatchObject({ wins: 0, saves: 0, goals_against: 0, shutouts: 0 });
  });
  it('preserves missing official stats as unavailable and parses signed numeric counts', () => {
    expect(officialGameStats({ player_id: 1, nhl_plus_minus: '-3', saves: 30 }))
      .toMatchObject({ plus_minus: -3, saves: null });
  });
  it('reads the requested players/date through official columns without the legacy RPC', async () => {
    const chain = createChain({ data: [{ player_id: 1, nhl_goals: 2 }], error: null });
    const db = createMockSupabase({ player_game_stats: chain });
    const result = await new MatchupService(db).getDailyGameStats([1], '2026-10-07');
    expect(chain.select).toHaveBeenCalledWith(OFFICIAL_GAME_STAT_SELECT);
    expect(chain.in).toHaveBeenCalledWith('player_id', [1]);
    expect(chain.eq).toHaveBeenCalledWith('game_date', '2026-10-07');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(result.stats[0]).toMatchObject({ player_id: 1, goals: 2 });
  });
});
