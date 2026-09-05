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
 * Projected finals (2026-09-03). The league endpoint now serves, beside the
 * live scores, `team1_projected_total` / `team2_projected_total` for the
 * viewed week (`LeagueScoreboardMatchup` in @citrus/shared): points banked
 * plus every remaining starter-game's projection, computed server-side in
 * MatchupService.getLeagueScoreboard from the same three tables the matchup
 * page reads for its own "proj" (frozen daily rosters, player_projected_stats,
 * the nhl_games clock), so the strip and the sticky bar are two evaluations
 * of one formula. `projectionOf` reads it and returns null, never 0, when the
 * server could not honestly say (a final matchup, a bye, a lineup or a
 * projection batch not in hand); the strip draws nothing for null.
 */

import { winProbabilityFromTotals } from '@/utils/winProbability';

export type ScoreboardSide = 'team1' | 'team2';

export interface WeekMatchupTeam {
  id?: string | null;
  team_name?: string | null;
  /**
   * A picture for the team, when the row's join carries one. Teams have no
   * avatar column (audit PR 11); the matchups join serves none today. The
   * owner's profile picture arrives by the other road — the league/teams
   * response — as the `teamAvatars` map `avatarOf` also reads.
   */
  avatar_url?: string | null;
}

/** Team id → owner's profile picture, from the league/teams response (audit M8). */
export type TeamAvatarMap = ReadonlyMap<string, string | null | undefined>;

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
  /**
   * Projected final per side from the league endpoint (`?week=N` only);
   * null or absent when there is nothing honest to say. Numeric strings are
   * tolerated the way the scores are.
   */
  team1_projected_total?: number | string | null;
  team2_projected_total?: number | string | null;
  /** Starter-games still to be played per side (2026-09-05); same terms as the totals. */
  team1_games_left?: number | string | null;
  team2_games_left?: number | string | null;
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

/**
 * The picture for one side of a row: the join's own `avatar_url` when the
 * row carries one, else the owner's profile picture looked up by team id in
 * `teamAvatars` (the league/teams response). Blank strings are no picture.
 */
export function avatarOf(row: WeekMatchupRow, side: ScoreboardSide, teamAvatars?: TeamAvatarMap): string | null {
  const joined = side === 'team1' ? row.team1?.avatar_url : row.team2?.avatar_url;
  if (joined && joined.trim()) return joined;
  const teamId = side === 'team1' ? row.team1_id : row.team2_id;
  const owner = teamId ? teamAvatars?.get(teamId) : null;
  return owner && owner.trim() ? owner : null;
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

/**
 * The projected final for one side, or null when the strip must say nothing:
 * the row carries none (a season-wide read, a server that could not compute
 * it), the value is not a finite number, the side is a bye, or the matchup is
 * final (a projection would only restate the score). Never 0 for "unknown":
 * a zero here is a real projected total, and the strip prints it as one.
 */
export function projectionOf(row: WeekMatchupRow, side: ScoreboardSide, today: string): number | null {
  if (isFinal(row, today)) return null;
  if (side === 'team2' && isBye(row)) return null;
  const raw = side === 'team1' ? row.team1_projected_total : row.team2_projected_total;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/**
 * Starter-games left for one side, or null on the terms of `projectionOf`.
 * The League HQ card's `27 · 26 LEFT`.
 */
export function gamesLeftOf(row: WeekMatchupRow, side: ScoreboardSide, today: string): number | null {
  if (isFinal(row, today)) return null;
  if (side === 'team2' && isBye(row)) return null;
  const raw = side === 'team1' ? row.team1_games_left : row.team2_games_left;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Win chance for one side, 0-100, from the row's projected finals and
 * games left through the same rule the Match screen and the Team card use
 * (`winProbabilityFromTotals`, DEFAULT_GAME_SD per unplayed game). null when
 * either side's projection or games-left is not in hand: the artboard's
 * `64% · 118.4` is a real number or nothing, never a coin flip drawn as one.
 * A settled week (nothing left on either side) is 100 / 0 / 50 on the score.
 */
export function winChanceOf(row: WeekMatchupRow, side: ScoreboardSide, today: string): number | null {
  const other: ScoreboardSide = side === 'team1' ? 'team2' : 'team1';
  const mine = projectionOf(row, side, today);
  const theirs = projectionOf(row, other, today);
  const myLeft = gamesLeftOf(row, side, today);
  const theirLeft = gamesLeftOf(row, other, today);
  if (mine === null || theirs === null || myLeft === null || theirLeft === null) return null;
  const { probability } = winProbabilityFromTotals({
    myExpectedFinal: mine,
    oppExpectedFinal: theirs,
    myGamesLeft: myLeft,
    oppGamesLeft: theirLeft,
  });
  return Math.round(probability * 100);
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
