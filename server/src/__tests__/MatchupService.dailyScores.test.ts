/**
 * calculateDailyMatchupScores — the single most important function in the
 * product, and until 2026-08-11 it had no test at all. The existing
 * MatchupService.test.ts has 43 tests and mentions neither this method nor
 * persist_matchup_lines.
 *
 * Its own file rather than an addition to MatchupService.test.ts, because that
 * file's getSupabaseAdmin mock builds a NEW client per call and so cannot be
 * asserted against. Restructuring it would put 43 passing tests at risk to add
 * three.
 *
 * What is pinned here, and why each one is a bug that actually happened:
 *   1. Scoring goes through calculate_daily_matchup_scores_v2, not the legacy
 *      function. Until today it used the legacy one while persist_matchup_lines
 *      scored through the rules table, so enabling any new category made the
 *      stored score and its own line items disagree — measured at 173.700 vs
 *      203.700, with check_matchup_score_calibration reporting an ERROR row.
 *   2. persist_matchup_lines is called, and called AFTER both scoring RPCs
 *      resolve. fantasy_matchup_lines was read in two places and written in
 *      zero for the whole life of the product.
 *   3. A persist failure must NOT fail scoring. The score is still correct;
 *      only its explanation is stale. Silent failure is what let the table sit
 *      empty, so it must log — but loudly, not fatally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain } from './helpers';

const { rpcMock, fromMock, loggerErrorMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}));

vi.mock('@citrus/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@citrus/shared')>();
  return {
    ...actual,
    logger: { ...actual.logger, error: loggerErrorMock, info: vi.fn(), warn: vi.fn() },
  };
});

import { MatchupService } from '../services/MatchupService';

const MATCHUP = {
  team1_id: 'team-1',
  team2_id: 'team-2',
  week_start_date: '2026-09-29',
  week_end_date: '2026-10-05',
  league_id: 'league-1',
};

function tableChains() {
  return {
    matchups: createChain({ data: MATCHUP, error: null }),
    // no lineup -> backfill bails harmlessly; not what these tests are about
    team_lineups: createChain({ data: null, error: null }),
    roster_assignments: createChain({ data: [], error: null }),
    draft_picks: createChain({ data: [], error: null }),
    fantasy_daily_rosters: createChain({ data: [], error: null }),
  };
}

describe('MatchupService.calculateDailyMatchupScores', () => {
  let service: MatchupService;

  beforeEach(() => {
    vi.clearAllMocks();
    const chains: Record<string, any> = tableChains();
    fromMock.mockImplementation((t: string) => chains[t] || createChain({ data: [], error: null }));
    rpcMock.mockResolvedValue({ data: [], error: null });
    service = new MatchupService({ from: fromMock, rpc: rpcMock } as any);
  });

  const rpcNames = () => rpcMock.mock.calls.map((c: any[]) => c[0]);

  it('scores through the v2 engine, never the legacy function', async () => {
    await service.calculateDailyMatchupScores('m-1');
    const names = rpcNames();
    expect(names.filter((n) => n === 'calculate_daily_matchup_scores_v2')).toHaveLength(2);
    expect(names).not.toContain('calculate_daily_matchup_scores');
  });

  it('scores each team once, with that team id and the matchup week', async () => {
    await service.calculateDailyMatchupScores('m-1');
    const scoring = rpcMock.mock.calls.filter((c: any[]) => c[0] === 'calculate_daily_matchup_scores_v2');
    expect(scoring.map((c: any[]) => c[1].p_team_id).sort()).toEqual(['team-1', 'team-2']);
    for (const call of scoring) {
      expect(call[1]).toMatchObject({
        p_matchup_id: 'm-1',
        p_week_start: '2026-09-29',
        p_week_end: '2026-10-05',
      });
    }
  });

  it('persists line items, AFTER both scoring calls have resolved', async () => {
    await service.calculateDailyMatchupScores('m-1');
    const names = rpcNames();
    const persistAt = names.indexOf('persist_matchup_lines');
    expect(persistAt).toBeGreaterThan(-1);
    const lastScoreAt = names.lastIndexOf('calculate_daily_matchup_scores_v2');
    expect(persistAt).toBeGreaterThan(lastScoreAt);
    const persistCall = rpcMock.mock.calls.find((c: any[]) => c[0] === 'persist_matchup_lines');
    expect(persistCall![1]).toEqual({ p_matchup_id: 'm-1' });
  });

  it('a persist failure is logged loudly but does NOT fail the score', async () => {
    rpcMock.mockImplementation((name: string) =>
      name === 'persist_matchup_lines'
        ? Promise.resolve({ data: null, error: { message: 'boom' } })
        : Promise.resolve({ data: [], error: null }),
    );
    const result = await service.calculateDailyMatchupScores('m-1');
    expect(result.error).toBeNull();
    expect(loggerErrorMock).toHaveBeenCalled();
    const logged = loggerErrorMock.mock.calls.map((c: any[]) => String(c[0])).join(' ');
    expect(logged).toContain('persist_matchup_lines');
  });

  it('a scoring failure DOES fail, and does not go on to persist stale lines', async () => {
    rpcMock.mockImplementation((name: string) =>
      name === 'calculate_daily_matchup_scores_v2'
        ? Promise.resolve({ data: null, error: { message: 'scoring exploded' } })
        : Promise.resolve({ data: [], error: null }),
    );
    const result = await service.calculateDailyMatchupScores('m-1');
    expect(result.error).toBeTruthy();
    expect(rpcNames()).not.toContain('persist_matchup_lines');
  });

  it('CONTROL: these assertions can fail — the mock records real calls', async () => {
    await service.calculateDailyMatchupScores('m-1');
    expect(rpcMock).toHaveBeenCalled();
    expect(rpcNames().length).toBeGreaterThanOrEqual(3);
  });
});
