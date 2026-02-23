/**
 * OddsService — Fetches and manages NHL game spreads/odds data.
 *
 * Data flows:
 *   1. The Odds API → fetch-spreads Edge Function → game_spreads table
 *   2. Frontend reads from game_spreads table via this service
 *
 * Used by Pick'em ATS mode to display puck lines alongside games.
 */

import { supabase } from '@/integrations/supabase/client';

export interface GameSpread {
  id: string;
  game_id: string;
  game_date: string;
  external_id: string | null;
  home_team: string;
  away_team: string;
  home_spread: number;
  away_spread: number;
  home_moneyline: number | null;
  away_moneyline: number | null;
  over_under: number | null;
  source: string;
  bookmaker: string;
  fetched_at: string;
}

export class OddsService {
  /**
   * Get spreads for a specific date (all games on that day).
   */
  static async getSpreadsForDate(date: string): Promise<GameSpread[]> {
    try {
      const { data, error } = await supabase
        .from('game_spreads')
        .select('*')
        .eq('game_date', date)
        .order('game_id');

      if (error) throw error;
      return (data ?? []) as GameSpread[];
    } catch (err) {
      console.error('[OddsService] getSpreadsForDate error:', err);
      return [];
    }
  }

  /**
   * Get spreads for multiple game IDs (e.g., all games in a Pick'em week).
   */
  static async getSpreadsForGames(gameIds: string[]): Promise<Map<string, GameSpread>> {
    try {
      if (gameIds.length === 0) return new Map();

      const { data, error } = await supabase
        .from('game_spreads')
        .select('*')
        .in('game_id', gameIds);

      if (error) throw error;

      const map = new Map<string, GameSpread>();
      for (const row of (data ?? [])) {
        map.set(row.game_id, row as GameSpread);
      }
      return map;
    } catch (err) {
      console.error('[OddsService] getSpreadsForGames error:', err);
      return new Map();
    }
  }

  /**
   * Get the spread for a single game.
   */
  static async getSpreadForGame(gameId: string): Promise<GameSpread | null> {
    try {
      const { data, error } = await supabase
        .from('game_spreads')
        .select('*')
        .eq('game_id', gameId)
        .maybeSingle();

      if (error) throw error;
      return data as GameSpread | null;
    } catch (err) {
      console.error('[OddsService] getSpreadForGame error:', err);
      return null;
    }
  }

  /**
   * Get spreads for a date range (e.g., a full Pick'em week).
   */
  static async getSpreadsForDateRange(startDate: string, endDate: string): Promise<GameSpread[]> {
    try {
      const { data, error } = await supabase
        .from('game_spreads')
        .select('*')
        .gte('game_date', startDate)
        .lte('game_date', endDate)
        .order('game_date')
        .order('game_id');

      if (error) throw error;
      return (data ?? []) as GameSpread[];
    } catch (err) {
      console.error('[OddsService] getSpreadsForDateRange error:', err);
      return [];
    }
  }

  /**
   * Trigger a manual spread fetch via the Edge Function.
   * Useful for commissioner "Refresh Spreads" button.
   * Requires authentication (the Edge Function verifies auth).
   */
  static async triggerSpreadFetch(date?: string): Promise<{
    success: boolean;
    events_fetched?: number;
    spreads_saved?: number;
    error?: string;
  }> {
    try {
      const url = date
        ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-spreads?date=${date}`
        : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-spreads`;

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        return { success: false, error: result.error || `HTTP ${response.status}` };
      }

      return {
        success: true,
        events_fetched: result.events_fetched,
        spreads_saved: result.spreads_saved,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[OddsService] triggerSpreadFetch error:', msg);
      return { success: false, error: msg };
    }
  }
}
