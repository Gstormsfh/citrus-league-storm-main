import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, SEASON_START_YEAR } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';
import { ScheduleService } from './ScheduleService';
import { AppError } from '../lib/errors';

/**
 * PoolService — Server-side gameplay layer for Pick'em, Survivor, and Confidence pools.
 *
 * Handles submission, retrieval, scoring, and standings for all pool-style league types.
 * Tables: pool_picks, survivor_selections, confidence_picks.
 */
export class PoolService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;
  private schedule: ScheduleService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
    this.schedule = new ScheduleService(supabase);
  }

  // ── Week Helpers ────────────────────────────────────────────────────

  /** Get the current NHL week number. */
  getCurrentWeek(): number {
    const oct1 = new Date(SEASON_START_YEAR, 9, 1);
    const dayOfWeek = oct1.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const firstSunday = new Date(oct1);
    firstSunday.setDate(oct1.getDate() + daysUntilSunday);

    const now = new Date();
    const diffMs = now.getTime() - firstSunday.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
  }

  /** Get week date range (Sunday–Saturday). */
  private getWeekDateRange(weekNumber: number): { start: string; end: string } {
    const oct1 = new Date(SEASON_START_YEAR, 9, 1);
    const dayOfWeek = oct1.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const firstSunday = new Date(oct1);
    firstSunday.setDate(oct1.getDate() + daysUntilSunday);

    const start = new Date(firstSunday);
    start.setDate(firstSunday.getDate() + (weekNumber - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { start: fmt(start), end: fmt(end) };
  }

  /** Get games for a week and check lock status. */
  private async getWeekGames(weekNumber: number): Promise<any[]> {
    const { start, end } = this.getWeekDateRange(weekNumber);
    const { games } = await this.schedule.getGamesForDateRange(start, end);
    return games as any[];
  }

  /** Check if a game has started (locked for picks). */
  private isGameLocked(game: { status: string; game_date: string; game_time?: string }): boolean {
    if (game.status === 'live' || game.status === 'final' || game.status === 'postponed') return true;
    if (!game.game_time) return false;
    const gameDateTime = new Date(`${game.game_date}T${game.game_time}`);
    return new Date() >= gameDateTime;
  }

  // ── Pick'em Pool ────────────────────────────────────────────────────

  /** Submit or update Pick'em picks for a week. Rejects picks for started games. */
  async submitPickemPicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    inputPicks: Array<{ game_id: string; picked_team: string; spread_value?: number }>,
  ) {
    await this.membership.requireMembership(leagueId, userId);

    const weekGames = await this.getWeekGames(weekNumber);
    const gameMap = new Map(weekGames.map((g: any) => [String(g.id), g]));

    // Filter out locked games and validate game existence
    const picks = inputPicks.filter(p => {
      const game = gameMap.get(p.game_id);
      if (!game) return false; // Skip picks for non-existent games
      return !this.isGameLocked(game);
    });

    if (picks.length === 0 && inputPicks.length > 0) {
      throw AppError.badRequest('All selected games have already started. Picks are locked after game time.');
    }

    const rows = picks.map(p => ({
      league_id: leagueId,
      user_id: userId,
      week_number: weekNumber,
      game_id: p.game_id,
      picked_team: p.picked_team,
      spread_value: p.spread_value ?? null,
      is_correct: null,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from('pool_picks')
      .upsert(rows, { onConflict: 'league_id,user_id,week_number,game_id' });

    if (error) throw AppError.internal(error.message);
    return { success: true, submitted: picks.length, locked: inputPicks.length - picks.length };
  }

  /** Get a user's Pick'em picks for a week. */
  async getPickemPicks(leagueId: string, userId: string, weekNumber: number) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('pool_picks')
      .select(COLUMNS.POOL_PICK)
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .eq('week_number', weekNumber)
      .order('created_at');

    if (error) throw AppError.internal(error.message);
    return data || [];
  }

  /** Score Pick'em picks for a week. */
  async scorePickemWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ) {
    const resultMap = new Map(gameResults.map(g => [g.game_id, g.winning_team]));

    const { data: picks, error: fetchErr } = await this.supabase
      .from('pool_picks')
      .select('id, game_id, picked_team')
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber);

    if (fetchErr) throw AppError.internal(fetchErr.message);

    let scored = 0;
    for (const pick of (picks ?? [])) {
      const winner = resultMap.get(pick.game_id);
      if (winner === undefined) continue;

      const isCorrect = winner !== 'TIE' && winner !== 'POSTPONED' && pick.picked_team === winner;

      await this.supabase
        .from('pool_picks')
        .update({ is_correct: isCorrect })
        .eq('id', pick.id);
      scored++;
    }
    return { scored };
  }

  /** Score Pick'em ATS picks for a week. */
  async scorePickemWeekATS(
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
    const resultMap = new Map(gameResults.map(g => [g.game_id, g]));

    const { data: picks, error: fetchErr } = await this.supabase
      .from('pool_picks')
      .select('id, game_id, picked_team, spread_value')
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber);

    if (fetchErr) throw AppError.internal(fetchErr.message);

    let scored = 0;
    for (const pick of (picks ?? [])) {
      const game = resultMap.get(pick.game_id);
      if (!game || game.status === 'postponed') {
        if (game?.status === 'postponed') {
          await this.supabase.from('pool_picks').update({ is_correct: false }).eq('id', pick.id);
          scored++;
        }
        continue;
      }

      const spread = pick.spread_value ?? 0;
      let isCorrect = false;
      if (pick.picked_team === game.home_team) {
        isCorrect = (game.home_score + spread) > game.away_score;
      } else if (pick.picked_team === game.away_team) {
        isCorrect = (game.away_score + spread) > game.home_score;
      }

      await this.supabase.from('pool_picks').update({ is_correct: isCorrect }).eq('id', pick.id);
      scored++;
    }
    return { scored };
  }

  /** Get cumulative Pick'em standings. */
  async getPickemStandings(leagueId: string) {
    await this.membership.requireMembership(leagueId, this.getCurrentUserId());

    const { data: picks, error } = await this.supabase
      .from('pool_picks')
      .select('user_id, week_number, is_correct')
      .eq('league_id', leagueId)
      .not('is_correct', 'is', null);

    if (error) throw AppError.internal(error.message);

    // Aggregate per user
    const map = new Map<string, { correct: number; total: number; weekly: Map<number, number> }>();
    for (const p of (picks ?? [])) {
      if (!map.has(p.user_id)) map.set(p.user_id, { correct: 0, total: 0, weekly: new Map() });
      const entry = map.get(p.user_id)!;
      entry.total++;
      if (p.is_correct) {
        entry.correct++;
        entry.weekly.set(p.week_number, (entry.weekly.get(p.week_number) || 0) + 1);
      } else if (!entry.weekly.has(p.week_number)) {
        entry.weekly.set(p.week_number, 0);
      }
    }

    const userIds = [...map.keys()];
    const { data: profiles } = userIds.length > 0
      ? await this.supabase.from('profiles').select('id, username, first_name, last_name').in('id', userIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p: { id: string; username: string | null; first_name: string | null; last_name: string | null }) => [p.id, p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown']));

    return [...map.entries()]
      .map(([uid, stats]) => ({
        user_id: uid,
        display_name: nameMap.get(uid) || 'Unknown',
        correct_picks: stats.correct,
        total_picks: stats.total,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        current_week_correct: 0,
        weekly_correct: Object.fromEntries(stats.weekly.entries()),
      }))
      .sort((a, b) => b.correct_picks !== a.correct_picks
        ? b.correct_picks - a.correct_picks
        : b.accuracy - a.accuracy);
  }

  // ── Survivor Pool ──────────────────────────────────────────────────

  /** Submit a survivor pick for a week. Enforces no-repeat and per-game lock. */
  async submitSurvivorPick(
    leagueId: string,
    userId: string,
    weekNumber: number,
    pickedTeam: string,
  ) {
    await this.membership.requireMembership(leagueId, userId);

    // Check elimination
    const eliminated = await this.checkSurvivorEliminated(leagueId, userId);
    if (eliminated) throw AppError.badRequest('You have been eliminated from this pool.');

    // Per-game lock
    const weekGames = await this.getWeekGames(weekNumber);
    const teamGame = weekGames.find(
      (g: any) => g.home_team === pickedTeam || g.away_team === pickedTeam
    );
    if (teamGame && this.isGameLocked(teamGame)) {
      throw AppError.badRequest(`${pickedTeam}'s game has already started. Pick a team whose game hasn't begun yet.`);
    }

    // Check duplicate team usage
    const { data: previous } = await this.supabase
      .from('survivor_selections')
      .select('picked_team')
      .eq('league_id', leagueId)
      .eq('user_id', userId);

    const usedTeams = new Set((previous ?? []).map((p: { picked_team: string }) => p.picked_team));
    if (usedTeams.has(pickedTeam)) {
      throw AppError.badRequest(`You have already used ${pickedTeam} this season.`);
    }

    const { error } = await this.supabase
      .from('survivor_selections')
      .upsert({
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        picked_team: pickedTeam,
        is_correct: null,
      }, { onConflict: 'league_id,user_id,week_number' });

    if (error) throw AppError.internal(error.message);
    return { success: true };
  }

  /** Check if a user is eliminated from the survivor pool. */
  async checkSurvivorEliminated(leagueId: string, userId: string): Promise<boolean> {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const maxLives = (league?.settings as Record<string, unknown>)?.survivorLives as number ?? 1;

    const { count, error } = await this.supabase
      .from('survivor_selections')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .eq('is_correct', false);

    if (error) throw AppError.internal(error.message);
    return (count ?? 0) >= maxLives;
  }

  /** Score survivor picks for a week. */
  async scoreSurvivorWeek(
    leagueId: string,
    weekNumber: number,
    teamResults: Array<{ team: string; won: boolean }>,
  ) {
    const resultMap = new Map(teamResults.map(t => [t.team, t.won]));

    const { data: selections, error: fetchErr } = await this.supabase
      .from('survivor_selections')
      .select('id, picked_team')
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber);

    if (fetchErr) throw AppError.internal(fetchErr.message);

    let scored = 0;
    for (const sel of (selections ?? [])) {
      const won = resultMap.get(sel.picked_team);
      if (won === undefined) continue;
      await this.supabase.from('survivor_selections').update({ is_correct: won }).eq('id', sel.id);
      scored++;
    }
    return { scored };
  }

  /** Get survivor standings with elimination status. */
  async getSurvivorStandings(leagueId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const maxLives = (league?.settings as Record<string, unknown>)?.survivorLives as number ?? 1;

    const { data: selections, error } = await this.supabase
      .from('survivor_selections')
      .select('user_id, week_number, picked_team, is_correct')
      .eq('league_id', leagueId)
      .order('week_number');

    if (error) throw AppError.internal(error.message);

    const map = new Map<string, {
      teams: string[];
      losses: number;
      eliminatedWeek: number | null;
      currentPick: string | null;
      maxWeek: number;
    }>();

    for (const s of (selections ?? [])) {
      if (!map.has(s.user_id)) map.set(s.user_id, { teams: [], losses: 0, eliminatedWeek: null, currentPick: null, maxWeek: 0 });
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

    const userIds = [...map.keys()];
    const { data: profiles } = userIds.length > 0
      ? await this.supabase.from('profiles').select('id, username, first_name, last_name').in('id', userIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p: { id: string; username: string | null; first_name: string | null; last_name: string | null }) => [p.id, p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown']));

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
        if (a.is_eliminated !== b.is_eliminated) return a.is_eliminated ? 1 : -1;
        return b.teams_used.length - a.teams_used.length;
      });
  }

  /** Get full pick history for a user in a survivor pool. */
  async getSurvivorPickHistory(leagueId: string, userId: string) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('survivor_selections')
      .select('week_number, picked_team, is_correct')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .order('week_number');

    if (error) throw AppError.internal(error.message);
    return (data ?? []).map((d: { week_number: number; picked_team: string; is_correct: boolean | null }) => ({
      week: d.week_number,
      team: d.picked_team,
      is_correct: d.is_correct,
    }));
  }

  /** Get teams already used by a user in survivor pool. */
  async getSurvivorUsedTeams(leagueId: string, userId: string) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('survivor_selections')
      .select('picked_team')
      .eq('league_id', leagueId)
      .eq('user_id', userId);

    if (error) throw AppError.internal(error.message);
    return (data ?? []).map((d: { picked_team: string }) => d.picked_team);
  }

  // ── Confidence Pool ────────────────────────────────────────────────

  /** Submit ranked confidence picks for a week. Rejects picks for started games. */
  async submitConfidencePicks(
    leagueId: string,
    userId: string,
    weekNumber: number,
    inputPicks: Array<{ game_id: string; picked_team: string; confidence_points: number }>,
  ) {
    await this.membership.requireMembership(leagueId, userId);

    const weekGames = await this.getWeekGames(weekNumber);
    const gameMap = new Map(weekGames.map((g: any) => [String(g.id), g]));
    const picks = inputPicks.filter(p => {
      const game = gameMap.get(p.game_id);
      return !game || !this.isGameLocked(game);
    });

    if (picks.length === 0 && inputPicks.length > 0) {
      throw AppError.badRequest('All selected games have already started. Picks are locked after game time.');
    }

    // Validate uniqueness and sequential 1-to-N
    const pointSet = new Set(picks.map(p => p.confidence_points));
    if (pointSet.size !== picks.length) {
      throw AppError.validation('Each pick must have a unique confidence point value.');
    }
    const n = picks.length;
    const expectedSet = new Set(Array.from({ length: n }, (_, i) => i + 1));
    for (const pts of pointSet) {
      if (!expectedSet.has(pts)) {
        throw AppError.validation(`Confidence values must be sequential 1 to ${n}. Invalid value: ${pts}`);
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

    const { error } = await this.supabase
      .from('confidence_picks')
      .upsert(rows, { onConflict: 'league_id,user_id,week_number,game_id' });

    if (error) throw AppError.internal(error.message);
    return { success: true, submitted: picks.length, locked: inputPicks.length - picks.length };
  }

  /** Get a user's confidence picks for a week. */
  async getConfidencePicks(leagueId: string, userId: string, weekNumber: number) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('confidence_picks')
      .select(COLUMNS.CONFIDENCE_PICK)
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .eq('week_number', weekNumber)
      .order('confidence_points', { ascending: false });

    if (error) throw AppError.internal(error.message);
    return data || [];
  }

  /** Score confidence picks for a week. */
  async scoreConfidenceWeek(
    leagueId: string,
    weekNumber: number,
    gameResults: Array<{ game_id: string; winning_team: string }>,
  ) {
    const resultMap = new Map(gameResults.map(g => [g.game_id, g.winning_team]));

    const { data: picks, error: fetchErr } = await this.supabase
      .from('confidence_picks')
      .select('id, game_id, picked_team, confidence_points')
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber);

    if (fetchErr) throw AppError.internal(fetchErr.message);

    let scored = 0;
    for (const pick of (picks ?? [])) {
      const winner = resultMap.get(pick.game_id);
      if (winner === undefined) continue;
      const isCorrect = winner !== 'TIE' && winner !== 'POSTPONED' && pick.picked_team === winner;
      const pointsEarned = isCorrect ? pick.confidence_points : 0;
      await this.supabase
        .from('confidence_picks')
        .update({ is_correct: isCorrect, points_earned: pointsEarned })
        .eq('id', pick.id);
      scored++;
    }
    return { scored };
  }

  /** Get cumulative confidence pool standings. */
  async getConfidenceStandings(leagueId: string) {
    const { data: picks, error } = await this.supabase
      .from('confidence_picks')
      .select('user_id, week_number, confidence_points, points_earned, is_correct')
      .eq('league_id', leagueId);

    if (error) throw AppError.internal(error.message);

    const currentWeek = this.getCurrentWeek();
    const map = new Map<string, { totalPoints: number; possiblePoints: number; weeks: Set<number>; currentWeekPoints: number }>();
    for (const p of (picks ?? [])) {
      if (!map.has(p.user_id)) map.set(p.user_id, { totalPoints: 0, possiblePoints: 0, weeks: new Set(), currentWeekPoints: 0 });
      const entry = map.get(p.user_id)!;
      entry.totalPoints += p.points_earned ?? 0;
      entry.possiblePoints += p.confidence_points;
      entry.weeks.add(p.week_number);
      if (p.week_number === currentWeek) {
        entry.currentWeekPoints += p.points_earned ?? 0;
      }
    }

    const userIds = [...map.keys()];
    const { data: profiles } = userIds.length > 0
      ? await this.supabase.from('profiles').select('id, username, first_name, last_name').in('id', userIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p: { id: string; username: string | null; first_name: string | null; last_name: string | null }) => [p.id, p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown']));

    return [...map.entries()]
      .map(([uid, stats]) => ({
        user_id: uid,
        display_name: nameMap.get(uid) || 'Unknown',
        total_points: stats.totalPoints,
        possible_points: stats.possiblePoints,
        current_week_points: stats.currentWeekPoints,
        weeks_played: stats.weeks.size,
      }))
      .sort((a, b) => {
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;
        const effA = a.possible_points > 0 ? a.total_points / a.possible_points : 0;
        const effB = b.possible_points > 0 ? b.total_points / b.possible_points : 0;
        return effB - effA;
      });
  }

  // ── Week Games (public for routes) ─────────────────────────────────

  /** Get all games for a week with lock status. */
  async getGamesForWeek(weekNumber: number) {
    const games = await this.getWeekGames(weekNumber);
    return games.map((g: any) => ({
      ...g,
      is_locked: this.isGameLocked(g),
    }));
  }

  /** Placeholder — in routes, userId comes from context, not from the service. */
  private getCurrentUserId(): string {
    // This is overridden by the route handler which passes userId explicitly.
    // Standings methods that need membership checking receive userId from the route.
    return '';
  }
}
