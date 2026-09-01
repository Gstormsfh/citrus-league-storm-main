/**
 * LEAGUE SCOREBOARD — pure rules (2026-09-01, Sleeper parity audit M7).
 *
 * Everything the ScoreboardStrip decides about a row lives here so it can be
 * pinned without rendering: who leads, which side is the viewer, whether a
 * week is over, and whether anything is live. The strip only draws.
 *
 * Input is the row shape `api/matchups.getLeagueMatchups` already returns to
 * the page (`MATCHUP_COLUMNS` + the two `teams` joins), as it sits in
 * Matchup.tsx's `allWeekMatchups` after the page has copied the joined names
 * up to `team1_name` / `team2_name`. Both spellings are read, so a row that
 * skipped that copy still renders.
 *
 * NOT here, on purpose: projected scores. The league endpoint serves live
 * `team1_score` / `team2_score` only; a projection for someone else's
 * matchup would need every team's remaining-day projections server-side
 * (or `matchup_simulations`, whose table has no scheduled producer). The
 * strip shows what is banked and says nothing it cannot know.
 */

export type ScoreboardSide = 'team1' | 'team2';

export interface WeekMatchupTeam {
  id?: string | null;
  team_name?: string | null;
  /** Not in the schema yet (audit PR 11). Read when present, never required. */
  avatar_url?: string | null;
}

export interface WeekMatchupRow {
  id: string;
  team1_id: string;
  team2_id: string | null;
  team1_score: number | string | null;
  team2_score: number | string | null;
  status?: string | null;
  week_number?: number;
  week_end_date?: string | null;
  team1_name?: string | null;
  team2_name?: string | null;
  team1?: WeekMatchupTeam | null;
  team2?: WeekMatchupTeam | null;
}

/** Points as a number; the API hands back numerics as strings on some paths. */
export function scoreOf(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** A matchup with no second team is a bye. */
export function isBye(row: WeekMatchupRow): boolean {
  return !row.team2_id;
}

export function teamNameOf(row: WeekMatchupRow, side: ScoreboardSide): string {
  const direct = side === 'team1' ? row.team1_name : row.team2_name;
  const joined = side === 'team1' ? row.team1?.team_name : row.team2?.team_name;
  const name = (direct || joined || '').trim();
  if (name) return name;
  return side === 'team2' && isBye(row) ? 'Bye Week' : 'Unknown';
}

export function avatarOf(row: WeekMatchupRow, side: ScoreboardSide): string | null {
  const url = side === 'team1' ? row.team1?.avatar_url : row.team2?.avatar_url;
  return url && url.trim() ? url : null;
}

/** First initial of a team name, for the disc — same rule as ScoreCard. */
export function initialOf(name: string): string {
  const ch = (name || '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/**
 * The side ahead on points, or null for a tie or a bye. A bye has nobody to
 * lead, and 0.0–0.0 before puck drop is a tie, not a double leader.
 */
export function leaderOf(row: WeekMatchupRow): ScoreboardSide | null {
  if (isBye(row)) return null;
  const a = scoreOf(row.team1_score);
  const b = scoreOf(row.team2_score);
  if (a > b) return 'team1';
  if (b > a) return 'team2';
  return null;
}

/** Which side of the row is the viewer's team, if either. */
export function ownSideOf(row: WeekMatchupRow, ownTeamId: string | null | undefined): ScoreboardSide | null {
  if (!ownTeamId) return null;
  if (row.team1_id === ownTeamId) return 'team1';
  if (row.team2_id === ownTeamId) return 'team2';
  return null;
}

/**
 * A matchup is final once the scorer has closed it, or once its week has
 * ended on the calendar — the status column can lag the nightly job, and a
 * week that ended yesterday should not still read as open.
 */
export function isFinal(row: WeekMatchupRow, today: string): boolean {
  if (row.status === 'completed') return true;
  const end = row.week_end_date;
  return typeof end === 'string' && end.length >= 10 && end.slice(0, 10) < today;
}

export type ScoreboardState = 'final' | 'live' | 'open';

/**
 * Strip-level state: FINAL when every matchup is settled, LIVE when the
 * caller says a game is in progress, otherwise OPEN (the week is on).
 */
export function scoreboardState(rows: WeekMatchupRow[], today: string, live: boolean): ScoreboardState {
  if (rows.length > 0 && rows.every((r) => isFinal(r, today))) return 'final';
  return live ? 'live' : 'open';
}

interface GameLike {
  game_date?: string | null;
  status?: string | null;
}

interface PlayerWithGames {
  games?: GameLike[] | null;
}

/**
 * True when any player the page already holds has a game in progress today.
 *
 * This is the cheap signal: Matchup.tsx's live-refresh writes fresh statuses
 * into the two viewed rosters every 120s, and between them those rosters
 * cover most of the league's NHL teams on a game night. It is deliberately a
 * STRIP-level indicator, not a per-chip one — nothing per matchup is served
 * that says which other lineups have skaters on the ice right now, and a dot
 * guessed per chip would be a fabrication.
 */
export function anyGameLive(players: PlayerWithGames[], today: string): boolean {
  for (const p of players) {
    const games = p?.games;
    if (!games) continue;
    for (const g of games) {
      if (!g) continue;
      const date = (g.game_date || '').slice(0, 10);
      if (date !== today) continue;
      const status = (g.status || '').toLowerCase();
      if (status === 'live' || status === 'crit' || status === 'intermission') return true;
    }
  }
  return false;
}

/** Points to one decimal, the way every other score on the page prints. */
export function formatScore(value: number | string | null | undefined): string {
  return scoreOf(value).toFixed(1);
}
