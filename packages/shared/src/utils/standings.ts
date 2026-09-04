/**
 * HEAD-TO-HEAD STANDINGS - one derivation, shared by the API server and the
 * browser so the two cannot drift.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Audited 2026-09-03 against production. "Demo League - Citrus Storm
 * Showcase" (750f4e1a-92ae-44cf-a798-2f3e06d0d5c9) showed both teams at
 * 1-1-18. Twenty weeks of matchups exist; exactly TWO were ever played:
 *
 *   week  status        team1  team2  fantasy_matchup_lines  daily_roster_rows
 *   1     completed     0.000  0.000  0                      0
 *   2     completed     0.000  0.000  0                      0
 *   3     in_progress   0.000  0.000  0                      0
 *   4-5   scheduled     0.000  0.000  0                      0
 *   6     scheduled     0.000  0.000  0                      294   <- Olympic break
 *   7     completed    58.000 70.900  22 (33 games played)    294
 *   8     completed   122.900 104.800 22 (66 games played)    252
 *   9-11  completed     0.000  0.000  0                      0
 *   12-20 scheduled     0.000  0.000  0                      0
 *
 * The old client rule counted every matchup whose week had ended and read
 * `team1Score === team2Score` as a tie, so all eighteen unplayed weeks became
 * draws. Eighteen phantom ties on the first screen a new manager opens.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, AND WHY IT IS THIS ONE
 *
 * A matchup contributes to a record only when BOTH hold:
 *
 *   1. IT IS FINAL. `status === 'completed'`, or its `week_end_date` is
 *      already in the past. This window is unchanged from the old client
 *      rule on purpose: a genuinely scored week that the auto-complete cron
 *      has not yet stamped must not vanish from the table for a day.
 *
 *   2. IT WAS PLAYED. Either the caller supplies explicit evidence via
 *      `played`, or - absent evidence - at least one side scored above zero.
 *
 * Rule 2 replaces "the scores are equal" with "something actually happened",
 * which is the claim the standings page is really making.
 *
 * Three things make the zero-score inference the right default rather than a
 * guess:
 *
 *   a. THE DATABASE ALREADY DEFINES PLAYED THIS WAY. `auto_complete_matchups()`
 *      will only move a matchup to 'completed' when
 *        (team2_id IS NULL AND team1_score > 0)
 *        OR (team2_id IS NOT NULL AND team1_score > 0 AND team2_score > 0).
 *      A 0-0 week can therefore never reach 'completed' on its own. Standings
 *      that counted 0-0 as a played draw were contradicting the very function
 *      that decides when a week is over. This module adopts the database's
 *      own predicate instead of inventing a second one.
 *
 *   b. IT MATCHES THE POSITIVE EVIDENCE, EVERYWHERE, TODAY. Measured across
 *      all 407 matchup rows in production: `team1_score > 0 OR team2_score > 0`
 *      agrees with "a fantasy_matchup_lines row exists" on 407 of 407, and
 *      with "a line row with games_played > 0 exists" on 407 of 407. Zero
 *      disagreements in either direction. The cheap signal that travels on
 *      the matchup row is, right now, exactly as good as the expensive one
 *      that needs a second query - so both callers can use it without either
 *      one paying for an extra round trip or drifting from the other.
 *
 *   c. ROSTER ROWS ARE NOT EVIDENCE, AND THE TABLE ABOVE SHOWS WHY. Week 6
 *      carries 294 fantasy_daily_rosters rows and is the Olympic break: real
 *      lineups, no NHL games, no result. Gating on "someone set a lineup"
 *      would have booked that week as a played 0-0 draw. Scoring lines, not
 *      lineup intent, are what a result is made of.
 *
 * This is also the standing house position on zero-versus-absent. See
 * `ScoresService.scoreOrNull` in the API server: `nhl_games` stores 0/0 on
 * every scheduled row, and rendering it would print "0 - 0" for a game nobody
 * played. Standings had the same defect one table over.
 *
 * ---------------------------------------------------------------------------
 * THE LEGITIMATELY-PLAYED 0-0 WEEK
 *
 * It is possible in principle - every rostered skater and both goalies held
 * to exactly zero fantasy points across a seven-day week, on both sides. It
 * has never happened in this database and it cannot currently reach
 * 'completed' anyway (see (a)). It is still handled, and not by guessing:
 * pass `played: true` on the matchup and the rule books it as a real tie,
 * scores be damned. `played` is authoritative whenever it is a boolean; the
 * score inference only runs when it is absent.
 *
 * The durable fix is for the matchup row itself to carry that evidence, so
 * neither caller has to infer. Two ways, in order of preference:
 *
 *   - a `scored_at timestamptz` column on `matchups`, written by whatever
 *     scoring pass produces the totals, and mapped to `played: row.scored_at
 *     !== null` at both call sites; or
 *   - a `played` boolean projected into the matchup payload from
 *     `EXISTS (SELECT 1 FROM fantasy_matchup_lines l WHERE l.matchup_id = m.id)`.
 *
 * Either one is a migration and a scoring-writer change, deliberately NOT
 * done here. When it lands, set `played` at both call sites and this module
 * needs no edit: the field is already authoritative.
 *
 * ---------------------------------------------------------------------------
 * CALLERS - BOTH OF THEM, AND THERE MUST ONLY EVER BE TWO
 *
 *   apps/web/src/services/StandingsService.ts  calculateTeamStandings()
 *   server/src/services/LeagueService.ts       getStandings()
 *
 * Both read the same `matchups` columns (COLUMNS.MATCHUP) and hand them to
 * `deriveStandings` unchanged, so the web app and GET /api/leagues/:id/standings
 * cannot disagree about a league. Adding a third implementation of this rule
 * is how this codebase got four live implementations of fantasy scoring.
 */

/**
 * The subset of a `matchups` row this derivation reads. Every field is on
 * COLUMNS.MATCHUP, so any caller that already fetched matchups can pass its
 * rows straight through.
 */
export interface StandingsMatchup {
  id?: string | null;
  week_number: number;
  team1_id: string;
  team2_id?: string | null;
  team1_score?: number | string | null;
  team2_score?: number | string | null;
  status?: string | null;
  week_end_date?: string | null;
  /**
   * Authoritative "this week was actually played" evidence, when the caller
   * has it (a scored-at timestamp, or the existence of scoring lines).
   * A boolean here overrides the score inference in both directions:
   * `true` books a real 0-0 week as a tie, `false` excludes a week whose
   * score is stale. Leave it undefined to let the rule infer.
   */
  played?: boolean | null;
}

/** One team's head-to-head record. Shape is stable; callers spread it. */
export interface TeamStandingsRecord {
  pointsFor: number;
  pointsAgainst: number;
  wins: number;
  losses: number;
  ties: number;
  streak: string;
  last5: { wins: number; losses: number; ties: number };
}

export type StandingsByTeamId = Record<string, TeamStandingsRecord>;

/** A ranked standings row: a record plus the team identity and derived rates. */
export interface RankedStandingsRow extends TeamStandingsRecord {
  team_id: string;
  team_name: string;
  owner_id: string | null;
  gamesPlayed: number;
  /** Ties count as half a win, the standard fantasy convention. 0 when nothing is played. */
  winPct: number;
}

/** Minimal team identity `rankStandings` needs. */
export interface StandingsTeamRef {
  id: string;
  team_name?: string | null;
  owner_id?: string | null;
}

type MatchupResult = 'win' | 'loss' | 'tie';

/**
 * Numeric coercion for a Postgres `numeric` column, which supabase-js hands
 * back as a string ("58.000"). Anything unreadable is 0, which is safe here
 * only because a 0 can no longer be mistaken for a played result.
 */
export function toMatchupScore(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Is this week over? `status === 'completed'`, or the week has already ended.
 *
 * The date half is not redundant. `auto_complete_matchups()` runs on a
 * schedule; between a week ending and that run, a fully scored week is still
 * 'in_progress' and belongs in the table.
 */
export function isMatchupFinal(matchup: StandingsMatchup, todayStr: string): boolean {
  if (matchup.status === 'completed') return true;
  const end = matchup.week_end_date;
  return typeof end === 'string' && end.length > 0 && end < todayStr;
}

/**
 * Was this week actually played?
 *
 * Explicit `played` evidence wins outright. Otherwise: at least one side
 * scored above zero - the same predicate `auto_complete_matchups()` uses,
 * including its bye-week form (a bye needs team1_score > 0 and nothing else,
 * because team2_score is meaningless when team2_id is null).
 */
export function wasMatchupPlayed(
  // Only the four fields this rule actually reads. A caller that already
  // knows a week was played (a career-stats query that never selects
  // week_number, say) should not have to invent one to ask the question.
  matchup: Pick<StandingsMatchup, 'team1_score' | 'team2_score' | 'played'> & {
    team2_id?: string | null;
  },
): boolean {
  if (typeof matchup.played === 'boolean') return matchup.played;
  const team1Score = toMatchupScore(matchup.team1_score);
  if (!matchup.team2_id) return team1Score > 0;
  return team1Score > 0 || toMatchupScore(matchup.team2_score) > 0;
}

/** Final AND played. The single gate every W/L/T and PF/PA number passes. */
export function countsTowardRecord(matchup: StandingsMatchup, todayStr: string): boolean {
  return isMatchupFinal(matchup, todayStr) && wasMatchupPlayed(matchup);
}

function emptyRecord(): TeamStandingsRecord {
  return {
    pointsFor: 0,
    pointsAgainst: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    streak: '-',
    last5: { wins: 0, losses: 0, ties: 0 },
  };
}

/**
 * Derive every team's head-to-head record from raw matchup rows.
 *
 * Deduplicates by matchup id (the league scoreboard endpoint can return the
 * same row twice when a week filter and the full list are merged client-side),
 * and ignores matchups whose teams are not in `teamIds` so a deleted team
 * cannot resurrect a record.
 *
 * `todayStr` is a YYYY-MM-DD date in the league's operating timezone -
 * `getTodayMST()` from this package on both sides. It is a parameter rather
 * than a call so the rule is a pure function and the tests can pin a date.
 */
export function deriveStandings(
  teamIds: string[],
  matchups: StandingsMatchup[],
  todayStr: string,
): StandingsByTeamId {
  const stats: StandingsByTeamId = {};
  const history: Record<string, Array<{ week: number; result: MatchupResult }>> = {};

  for (const teamId of teamIds) {
    stats[teamId] = emptyRecord();
    history[teamId] = [];
  }

  // Dedup by id. Rows without an id cannot be keyed, so they are kept as-is
  // rather than collapsed onto each other.
  const byId = new Map<string, StandingsMatchup>();
  const unkeyed: StandingsMatchup[] = [];
  for (const matchup of matchups || []) {
    if (matchup && typeof matchup.id === 'string' && matchup.id.length > 0) {
      byId.set(matchup.id, matchup);
    } else if (matchup) {
      unkeyed.push(matchup);
    }
  }

  const ordered = [...Array.from(byId.values()), ...unkeyed]
    .filter((m) => countsTowardRecord(m, todayStr))
    .sort((a, b) => a.week_number - b.week_number);

  const record = (teamId: string, week: number, result: MatchupResult) => {
    const team = stats[teamId];
    if (!team) return;
    if (result === 'win') team.wins++;
    else if (result === 'loss') team.losses++;
    else team.ties++;
    history[teamId].push({ week, result });
  };

  for (const matchup of ordered) {
    const team1Score = toMatchupScore(matchup.team1_score);

    if (!matchup.team2_id) {
      // A played bye week is a win, and carries its own points for.
      const team1 = stats[matchup.team1_id];
      if (team1) {
        team1.pointsFor += team1Score;
        record(matchup.team1_id, matchup.week_number, 'win');
      }
      continue;
    }

    const team2Score = toMatchupScore(matchup.team2_score);
    const team1 = stats[matchup.team1_id];
    const team2 = stats[matchup.team2_id];

    if (team1) {
      team1.pointsFor += team1Score;
      team1.pointsAgainst += team2Score;
    }
    if (team2) {
      team2.pointsFor += team2Score;
      team2.pointsAgainst += team1Score;
    }

    if (team1Score > team2Score) {
      record(matchup.team1_id, matchup.week_number, 'win');
      record(matchup.team2_id, matchup.week_number, 'loss');
    } else if (team2Score > team1Score) {
      record(matchup.team2_id, matchup.week_number, 'win');
      record(matchup.team1_id, matchup.week_number, 'loss');
    } else {
      // Equal scores on a week we have already established was PLAYED.
      // This is the only path to a tie, and the reason a real 0-0 week with
      // `played: true` still lands here correctly.
      record(matchup.team1_id, matchup.week_number, 'tie');
      record(matchup.team2_id, matchup.week_number, 'tie');
    }
  }

  for (const teamId of Object.keys(stats)) {
    const played = [...history[teamId]].sort((a, b) => b.week - a.week);
    if (played.length > 0) {
      const mostRecent = played[0];
      let streakCount = 1;
      for (let i = 1; i < played.length; i++) {
        if (played[i].result === mostRecent.result) streakCount++;
        else break;
      }
      const label = mostRecent.result === 'win' ? 'W' : mostRecent.result === 'loss' ? 'L' : 'T';
      stats[teamId].streak = `${label}${streakCount}`;
    }

    const last5 = played.slice(0, 5);
    stats[teamId].last5 = {
      wins: last5.filter((g) => g.result === 'win').length,
      losses: last5.filter((g) => g.result === 'loss').length,
      ties: last5.filter((g) => g.result === 'tie').length,
    };
  }

  return stats;
}

/**
 * Rank derived records into the array shape an API response wants.
 *
 * Order mirrors the web Standings page exactly (apps/web/src/pages/Standings.tsx,
 * H2H branch): wins descending, then points for descending. Team name breaks
 * the remaining tie so the order is stable across requests rather than left
 * to whatever Postgres returned.
 */
export function rankStandings(
  teams: StandingsTeamRef[],
  records: StandingsByTeamId,
): RankedStandingsRow[] {
  const rows: RankedStandingsRow[] = (teams || []).map((team) => {
    const rec = records[team.id] || emptyRecord();
    const gamesPlayed = rec.wins + rec.losses + rec.ties;
    return {
      ...rec,
      team_id: team.id,
      team_name: team.team_name ?? '',
      owner_id: team.owner_id ?? null,
      gamesPlayed,
      winPct: gamesPlayed > 0 ? (rec.wins + rec.ties * 0.5) / gamesPlayed : 0,
    };
  });

  return rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.team_name.localeCompare(b.team_name);
  });
}
