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
  // Pick'em Pool
  // --------------------------------------------------------------------------

  /** Submit or update a batch of picks for a given week. */
  static async submitPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; spread_value?: number }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
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
  static async scorePickemWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>
  ): Promise<{ scored: number; error?: string }> {
    try {
      const resultMap = new Map(gameResults.map(g => [g.game_id, g.winning_team]));

      const { data: picks, error: fetchErr } = await supabase
        .from('pool_picks')
        .select('id, game_id, picked_team')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      if (fetchErr) return { scored: 0, error: fetchErr.message };

      let scored = 0;
      for (const pick of (picks ?? [])) {
        const winner = resultMap.get(pick.game_id);
        if (winner === undefined) continue; // game not finished
        const isCorrect = pick.picked_team === winner;
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

      return [...map.entries()]
        .map(([uid, stats]) => ({
          user_id: uid,
          display_name: nameMap.get(uid) || 'Unknown',
          correct_picks: stats.correct,
          total_picks: stats.total,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          current_week_correct: 0, // caller can enrich from current week data
        }))
        .sort((a, b) => b.correct_picks - a.correct_picks);
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

      const maxLives = (league?.settings as any)?.survivorLives ?? 1;

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

      const maxLives = (league?.settings as any)?.survivorLives ?? 1;

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

  /** Submit ranked confidence picks for a week. */
  static async submitConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    picks: Array<{ game_id: string; picked_team: string; confidence_points: number }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate uniqueness of confidence points
      const pointSet = new Set(picks.map(p => p.confidence_points));
      if (pointSet.size !== picks.length) {
        return { success: false, error: 'Each pick must have a unique confidence point value.' };
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

  /** Score confidence picks for a week. Points earned = confidence_points if correct. */
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
        const isCorrect = pick.picked_team === winner;
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
        .sort((a, b) => b.total_points - a.total_points);
    } catch (err) {
      console.error('[PoolService] getConfidenceStandings error:', err);
      return [];
    }
  }
}
