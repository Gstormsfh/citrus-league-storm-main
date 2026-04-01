/**
 * PoolService — API client wrapper for Pick'em, Survivor, and Confidence pools.
 *
 * All data fetching and mutations go through the API server via poolApi.
 * No direct Supabase calls from the frontend.
 */

import { poolApi } from '@/api/pools';
import { ScheduleService, NHLGame } from '@/services/ScheduleService';
import { SEASON_START_YEAR } from '@/utils/seasonConstants';
import { getTodayMSTDate } from '@/utils/timezoneUtils';
import { logger } from '@/utils/logger';

// ── Types (unchanged — still exported for page components) ───────────

export interface PickemPick {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  game_id: string;
  picked_team: string;
  is_correct?: boolean | null;
  spread_value?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface PickemStanding {
  user_id: string;
  display_name: string;
  correct_picks: number;
  total_picks: number;
  accuracy: number;
  current_week_correct: number;
}

export interface SurvivorSelection {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  picked_team: string;
  is_correct?: boolean | null;
  created_at?: string;
}

export interface SurvivorStanding {
  user_id: string;
  display_name: string;
  is_eliminated: boolean;
  eliminated_week: number | null;
  lives_remaining: number;
  teams_used: string[];
  current_pick: string | null;
}

export interface ConfidencePick {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  game_id: string;
  picked_team: string;
  confidence_points: number;
  is_correct?: boolean | null;
  points_earned?: number;
  created_at?: string;
}

export interface ConfidenceStanding {
  user_id: string;
  display_name: string;
  total_points: number;
  possible_points: number;
  current_week_points: number;
  weeks_played: number;
}

// ── Week helpers (kept local for synchronous getCurrentWeek) ─────────

function getCurrentWeekNumber(seasonStartYear: number = SEASON_START_YEAR): number {
  const oct1 = new Date(seasonStartYear, 9, 1);
  const dayOfWeek = oct1.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = new Date(oct1);
  firstSunday.setDate(oct1.getDate() + daysUntilSunday);

  const today = getTodayMSTDate();
  const diffMs = today.getTime() - firstSunday.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

function getWeekDateRange(weekNumber: number, seasonStartYear: number = SEASON_START_YEAR): { start: Date; end: Date } {
  const oct1 = new Date(seasonStartYear, 9, 1);
  const dayOfWeek = oct1.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = new Date(oct1);
  firstSunday.setDate(oct1.getDate() + daysUntilSunday);

  const start = new Date(firstSunday);
  start.setDate(firstSunday.getDate() + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function isGameLocked(game: NHLGame): boolean {
  if (game.status === 'live' || game.status === 'final' || game.status === 'postponed') return true;
  if (!game.game_time) return false;
  const gameDateTime = new Date(`${game.game_date}T${game.game_time}`);
  return new Date() >= gameDateTime;
}

// ── Service (all methods delegate to API server) ─────────────────────

export class PoolService {
  // ── Shared Helpers ──────────────────────────────────────────────────

  /** Get the current NHL week number (synchronous). */
  static getCurrentWeek(): number {
    return getCurrentWeekNumber();
  }

  /** Get all games for a given week number. */
  static async getWeekGames(weekNumber: number): Promise<NHLGame[]> {
    const { start, end } = getWeekDateRange(weekNumber);
    const { games } = await ScheduleService.getGamesForDateRange(start, end);
    return games;
  }

  /** Filter out games that have already started (locked). */
  static getPickableGames(games: NHLGame[]): NHLGame[] {
    return games.filter(g => !isGameLocked(g));
  }

  /** Get all NHL team records + H2H for a given week (single API call). */
  static async getTeamRecordsAndH2H(weekNumber?: number): Promise<{
    records: Record<string, { w: number; l: number; otl: number; streak: string }>;
    h2h: Record<string, { awayWins: number; homeWins: number; games: number }>;
  }> {
    try {
      const response = await poolApi.getTeamRecords(weekNumber);
      const data = response.data as any;
      return {
        records: data?.records || {},
        h2h: data?.h2h || {},
      };
    } catch {
      return { records: {}, h2h: {} };
    }
  }

  // ── Pick'em Pool ────────────────────────────────────────────────────

  static async submitPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; spread_value?: number }>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await poolApi.submitPickemPicks(leagueId, weekNumber, picks);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[PoolService] submitPickemPicks error:', message);
      return { success: false, error: message };
    }
  }

  static async getPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
  ): Promise<PickemPick[]> {
    try {
      const res = await poolApi.getPickemPicks(leagueId, weekNumber);
      return (res.data ?? []) as PickemPick[];
    } catch (err) {
      logger.error('[PoolService] getPickemPicks error:', err);
      return [];
    }
  }

  static async scorePickemWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ): Promise<{ scored: number; error?: string }> {
    try {
      const res = await poolApi.scorePickemWeek(leagueId, weekNumber, gameResults);
      return res.data as { scored: number };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  static async scorePickemWeekATS(
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
  ): Promise<{ scored: number; error?: string }> {
    try {
      const res = await poolApi.scorePickemWeekATS(leagueId, weekNumber, gameResults);
      return res.data as { scored: number };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  static async getPickemStandings(leagueId: string): Promise<PickemStanding[]> {
    try {
      const res = await poolApi.getPickemStandings(leagueId);
      return (res.data ?? []) as PickemStanding[];
    } catch (err) {
      logger.error('[PoolService] getPickemStandings error:', err);
      return [];
    }
  }

  // ── Survivor Pool ──────────────────────────────────────────────────

  static async submitSurvivorPick(
    leagueId: string,
    userId: string,
    weekNumber: number,
    pickedTeam: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await poolApi.submitSurvivorPick(leagueId, weekNumber, pickedTeam);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[PoolService] submitSurvivorPick error:', message);
      return { success: false, error: message };
    }
  }

  static async isSurvivorEliminated(leagueId: string, userId: string): Promise<boolean> {
    try {
      const res = await poolApi.isSurvivorEliminated(leagueId, userId);
      return (res.data as { eliminated: boolean })?.eliminated ?? false;
    } catch (err) {
      logger.error('[PoolService] isSurvivorEliminated error:', err);
      return false;
    }
  }

  static async scoreSurvivorWeek(
    leagueId: string,
    weekNumber: number,
    teamResults: Array<{ team: string; won: boolean }>,
  ): Promise<{ scored: number; error?: string }> {
    try {
      const res = await poolApi.scoreSurvivorWeek(leagueId, weekNumber, teamResults);
      return res.data as { scored: number };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  static async getSurvivorStandings(leagueId: string): Promise<SurvivorStanding[]> {
    try {
      const res = await poolApi.getSurvivorStandings(leagueId);
      return (res.data ?? []) as SurvivorStanding[];
    } catch (err) {
      logger.error('[PoolService] getSurvivorStandings error:', err);
      return [];
    }
  }

  static async getSurvivorPickHistory(
    leagueId: string,
    userId: string,
  ): Promise<Array<{ week: number; team: string; is_correct: boolean | null }>> {
    try {
      const res = await poolApi.getSurvivorPickHistory(leagueId, userId);
      return (res.data ?? []) as Array<{ week: number; team: string; is_correct: boolean | null }>;
    } catch (err) {
      logger.error('[PoolService] getSurvivorPickHistory error:', err);
      return [];
    }
  }

  static async getSurvivorUsedTeams(leagueId: string, userId: string): Promise<string[]> {
    try {
      const res = await poolApi.getSurvivorUsedTeams(leagueId, userId);
      return (res.data ?? []) as string[];
    } catch (err) {
      logger.error('[PoolService] getSurvivorUsedTeams error:', err);
      return [];
    }
  }

  // ── Confidence Pool ────────────────────────────────────────────────

  static async submitConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; confidence_points: number }>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await poolApi.submitConfidencePicks(leagueId, weekNumber, picks);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[PoolService] submitConfidencePicks error:', message);
      return { success: false, error: message };
    }
  }

  static async getConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
  ): Promise<ConfidencePick[]> {
    try {
      const res = await poolApi.getConfidencePicks(leagueId, weekNumber);
      return (res.data ?? []) as ConfidencePick[];
    } catch (err) {
      logger.error('[PoolService] getConfidencePicks error:', err);
      return [];
    }
  }

  static async scoreConfidenceWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ): Promise<{ scored: number; error?: string }> {
    try {
      const res = await poolApi.scoreConfidenceWeek(leagueId, weekNumber, gameResults);
      return res.data as { scored: number };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  static async getConfidenceStandings(leagueId: string): Promise<ConfidenceStanding[]> {
    try {
      const res = await poolApi.getConfidenceStandings(leagueId);
      return (res.data ?? []) as ConfidenceStanding[];
    } catch (err) {
      logger.error('[PoolService] getConfidenceStandings error:', err);
      return [];
    }
  }
}
