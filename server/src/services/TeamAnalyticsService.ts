import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@citrus/shared';

/**
 * TeamAnalyticsService — projected vs actual for one fantasy team.
 *
 * The Team Analytics page had nothing to say after the fabricated positional
 * deep-dive was removed in the 2026-08-26 sweep (four hardcoded letter grades,
 * identical for every team in every league). This is the honest replacement:
 * the roster's season projection beside what it actually produced.
 *
 * Read-only, user-scoped. It joins three tables the client cannot reach on its
 * own — roster_assignments for who is on the team, player_ros_projections for
 * what was expected, player_season_stats for what happened.
 *
 * CALIBRATION LIVES IN THE CLIENT, deliberately. apps/web/src/utils/
 * teamAnalytics.ts holds CATEGORY_CALIBRATION and the reasoning behind it; this
 * service ships RAW projected and actual totals and makes no claim about the
 * gap between them. One place to state the correction beats two places to let
 * it drift, and the raw numbers are the ones a tooltip needs anyway.
 */

/** Categories the radar renders, in its order. */
const CATEGORIES = ['goals', 'assists', 'ppp', 'shots', 'blocks', 'hits'] as const;
type Category = (typeof CATEGORIES)[number];

export type CategoryPair = { projected: number; actual: number };

export type TeamAnalyticsPlayer = {
  id: number;
  name: string;
  position: string;
  projectedPoints: number;
  actualPoints: number;
  games: number;
};

export type TeamAnalyticsResult = {
  totals: Record<Category, CategoryPair>;
  players: TeamAnalyticsPlayer[];
  /** How many rostered players had BOTH a projection and season stats. The
   *  page states its own sample size rather than implying completeness. */
  measuredPlayers: number;
  rosterSize: number;
};

/** Default Citrus scoring. A league override is applied by the caller when the
 *  league carries one; these are the documented defaults in CLAUDE.md. */
const W = { goals: 3, assists: 2, ppp: 1, shp: 2, shots: 0.4, blocks: 0.5, hits: 0.2, pim: 0.5 };

/**
 * Row shapes for the three tables this reads.
 *
 * The generated Supabase types do not cover player_ros_projections or
 * player_season_stats, so the client infers GenericStringError for every field
 * and the whole file fails to compile. Declaring the shapes here and casting
 * once per query keeps the field names checked at every use site — an `as any`
 * per access would compile just as well and would silently accept a typo'd
 * column, which is the failure this service is least able to notice (a missing
 * column reads as zero, and zero is a plausible-looking projection).
 */
type ProjRow = {
  player_id: number | string;
  player_name: string | null;
  position: string | null;
  is_goalie: boolean | null;
  total_projected_points: number | null;
  projected_goals: number | null;
  projected_assists: number | null;
  projected_ppp: number | null;
  projected_sog: number | null;
  projected_blocks: number | null;
  projected_hits: number | null;
  games_played: number | null;
};

type StatRow = {
  player_id: number | string;
  position_code: string | null;
  is_goalie: boolean | null;
  games_played: number | null;
  goalie_gp: number | null;
  nhl_goals: number | null;
  nhl_assists: number | null;
  nhl_ppp: number | null;
  nhl_shp: number | null;
  nhl_shots_on_goal: number | null;
  nhl_blocks: number | null;
  nhl_hits: number | null;
  nhl_pim: number | null;
  nhl_wins: number | null;
  nhl_saves: number | null;
  nhl_goals_against: number | null;
  nhl_shutouts: number | null;
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

export class TeamAnalyticsService {
  constructor(private readonly supabase: SupabaseClient) {}

  async getProjectedVsActual(
    leagueId: string,
    teamId: string,
    season: number,
  ): Promise<{ data: TeamAnalyticsResult | null; error: unknown }> {
    try {
      const { data: roster, error: rosterErr } = await this.supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      if (rosterErr) return { data: null, error: rosterErr };

      const ids = (roster ?? []).map((r) => Number(r.player_id)).filter(Number.isFinite);
      const empty: TeamAnalyticsResult = {
        totals: Object.fromEntries(
          CATEGORIES.map((c) => [c, { projected: 0, actual: 0 }]),
        ) as Record<Category, CategoryPair>,
        players: [],
        measuredPlayers: 0,
        rosterSize: 0,
      };
      if (ids.length === 0) return { data: empty, error: null };

      const [projRes, statRes] = await Promise.all([
        this.supabase
          .from('player_ros_projections')
          .select(
            'player_id, player_name, position, is_goalie, total_projected_points, ' +
              'projected_goals, projected_assists, projected_ppp, projected_sog, ' +
              'projected_blocks, projected_hits, games_played',
          )
          .eq('season', season)
          .in('player_id', ids),
        this.supabase
          .from('player_season_stats')
          .select(
            'player_id, position_code, is_goalie, games_played, goalie_gp, ' +
              'nhl_goals, nhl_assists, nhl_ppp, nhl_shp, nhl_shots_on_goal, ' +
              'nhl_blocks, nhl_hits, nhl_pim, nhl_wins, nhl_saves, ' +
              'nhl_goals_against, nhl_shutouts',
          )
          .eq('season', season)
          .in('player_id', ids),
      ]);

      if (projRes.error) return { data: null, error: projRes.error };
      if (statRes.error) return { data: null, error: statRes.error };

      const projRows = (projRes.data ?? []) as unknown as ProjRow[];
      const statRows = (statRes.data ?? []) as unknown as StatRow[];
      const projById = new Map(projRows.map((p) => [Number(p.player_id), p]));
      const statById = new Map(statRows.map((r) => [Number(r.player_id), r]));

      const totals = Object.fromEntries(
        CATEGORIES.map((c) => [c, { projected: 0, actual: 0 }]),
      ) as Record<Category, CategoryPair>;

      const players: TeamAnalyticsPlayer[] = [];

      for (const id of ids) {
        const p = projById.get(id);
        const s = statById.get(id);
        if (!p || !s) continue; // no expectation or no result — nothing to compare

        // Goalies are excluded from the CATEGORY totals on purpose: a goalie
        // contributes no goals, assists, shots, blocks or hits, so folding him
        // in would drag every skater axis toward zero and make the radar a
        // statement about roster construction rather than production. He is
        // still ranked among the players below on total points.
        if (!s.is_goalie) {
          totals.goals.projected += num(p.projected_goals);
          totals.goals.actual += num(s.nhl_goals);
          totals.assists.projected += num(p.projected_assists);
          totals.assists.actual += num(s.nhl_assists);
          totals.ppp.projected += num(p.projected_ppp);
          totals.ppp.actual += num(s.nhl_ppp);
          totals.shots.projected += num(p.projected_sog);
          totals.shots.actual += num(s.nhl_shots_on_goal);
          totals.blocks.projected += num(p.projected_blocks);
          totals.blocks.actual += num(s.nhl_blocks);
          totals.hits.projected += num(p.projected_hits);
          totals.hits.actual += num(s.nhl_hits);
        }

        const actualPoints = s.is_goalie
          ? num(s.nhl_wins) * 4 +
            num(s.nhl_shutouts) * 3 +
            num(s.nhl_saves) * 0.2 -
            num(s.nhl_goals_against)
          : num(s.nhl_goals) * W.goals +
            num(s.nhl_assists) * W.assists +
            num(s.nhl_ppp) * W.ppp +
            num(s.nhl_shp) * W.shp +
            num(s.nhl_shots_on_goal) * W.shots +
            num(s.nhl_blocks) * W.blocks +
            num(s.nhl_hits) * W.hits +
            num(s.nhl_pim) * W.pim;

        players.push({
          id,
          name: String(p.player_name ?? ''),
          position: String(p.position ?? s.position_code ?? ''),
          projectedPoints: num(p.total_projected_points),
          actualPoints,
          games: s.is_goalie ? num(s.goalie_gp) : num(s.games_played),
        });
      }

      return {
        data: { totals, players, measuredPlayers: players.length, rosterSize: ids.length },
        error: null,
      };
    } catch (err) {
      logger.error('[TeamAnalyticsService] getProjectedVsActual failed:', err);
      return { data: null, error: err };
    }
  }
}
