import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mode = vi.hoisted(() => ({ prefetch: true }));
vi.mock('@/lib/scopedRead', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/scopedRead')>();
  return { ...actual, startScopedRead: (...args: Parameters<typeof actual.startScopedRead>) =>
    mode.prefetch ? actual.startScopedRead(...args) : undefined };
});
vi.mock('../LeagueService', () => ({ LeagueService: { getLeague: vi.fn(), getLineup: vi.fn(), saveLineup: vi.fn() } }));
vi.mock('../ScheduleService', () => ({ ScheduleService: { getGamesForTeams: vi.fn() } }));
vi.mock('@/api/matchups', () => ({ matchupApi: {} }));
vi.mock('../PlayerService', () => ({ PlayerService: {} }));
vi.mock('../DemoLeagueService', () => ({ DEMO_LEAGUE_ID_FOR_GUESTS: 'demo' }));
import { DEFAULT_SCORING } from '@citrus/shared';
import { MatchupService, type Matchup } from '../MatchupService';
import { LeagueService } from '../LeagueService';
import { ScheduleService } from '../ScheduleService';
import { startScopedRead, normalizedPlayerScope } from '@/lib/scopedRead';
const matchup = { id: 'm', league_id: 'l', team1_id: 'a', team2_id: 'b', week_start_date: '2026-09-14', week_end_date: '2026-09-20' } as Matchup;
const players = [{ id: 1, team: 'EDM', position: 'C', full_name: 'Skater' }, { id: 2, team: 'WPG', position: 'G', full_name: 'Goalie' }];
const projections = new Map([[1, { player_id: 1, projected_goals: 0, projected_assists: 0, projected_sog: 0, projected_blocks: 0, projected_ppp: 0, projected_shp: 0, projected_hits: 0, projected_pim: 0, projected_plus_minus: -2, total_projected_points: 0 }], [2, { player_id: 2, is_goalie: true, projected_wins: 0.4, projected_saves: 20, projected_goals_against: 3, projected_shutouts: 0, projected_gp: 0.6 }]]);
const wait = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
beforeEach(() => {
  mode.prefetch = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T19:00:00Z'));
  vi.mocked(LeagueService.getLeague).mockResolvedValue({ league: { id: 'l', scoring_settings: { ...DEFAULT_SCORING, skater: { ...DEFAULT_SCORING.skater, plus_minus: 1 } } }, error: null } as never);
  vi.mocked(LeagueService.getLineup).mockImplementation(team => wait(300, { starters: [team === 'a' ? '1' : '2'], bench: [], ir: [], slotAssignments: {} }));
  vi.mocked(ScheduleService.getGamesForTeams).mockImplementation(() => wait(286, { gamesByTeam: new Map() }) as never);
  vi.spyOn(MatchupService, 'getTeamRoster').mockImplementation(async team => [MatchupService.transformToHockeyPlayer(players[team === 'a' ? 0 : 1] as never)]);
  vi.spyOn(MatchupService, 'getMatchupLines').mockImplementation(() => wait(100, new Map()));
  vi.spyOn(MatchupService, 'fetchMatchupStatsForPlayers').mockImplementation(() => wait(226, new Map([[1, { goals: 0, assists: 0, sog: 0, blocks: 0, ppp: 0, shp: 0, hits: 0, pim: 0, plus_minus: -3 }], [2, { wins: 0, saves: 0, shutouts: 0, goals_against: 0 }]])));
  vi.spyOn(MatchupService, 'getDailyProjectionsForMatchup').mockImplementation(() => wait(380, structuredClone(projections)) as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });
async function load(prefetch: boolean) {
  mode.prefetch = prefetch;
  const started = Date.now();
  const receipt = startScopedRead(normalizedPlayerScope([1, 2], '2026-09-14'), () => MatchupService.getDailyProjectionsForMatchup([1, 2], '2026-09-14'));
  const pending = MatchupService.getMatchupRosters(matchup, players as never, undefined, 'user', undefined, receipt);
  await vi.runAllTimersAsync();
  return { value: await pending, elapsed: Date.now() - started };
}
it('overlaps all enrichment branches and returns exactly the same scored roster', async () => {
  const baseline = await load(false);
  const candidate = await load(true);
  expect(candidate.value.error).toBeNull();
  expect(candidate.value).toEqual(baseline.value);
  expect(candidate.value.team1Roster[0].points).toBe(-3);
  expect(candidate.value.team2Roster[0].points).toBe(0);
  expect(candidate.value.team1Roster[0].daily_projection?.projected_goals).toBe(0);
  expect(candidate.value.team1Roster[0].daily_projection?.projected_plus_minus).toBe(-2);
  expect(candidate.value.team2Roster[0].goalieProjection?.projected_wins).toBe(0.4);
  expect(baseline.elapsed).toBe(680);
  expect(candidate.elapsed).toBe(380);
  expect(LeagueService.saveLineup).not.toHaveBeenCalled();
});
it('refetches when construction drops a player from the requested ID set', async () => {
  vi.mocked(MatchupService.getTeamRoster).mockImplementation(async team => team === 'a' ? [MatchupService.transformToHockeyPlayer(players[0] as never)] : []);
  const result = await load(true);
  expect(result.value.error).toBeNull();
  expect(MatchupService.getDailyProjectionsForMatchup).toHaveBeenLastCalledWith([1], '2026-09-14');
  expect(MatchupService.fetchMatchupStatsForPlayers).toHaveBeenCalledTimes(2);
  expect(ScheduleService.getGamesForTeams).toHaveBeenCalledTimes(2);
});
it('keeps rejected enrichment reads within their existing graceful fallback boundary', async () => {
  vi.mocked(MatchupService.getDailyProjectionsForMatchup).mockRejectedValue(new Error('projection failed'));
  vi.mocked(MatchupService.getMatchupLines).mockRejectedValue(new Error('lines failed'));
  vi.mocked(MatchupService.fetchMatchupStatsForPlayers).mockRejectedValue(new Error('stats failed'));
  const baseline = await load(false);
  const candidate = await load(true);
  expect(candidate.value.error).toBeNull();
  expect(candidate.value).toEqual(baseline.value);
});
it('preserves fatal schedule failure at the roster boundary', async () => {
  vi.mocked(ScheduleService.getGamesForTeams).mockRejectedValue(new Error('schedule failed'));
  const candidate = await load(true);
  expect(candidate.value.error?.message).toBe('schedule failed');
});
it('retains lineup failure precedence while early enrichment rejects', async () => {
  vi.mocked(LeagueService.getLineup).mockRejectedValue(new Error('lineup failed'));
  vi.mocked(ScheduleService.getGamesForTeams).mockRejectedValue(new Error('schedule failed'));
  vi.mocked(MatchupService.getDailyProjectionsForMatchup).mockRejectedValue(new Error('projection failed'));
  expect((await load(true)).value.error?.message).toBe('lineup failed');
});
it('refetches today projections if the date changes during roster construction', async () => {
  vi.mocked(LeagueService.getLineup).mockImplementation(async team => {
    vi.setSystemTime(new Date('2026-09-15T19:00:00Z'));
    return { starters: [team === 'a' ? '1' : '2'], bench: [], ir: [], slotAssignments: {} };
  });
  const result = await load(true);
  expect(result.value.error).toBeNull();
  expect(MatchupService.getDailyProjectionsForMatchup).toHaveBeenLastCalledWith([1, 2], '2026-09-15');
  expect(MatchupService.getDailyProjectionsForMatchup).toHaveBeenCalledTimes(2);
});
it('awaits missing-lineup saves in the same order before hydrating the default roster', async () => {
  // These read fixtures are independent of saved lineup state. This replay
  // proves maintenance order and response parity, not concurrent DB equivalence.
  vi.mocked(LeagueService.getLineup).mockImplementation(() => wait(300, null));
  const originalTransform = MatchupService.transformToMatchupPlayerWithGames;
  const replay = async (prefetch: boolean) => {
    const trace: string[] = [];
    const saved: unknown[] = [];
    let saving = false;
    vi.mocked(LeagueService.saveLineup).mockImplementation(async (team, league, lineup) => {
      expect(saving).toBe(false);
      saving = true;
      trace.push(`save-start:${team}`);
      saved.push(structuredClone({ team, league, lineup }));
      await wait(200, undefined);
      trace.push(`save-end:${team}`);
      saving = false;
      return { error: null } as never;
    });
    const transform = vi.spyOn(MatchupService, 'transformToMatchupPlayerWithGames').mockImplementation(function (...args) {
      expect(saving).toBe(false);
      expect(trace.slice(0, 4)).toEqual(['save-start:a', 'save-end:a', 'save-start:b', 'save-end:b']);
      trace.push(`hydrate:${args[0].id}`);
      return originalTransform.apply(MatchupService, args);
    });
    const result = await load(prefetch);
    trace.push('response');
    transform.mockRestore();
    return { ...result, trace, saved };
  };
  const baseline = await replay(false);
  const candidate = await replay(true);
  expect(candidate.value.error).toBeNull();
  expect(candidate.value).toEqual(baseline.value);
  expect(candidate.saved).toEqual(baseline.saved);
  expect(candidate.saved).toHaveLength(2);
  expect(candidate.trace).toEqual(baseline.trace);
  expect(candidate.trace).toEqual(['save-start:a', 'save-end:a', 'save-start:b', 'save-end:b', 'hydrate:1', 'hydrate:2', 'response']);
  expect(baseline.elapsed).toBe(1080);
  expect(candidate.elapsed).toBe(700);
});
