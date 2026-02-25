/**
 * PlayoffService - World-class playoff bracket management
 *
 * Handles:
 * - Bracket generation (seeded from standings)
 * - Round advancement
 * - Bracket reset
 * - Playoff picture (clinch/elimination status, magic numbers)
 * - Score syncing between matchups table and playoff_series
 */

import { supabase } from '@/integrations/supabase/client';
import { CURRENT_SEASON } from '@/utils/seasonConstants';

// ============================================================================
// TYPES
// ============================================================================

export interface PlayoffBracket {
  id: string;
  league_id: string;
  season: number;
  bracket_size: number;  // 4, 6, or 8
  status: 'pending' | 'active' | 'completed';
  current_round: number;
  total_rounds: number;
  seeding_method: 'standings' | 'manual';
  reseed_each_round: boolean;
  consolation_enabled: boolean;
  two_week_matchups: boolean;
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  third_place_team_id: string | null;
  generated_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayoffSeed {
  id: string;
  bracket_id: string;
  team_id: string;
  seed_number: number;
  regular_season_wins: number;
  regular_season_losses: number;
  regular_season_ties: number;
  regular_season_points_for: number;
  source: 'standings' | 'commissioner_override';
  created_at: string;
}

export interface PlayoffSeries {
  id: string;
  bracket_id: string;
  round_number: number;
  match_number: number;
  bracket_position: 'winners' | 'consolation' | 'third_place';
  home_seed: number | null;
  away_seed: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  winner_team_id: string | null;
  loser_team_id: string | null;
  status: 'pending' | 'bye' | 'active' | 'completed';
  matchup_week_1: number | null;
  matchup_week_2: number | null;
  winner_advances_to: string | null;
  winner_slot: 'home' | 'away' | null;
  loser_drops_to: string | null;
  loser_slot: 'home' | 'away' | null;
  created_at: string;
  updated_at: string;
}

export interface PlayoffPictureTeam {
  team_id: string;
  team_name: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  clinch_status: 'clinched' | 'eliminated' | 'in_contention';
  magic_number: number;
}

export interface PlayoffPicture {
  playoff_teams: number;
  total_teams: number;
  weeks_completed: number;
  remaining_weeks: number;
  teams: PlayoffPictureTeam[];
}

export interface BracketGenerationOptions {
  consolationEnabled?: boolean;
  twoWeekMatchups?: boolean;
  reseedEachRound?: boolean;
  seedingMethod?: 'standings' | 'manual';
}

// Round names by bracket size
const ROUND_NAMES: Record<number, Record<number, string>> = {
  8: { 1: 'Quarterfinals', 2: 'Semifinals', 3: 'Championship' },
  6: { 1: 'Wild Card Round', 2: 'Semifinals', 3: 'Championship' },
  4: { 1: 'Semifinals', 2: 'Championship' },
};

// ============================================================================
// SERVICE
// ============================================================================

export const PlayoffService = {
  /**
   * Get the active playoff bracket for a league
   */
  async getBracket(leagueId: string): Promise<{
    bracket: PlayoffBracket | null;
    seeds: PlayoffSeed[];
    series: PlayoffSeries[];
    error: Error | null;
  }> {
    try {
      // Get bracket
      const { data: bracketData, error: bracketError } = await supabase
        .from('playoff_brackets')
        .select('*')
        .eq('league_id', leagueId)
        .eq('season', CURRENT_SEASON)
        .maybeSingle();

      if (bracketError) throw bracketError;
      if (!bracketData) {
        return { bracket: null, seeds: [], series: [], error: null };
      }

      const bracket = bracketData as unknown as PlayoffBracket;

      // Get seeds and series in parallel
      const [seedsResult, seriesResult] = await Promise.all([
        supabase
          .from('playoff_seeds')
          .select('*')
          .eq('bracket_id', bracket.id)
          .order('seed_number', { ascending: true }),
        supabase
          .from('playoff_series')
          .select('*')
          .eq('bracket_id', bracket.id)
          .order('round_number', { ascending: true })
          .order('match_number', { ascending: true }),
      ]);

      if (seedsResult.error) throw seedsResult.error;
      if (seriesResult.error) throw seriesResult.error;

      return {
        bracket,
        seeds: (seedsResult.data || []) as unknown as PlayoffSeed[],
        series: (seriesResult.data || []) as unknown as PlayoffSeries[],
        error: null,
      };
    } catch (error) {
      console.error('[PlayoffService] Error getting bracket:', error);
      return {
        bracket: null,
        seeds: [],
        series: [],
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  /**
   * Generate a new playoff bracket (commissioner only)
   */
  async generateBracket(
    leagueId: string,
    options: BracketGenerationOptions = {}
  ): Promise<{ result: any; error: Error | null }> {
    try {
      const { data, error } = await supabase.rpc('generate_playoff_bracket', {
        p_league_id: leagueId,
        p_consolation_enabled: options.consolationEnabled ?? false,
        p_two_week_matchups: options.twoWeekMatchups ?? false,
        p_reseed_each_round: options.reseedEachRound ?? false,
        p_seeding_method: options.seedingMethod ?? 'standings',
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result?.error) {
        return { result: null, error: new Error(result.error) };
      }

      return { result, error: null };
    } catch (error) {
      console.error('[PlayoffService] Error generating bracket:', error);
      return {
        result: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  /**
   * Advance winners to the next round (commissioner only)
   */
  async advanceRound(bracketId: string): Promise<{ result: any; error: Error | null }> {
    try {
      const { data, error } = await supabase.rpc('advance_playoff_round', {
        p_bracket_id: bracketId,
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result?.error) {
        return { result: null, error: new Error(result.error) };
      }

      return { result, error: null };
    } catch (error) {
      console.error('[PlayoffService] Error advancing round:', error);
      return {
        result: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  /**
   * Reset the playoff bracket (commissioner only)
   */
  async resetBracket(leagueId: string): Promise<{ error: Error | null }> {
    try {
      const { data, error } = await supabase.rpc('reset_playoff_bracket', {
        p_league_id: leagueId,
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result?.error) {
        return { error: new Error(result.error) };
      }

      return { error: null };
    } catch (error) {
      console.error('[PlayoffService] Error resetting bracket:', error);
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  /**
   * Get the playoff picture (clinching scenarios, magic numbers)
   */
  async getPlayoffPicture(leagueId: string): Promise<{
    picture: PlayoffPicture | null;
    error: Error | null;
  }> {
    try {
      const { data, error } = await supabase.rpc('get_playoff_picture', {
        p_league_id: leagueId,
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result?.error) {
        return { picture: null, error: new Error(result.error) };
      }

      return { picture: result as PlayoffPicture, error: null };
    } catch (error) {
      console.error('[PlayoffService] Error getting playoff picture:', error);
      return {
        picture: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  /**
   * Get the round name for a given bracket size and round number
   */
  getRoundName(bracketSize: number, roundNumber: number): string {
    return ROUND_NAMES[bracketSize]?.[roundNumber] || `Round ${roundNumber}`;
  },

  /**
   * Check if the user is the commissioner of a league
   */
  async isCommissioner(leagueId: string, userId: string): Promise<boolean> {
    try {
      const { data } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .maybeSingle();

      return data?.commissioner_id === userId;
    } catch {
      return false;
    }
  },

  /**
   * Structure series data into a renderable bracket tree
   */
  buildBracketTree(
    series: PlayoffSeries[],
    seeds: PlayoffSeed[],
    teamNames: Record<string, string>,
    bracketSize: number
  ): {
    winners: Map<number, PlayoffSeries[]>;
    consolation: Map<number, PlayoffSeries[]>;
    thirdPlace: PlayoffSeries | null;
    seedMap: Map<string, PlayoffSeed>;
  } {
    const winners = new Map<number, PlayoffSeries[]>();
    const consolation = new Map<number, PlayoffSeries[]>();
    let thirdPlace: PlayoffSeries | null = null;

    const seedMap = new Map<string, PlayoffSeed>();
    seeds.forEach(s => seedMap.set(s.team_id, s));

    series.forEach(s => {
      if (s.bracket_position === 'winners') {
        if (!winners.has(s.round_number)) winners.set(s.round_number, []);
        winners.get(s.round_number)!.push(s);
      } else if (s.bracket_position === 'consolation') {
        if (!consolation.has(s.round_number)) consolation.set(s.round_number, []);
        consolation.get(s.round_number)!.push(s);
      } else if (s.bracket_position === 'third_place') {
        thirdPlace = s;
      }
    });

    // Sort each round's matchups by match_number
    winners.forEach(roundSeries => roundSeries.sort((a, b) => a.match_number - b.match_number));
    consolation.forEach(roundSeries => roundSeries.sort((a, b) => a.match_number - b.match_number));

    return { winners, consolation, thirdPlace, seedMap };
  },
};
