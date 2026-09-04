/**
 * GET /api/leagues/:leagueId/standings
 *
 * This route answered 500 on every request it has ever served. `getStandings`
 * selected `wins, losses, ties, points_for, points_against` from `teams`, and
 * `teams` has six columns: id, league_id, owner_id, team_name, created_at,
 * updated_at (production, verified 2026-09-03; COLUMNS.TEAM agrees). Postgres
 * answered 42703 'column "wins" does not exist' every time. Nothing in
 * apps/web/src calls `leagueApi.getStandings`, so nobody saw it -- but the
 * route is live and documented and a native client can reach it on day one.
 *
 * Standings are DERIVED from matchups. These tests pin four things:
 *
 *   1. The read no longer names a column `teams` does not have.
 *   2. The endpoint computes real records instead of failing.
 *   3. An unplayed week is not a tie (the demo league's 1-1-18).
 *   4. It computes with `deriveStandings` from @citrus/shared -- the SAME
 *      function apps/web/src/services/StandingsService.ts calls, over the same
 *      COLUMNS.MATCHUP rows. Two implementations of one rule is the bug class
 *      this repo keeps paying for; the parity test is what stops a third from
 *      growing here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deriveStandings, COLUMNS, type StandingsMatchup } from '@citrus/shared';
import { LeagueService } from '../LeagueService';
import { createChain, createMockSupabase } from '../../__tests__/helpers';

const LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

// Production shape: six columns, no W/L/T anywhere.
const TEAMS = [
  { id: 'team-storm', league_id: LEAGUE_ID, owner_id: 'owner-1', team_name: 'Citrus Storm', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'team-surge', league_id: LEAGUE_ID, owner_id: 'owner-2', team_name: 'Sunset Surge', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

// The demo league's real matchups, statuses and scores as production holds
// them. Twenty weeks scheduled; weeks 7 and 8 are the only ones ever scored.
// Week 6 is the Olympic break: 294 fantasy_daily_rosters rows, no NHL games,
// no scoring lines.
const MATCHUPS: StandingsMatchup[] = [
  { id: 'w1', week_number: 1, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-16' },
  { id: 'w2', week_number: 2, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-23' },
  { id: 'w3', week_number: 3, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'in_progress', week_end_date: '2026-01-30' },
  { id: 'w6', week_number: 6, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-20' },
  { id: 'w7', week_number: 7, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '58.000', team2_score: '70.900', status: 'completed', week_end_date: '2026-02-27' },
  { id: 'w8', week_number: 8, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '122.900', team2_score: '104.800', status: 'completed', week_end_date: '2026-03-06' },
  { id: 'w9', week_number: 9, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-13' },
  { id: 'w20', week_number: 20, team1_id: 'team-storm', team2_id: 'team-surge', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-05-29' },
];

interface Fixture {
  teams?: unknown[];
  matchups?: unknown[];
  teamsError?: { code: string; message: string } | null;
  matchupsError?: { code: string; message: string } | null;
}

function makeService(fixture: Fixture = {}) {
  const teamsChain = createChain(
    fixture.teamsError
      ? { data: null, error: fixture.teamsError }
      : { data: fixture.teams ?? TEAMS, error: null },
  );
  const matchupsChain = createChain(
    fixture.matchupsError
      ? { data: null, error: fixture.matchupsError }
      : { data: fixture.matchups ?? MATCHUPS, error: null },
  );

  const supabase = createMockSupabase({ teams: teamsChain, matchups: matchupsChain });
  return { service: new LeagueService(supabase), teamsChain, matchupsChain };
}

beforeEach(() => {
  // Pin "today" so the week window is deterministic. 18:00Z on 2026-09-03 is
  // noon Mountain, the timezone getTodayMST() answers in.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-03T18:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LeagueService.getStandings', () => {
  it('never selects a W/L/T column from teams', async () => {
    // The exact 42703 regression. `teams` has no wins/losses/ties/points_for/
    // points_against and never had; naming one is a guaranteed 500.
    const { service, teamsChain, matchupsChain } = makeService();
    await service.getStandings(LEAGUE_ID);

    const teamColumns = teamsChain.select.mock.calls[0][0] as string;
    expect(teamColumns).not.toMatch(/\bwins\b/);
    expect(teamColumns).not.toMatch(/\blosses\b/);
    expect(teamColumns).not.toMatch(/\bties\b/);
    expect(teamColumns).not.toMatch(/\bpoints_for\b/);
    expect(teamColumns).not.toMatch(/\bpoints_against\b/);
    expect(teamColumns).toBe(COLUMNS.TEAM);

    // Standings come from matchups, so the matchup read is the other half.
    expect(matchupsChain.select.mock.calls[0][0]).toBe(COLUMNS.MATCHUP);
  });

  it('returns real records instead of an error', async () => {
    const { service } = makeService();
    const { standings, error } = await service.getStandings(LEAGUE_ID);

    expect(error).toBeNull();
    expect(standings).toHaveLength(2);

    const storm = standings.find((row) => row.team_id === 'team-storm');
    const surge = standings.find((row) => row.team_id === 'team-surge');

    expect(storm).toMatchObject({
      team_name: 'Citrus Storm',
      owner_id: 'owner-1',
      wins: 1,
      losses: 1,
      ties: 0,
      gamesPlayed: 2,
      winPct: 0.5,
      streak: 'W1',
    });
    expect(storm?.pointsFor).toBeCloseTo(180.9, 6);
    expect(storm?.pointsAgainst).toBeCloseTo(175.7, 6);
    expect(surge).toMatchObject({ wins: 1, losses: 1, ties: 0, streak: 'L1' });
  });

  it('books zero ties for the weeks that were never played', async () => {
    // 1-1-18 on the demo league is what shipped. Not one of the unscored
    // weeks may become a draw, whatever status it happens to carry.
    const { service } = makeService();
    const { standings } = await service.getStandings(LEAGUE_ID);

    for (const row of standings) {
      expect(row.ties).toBe(0);
      expect(row.gamesPlayed).toBe(2);
    }
  });

  it('agrees exactly with the shared rule the web app uses', async () => {
    // PARITY. apps/web/src/services/StandingsService.calculateTeamStandings
    // calls this same function over these same COLUMNS.MATCHUP rows, so while
    // this holds the two surfaces cannot report different records.
    const { service } = makeService();
    const { standings } = await service.getStandings(LEAGUE_ID);

    const expected = deriveStandings(TEAMS.map((team) => team.id), MATCHUPS, '2026-09-03');

    for (const row of standings) {
      expect({
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        streak: row.streak,
        last5: row.last5,
      }).toEqual(expected[row.team_id]);
    }
  });

  it('sorts by wins, then points for', async () => {
    const matchups: StandingsMatchup[] = [
      { id: 'a', week_number: 1, team1_id: 'team-surge', team2_id: 'team-storm', team1_score: 200, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' },
    ];
    const { service } = makeService({ matchups });
    const { standings } = await service.getStandings(LEAGUE_ID);

    expect(standings.map((row) => row.team_id)).toEqual(['team-surge', 'team-storm']);
  });

  it('still lists every team at 0-0-0 when the matchup read fails', async () => {
    // A matchup read failure is not a standings failure. Answering 500 here
    // would put the route back exactly where it started.
    const { service } = makeService({ matchupsError: { code: '42P01', message: 'relation does not exist' } });
    const { standings, error } = await service.getStandings(LEAGUE_ID);

    expect(error).toBeNull();
    expect(standings).toHaveLength(2);
    expect(standings.every((row) => row.gamesPlayed === 0 && row.winPct === 0)).toBe(true);
  });

  it('surfaces a teams read failure to the route', async () => {
    const teamsError = { code: '42501', message: 'permission denied' };
    const { service } = makeService({ teamsError });
    const { standings, error } = await service.getStandings(LEAGUE_ID);

    expect(standings).toEqual([]);
    expect(error).toEqual(teamsError);
  });

  it('returns an empty list for a league with no teams', async () => {
    const { service } = makeService({ teams: [], matchups: [] });
    const { standings, error } = await service.getStandings(LEAGUE_ID);

    expect(error).toBeNull();
    expect(standings).toEqual([]);
  });
});
