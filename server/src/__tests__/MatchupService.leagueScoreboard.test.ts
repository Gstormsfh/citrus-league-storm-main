/**
 * LEAGUE SCOREBOARD PROJECTIONS (2026-09-03, Sleeper parity audit M7).
 *
 * The league scoreboard strip prints a projected final per side, computed
 * here on the server from the same three tables the matchup page reads for
 * its own "proj": the frozen daily rosters (else the current lineup), the
 * per-player daily projections, and the game's clock. What is pinned:
 *
 *   1. The fraction rule matches apps/web/src/utils/winProbability.ts
 *      fixture for fixture, so a live game counts only its unplayed share
 *      and a final one counts nothing (the banked score already has it).
 *   2. The sum: banked + remaining starter-games, with one game final and
 *      one not, the frozen-roster-else-current-lineup precedence, and
 *      yesterday excluded.
 *   3. null, never 0, for a closed matchup, a bye, a side with no lineup,
 *      and a week with no projection rows at all.
 *   4. getLeagueScoreboard reads through the caller's user-scoped client,
 *      one query per table per league-week, and ships live scores with null
 *      projections when a read fails.
 *   5. The route computes projections for `?week=N` only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChain, createMockSupabase } from './helpers';

// Hoisted so the mock factory (which runs when the service module is first
// imported, before this file's body) can see it.
const { adminFrom } = vi.hoisted(() => ({ adminFrom: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: adminFrom, rpc: vi.fn() })),
}));

import {
  MatchupService,
  isOpenScoreboardMatchup,
  projectLeagueWeek,
  scoreboardFractionFromStartTime,
  scoreboardGameFraction,
  scoreboardWeekDates,
  type ScoreboardMatchupRow,
  type ScoreboardProjectionRow,
  type ScoreboardRosterRow,
} from '../services/MatchupService';

const TODAY = '2026-10-14';
const NOW_MS = Date.parse('2026-10-14T20:30:00-06:00');

const matchup = (over: Partial<ScoreboardMatchupRow> = {}): ScoreboardMatchupRow => ({
  id: 'm1',
  team1_id: 't1',
  team2_id: 't2',
  team1_score: '12.4',
  team2_score: 9.8,
  status: 'in_progress',
  week_start_date: '2026-10-12',
  week_end_date: '2026-10-18',
  ...over,
});

/**
 * The fixture. Team t1 has frozen rows for today only (players 1 and 2);
 * its current lineup says the same two start, which is what the later days
 * fall back to. Team t2 has a frozen row for today (player 3) and a lineup
 * of player 3.
 *
 *   player 1, today      game FINAL        -> adds 0 (already banked)
 *   player 2, today      game scheduled    -> adds 4.0
 *   player 1, 10-16      scheduled, no frozen row -> lineup fallback, adds 3.0
 *   player 1, 10-13      yesterday         -> ignored
 *   player 3, today      live, 2nd 10:00   -> half of 6.0 = 3.0
 *
 *   t1: 12.4 + 4.0 + 3.0 = 19.4       t2: 9.8 + 3.0 = 12.8
 */
const rosters: ScoreboardRosterRow[] = [
  { matchup_id: 'm1', team_id: 't1', roster_date: TODAY, player_id: 1 },
  { matchup_id: 'm1', team_id: 't1', roster_date: TODAY, player_id: '2' },
  { matchup_id: 'm1', team_id: 't2', roster_date: TODAY, player_id: 3 },
];
const lineups = [
  { team_id: 't1', starters: [1, '2'] },
  { team_id: 't2', starters: ['3'] },
];
const projections: ScoreboardProjectionRow[] = [
  { player_id: 1, projection_date: TODAY, total_projected_points: '5.5', game: { status: 'final', period: '3rd' } },
  { player_id: 2, projection_date: TODAY, total_projected_points: 4, game: { status: 'scheduled' } },
  { player_id: 1, projection_date: '2026-10-16', total_projected_points: 3, game: { status: 'scheduled' } },
  { player_id: 1, projection_date: '2026-10-13', total_projected_points: 9, game: { status: 'final' } },
  { player_id: 3, projection_date: TODAY, total_projected_points: 6, game: { status: 'live', period: '2nd', period_time: '10:00' } },
];

const input = (over: Partial<Parameters<typeof projectLeagueWeek>[0]> = {}) => ({
  matchups: [matchup()],
  rosters,
  lineups,
  projections,
  today: TODAY,
  nowMs: NOW_MS,
  ...over,
});

describe('scoreboardGameFraction matches the page fixture for fixture', () => {
  it('reads the schedule row', () => {
    expect(scoreboardGameFraction({ status: 'scheduled' })).toBe(1);
    expect(scoreboardGameFraction({ status: 'final', period: '3rd' })).toBe(0);
    expect(scoreboardGameFraction({ status: 'postponed' })).toBe(0);
  });

  it('uses the period clock when it has one', () => {
    expect(scoreboardGameFraction({ status: 'live', period: '2nd', period_time: '10:00' })).toBeCloseTo(0.5);
    expect(scoreboardGameFraction({ status: 'live', period: '1st', period_time: '20:00' })).toBeCloseTo(1);
    expect(scoreboardGameFraction({ status: 'live', period: '3rd', period_time: '00:30' })).toBeCloseTo(0.5 / 60);
  });

  it('handles intermissions, unknown clocks and overtime', () => {
    expect(scoreboardGameFraction({ status: 'intermission', period: '1st', period_time: 'INT' })).toBeCloseTo(2 / 3);
    expect(scoreboardGameFraction({ status: 'live', period: '3rd', period_time: null })).toBeCloseTo(0.5 / 3);
    expect(scoreboardGameFraction({ status: 'live', period: 'OT', period_time: '03:12' })).toBe(0.05);
    expect(scoreboardGameFraction({ status: 'live', period: 'SO' })).toBe(0.05);
  });

  it('treats a stale "scheduled" row with a score on it as started', () => {
    expect(scoreboardGameFraction({ status: 'scheduled', home_score: 2, away_score: 1 })).toBe(0.5);
  });

  it('falls back to the wall clock only when there is no schedule row', () => {
    const start = '2026-10-14T19:00:00-06:00';
    expect(scoreboardFractionFromStartTime(start, Date.parse('2026-10-14T18:00:00-06:00'))).toBe(1);
    expect(scoreboardFractionFromStartTime(start, Date.parse('2026-10-14T20:15:00-06:00'))).toBeCloseTo(0.5);
    expect(scoreboardFractionFromStartTime(start, Date.parse('2026-10-14T23:00:00-06:00'))).toBe(0);
    expect(scoreboardFractionFromStartTime(null, NOW_MS)).toBe(1);
    expect(scoreboardFractionFromStartTime('not a date', NOW_MS)).toBe(1);
  });
});

describe('scoreboardWeekDates / isOpenScoreboardMatchup', () => {
  it('enumerates the week inclusive, date-only', () => {
    expect(scoreboardWeekDates('2026-10-12', '2026-10-18')).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    expect(scoreboardWeekDates('', '2026-10-18')).toEqual([]);
  });

  it('a matchup is open until the scorer closes it or its week ends on the calendar', () => {
    expect(isOpenScoreboardMatchup(matchup(), TODAY)).toBe(true);
    expect(isOpenScoreboardMatchup(matchup({ status: 'completed' }), TODAY)).toBe(false);
    expect(isOpenScoreboardMatchup(matchup({ week_end_date: '2026-10-13' }), TODAY)).toBe(false);
    expect(isOpenScoreboardMatchup(matchup({ week_end_date: TODAY }), TODAY)).toBe(true);
    expect(isOpenScoreboardMatchup(matchup({ team2_id: null }), TODAY)).toBe(false);
  });
});

describe('projectLeagueWeek: banked + the unplayed share of every remaining starter-game', () => {
  it('one game final, one not: the final one adds nothing, the open one adds its projection', () => {
    const totals = projectLeagueWeek(input());
    expect(totals.get('m1')?.team1).toBeCloseTo(19.4);
    expect(totals.get('m1')?.team2).toBeCloseTo(12.8);
  });

  it('counts the starter-games still to be played: the final one is not, the live one still is', () => {
    const totals = projectLeagueWeek(input());
    // t1: player 2 today (scheduled) and player 1 on 10-16; player 1's final today is done.
    expect(totals.get('m1')?.team1GamesLeft).toBe(2);
    // t2: player 3's game is in the 2nd period -- still a game left.
    expect(totals.get('m1')?.team2GamesLeft).toBe(1);
    // Tomorrow: only the 10-16 game remains for t1, nothing for t2.
    const later = projectLeagueWeek(input({ today: '2026-10-15' })).get('m1');
    expect(later?.team1GamesLeft).toBe(1);
    expect(later?.team2GamesLeft).toBe(0);
  });

  it('a frozen roster for the day wins over the current lineup; a day with no frozen row falls back to it', () => {
    // Today's frozen row benches player 1 for t1 (only player 2 starts) while
    // the current lineup still names both. Give player 1 an OPEN game today:
    // through the lineup it would add 5.5, through the frozen row nothing.
    // The 10-16 game, a day with no frozen row, still counts via the lineup.
    const totals = projectLeagueWeek(input({
      rosters: rosters.filter((r) => !(r.team_id === 't1' && r.player_id === 1)),
      lineups: [{ team_id: 't1', starters: [1, 2] }, { team_id: 't2', starters: [3] }],
      projections: projections.map((p) =>
        p.player_id === 1 && p.projection_date === TODAY ? { ...p, game: { status: 'scheduled' } } : p,
      ),
    }));
    expect(totals.get('m1')?.team1).toBeCloseTo(12.4 + 4 + 3);
    // Without any lineup, the later days have nobody to project.
    const frozenOnly = projectLeagueWeek(input({ lineups: [{ team_id: 't2', starters: [3] }] }));
    expect(frozenOnly.get('m1')?.team1).toBeCloseTo(12.4 + 4);
  });

  it('yesterday is banked, not projected', () => {
    const totals = projectLeagueWeek(input({ today: '2026-10-15' }));
    // Only the 10-16 game is left for t1; t2 has nothing left.
    expect(totals.get('m1')?.team1).toBeCloseTo(12.4 + 3);
    expect(totals.get('m1')?.team2).toBeCloseTo(9.8);
  });

  it('a projection with no game row uses the wall clock from its start time', () => {
    const totals = projectLeagueWeek(input({
      projections: [
        { player_id: 2, projection_date: TODAY, total_projected_points: 4, game: null, game_start_time: '2026-10-14T19:15:00-06:00' },
        { player_id: 3, projection_date: TODAY, total_projected_points: 6, game: [{ status: 'scheduled' }] },
      ],
      nowMs: Date.parse('2026-10-14T20:30:00-06:00'),
    }));
    // 75 minutes into a 150-minute game: half of 4.0 remains.
    expect(totals.get('m1')?.team1).toBeCloseTo(12.4 + 2);
    // An embedded to-one that arrives as a one-element array still reads.
    expect(totals.get('m1')?.team2).toBeCloseTo(9.8 + 6);
  });

  it('null, never 0: closed matchup, bye, a side with no lineup, or no projections at all', () => {
    const nothing = { team1: null, team2: null, team1GamesLeft: null, team2GamesLeft: null };
    expect(projectLeagueWeek(input({ matchups: [matchup({ status: 'completed' })] })).get('m1')).toEqual(nothing);
    expect(projectLeagueWeek(input({ matchups: [matchup({ week_end_date: '2026-10-13' })] })).get('m1')).toEqual(nothing);
    expect(projectLeagueWeek(input({ matchups: [matchup({ team2_id: null })] })).get('m1')).toEqual(nothing);
    // t2 has neither frozen rows nor a lineup: the page says nothing until
    // both lineups are in hand, and so does this, for BOTH sides.
    expect(projectLeagueWeek(input({
      rosters: rosters.filter((r) => r.team_id !== 't2'),
      lineups: [{ team_id: 't1', starters: [1, 2] }],
    })).get('m1')).toEqual(nothing);
    expect(projectLeagueWeek(input({ projections: [] })).get('m1')).toEqual(nothing);
    // ...whereas a side whose starters simply have no games left is a real number.
    expect(projectLeagueWeek(input({ today: '2026-10-15' })).get('m1')?.team2).toBeCloseTo(9.8);
  });

  it('ignores rows it cannot key: junk player ids, an unknown matchup', () => {
    const totals = projectLeagueWeek(input({
      rosters: [...rosters, { matchup_id: 'm1', team_id: 't1', roster_date: TODAY, player_id: 'abc' }],
      lineups: [...lineups, { team_id: 't9', starters: 'not-an-array' }],
    }));
    expect(totals.get('m1')?.team1).toBeCloseTo(19.4);
    expect(totals.has('m9')).toBe(false);
  });
});

describe('MatchupService.getLeagueScoreboard: the reads', () => {
  const rows = [
    { ...matchup(), league_id: 'league-1', week_number: 3, team1: { id: 't1', team_name: 'A' }, team2: { id: 't2', team_name: 'B' } },
    { ...matchup({ id: 'm2', team1_id: 't3', team2_id: null, team1_score: 40 }), league_id: 'league-1', week_number: 3 },
    { ...matchup({ id: 'm3', team1_id: 't4', team2_id: 't5', status: 'completed' }), league_id: 'league-1', week_number: 3 },
  ];

  const chains = () => ({
    matchups: createChain({ data: rows, error: null }),
    fantasy_daily_rosters: createChain({ data: rosters, error: null }),
    team_lineups: createChain({ data: lineups, error: null }),
    player_projected_stats: createChain({ data: projections, error: null }),
  });

  beforeEach(() => {
    adminFrom.mockClear();
  });

  it('returns every matchup with a projected total per side, null where there is nothing to say', async () => {
    const tables = chains();
    const supabase = createMockSupabase(tables);
    const service = new MatchupService(supabase);

    const { matchups, error } = await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);

    expect(error).toBeNull();
    expect(matchups).toHaveLength(3);
    const m1 = matchups.find((m) => m.id === 'm1')!;
    expect(m1.team1_projected_total).toBeCloseTo(19.4);
    expect(m1.team2_projected_total).toBeCloseTo(12.8);
    expect(m1.team1_games_left).toBe(2);
    expect(m1.team2_games_left).toBe(1);
    // The row shape the page already reads is untouched.
    expect(m1.team1).toEqual({ id: 't1', team_name: 'A' });
    expect(m1.team1_score).toBe('12.4');
    // A bye and a completed matchup say nothing.
    expect(matchups.find((m) => m.id === 'm2')).toMatchObject({ team1_projected_total: null, team2_projected_total: null });
    expect(matchups.find((m) => m.id === 'm3')).toMatchObject({ team1_projected_total: null, team2_projected_total: null });
  });

  it('reads through the user-scoped client, one query per table for the league-week, never the admin client', async () => {
    const tables = chains();
    const supabase = createMockSupabase(tables);
    const service = new MatchupService(supabase);

    await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);

    const touched = supabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(touched).toEqual(['matchups', 'fantasy_daily_rosters', 'team_lineups', 'player_projected_stats']);
    expect(adminFrom).not.toHaveBeenCalled();

    // Rosters: the open matchups only, active slots, from today to the week's end.
    expect(tables.fantasy_daily_rosters.in).toHaveBeenCalledWith('matchup_id', ['m1']);
    expect(tables.fantasy_daily_rosters.eq).toHaveBeenCalledWith('slot_type', 'active');
    expect(tables.fantasy_daily_rosters.gte).toHaveBeenCalledWith('roster_date', TODAY);
    expect(tables.fantasy_daily_rosters.lte).toHaveBeenCalledWith('roster_date', '2026-10-18');
    // Lineups: the league's, for the open matchups' teams.
    expect(tables.team_lineups.eq).toHaveBeenCalledWith('league_id', 'league-1');
    expect(tables.team_lineups.in).toHaveBeenCalledWith('team_id', ['t1', 't2']);
    // Projections: every starter named above, same window, the game embedded.
    expect(tables.player_projected_stats.in).toHaveBeenCalledWith('player_id', expect.arrayContaining([1, 2, 3]));
    expect(tables.player_projected_stats.gte).toHaveBeenCalledWith('projection_date', TODAY);
    expect(tables.player_projected_stats.lte).toHaveBeenCalledWith('projection_date', '2026-10-18');
    const selected = String(tables.player_projected_stats.select.mock.calls[0][0]);
    expect(selected).toContain('total_projected_points');
    expect(selected).toContain('nhl_games!game_id(');
  });

  it('a week with nothing open reads the matchups only', async () => {
    const tables = chains();
    tables.matchups = createChain({ data: rows.map((r) => ({ ...r, status: 'completed' })), error: null });
    const supabase = createMockSupabase(tables);
    const service = new MatchupService(supabase);

    const { matchups } = await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);

    expect(supabase.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['matchups']);
    for (const m of matchups) {
      expect(m.team1_projected_total).toBeNull();
      expect(m.team2_projected_total).toBeNull();
    }
  });

  it('a failed roster or projection read ships the live scores with null projections, not an error', async () => {
    const broken = chains();
    broken.fantasy_daily_rosters = createChain({ data: null, error: { message: 'boom' } });
    let service = new MatchupService(createMockSupabase(broken));
    let result = await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);
    expect(result.error).toBeNull();
    expect(result.matchups).toHaveLength(3);
    expect(result.matchups[0].team1_projected_total).toBeNull();
    expect(result.matchups[0].team1_score).toBe('12.4');

    const brokenProj = chains();
    brokenProj.player_projected_stats = createChain({ data: null, error: { message: 'boom' } });
    service = new MatchupService(createMockSupabase(brokenProj));
    result = await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);
    expect(result.error).toBeNull();
    expect(result.matchups[0].team1_projected_total).toBeNull();
  });

  it('a failed matchups read is still the endpoint error it always was', async () => {
    const tables = chains();
    tables.matchups = createChain({ data: null, error: { message: 'Query failed' } });
    const service = new MatchupService(createMockSupabase(tables));
    const result = await service.getLeagueScoreboard('league-1', 3, TODAY, NOW_MS);
    expect(result.error).toEqual({ message: 'Query failed' });
    expect(result.matchups).toEqual([]);
  });
});

describe('the league route computes projections for ?week=N only', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ROUTES = readFileSync(resolve(here, '../routes/matchups.ts'), 'utf-8');

  it("GET /league/:leagueId branches on the week query", () => {
    const start = ROUTES.indexOf("matchupRoutes.get('/league/:leagueId', membershipMiddleware");
    const end = ROUTES.indexOf('matchupRoutes.', start + 10);
    const route = ROUTES.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(route).toContain('membershipMiddleware');
    expect(route).toContain("createUserClient(c.get('userToken'))");
    expect(route).toContain('service.getLeagueScoreboard(leagueId, weekNumber)');
    expect(route).toContain('service.getLeagueMatchups(leagueId, weekNumber)');
    expect(route).not.toContain('getSupabaseAdmin');
  });
});
