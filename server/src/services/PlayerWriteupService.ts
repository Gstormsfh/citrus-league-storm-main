import { NewsRoomService } from './NewsRoomService';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  buildWriteupFromSources,
  extractFormatSettings,
  logger,
  type DashboardIndexEntry,
  type CareerSummary,
  type PlayerWriteup,
  type XgHistoryPoint,
} from '@citrus/shared';
import { PlayerDashboardService } from './PlayerDashboardService';
import { LeagueMembershipService } from './LeagueMembershipService';
import { mirrorRulesIntoSettings } from '../lib/scoringMirror';

/**
 * THE PLAYER WRITEUP, RENDERED SERVER-SIDE (2026-09-11).
 *
 * Until today every word on a player card was written by
 * `apps/web/src/utils/playerWriteup.ts`, which means changing one was an App
 * Store round trip. The engine now lives in `@citrus/shared` and this
 * service feeds it, so the copy on the most-read surface in the product
 * ships with a server deploy.
 *
 * IT NEVER THROWS AND IT NEVER 500s ITS HOST. The writeup rides on
 * `GET /api/players/:playerId/xg-history`, a payload the player modal
 * already fetches, precisely so it costs no extra round trip and no loading
 * state. A writeup that arrives after the card has painted is worse than
 * one baked into the bundle. Every failure below therefore degrades to
 * `null`: the route omits the field, and the client renders the copy still
 * in its bundle. That fallback is the condition on which this ships.
 *
 * WHAT IT READS, AND ON WHOSE AUTHORITY
 *
 *   * The dashboard index, through `PlayerDashboardService.getDashboardIndex`
 *     — already paged (PostgREST's `db-max-rows` is 1000 and truncates
 *     silently, so a cohort clipped at 1000 would produce wrong percentiles
 *     with no error) and already behind a two-minute cache with a stampede
 *     guard. The cohort percentiles are computed over that whole universe,
 *     which is the correctness improvement this move buys.
 *   * `player_directory` for the birthdate and the career document, on the
 *     caller's own RLS-scoped client.
 *   * `player_xg_season`, handed in by the route, which has already read it.
 *   * The league's scoring weights — see `scoringFor` for why membership is
 *     checked by hand here.
 */
export class PlayerWriteupService {
  constructor(
    private supabase: SupabaseClient,
    private dashboard: PlayerDashboardService = new PlayerDashboardService(supabase),
  ) {}

  /**
   * The writeup for one player, or null if anything at all was missing.
   *
   * `leagueId` is what licenses the projection sentence. WITHOUT IT THE
   * SENTENCE IS OMITTED, never scored league-neutrally: the projection is
   * scored with that league's own weights, there are 16 distinct scoring
   * shapes across the 68 leagues in production, and a wrong number on a
   * draft board is worse than a missing one.
   */
  async getWriteup(input: {
    playerId: number;
    leagueId?: string | null;
    userId?: string | null;
    xgSeasons?: readonly XgHistoryPoint[] | null;
    now?: Date;
  }): Promise<PlayerWriteup | null> {
    try {
      const { players, error } = await this.dashboard.getDashboardIndex();
      if (error || !players.length) return null;

      const entry = players.find((p: DashboardIndexEntry) => p.id === input.playerId);
      if (!entry) return null;

      const [directory, scoring, newsItems] = await Promise.all([
        this.directoryFor(input.playerId),
        this.scoringFor(input.leagueId, input.userId),
        new NewsRoomService(this.supabase).forPlayer(input.playerId, 20).catch((err) => {
          logger.debug('[PlayerWriteupService] news unavailable:', err);
          return [];
        }),
      ]);

      return buildWriteupFromSources({
        entry,
        index: players,
        xgSeasons: input.xgSeasons ?? null,
        career: directory.career,
        birthdate: directory.birthdate,
        scoring: scoring?.settings ?? null,
        scoringFormat: scoring?.format ?? null,
        now: input.now,
        newsItems,
      });
    } catch (err) {
      logger.debug('[PlayerWriteupService] writeup unavailable:', err);
      return null;
    }
  }

  /**
   * Birthdate and career from the newest directory season on record.
   *
   * `career` is SELECTed separately from the rest and its absence tolerated,
   * the same shape the directory route uses: the column was added after the
   * table, and an environment without it must still serve an age.
   */
  private async directoryFor(
    playerId: number,
  ): Promise<{ birthdate: string | null; career: CareerSummary | null }> {
    const read = async (columns: string) =>
      this.supabase
        .from('player_directory')
        .select(columns)
        .eq('player_id', playerId)
        .order('season', { ascending: false })
        .limit(1);

    let { data, error } = await read('season, birthdate, career');
    if (error && /career/i.test(error.message ?? '')) {
      ({ data, error } = await read('season, birthdate'));
    }
    if (error) {
      logger.debug('[PlayerWriteupService] directory read failed:', error.message);
      return { birthdate: null, career: null };
    }

    const row = ((data ?? [])[0] ?? null) as
      | { birthdate?: string | null; career?: unknown }
      | null;
    return {
      birthdate: typeof row?.birthdate === 'string' ? row.birthdate : null,
      career: (row?.career as CareerSummary | null | undefined) ?? null,
    };
  }

  /**
   * This league's effective scoring weights, as the document
   * `ScoringCalculator` reads.
   *
   * MEMBERSHIP IS CHECKED BY HAND, and this is the one place in this file
   * that needs explaining. `get_effective_scoring_rules` is SECURITY
   * DEFINER with no membership clause of its own, so RLS on the caller's
   * client does not gate it; without the check below, any authenticated
   * user could read any league's weights by naming its id in a query
   * string. The route this rides on is `authMiddleware`-only by design (it
   * serves a career arc that belongs to no league), so the gate lives here
   * rather than in middleware that would wrongly require a league of every
   * caller.
   *
   * A non-member gets `null`, which omits the projection sentence. Not a
   * 403: the writeup is an enhancement on a payload whose contract is that
   * it never breaks its host.
   */
  private async scoringFor(
    leagueId: string | null | undefined,
    userId: string | null | undefined,
  ): Promise<{ settings: Record<string, unknown>; format: string } | null> {
    if (!leagueId || !userId) return null;

    const membership = new LeagueMembershipService(this.supabase);
    if (!(await membership.verifyMembership(leagueId, userId))) return null;

    const [catalogRes, rulesRes, leagueRes] = await Promise.all([
      this.supabase.from('stat_catalog').select('stat_key, applies_to'),
      this.supabase.rpc('get_effective_scoring_rules', { p_league_id: leagueId }),
      this.supabase.from('leagues').select('settings').eq('id', leagueId).maybeSingle(),
    ]);
    if (catalogRes.error || rulesRes.error || leagueRes.error || !leagueRes.data) {
      logger.debug(
        '[PlayerWriteupService] scoring rules unavailable:',
        catalogRes.error?.message ?? rulesRes.error?.message ?? leagueRes.error?.message,
      );
      return null;
    }

    const settings = mirrorRulesIntoSettings(
      null,
      (catalogRes.data ?? []) as Array<{ stat_key: string; applies_to: string }>,
      (rulesRes.data ?? []) as Array<{ stat_key: string; multiplier: number | string }>,
    );
    // An empty document would be normalised into an all-zero scoring shape,
    // which scores every player at exactly 0.0 fantasy points. That is not a
    // projection, it is a lie with a decimal point, so it degrades to no
    // sentence at all.
    return Object.keys(settings).length > 0
      ? { settings, format: extractFormatSettings(leagueRes.data.settings ?? {}).scoringFormat ?? 'h2h-points' } : null;
  }
}
