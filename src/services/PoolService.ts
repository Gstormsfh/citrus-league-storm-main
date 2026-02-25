/**
 * PoolService — gameplay layer for Pick'em, Survivor, and Confidence pools.
 *
 * Provides submission, retrieval, scoring, and elimination logic for all
 * pool-style league types. Works against the pool_picks, survivor_selections,
 * and confidence_picks tables (created via migrations or on first use).
 *
 * Each pool type stores its data in a single table per type for clarity:
 *   - pool_picks          — Pick'em (straight-up / ATS)
 *   - survivor_selections — Survivor (one team per week, no repeats)
 *   - confidence_picks    — Confidence pool (ranked picks per week)
 */

import { supabase } from '@/integrations/supabase/client';
import { ScheduleService, NHLGame } from '@/services/ScheduleService';
import { SEASON_START_YEAR } from '@/utils/seasonConstants';
import type { LeagueSettings } from '@/types/leagueTypes';

// ============================================================================
// Week / Deadline Helpers
// ============================================================================

/**
 * Calculate NHL week start/end dates for a given week number.
 * NHL regular season starts in early October; weeks are Sunday-Saturday
 * (matching the app-wide standard set by the shift_weeks migration).
 * Week 1 starts on the first Sunday on or after October 1.
 */
function getWeekDateRange(weekNumber: number, seasonStartYear: number = SEASON_START_YEAR): { start: Date; end: Date } {
  // Find the first Sunday on or after October 1
  const oct1 = new Date(seasonStartYear, 9, 1); // October 1
  const dayOfWeek = oct1.getDay(); // 0 = Sunday
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = new Date(oct1);
  firstSunday.setDate(oct1.getDate() + daysUntilSunday);

  const start = new Date(firstSunday);
  start.setDate(firstSunday.getDate() + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6); // Saturday
  return { start, end };
}

/**
 * Calculate the current NHL week number based on today's date.
 */
function getCurrentWeekNumber(seasonStartYear: number = SEASON_START_YEAR): number {
  const oct1 = new Date(seasonStartYear, 9, 1);
  const dayOfWeek = oct1.getDay(); // 0 = Sunday
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = new Date(oct1);
  firstSunday.setDate(oct1.getDate() + daysUntilSunday);

  const today = new Date();
  const diffMs = today.getTime() - firstSunday.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * Check if a game has started (cannot pick after game time).
 * Also locks postponed games (industry standard: postponed = 0 points).
 */
function isGameLocked(game: NHLGame): boolean {
  if (game.status === 'live' || game.status === 'final' || game.status === 'postponed') return true;
  if (!game.game_time) return false;

  // Parse game date + time and compare to now
  const gameDateTime = new Date(`${game.game_date}T${game.game_time}`);
  return new Date() >= gameDateTime;
}

/**
 * Check if a game is postponed (used for scoring — postponed = no winner).
 */
function isPostponed(game: NHLGame): boolean {
  return game.status === 'postponed';
}

// ============================================================================
// Pick'em Pool
// ============================================================================

export interface PickemPick {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  game_id: string;        // nhl_games.id
  picked_team: string;    // team abbreviation (e.g. 'TOR')
  is_correct?: boolean | null;
  spread_value?: number | null; // for ATS mode
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

// ============================================================================
// Survivor Pool
// ============================================================================

export interface SurvivorSelection {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  picked_team: string;    // team abbreviation
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

// ============================================================================
// Confidence Pool
// ============================================================================

export interface ConfidencePick {
  id?: string;
  league_id: string;
  user_id: string;
  week_number: number;
  game_id: string;
  picked_team: string;
  confidence_points: number; // 1 = least confident, N = most confident
  is_correct?: boolean | null;
  points_earned?: number;   // confidence_points if correct, 0 if wrong
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

// ============================================================================
// Service implementation
// ============================================================================

export class PoolService {
  // --------------------------------------------------------------------------
  // Shared Helpers
  // --------------------------------------------------------------------------

  /** Get the current NHL week number. */
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

  // --------------------------------------------------------------------------
  // Pick'em Pool
  // --------------------------------------------------------------------------

  /** Submit or update a batch of picks for a given week. Rejects picks for started games. */
  static async submitPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    inputPicks: Array<{ game_id: string; picked_team: string; spread_value?: number }>
  ): Promise<{ success: boolean; error?: string }> {
    let picks = inputPicks;
    try {
      // Deadline enforcement: fetch games to verify none have started
      const weekGames = await this.getWeekGames(weekNumber);
      const gameMap = new Map(weekGames.map(g => [String(g.id), g]));

      // Reject picks for games that have already started
      const lockedGameIds: string[] = [];
      for (const pick of picks) {
        const game = gameMap.get(pick.game_id);
        if (game && isGameLocked(game)) {
          lockedGameIds.push(pick.game_id);
        }
      }

      if (lockedGameIds.length > 0) {
        const validPicks = picks.filter(p => !lockedGameIds.includes(p.game_id));
        if (validPicks.length === 0) {
          return { success: false, error: 'All selected games have already started. Picks are locked after game time.' };
        }
        // Only submit picks for unlocked games
        picks = validPicks;
      }

      // Upsert each pick — unique on (league_id, user_id, week_number, game_id)
      const rows = picks.map(p => ({
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        game_id: p.game_id,
        picked_team: p.picked_team,
        spread_value: p.spread_value ?? null,
        is_correct: null, // not yet scored
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('pool_picks')
        .upsert(rows, { onConflict: 'league_id,user_id,week_number,game_id' });

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PoolService] submitPickemPicks error:', message);
      return { success: false, error: message };
    }
  }

  /** Get a user's picks for a given week. */
  static async getPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number
  ): Promise<PickemPick[]> {
    try {
      const { data, error } = await supabase
        .from('pool_picks')
        .select('*')
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('week_number', weekNumber)
        .order('created_at');

      if (error) throw error;
      return (data ?? []) as PickemPick[];
    } catch (err) {
      console.error('[PoolService] getPickemPicks error:', err);
      return [];
    }
  }

  /** Score completed games for a week — marks each pick correct/incorrect. */
  /**
   * Score Pick'em picks for a week.
   * gameResults: winning_team = team abbreviation, or 'TIE' for tie games,
   *              or 'POSTPONED' for postponed games.
   * Industry standard (ESPN/CBS): tie = both sides incorrect; postponed = 0 points.
   */
  static async scorePickemWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>
  ): Promise<{ scored: number; error?: string }> {
    try {
      const resultMap = new Map(gameResults.map(g => [g.game_id, g.winning_team]));

      const { data: picks, error: fetchErr } = await supabase
        .from('pool_picks')
        .select('id, game_id, picked_team, spread_value')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      if (fetchErr) return { scored: 0, error: fetchErr.message };

      let scored = 0;
      for (const pick of (picks ?? [])) {
        const winner = resultMap.get(pick.game_id);
        if (winner === undefined) continue; // game not finished

        // Tie game: both teams count as loss (ESPN/CBS standard)
        // Postponed: treated as incorrect (0 points)
        let isCorrect = false;
        if (winner === 'TIE' || winner === 'POSTPONED') {
          isCorrect = false;
        } else {
          isCorrect = pick.picked_team === winner;
        }

        await supabase
          .from('pool_picks')
          .update({ is_correct: isCorrect })
          .eq('id', pick.id);
        scored++;
      }
      return { scored };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PoolService] scorePickemWeek error:', message);
      return { scored: 0, error: message };
    }
  }

  /**
   * Score Pick'em picks for ATS (Against the Spread) mode.
   * Industry standard: Half-point spreads eliminate ties.
   * A pick is correct if the picked team covers the spread.
   *
   * Example: Team A (-3.5) vs Team B (+3.5)
   *   If you picked Team A and they win by 4+, you're correct.
   *   If you picked Team B and they lose by 3 or fewer (or win), you're correct.
   *
   * gameResults must include scores for spread calculation.
   */
  static async scorePickemWeekATS(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{
      game_id: string;
      home_team: string;
      away_team: string;
      home_score: number;
      away_score: number;
      status: string; // 'final', 'postponed', 'tie'
    }>
  ): Promise<{ scored: number; error?: string }> {
    try {
      const resultMap = new Map(gameResults.map(g => [g.game_id, g]));

      const { data: picks, error: fetchErr } = await supabase
        .from('pool_picks')
        .select('id, game_id, picked_team, spread_value')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      if (fetchErr) return { scored: 0, error: fetchErr.message };

      let scored = 0;
      for (const pick of (picks ?? [])) {
        const game = resultMap.get(pick.game_id);
        if (!game || game.status === 'postponed') {
          // Postponed = incorrect (0 points)
          if (game?.status === 'postponed') {
            await supabase
              .from('pool_picks')
              .update({ is_correct: false })
              .eq('id', pick.id);
            scored++;
          }
          continue;
        }

        const spread = pick.spread_value ?? 0;

        // Calculate if picked team covers the spread
        // Spread is from the perspective of the picked team
        // If picked_team is home: adjusted_score = home_score + spread
        // If picked_team is away: adjusted_score = away_score + spread
        let isCorrect = false;
        if (pick.picked_team === game.home_team) {
          // Home team picked with spread
          isCorrect = (game.home_score + spread) > game.away_score;
        } else if (pick.picked_team === game.away_team) {
          // Away team picked with spread
          isCorrect = (game.away_score + spread) > game.home_score;
        }

        await supabase
          .from('pool_picks')
          .update({ is_correct: isCorrect })
          .eq('id', pick.id);
        scored++;
      }
      return { scored };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PoolService] scorePickemWeekATS error:', message);
      return { scored: 0, error: message };
    }
  }

  /** Calculate cumulative Pick'em standings. */
  static async getPickemStandings(leagueId: string): Promise<PickemStanding[]> {
    try {
      const { data: picks, error } = await supabase
        .from('pool_picks')
        .select('user_id, is_correct')
        .eq('league_id', leagueId)
        .not('is_correct', 'is', null);

      if (error) throw error;

      // Aggregate per user
      const map = new Map<string, { correct: number; total: number }>();
      for (const p of (picks ?? [])) {
        if (!map.has(p.user_id)) map.set(p.user_id, { correct: 0, total: 0 });
        const entry = map.get(p.user_id)!;
        entry.total++;
        if (p.is_correct) entry.correct++;
      }

      // Fetch display names
      const userIds = [...map.keys()];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);

      const nameMap = new Map((profiles ?? []).map(p => [p.id, p.display_name || 'Unknown']));

      // Also fetch per-week breakdown for the current standings display
      const { data: allPicks } = await supabase
        .from('pool_picks')
        .select('user_id, week_number, is_correct')
        .eq('league_id', leagueId)
        .not('is_correct', 'is', null);

      // Build per-user, per-week counts
      const weeklyMap = new Map<string, Map<number, number>>();
      for (const p of (allPicks ?? [])) {
        if (!weeklyMap.has(p.user_id)) weeklyMap.set(p.user_id, new Map());
        const weeks = weeklyMap.get(p.user_id)!;
        if (p.is_correct) {
          weeks.set(p.week_number, (weeks.get(p.week_number) || 0) + 1);
        } else if (!weeks.has(p.week_number)) {
          weeks.set(p.week_number, 0);
        }
      }

      return [...map.entries()]
        .map(([uid, stats]) => ({
          user_id: uid,
          display_name: nameMap.get(uid) || 'Unknown',
          correct_picks: stats.correct,
          total_picks: stats.total,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          current_week_correct: 0,
          weekly_correct: Object.fromEntries(weeklyMap.get(uid)?.entries() || []) as Record<number, number>,
        }))
        .sort((a, b) => {
          // Primary: most correct picks
          if (b.correct_picks !== a.correct_picks) return b.correct_picks - a.correct_picks;
          // Tiebreaker: highest accuracy (fewer total picks with same correct = better)
          return b.accuracy - a.accuracy;
        });
    } catch (err) {
      console.error('[PoolService] getPickemStandings error:', err);
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Survivor Pool
  // --------------------------------------------------------------------------

  /** Submit a survivor pick for a given week. Enforces no-repeat rule. */
  static async submitSurvivorPick(
    leagueId: string,
    userId: string,
    weekNumber: number,
    pickedTeam: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if user is eliminated
      const eliminated = await this.isSurvivorEliminated(leagueId, userId);
      if (eliminated) return { success: false, error: 'You have been eliminated from this pool.' };

      // Per-game lock: prevent picking a team whose game has already started (ESPN/Yahoo standard)
      const weekGames = await this.getWeekGames(weekNumber);
      const teamGame = weekGames.find(
        g => g.home_team === pickedTeam || g.away_team === pickedTeam
      );
      if (teamGame) {
        const gameStart = teamGame.game_time
          ? new Date(`${teamGame.game_date}T${teamGame.game_time}`)
          : null;
        const gameLocked = teamGame.status === 'live' || teamGame.status === 'final' ||
          (gameStart && gameStart <= new Date());
        if (gameLocked) {
          return { success: false, error: `${pickedTeam}'s game has already started. Pick a team whose game hasn't begun yet.` };
        }
      }

      // Check for duplicate team usage
      const { data: previous } = await supabase
        .from('survivor_selections')
        .select('picked_team')
        .eq('league_id', leagueId)
        .eq('user_id', userId);

      const usedTeams = new Set((previous ?? []).map(p => p.picked_team));
      if (usedTeams.has(pickedTeam)) {
        return { success: false, error: `You have already used ${pickedTeam} this season.` };
      }

      // Upsert the pick for the week
      const { error } = await supabase
        .from('survivor_selections')
        .upsert({
          league_id: leagueId,
          user_id: userId,
          week_number: weekNumber,
          picked_team: pickedTeam,
          is_correct: null,
        }, { onConflict: 'league_id,user_id,week_number' });

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PoolService] submitSurvivorPick error:', message);
      return { success: false, error: message };
    }
  }

  /** Check if a user is eliminated (all lives lost). */
  static async isSurvivorEliminated(leagueId: string, userId: string): Promise<boolean> {
    try {
      // Get league survivor lives setting
      const { data: league } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      const maxLives = (league?.settings as LeagueSettings)?.survivorLives ?? 1;

      // Count incorrect picks
      const { count, error } = await supabase
        .from('survivor_selections')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('is_correct', false);

      if (error) throw error;
      return (count ?? 0) >= maxLives;
    } catch (err) {
      console.error('[PoolService] isSurvivorEliminated error:', err);
      return false;
    }
  }

  /** Score survivor picks for a week. */
  static async scoreSurvivorWeek(
    leagueId: string,
    weekNumber: number,
    teamResults: Array<{ team: string; won: boolean }>
  ): Promise<{ scored: number; error?: string }> {
    try {
      const resultMap = new Map(teamResults.map(t => [t.team, t.won]));

      const { data: selections, error: fetchErr } = await supabase
        .from('survivor_selections')
        .select('id, picked_team')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      if (fetchErr) return { scored: 0, error: fetchErr.message };

      let scored = 0;
      for (const sel of (selections ?? [])) {
        const won = resultMap.get(sel.picked_team);
        if (won === undefined) continue;
        await supabase
          .from('survivor_selections')
          .update({ is_correct: won })
          .eq('id', sel.id);
        scored++;
      }
      return { scored };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  /** Get survivor standings with elimination status. */
  static async getSurvivorStandings(leagueId: string): Promise<SurvivorStanding[]> {
    try {
      const { data: league } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      const maxLives = (league?.settings as LeagueSettings)?.survivorLives ?? 1;

      const { data: selections, error } = await supabase
        .from('survivor_selections')
        .select('user_id, week_number, picked_team, is_correct')
        .eq('league_id', leagueId)
        .order('week_number');

      if (error) throw error;

      // Aggregate per user
      const map = new Map<string, {
        teams: string[];
        losses: number;
        eliminatedWeek: number | null;
        currentPick: string | null;
        maxWeek: number;
      }>();

      for (const s of (selections ?? [])) {
        if (!map.has(s.user_id)) {
          map.set(s.user_id, { teams: [], losses: 0, eliminatedWeek: null, currentPick: null, maxWeek: 0 });
        }
        const entry = map.get(s.user_id)!;
        entry.teams.push(s.picked_team);
        if (s.week_number > entry.maxWeek) {
          entry.maxWeek = s.week_number;
          entry.currentPick = s.picked_team;
        }
        if (s.is_correct === false) {
          entry.losses++;
          if (entry.losses >= maxLives && entry.eliminatedWeek === null) {
            entry.eliminatedWeek = s.week_number;
          }
        }
      }

      // Fetch display names
      const userIds = [...map.keys()];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);

      const nameMap = new Map((profiles ?? []).map(p => [p.id, p.display_name || 'Unknown']));

      return [...map.entries()]
        .map(([uid, info]) => ({
          user_id: uid,
          display_name: nameMap.get(uid) || 'Unknown',
          is_eliminated: info.losses >= maxLives,
          eliminated_week: info.eliminatedWeek,
          lives_remaining: Math.max(0, maxLives - info.losses),
          teams_used: info.teams,
          current_pick: info.currentPick,
        }))
        .sort((a, b) => {
          // Active players first, then by weeks survived
          if (a.is_eliminated !== b.is_eliminated) return a.is_eliminated ? 1 : -1;
          return b.teams_used.length - a.teams_used.length;
        });
    } catch (err) {
      console.error('[PoolService] getSurvivorStandings error:', err);
      return [];
    }
  }

  /** Get full pick history with results for survivor pool. */
  static async getSurvivorPickHistory(
    leagueId: string,
    userId: string
  ): Promise<Array<{ week: number; team: string; is_correct: boolean | null }>> {
    try {
      const { data, error } = await supabase
        .from('survivor_selections')
        .select('week_number, picked_team, is_correct')
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .order('week_number');

      if (error) throw error;
      return (data ?? []).map(d => ({
        week: d.week_number,
        team: d.picked_team,
        is_correct: d.is_correct,
      }));
    } catch (err) {
      console.error('[PoolService] getSurvivorPickHistory error:', err);
      return [];
    }
  }

  /** Get teams already used by a user in survivor pool. */
  static async getSurvivorUsedTeams(leagueId: string, userId: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('survivor_selections')
        .select('picked_team')
        .eq('league_id', leagueId)
        .eq('user_id', userId);

      if (error) throw error;
      return (data ?? []).map(d => d.picked_team);
    } catch (err) {
      console.error('[PoolService] getSurvivorUsedTeams error:', err);
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Confidence Pool
  // --------------------------------------------------------------------------

  /** Submit ranked confidence picks for a week. Rejects picks for started games. */
  static async submitConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    inputPicks: Array<{ game_id: string; picked_team: string; confidence_points: number }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Deadline enforcement: reject picks for games that have started
      const weekGames = await this.getWeekGames(weekNumber);
      const gameMap = new Map(weekGames.map(g => [String(g.id), g]));
      const picks = inputPicks.filter(p => {
        const game = gameMap.get(p.game_id);
        return !game || !isGameLocked(game);
      });

      if (picks.length === 0 && inputPicks.length > 0) {
        return { success: false, error: 'All selected games have already started. Picks are locked after game time.' };
      }

      // Validate uniqueness of confidence points
      const pointSet = new Set(picks.map(p => p.confidence_points));
      if (pointSet.size !== picks.length) {
        return { success: false, error: 'Each pick must have a unique confidence point value.' };
      }

      // Validate sequential 1-to-N (industry standard: ESPN/Yahoo/CBS)
      const n = picks.length;
      const expectedSet = new Set(Array.from({ length: n }, (_, i) => i + 1));
      for (const pts of pointSet) {
        if (!expectedSet.has(pts)) {
          return { success: false, error: `Confidence values must be sequential 1 to ${n}. Invalid value: ${pts}` };
        }
      }

      const rows = picks.map(p => ({
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        game_id: p.game_id,
        picked_team: p.picked_team,
        confidence_points: p.confidence_points,
        is_correct: null,
        points_earned: 0,
      }));

      const { error } = await supabase
        .from('confidence_picks')
        .upsert(rows, { onConflict: 'league_id,user_id,week_number,game_id' });

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PoolService] submitConfidencePicks error:', message);
      return { success: false, error: message };
    }
  }

  /** Get a user's confidence picks for a week. */
  static async getConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number
  ): Promise<ConfidencePick[]> {
    try {
      const { data, error } = await supabase
        .from('confidence_picks')
        .select('*')
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('week_number', weekNumber)
        .order('confidence_points', { ascending: false });

      if (error) throw error;
      return (data ?? []) as ConfidencePick[];
    } catch (err) {
      console.error('[PoolService] getConfidencePicks error:', err);
      return [];
    }
  }

  /**
   * Score confidence picks for a week.
   * Points earned = confidence_points if correct, 0 otherwise.
   * Tie/postponed games = 0 points (industry standard).
   */
  static async scoreConfidenceWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>
  ): Promise<{ scored: number; error?: string }> {
    try {
      const resultMap = new Map(gameResults.map(g => [g.game_id, g.winning_team]));

      const { data: picks, error: fetchErr } = await supabase
        .from('confidence_picks')
        .select('id, game_id, picked_team, confidence_points')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      if (fetchErr) return { scored: 0, error: fetchErr.message };

      let scored = 0;
      for (const pick of (picks ?? [])) {
        const winner = resultMap.get(pick.game_id);
        if (winner === undefined) continue;
        // Tie/postponed = incorrect (0 points), matching ESPN/CBS standard
        const isCorrect = winner !== 'TIE' && winner !== 'POSTPONED' && pick.picked_team === winner;
        const pointsEarned = isCorrect ? pick.confidence_points : 0;
        await supabase
          .from('confidence_picks')
          .update({ is_correct: isCorrect, points_earned: pointsEarned })
          .eq('id', pick.id);
        scored++;
      }
      return { scored };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { scored: 0, error: message };
    }
  }

  /** Calculate cumulative confidence pool standings. */
  static async getConfidenceStandings(leagueId: string): Promise<ConfidenceStanding[]> {
    try {
      const { data: picks, error } = await supabase
        .from('confidence_picks')
        .select('user_id, week_number, confidence_points, points_earned, is_correct')
        .eq('league_id', leagueId);

      if (error) throw error;

      const map = new Map<string, {
        totalPoints: number;
        possiblePoints: number;
        weeks: Set<number>;
      }>();

      for (const p of (picks ?? [])) {
        if (!map.has(p.user_id)) map.set(p.user_id, { totalPoints: 0, possiblePoints: 0, weeks: new Set() });
        const entry = map.get(p.user_id)!;
        entry.totalPoints += p.points_earned ?? 0;
        entry.possiblePoints += p.confidence_points;
        entry.weeks.add(p.week_number);
      }

      const userIds = [...map.keys()];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);

      const nameMap = new Map((profiles ?? []).map(p => [p.id, p.display_name || 'Unknown']));

      return [...map.entries()]
        .map(([uid, stats]) => ({
          user_id: uid,
          display_name: nameMap.get(uid) || 'Unknown',
          total_points: stats.totalPoints,
          possible_points: stats.possiblePoints,
          current_week_points: 0,
          weeks_played: stats.weeks.size,
        }))
        .sort((a, b) => {
          // Primary: most total points
          if (b.total_points !== a.total_points) return b.total_points - a.total_points;
          // Tiebreaker: higher efficiency (points earned / possible points)
          const effA = a.possible_points > 0 ? a.total_points / a.possible_points : 0;
          const effB = b.possible_points > 0 ? b.total_points / b.possible_points : 0;
          return effB - effA;
        });
    } catch (err) {
      console.error('[PoolService] getConfidenceStandings error:', err);
      return [];
    }
  }
}
