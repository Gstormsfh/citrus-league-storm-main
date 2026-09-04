import { describe, it, expect } from 'vitest';
import {
  deriveStandings,
  rankStandings,
  isMatchupFinal,
  wasMatchupPlayed,
  countsTowardRecord,
  toMatchupScore,
  type StandingsMatchup,
} from '../standings';

/**
 * The rule that stops the standings table saying something untrue.
 *
 * The load-bearing case is the first describe block: an unplayed week is not
 * a tie. Production 2026-09-03, league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9,
 * showed both teams at 1-1-18 with eighteen of those "ties" being weeks that
 * were never scored. The fixture below is that league, week for week.
 */

const TODAY = '2026-09-03';

/** The demo league's real matchup rows, as `matchups` holds them. */
const DEMO_LEAGUE: StandingsMatchup[] = [
  { id: 'w1', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-16' },
  { id: 'w2', week_number: 2, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-23' },
  { id: 'w3', week_number: 3, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'in_progress', week_end_date: '2026-01-30' },
  { id: 'w4', week_number: 4, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-06' },
  { id: 'w5', week_number: 5, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-13' },
  // Week 6 is the Olympic break: 294 fantasy_daily_rosters rows, zero NHL
  // games, zero scoring lines. Lineup intent is not a result.
  { id: 'w6', week_number: 6, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-20' },
  { id: 'w7', week_number: 7, team1_id: 'A', team2_id: 'B', team1_score: '58.000', team2_score: '70.900', status: 'completed', week_end_date: '2026-02-27' },
  { id: 'w8', week_number: 8, team1_id: 'A', team2_id: 'B', team1_score: '122.900', team2_score: '104.800', status: 'completed', week_end_date: '2026-03-06' },
  { id: 'w9', week_number: 9, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-13' },
  { id: 'w10', week_number: 10, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-20' },
  { id: 'w11', week_number: 11, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-27' },
  { id: 'w12', week_number: 12, team1_id: 'A', team2_id: 'B', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-04-03' },
];

describe('an unplayed week is not a tie', () => {
  it('reads the demo league as 1-1-0, not 1-1-18', () => {
    const stats = deriveStandings(['A', 'B'], DEMO_LEAGUE, TODAY);

    expect(stats.A).toEqual({
      pointsFor: 180.9,
      pointsAgainst: 175.7,
      wins: 1,
      losses: 1,
      ties: 0,
      streak: 'W1',
      last5: { wins: 1, losses: 1, ties: 0 },
    });
    expect(stats.B.wins).toBe(1);
    expect(stats.B.losses).toBe(1);
    expect(stats.B.ties).toBe(0);
  });

  it('counts zero ties no matter which status an unscored week carries', () => {
    // Weeks 1, 2, 9, 10 and 11 are 'completed' at 0-0 in production. Status
    // alone cannot be the gate.
    const completedZeros = DEMO_LEAGUE.filter(
      (m) => m.status === 'completed' && toMatchupScore(m.team1_score) === 0,
    );
    expect(completedZeros.length).toBeGreaterThan(0);

    const stats = deriveStandings(['A', 'B'], completedZeros, TODAY);
    expect(stats.A.ties).toBe(0);
    expect(stats.A.wins).toBe(0);
    expect(stats.A.losses).toBe(0);
    expect(stats.A.streak).toBe('-');
  });

  it('does not book the Olympic break as a played draw', () => {
    const week6 = DEMO_LEAGUE.filter((m) => m.id === 'w6');
    expect(deriveStandings(['A', 'B'], week6, TODAY).A.ties).toBe(0);
  });

  it('leaves points for and against untouched by unplayed weeks', () => {
    const stats = deriveStandings(['A', 'B'], DEMO_LEAGUE, TODAY);
    // 58.0 + 122.9 for A, 70.9 + 104.8 against. Nothing from the other ten.
    expect(stats.A.pointsFor).toBeCloseTo(180.9, 6);
    expect(stats.A.pointsAgainst).toBeCloseTo(175.7, 6);
  });
});

describe('a played result still counts', () => {
  it('counts a genuine tie between two scoring teams', () => {
    const stats = deriveStandings(
      ['A', 'B'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 100, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' }],
      TODAY,
    );
    expect(stats.A.ties).toBe(1);
    expect(stats.B.ties).toBe(1);
    expect(stats.A.streak).toBe('T1');
  });

  it('counts a real 0-0 week when the caller supplies played evidence', () => {
    // The vanishingly rare case the score inference cannot see. `played` is
    // authoritative, so a scored-at timestamp or an EXISTS on
    // fantasy_matchup_lines books it correctly without changing this rule.
    const stats = deriveStandings(
      ['A', 'B'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 0, team2_score: 0, status: 'completed', week_end_date: '2026-03-01', played: true }],
      TODAY,
    );
    expect(stats.A.ties).toBe(1);
    expect(stats.B.ties).toBe(1);
  });

  it('excludes a week the caller marks unplayed even when it carries a score', () => {
    const stats = deriveStandings(
      ['A', 'B'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-03-01', played: false }],
      TODAY,
    );
    expect(stats.A.wins).toBe(0);
    expect(stats.B.losses).toBe(0);
  });

  it('counts a scored week whose status the auto-complete cron has not stamped yet', () => {
    // auto_complete_matchups() runs on a schedule. Between the week ending
    // and that run the row is still 'in_progress' and must stay in the table.
    const stats = deriveStandings(
      ['A', 'B'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'in_progress', week_end_date: '2026-09-02' }],
      TODAY,
    );
    expect(stats.A.wins).toBe(1);
    expect(stats.B.losses).toBe(1);
  });

  it('ignores a week that has not ended yet', () => {
    const stats = deriveStandings(
      ['A', 'B'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'in_progress', week_end_date: '2026-09-09' }],
      TODAY,
    );
    expect(stats.A.wins).toBe(0);
  });
});

describe('bye weeks', () => {
  it('awards a win for a played bye', () => {
    const stats = deriveStandings(
      ['A'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: null, team1_score: 100, team2_score: null, status: 'completed', week_end_date: '2026-03-01' }],
      TODAY,
    );
    expect(stats.A.wins).toBe(1);
    expect(stats.A.pointsFor).toBe(100);
    expect(stats.A.pointsAgainst).toBe(0);
  });

  it('awards nothing for an unplayed bye', () => {
    // Matches auto_complete_matchups()'s own bye predicate:
    // (team2_id IS NULL AND team1_score > 0).
    const stats = deriveStandings(
      ['A'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: null, team1_score: 0, team2_score: null, status: 'completed', week_end_date: '2026-03-01' }],
      TODAY,
    );
    expect(stats.A.wins).toBe(0);
    expect(stats.A.streak).toBe('-');
  });
});

describe('bookkeeping', () => {
  it('deduplicates matchups by id', () => {
    const row: StandingsMatchup = { id: 'm1', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' };
    const stats = deriveStandings(['A', 'B'], [row, row], TODAY);
    expect(stats.A.wins).toBe(1);
  });

  it('initializes every team, including one with no matchups', () => {
    const stats = deriveStandings(['A', 'B', 'C'], [], TODAY);
    expect(Object.keys(stats).sort()).toEqual(['A', 'B', 'C']);
    expect(stats.C).toEqual({
      pointsFor: 0, pointsAgainst: 0, wins: 0, losses: 0, ties: 0,
      streak: '-', last5: { wins: 0, losses: 0, ties: 0 },
    });
  });

  it('ignores a matchup naming a team that is not in the league', () => {
    const stats = deriveStandings(
      ['A'],
      [{ id: 'm', week_number: 1, team1_id: 'A', team2_id: 'GHOST', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' }],
      TODAY,
    );
    expect(stats.A.wins).toBe(1);
    expect(stats.GHOST).toBeUndefined();
  });

  it('builds streak and last5 from played weeks only', () => {
    const rows: StandingsMatchup[] = [
      { id: 'm1', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-02-15' },
      { id: 'm2', week_number: 2, team1_id: 'A', team2_id: 'B', team1_score: 130, team2_score: 100, status: 'completed', week_end_date: '2026-02-22' },
      // Never played. Under the old rule this landed between the two wins as
      // a tie and reported the streak as W1 instead of W3.
      { id: 'm3', week_number: 3, team1_id: 'A', team2_id: 'B', team1_score: 0, team2_score: 0, status: 'completed', week_end_date: '2026-03-01' },
      { id: 'm4', week_number: 4, team1_id: 'A', team2_id: 'B', team1_score: 140, team2_score: 100, status: 'completed', week_end_date: '2026-03-08' },
    ];
    const stats = deriveStandings(['A', 'B'], rows, TODAY);
    expect(stats.A.streak).toBe('W3');
    expect(stats.B.streak).toBe('L3');
    expect(stats.A.last5).toEqual({ wins: 3, losses: 0, ties: 0 });
  });

  it('caps last5 at five played weeks', () => {
    const rows: StandingsMatchup[] = [];
    for (let i = 1; i <= 6; i++) {
      rows.push({
        id: `m${i}`, week_number: i, team1_id: 'A', team2_id: 'B',
        team1_score: i <= 4 ? 120 : 80, team2_score: 100,
        status: 'completed', week_end_date: `2026-02-${String(i * 4).padStart(2, '0')}`,
      });
    }
    const stats = deriveStandings(['A', 'B'], rows, TODAY);
    expect(stats.A.last5).toEqual({ wins: 3, losses: 2, ties: 0 });
  });

  it('reads numeric columns that arrive as strings', () => {
    expect(toMatchupScore('58.000')).toBe(58);
    expect(toMatchupScore(null)).toBe(0);
    expect(toMatchupScore(undefined)).toBe(0);
    expect(toMatchupScore('not a number')).toBe(0);
  });
});

describe('the gate, piece by piece', () => {
  const scored: StandingsMatchup = { id: 'm', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 10, team2_score: 5, status: 'scheduled', week_end_date: '2026-08-01' };
  const unscored: StandingsMatchup = { ...scored, team1_score: 0, team2_score: 0 };

  it('isMatchupFinal accepts completed or past, rejects future', () => {
    expect(isMatchupFinal({ ...unscored, status: 'completed', week_end_date: '2027-01-01' }, TODAY)).toBe(true);
    expect(isMatchupFinal(unscored, TODAY)).toBe(true);
    expect(isMatchupFinal({ ...unscored, week_end_date: '2026-12-31' }, TODAY)).toBe(false);
  });

  it('wasMatchupPlayed needs a score above zero, or explicit evidence', () => {
    expect(wasMatchupPlayed(scored)).toBe(true);
    expect(wasMatchupPlayed(unscored)).toBe(false);
    expect(wasMatchupPlayed({ ...unscored, played: true })).toBe(true);
    expect(wasMatchupPlayed({ ...scored, played: false })).toBe(false);
    // One side scoring is enough: a shutout week is still a played week.
    expect(wasMatchupPlayed({ ...unscored, team2_score: 42 })).toBe(true);
  });

  it('countsTowardRecord is both halves and nothing else', () => {
    expect(countsTowardRecord(scored, TODAY)).toBe(true);
    expect(countsTowardRecord(unscored, TODAY)).toBe(false);
    expect(countsTowardRecord({ ...scored, week_end_date: '2026-12-31', status: 'scheduled' }, TODAY)).toBe(false);
  });
});

describe('rankStandings', () => {
  it('orders by wins, then points for, then name', () => {
    const records = deriveStandings(['A', 'B', 'C'], [
      { id: 'm1', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' },
      { id: 'm2', week_number: 2, team1_id: 'C', team2_id: 'B', team1_score: 200, team2_score: 100, status: 'completed', week_end_date: '2026-03-08' },
    ], TODAY);

    const ranked = rankStandings(
      [
        { id: 'A', team_name: 'Avalanche', owner_id: 'o-a' },
        { id: 'B', team_name: 'Bruins', owner_id: 'o-b' },
        { id: 'C', team_name: 'Canucks', owner_id: null },
      ],
      records,
    );

    expect(ranked.map((r) => r.team_id)).toEqual(['C', 'A', 'B']);
    expect(ranked[0]).toMatchObject({ team_name: 'Canucks', owner_id: null, wins: 1, gamesPlayed: 1, winPct: 1 });
    expect(ranked[2]).toMatchObject({ team_id: 'B', wins: 0, losses: 2, winPct: 0 });
  });

  it('reports winPct 0 rather than NaN for a league with nothing played', () => {
    const ranked = rankStandings(
      [{ id: 'A', team_name: 'Avalanche', owner_id: null }],
      deriveStandings(['A'], DEMO_LEAGUE.filter((m) => m.id === 'w1'), TODAY),
    );
    expect(ranked[0].gamesPlayed).toBe(0);
    expect(ranked[0].winPct).toBe(0);
  });

  it('counts a tie as half a win', () => {
    const records = deriveStandings(['A', 'B'], [
      { id: 'm1', week_number: 1, team1_id: 'A', team2_id: 'B', team1_score: 100, team2_score: 100, status: 'completed', week_end_date: '2026-03-01' },
      { id: 'm2', week_number: 2, team1_id: 'A', team2_id: 'B', team1_score: 120, team2_score: 100, status: 'completed', week_end_date: '2026-03-08' },
    ], TODAY);
    const ranked = rankStandings([{ id: 'A', team_name: 'A' }, { id: 'B', team_name: 'B' }], records);
    expect(ranked[0].winPct).toBe(0.75);
  });
});
