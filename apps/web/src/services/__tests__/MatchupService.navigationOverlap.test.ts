import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ScoringCalculator, DEFAULT_SCORING } from '@citrus/shared';

const api = vi.hoisted(() => ({ league: vi.fn(), team: vi.fn(), navigation: vi.fn(), scores: vi.fn() }));
vi.mock('@/api/leagues', () => ({ leagueApi: { getLeague: api.league, getMyTeam: api.team } }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getUserMatchup: api.navigation, getDailyScores: api.scores } }));
vi.mock('../LeagueService', () => ({ LeagueService: { getLeagueTeams: vi.fn() } }));
vi.mock('../PlayerService', () => ({ PlayerService: { getPlayersByIds: vi.fn(), getAllPlayers: vi.fn() } }));
vi.mock('../ScheduleService', () => ({ ScheduleService: {} }));
vi.mock('../DemoLeagueService', () => ({ DEMO_LEAGUE_ID_FOR_GUESTS: 'demo' }));
import { MatchupService, type Matchup } from '../MatchupService';
import { LeagueService } from '../LeagueService';
import { PlayerService } from '../PlayerService';

const now = new Date('2026-09-12T19:00:00Z');
const matchup = {
  id: 'current-matchup', league_id: 'league-a', week_number: 1,
  team1_id: 'home', team2_id: 'away', team1_score: 0, team2_score: -2,
  status: 'scheduled', week_start_date: '2026-09-28', week_end_date: '2026-10-04',
} as Matchup;
const league = { id: 'league-a', updated_at: now.toISOString(), settings: { week_start_day: 1 } };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const wait = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const run = (current: Matchup | null = matchup, week = 1, targetDate?: string) =>
  MatchupService.getMatchupData('league-a', 'caller-a', week, 'America/Denver', current, targetDate);

function rosterResult(pmWeight = 0) {
  // Representative contract values, not newly authored production forecasts.
  // Use the real shared scorer; the loader must preserve its signed/zero/null
  // outputs and an already-weighted goalie projection without applying starts again.
  const scoring = { ...DEFAULT_SCORING, skater: { ...DEFAULT_SCORING.skater, plus_minus: pmWeight } };
  const scorer = new ScoringCalculator(scoring);
  const skater = { id: '8470001', points: scorer.calculatePoints({ goals: 0, plus_minus: -3 }, false),
    projectedPoints: 0, projectedPointsUnavailable: false, availability: { status: 'unknown' } };
  const goalie = { id: '8470002', points: 0,
    projectedPoints: scorer.calculatePoints({ wins: 0.8, saves: 55, goals_against: 5, shutouts: 0 }, true),
    expectedStarts: 2.7, gamesRemaining: 4 };
  const unsupported = { id: '8484795', points: 0, projectedPoints: null, projectedPointsUnavailable: true };
  return { team1Roster: [skater, goalie], team2Roster: [unsupported],
    team1SlotAssignments: { '8470001': 'c-slot-1', '8470002': 'g-slot-1' },
    team2SlotAssignments: { '8484795': 'bench-slot-1' }, error: null };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  api.league.mockResolvedValue({ data: league });
  api.team.mockResolvedValue({ data: { id: 'home', team_name: 'Home' } });
  api.navigation.mockResolvedValue({ data: { id: 'next-matchup' } });
  api.scores.mockResolvedValue({ data: [
    { team_id: 'home', roster_date: '2026-09-28', daily_score: '0' },
    { team_id: 'away', roster_date: '2026-09-28', daily_score: '-2' },
  ] });
  vi.mocked(LeagueService.getLeagueTeams).mockResolvedValue({ teams: [{ id: 'away', team_name: 'Away' }] } as never);
  vi.mocked(PlayerService.getPlayersByIds).mockResolvedValue([]);
  vi.mocked(PlayerService.getAllPlayers).mockResolvedValue([]);
  vi.spyOn(MatchupService, 'getRosterPlayerIds').mockResolvedValue(['8470001', '8470002']);
  vi.spyOn(MatchupService, 'getTeamRecord').mockResolvedValue({ wins: 2, losses: 1 });
  vi.spyOn(MatchupService, 'getMatchupRosters').mockResolvedValue(rosterResult() as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('starts navigation while roster work is pending, with unchanged league/week scope', async () => {
  const roster = deferred<ReturnType<typeof rosterResult>>();
  vi.mocked(MatchupService.getMatchupRosters).mockReturnValue(roster.promise as never);
  const result = run();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.navigation).toHaveBeenCalledExactlyOnceWith('league-a', 2);
  expect(api.scores).not.toHaveBeenCalled();
  roster.resolve(rosterResult());
  expect((await result).data?.navigation).toEqual({ previousWeek: null, nextWeek: 2, previousMatchupId: null, nextMatchupId: 'next-matchup' });
});

it('still waits for late navigation before returning the complete response', async () => {
  const next = deferred<{ data: { id: string } }>();
  api.navigation.mockReturnValue(next.promise);
  let completed = false;
  const result = run().then(value => { completed = true; return value; });
  await vi.advanceTimersByTimeAsync(0);
  expect(api.scores).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  next.resolve({ data: { id: 'next-matchup' } });
  expect((await result).error).toBeNull();
});

it.each(['league', 'team', 'matchup'])('does not prefetch before a valid %s exists', async missing => {
  if (missing === 'league') api.league.mockResolvedValue({ data: null });
  if (missing === 'team') api.team.mockResolvedValue({ data: null });
  if (missing === 'matchup') api.navigation.mockResolvedValue({ data: null });
  const result = await run(missing === 'matchup' ? null : matchup);
  expect(result.data).toBeNull();
  expect(api.navigation.mock.calls).toEqual(missing === 'matchup' ? [['league-a', 1]] : []);
});

it('preserves earlier roster failure even when prefetched navigation unexpectedly rejects', async () => {
  const failure = new Error('roster failure');
  vi.spyOn(MatchupService, 'getUserMatchup').mockRejectedValue(new Error('navigation failure'));
  vi.mocked(MatchupService.getMatchupRosters).mockResolvedValue({ ...rosterResult(), error: failure } as never);
  const result = await run();
  expect(result).toEqual({ data: null, error: failure });
});

it('keeps a normal navigation HTTP failure as the existing unavailable arrow', async () => {
  api.navigation.mockRejectedValue(new Error('forbidden'));
  const result = await run();
  expect(result.error).toBeNull();
  expect(result.data?.navigation.nextMatchupId).toBeNull();
});

it('reports an unexpected navigation rejection at the original response boundary', async () => {
  const failure = new Error('unexpected navigation failure');
  vi.spyOn(MatchupService, 'getUserMatchup').mockRejectedValue(failure);
  const result = await run();
  expect(api.scores).toHaveBeenCalledOnce();
  expect(result).toEqual({ data: null, error: failure });
});

it('retains both directions for an interior week and bypasses a missing opponent', async () => {
  const result = await run({ ...matchup, team2_id: null }, 2);
  expect(api.navigation.mock.calls).toEqual([['league-a', 1], ['league-a', 3]]);
  expect(result.data?.opponentTeam).toBeNull();
});

// Replay only the relevant measured stages of getMatchupData, using an
// identical virtual clock/inputs for baseline and candidate. This measures
// scheduling overlap in the real method, NOT production latency or paint.
describe('captured latency replay', () => {
  it.each([
    { label: 'Test', rosterMs: 568, scoreMs: 532, navigationMs: 265, pmWeight: 0 },
    { label: 'Finalsz', rosterMs: 620, scoreMs: 537, navigationMs: 252, pmWeight: 1 },
    { label: 'Cached-control', rosterMs: 620, scoreMs: 537, navigationMs: 0, pmWeight: 1 },
  ])('$label preserves the full response with representative scoring values', async sample => {
    const trace: Array<{ event: string; ms: number }> = [];
    const mark = (event: string) => trace.push({ event, ms: Date.now() - now.getTime() });
    const roster = rosterResult(sample.pmWeight);
    vi.mocked(MatchupService.getMatchupRosters).mockImplementation(() => { mark('roster-start'); return wait(sample.rosterMs, roster) as never; });
    api.navigation.mockImplementation(() => { mark('navigation-start'); return wait(sample.navigationMs, { data: { id: 'next-matchup' } }); });
    api.scores.mockImplementation(() => { mark('scores-start'); return wait(sample.scoreMs, { data: [
      { team_id: 'home', roster_date: '2026-09-28', daily_score: '0' },
      { team_id: 'away', roster_date: '2026-09-28', daily_score: '-2' },
    ] }); });
    const resultPromise = run().then(result => { mark('response'); return result; });
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.error).toBeNull();
    expect(result.data?.userTeam.roster).toEqual(roster.team1Roster);
    expect(result.data?.opponentTeam?.roster).toEqual(roster.team2Roster);
    expect(result.data?.userTeam.dailyPoints).toEqual([0]);
    expect(result.data?.opponentTeam?.dailyPoints).toEqual([-2]);
    expect(api.navigation).toHaveBeenCalledTimes(1);
    if (process.env.CITRUS_NAV_REPLAY_OUTPUT) {
      writeFileSync(`${process.env.CITRUS_NAV_REPLAY_OUTPUT}-${sample.label}.json`, JSON.stringify({
        sample, trace, response: result,
        responseSha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
        note: 'Virtual-clock service scheduling replay with representative roster/scoring fixtures; not production speedup.',
      }, null, 2));
    }
  });
});
