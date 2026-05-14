import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NhlPlayoffStateService } from '../services/NhlPlayoffStateService';
import { createChain, createMockSupabase } from './helpers';

// The shared createChain helper ignores `.in()` filters — it returns the
// terminal value regardless of what was passed. For this service the
// nhl_teams lookup MUST respect `.in('team_id', aliveIds)` or every test
// just gets back the full team table. This helper builds a chain whose
// `.in()` captures the requested IDs and filters the rows accordingly.
function teamLookupChain(allRows: Array<{ team_id: number; abbreviation: string }>) {
  let requestedIds: number[] | null = null;
  const chain: Record<string, any> = createChain({ data: allRows, error: null });
  chain.in = vi.fn((_col: string, ids: number[]) => {
    requestedIds = ids;
    return chain;
  });
  chain.then = (resolve: any, reject: any) => {
    const filtered = requestedIds === null
      ? allRows
      : allRows.filter(r => requestedIds!.includes(r.team_id));
    return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
  };
  return chain;
}

// Team IDs match the production seed (nhl_teams.team_id).
const T = {
  BOS: 1, BUF: 7, MTL: 8, OTT: 9, TBL: 10, CAR: 12,
  PIT: 5, PHI: 4, LAK: 26, COL: 21, DAL: 25, MIN: 30,
  UTA: 59, VGK: 54, EDM: 22, ANA: 24,
};

const ABBREV = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [v, k]),
) as Record<number, string>;

describe('NhlPlayoffStateService.getAliveTeamAbbreviations', () => {
  beforeEach(() => {
    NhlPlayoffStateService.clearCache();
  });

  function mockWithBracket(series: any[]) {
    const teamRows = Object.entries(T).map(([abbr, id]) => ({
      team_id: id,
      abbreviation: abbr,
    }));
    return createMockSupabase({
      nhl_playoff_series: createChain({ data: series, error: null }),
      nhl_teams: teamLookupChain(teamRows),
    });
  }

  it('returns empty when bracket is unpopulated', async () => {
    const mock = createMockSupabase({
      nhl_playoff_series: createChain({ data: [], error: null }),
    });
    const svc = new NhlPlayoffStateService(mock);
    const result = await svc.getAliveTeamAbbreviations(2025);
    expect(result).toEqual([]);
  });

  // Regression: PHI won R1 vs PIT, then lost R2 vs CAR. MIN won R1 vs DAL,
  // then lost R2 vs COL. Before the fix, both stayed "alive" because the
  // service unioned winners across rounds without ever subtracting losers
  // of later rounds. The WebSummit-pool launch surfaced this — the
  // draftable pool included PHI and MIN players after they'd been
  // eliminated.
  it('removes teams that won an earlier round but lost a later round', async () => {
    const series = [
      // Round 1 — all final
      { series_status: 'final', high_seed_team_id: T.BUF, low_seed_team_id: T.BOS, winner_team_id: T.BUF },
      { series_status: 'final', high_seed_team_id: T.TBL, low_seed_team_id: T.MTL, winner_team_id: T.MTL },
      { series_status: 'final', high_seed_team_id: T.CAR, low_seed_team_id: T.OTT, winner_team_id: T.CAR },
      { series_status: 'final', high_seed_team_id: T.PIT, low_seed_team_id: T.PHI, winner_team_id: T.PHI },
      { series_status: 'final', high_seed_team_id: T.COL, low_seed_team_id: T.LAK, winner_team_id: T.COL },
      { series_status: 'final', high_seed_team_id: T.DAL, low_seed_team_id: T.MIN, winner_team_id: T.MIN },
      { series_status: 'final', high_seed_team_id: T.VGK, low_seed_team_id: T.UTA, winner_team_id: T.VGK },
      { series_status: 'final', high_seed_team_id: T.EDM, low_seed_team_id: T.ANA, winner_team_id: T.ANA },
      // Round 2 — two final, two active
      { series_status: 'active', high_seed_team_id: T.BUF, low_seed_team_id: T.MTL, winner_team_id: null },
      { series_status: 'final',  high_seed_team_id: T.CAR, low_seed_team_id: T.PHI, winner_team_id: T.CAR },
      { series_status: 'final',  high_seed_team_id: T.COL, low_seed_team_id: T.MIN, winner_team_id: T.COL },
      { series_status: 'active', high_seed_team_id: T.VGK, low_seed_team_id: T.ANA, winner_team_id: null },
      // Round 3 pending (winners not yet filled)
      { series_status: 'pending', high_seed_team_id: null,  low_seed_team_id: T.CAR, winner_team_id: null },
      { series_status: 'pending', high_seed_team_id: T.COL, low_seed_team_id: null, winner_team_id: null },
    ];

    const mock = mockWithBracket(series);
    const svc = new NhlPlayoffStateService(mock);
    const result = await svc.getAliveTeamAbbreviations(2025);

    expect(new Set(result)).toEqual(
      new Set(['ANA', 'BUF', 'CAR', 'COL', 'MTL', 'VGK']),
    );
    expect(result).not.toContain('PHI');
    expect(result).not.toContain('MIN');
  });

  it('keeps both teams in an active series alive', async () => {
    const series = [
      { series_status: 'final', high_seed_team_id: T.BUF, low_seed_team_id: T.BOS, winner_team_id: T.BUF },
      { series_status: 'active', high_seed_team_id: T.BUF, low_seed_team_id: T.MTL, winner_team_id: null },
    ];
    const mock = mockWithBracket(series);
    const svc = new NhlPlayoffStateService(mock);
    const result = await svc.getAliveTeamAbbreviations(2025);
    // BOS lost R1, gone. BUF + MTL both alive (active series).
    expect(new Set(result)).toEqual(new Set(['BUF', 'MTL']));
  });

  it('treats a final series with a null winner as nothing decided', async () => {
    const series = [
      { series_status: 'final', high_seed_team_id: T.BUF, low_seed_team_id: T.BOS, winner_team_id: null },
    ];
    const mock = mockWithBracket(series);
    const svc = new NhlPlayoffStateService(mock);
    const result = await svc.getAliveTeamAbbreviations(2025);
    // No winner recorded → neither team is added or eliminated. Conservative.
    expect(result).toEqual([]);
  });
});
