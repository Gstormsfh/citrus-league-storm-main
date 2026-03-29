/**
 * Pool API client — replaces direct Supabase calls for Pick'em, Survivor, and Confidence pools.
 */

import { apiClient } from './client';

export const poolApi = {
  // ── Week Info ────────────────────────────────────────────────────────

  /** Get the current NHL week number. */
  getCurrentWeek() {
    return apiClient.get<{ week: number }>('/api/pools/current-week');
  },

  /** Get all games for a week with lock status. */
  getWeekGames(weekNumber: number) {
    return apiClient.get(`/api/pools/week/${weekNumber}/games`);
  },

  /** Get all NHL team records (W-L-OTL) for the current season. */
  getTeamRecords() {
    return apiClient.get<Record<string, { w: number; l: number; otl: number }>>('/api/pools/team-records');
  },

  // ── Pick'em ──────────────────────────────────────────────────────────

  /** Submit or update Pick'em picks for a week. */
  submitPickemPicks(
    leagueId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; spread_value?: number }>,
  ) {
    return apiClient.post('/api/pools/pickem/picks', { leagueId, weekNumber, picks });
  },

  /** Get a user's Pick'em picks for a week. */
  getPickemPicks(leagueId: string, week: number) {
    return apiClient.get(`/api/pools/pickem/${leagueId}/picks?week=${week}`);
  },

  /** Get cumulative Pick'em standings. */
  getPickemStandings(leagueId: string) {
    return apiClient.get(`/api/pools/pickem/${leagueId}/standings`);
  },

  /** Score Pick'em picks for a week. */
  scorePickemWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ) {
    return apiClient.post(`/api/pools/pickem/${leagueId}/score`, { weekNumber, gameResults });
  },

  /** Score Pick'em ATS picks for a week. */
  scorePickemWeekATS(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{
      game_id: string;
      home_team: string;
      away_team: string;
      home_score: number;
      away_score: number;
      status: string;
    }>,
  ) {
    return apiClient.post(`/api/pools/pickem/${leagueId}/score-ats`, { weekNumber, gameResults });
  },

  // ── Survivor ─────────────────────────────────────────────────────────

  /** Submit a survivor pick for a week. */
  submitSurvivorPick(leagueId: string, weekNumber: number, pickedTeam: string) {
    return apiClient.post('/api/pools/survivor/pick', { leagueId, weekNumber, pickedTeam });
  },

  /** Get survivor standings. */
  getSurvivorStandings(leagueId: string) {
    return apiClient.get(`/api/pools/survivor/${leagueId}/standings`);
  },

  /** Get a user's pick history in a survivor pool. */
  getSurvivorPickHistory(leagueId: string, userId?: string) {
    const qs = userId ? `?userId=${userId}` : '';
    return apiClient.get(`/api/pools/survivor/${leagueId}/history${qs}`);
  },

  /** Get teams already used by a user in survivor pool. */
  getSurvivorUsedTeams(leagueId: string, userId?: string) {
    const qs = userId ? `?userId=${userId}` : '';
    return apiClient.get<string[]>(`/api/pools/survivor/${leagueId}/used-teams${qs}`);
  },

  /** Check if a user is eliminated from the survivor pool. */
  isSurvivorEliminated(leagueId: string, userId?: string) {
    const qs = userId ? `?userId=${userId}` : '';
    return apiClient.get<{ eliminated: boolean }>(`/api/pools/survivor/${leagueId}/eliminated${qs}`);
  },

  /** Score survivor picks for a week. */
  scoreSurvivorWeek(
    leagueId: string,
    weekNumber: number,
    teamResults: Array<{ team: string; won: boolean }>,
  ) {
    return apiClient.post(`/api/pools/survivor/${leagueId}/score`, { weekNumber, teamResults });
  },

  // ── Confidence ───────────────────────────────────────────────────────

  /** Submit ranked confidence picks for a week. */
  submitConfidencePicks(
    leagueId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; confidence_points: number }>,
  ) {
    return apiClient.post('/api/pools/confidence/picks', { leagueId, weekNumber, picks });
  },

  /** Get a user's confidence picks for a week. */
  getConfidencePicks(leagueId: string, week: number) {
    return apiClient.get(`/api/pools/confidence/${leagueId}/picks?week=${week}`);
  },

  /** Get cumulative confidence pool standings. */
  getConfidenceStandings(leagueId: string) {
    return apiClient.get(`/api/pools/confidence/${leagueId}/standings`);
  },

  /** Score confidence picks for a week. */
  scoreConfidenceWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ) {
    return apiClient.post(`/api/pools/confidence/${leagueId}/score`, { weekNumber, gameResults });
  },
};
