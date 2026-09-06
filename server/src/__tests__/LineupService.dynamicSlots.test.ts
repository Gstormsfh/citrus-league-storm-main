import { describe, it, expect, vi } from 'vitest';
import { LineupService } from '../services/LineupService';

describe('initial lineup commissioner slot counts', () => {
  it.each([0, 1, 2, 3])('assigns every configured UTIL slot (%s) and honors zero IR', async UTIL => {
    const rows = {
      leagues: { settings: { rosterSlots: { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL, IR: 0 } } },
      roster_assignments: [1, 2, 3, 4].map(player_id => ({ player_id: String(player_id) })),
      player_directory: [1, 2, 3, 4].map(player_id => ({ player_id, position_code: 'LW' })),
      player_talent_metrics: [{ player_id: 4, roster_status: 'IR' }],
    };
    const client = { from(table: keyof typeof rows) {
      const result = { data: rows[table], error: null };
      const chain = { select: () => chain, eq: () => chain, in: () => chain,
        single: async () => result,
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return chain;
    } };
    const service = new LineupService(client as never);
    const save = vi.spyOn(service, 'saveLineup').mockImplementation(async (teamId, leagueId, lineup) => ({ success: true, data: { team_id: teamId, league_id: leagueId, ...lineup } }));
    await service.initializeLineup('team', 'league');
    const lineup = save.mock.calls[0][2];
    expect(lineup.starters).toHaveLength(UTIL);
    expect(lineup.ir).toEqual([]);
    expect(lineup.bench).toContain('4');
    expect(Object.values(lineup.slot_assignments)).toEqual(
      Array.from({ length: UTIL }, (_, i) => UTIL === 1 ? 'slot-UTIL' : `slot-UTIL-${i + 1}`),
    );
  });
});
