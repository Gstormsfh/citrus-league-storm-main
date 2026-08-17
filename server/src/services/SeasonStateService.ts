import { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentSeason, logger } from '@citrus/shared';

/**
 * Determines whether a fantasy league's season is complete and rosters
 * should be locked. A season is complete when:
 *
 *  1. All regular-season matchups are finished (status = 'completed'), AND
 *  2. Either no playoff bracket exists OR the bracket status = 'completed'.
 *
 * For non-fantasy league types (pickem, survivor, etc.) this always
 * returns `{ complete: false }` — those flows have their own lock logic.
 */
export class SeasonStateService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async isSeasonComplete(leagueId: string): Promise<{ complete: boolean; reason?: string }> {
    try {
      const { data: league, error: leagueErr } = await this.supabase
        .from('leagues')
        .select('id, settings, league_type')
        .eq('id', leagueId)
        .maybeSingle();

      if (leagueErr || !league) {
        return { complete: false };
      }

      // Only fantasy leagues use the roster/trade lock logic here.
      const leagueType = (league as any).league_type ?? 'fantasy';
      if (leagueType && leagueType !== 'fantasy') {
        return { complete: false };
      }

      const { data: matchups, error: matchupsErr } = await this.supabase
        .from('matchups')
        .select('id, status, week_number')
        .eq('league_id', leagueId);

      if (matchupsErr) {
        logger.warn('[SeasonStateService] matchups query failed:', matchupsErr);
        return { complete: false };
      }

      if (!matchups || matchups.length === 0) {
        return { complete: false };
      }

      // Regular-season boundary: prefer settings.regularSeasonWeeks; otherwise
      // fall back to max week_number across matchups (no playoffs case).
      const settings = ((league as any).settings ?? {}) as Record<string, unknown>;
      const cfgRegularWeeks = Number(settings.regularSeasonWeeks ?? 0) || 0;
      const maxWeek = matchups.reduce((m, r: any) => Math.max(m, Number(r.week_number) || 0), 0);
      const regularSeasonCutoff = cfgRegularWeeks > 0 ? cfgRegularWeeks : maxWeek;

      const regularMatchups = matchups.filter((m: any) => Number(m.week_number) <= regularSeasonCutoff);
      if (regularMatchups.length === 0) return { complete: false };

      const allRegularDone = regularMatchups.every(
        (m: any) => String(m.status).toLowerCase() === 'completed',
      );
      if (!allRegularDone) return { complete: false };

      // Check playoff bracket status if any.
      const { data: bracket } = await this.supabase
        .from('playoff_brackets')
        .select('id, status')
        .eq('league_id', leagueId)
        .eq('season', getCurrentSeason())
        .maybeSingle();

      if (!bracket) {
        return { complete: true, reason: 'regular_season_complete_no_playoffs' };
      }

      const bracketStatus = String((bracket as any).status ?? '').toLowerCase();
      if (bracketStatus === 'completed') {
        return { complete: true, reason: 'playoffs_complete' };
      }

      return { complete: false };
    } catch (err) {
      logger.warn('[SeasonStateService] isSeasonComplete error:', err);
      return { complete: false };
    }
  }
}
