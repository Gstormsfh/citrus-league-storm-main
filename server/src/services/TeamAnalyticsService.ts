import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, ScoringCalculator } from '@citrus/shared';
import type { ScoringSettings } from '@citrus/shared';

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

/**
 * League save percentage, used to derive a goalie's projected goals-against.
 *
 * player_ros_projections carries projected wins, saves and shutouts but NOT
 * goals-against, and goals-against is a scored category in essentially every
 * league. Omitting it would overstate every goalie projection by exactly the
 * amount the league penalises goals — so it is derived instead:
 *
 *     shots = saves / SV%      goals_against = shots - saves
 *
 * That is an ESTIMATE built on a league-average save percentage, not a
 * projection of this goalie's own rate, and it is the weakest number this
 * service produces. It is stated here rather than buried because the honest
 * alternative — dropping the term — is silently worse.
 *
 * INDUSTRY-STANDARD SCORING (2026-09-01): player_ros_projections now carries
 * projected_ga_ros (this goalie's own smoothed GA rate × remaining starts).
 * It is preferred whenever present; the SV% derivation remains only as the
 * fallback for rows written before the column existed.
 */
const LEAGUE_AVG_SV_PCT = 0.905;

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
  projected_shp: number | null;
  projected_pim: number | null;
  projected_wins_ros: number | null;
  projected_saves_ros: number | null;
  projected_shutouts_ros: number | null;
  projected_ga_ros?: number | null;
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
      // The league's own scoring, read HERE rather than accepted as a
      // parameter. An earlier version left a comment saying "a league override
      // is applied by the caller" — no caller applied one, so every league got
      // the defaults. Reading it inside the service means the claim cannot
      // drift from the behaviour again: there is no caller left to forget.
      const { data: leagueRow, error: leagueErr } = await this.supabase
        .from('leagues')
        .select('scoring_settings')
        .eq('id', leagueId)
        .maybeSingle();
      if (leagueErr) return { data: null, error: leagueErr };

      const scorer = new ScoringCalculator(
        (leagueRow?.scoring_settings ?? null) as ScoringSettings | null,
      );

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
              'projected_goals, projected_assists, projected_ppp, projected_shp, ' +
              'projected_sog, projected_blocks, projected_hits, projected_pim, ' +
              'projected_wins_ros, projected_saves_ros, projected_shutouts_ros, ' +
              'projected_ga_ros, games_played',
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

        // BOTH SIDES ARE SCORED BY THE LEAGUE'S OWN SETTINGS.
        //
        // The first version of this used hardcoded default weights for actuals
        // and read `total_projected_points` straight from the projection row —
        // which the pipeline computes under DEFAULT scoring. In a league with
        // custom settings that compared two different scoring systems to each
        // other, and because weights move a hits-heavy player differently from
        // a goals-heavy one, it could reorder the ranking away from what the
        // league actually pays out. Recomputing both from components is the
        // only way the comparison means anything.
        const isG = Boolean(s.is_goalie);
        const actualPoints = scorer.calculatePoints(
          isG
            ? {
                wins: num(s.nhl_wins),
                saves: num(s.nhl_saves),
                shutouts: num(s.nhl_shutouts),
                goals_against: num(s.nhl_goals_against),
              }
            : {
                goals: num(s.nhl_goals),
                assists: num(s.nhl_assists),
                ppp: num(s.nhl_ppp),
                shp: num(s.nhl_shp),
                sog: num(s.nhl_shots_on_goal),
                blocks: num(s.nhl_blocks),
                hits: num(s.nhl_hits),
                pim: num(s.nhl_pim),
              },
          isG,
        );

        const projSaves = num(p.projected_saves_ros);
        const projectedPoints = scorer.calculatePoints(
          isG
            ? {
                wins: num(p.projected_wins_ros),
                saves: projSaves,
                shutouts: num(p.projected_shutouts_ros),
                // The goalie's own projected GA when the row carries it;
                // otherwise derived — see LEAGUE_AVG_SV_PCT above.
                goals_against:
                  num(p.projected_ga_ros) > 0
                    ? num(p.projected_ga_ros)
                    : projSaves > 0 ? projSaves / LEAGUE_AVG_SV_PCT - projSaves : 0,
              }
            : {
                goals: num(p.projected_goals),
                assists: num(p.projected_assists),
                ppp: num(p.projected_ppp),
                shp: num(p.projected_shp),
                sog: num(p.projected_sog),
                blocks: num(p.projected_blocks),
                hits: num(p.projected_hits),
                pim: num(p.projected_pim),
              },
          isG,
        );

        players.push({
          id,
          name: String(p.player_name ?? ''),
          position: String(p.position ?? s.position_code ?? ''),
          projectedPoints,
          actualPoints,
          games: isG ? num(s.goalie_gp) : num(s.games_played),
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
