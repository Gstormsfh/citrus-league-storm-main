// TEAM ANALYTICS — projected vs actual (2026-08-27)
//
// What this pins is the handful of ways the service could return a number that
// looks fine and is wrong:
//
//   * folding goalies into the skater category totals, which would drag every
//     radar axis toward zero and turn a production chart into a statement
//     about roster construction;
//   * counting a player who has a projection but no season stats (or the
//     reverse) as a measured zero, which reads as "he produced nothing";
//   * scoring goalies with the skater weights;
//   * scoring ANY league with the default weights. The service used to carry a
//     comment saying a caller applied the league's override; no caller did, so
//     every league silently got the defaults — and since weights move a
//     hits-heavy player differently from a goals-heavy one, that could reorder
//     the ranking away from what the league actually pays out.
import { describe, it, expect, vi } from 'vitest';
import { TeamAnalyticsService } from '../services/TeamAnalyticsService';

type Row = Record<string, unknown>;

/** Minimal Supabase stand-in: from(table) -> canned rows for that table. */
function fakeClient(tables: Record<string, Row[]>, errorOn?: string) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const result = errorOn === table
        ? { data: null, error: { message: `boom on ${table}` } }
        : { data: tables[table] ?? [], error: null };
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.maybeSingle = () => {
        const rows = (result.data ?? []) as Row[];
        return Promise.resolve({ data: rows[0] ?? null, error: result.error });
      };
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return builder;
    },
  } as never;
}

const skaterProj = (id: number, over: Row = {}): Row => ({
  player_id: id, player_name: `Skater ${id}`, position: 'C', is_goalie: false,
  total_projected_points: 100, projected_goals: 20, projected_assists: 30,
  projected_ppp: 10, projected_sog: 150, projected_blocks: 40, projected_hits: 50,
  games_played: 60, ...over,
});

const skaterStat = (id: number, over: Row = {}): Row => ({
  player_id: id, position_code: 'C', is_goalie: false, games_played: 60, goalie_gp: 0,
  nhl_goals: 22, nhl_assists: 28, nhl_ppp: 11, nhl_shp: 0, nhl_shots_on_goal: 140,
  nhl_blocks: 38, nhl_hits: 61, nhl_pim: 10, nhl_wins: 0, nhl_saves: 0,
  nhl_goals_against: 0, nhl_shutouts: 0, ...over,
});

/** Every case gets a league row; default scoring unless a test supplies its own. */
const svc = (tables: Record<string, Row[]>, errorOn?: string) =>
  new TeamAnalyticsService(
    fakeClient({ leagues: [{ scoring_settings: null }], ...tables }, errorOn),
  );

const roster = (...ids: number[]) => ids.map((player_id) => ({ player_id }));

describe('TeamAnalyticsService — category totals', () => {
  it('sums projected and actual per category across the roster', async () => {
    const { data } = await svc({
      roster_assignments: roster(1, 2),
      player_ros_projections: [skaterProj(1), skaterProj(2)],
      player_season_stats: [skaterStat(1), skaterStat(2)],
    }).getProjectedVsActual('L', 'T', 2026);

    expect(data!.totals.goals).toEqual({ projected: 40, actual: 44 });
    expect(data!.totals.hits).toEqual({ projected: 100, actual: 122 });
  });

  it('keeps goalies OUT of the skater category totals', async () => {
    // A goalie records no goals, assists, shots, blocks or hits. Folding him in
    // would pull every axis toward zero and make the radar describe how many
    // goalies you roster rather than how your skaters are producing.
    const { data } = await svc({
      roster_assignments: roster(1, 9),
      player_ros_projections: [
        skaterProj(1),
        skaterProj(9, { is_goalie: true, position: 'G', projected_goals: 0, projected_hits: 0 }),
      ],
      player_season_stats: [
        skaterStat(1),
        skaterStat(9, {
          is_goalie: true, position_code: 'G', games_played: 0, goalie_gp: 40,
          nhl_goals: 0, nhl_assists: 1, nhl_hits: 0, nhl_shots_on_goal: 0,
          nhl_blocks: 0, nhl_ppp: 0, nhl_pim: 4,
          nhl_wins: 25, nhl_saves: 1100, nhl_goals_against: 100, nhl_shutouts: 3,
        }),
      ],
    }).getProjectedVsActual('L', 'T', 2026);

    // One skater's numbers only — the goalie's lone assist must not appear.
    expect(data!.totals.assists).toEqual({ projected: 30, actual: 28 });
    // ...but he is still ranked among the players.
    expect(data!.players.map((p) => p.id)).toContain(9);
  });
});

describe('TeamAnalyticsService — who counts as measured', () => {
  it('skips a player with a projection but no season stats', async () => {
    // Counting him would add a real projection against a zero actual and read
    // as catastrophic underperformance.
    const { data } = await svc({
      roster_assignments: roster(1, 2),
      player_ros_projections: [skaterProj(1), skaterProj(2)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    expect(data!.measuredPlayers).toBe(1);
    expect(data!.rosterSize).toBe(2);
    expect(data!.totals.goals.projected).toBe(20);
  });

  it('skips a player with stats but no projection', async () => {
    const { data } = await svc({
      roster_assignments: roster(1, 2),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1), skaterStat(2)],
    }).getProjectedVsActual('L', 'T', 2026);

    expect(data!.measuredPlayers).toBe(1);
    expect(data!.totals.goals.actual).toBe(22);
  });

  it('reports the roster size alongside, so the page can state its sample', async () => {
    const { data } = await svc({
      roster_assignments: roster(1, 2, 3, 4),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    expect(data!.measuredPlayers).toBe(1);
    expect(data!.rosterSize).toBe(4);
  });
});

describe('TeamAnalyticsService — scoring', () => {
  it('scores a skater on the default Citrus weights', async () => {
    const { data } = await svc({
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    // 22*3 + 28*2 + 11*1 + 0*2 + 140*.4 + 38*.5 + 61*.2 + 10*.5
    expect(data!.players[0].actualPoints).toBeCloseTo(66 + 56 + 11 + 56 + 19 + 12.2 + 5, 4);
  });

  it('scores a goalie on the GOALIE weights, not the skater ones', async () => {
    const { data } = await svc({
      roster_assignments: roster(9),
      player_ros_projections: [skaterProj(9, { is_goalie: true, position: 'G' })],
      player_season_stats: [skaterStat(9, {
        is_goalie: true, goalie_gp: 40, nhl_wins: 25, nhl_saves: 1100,
        nhl_goals_against: 100, nhl_shutouts: 3,
      })],
    }).getProjectedVsActual('L', 'T', 2026);

    // 25*4 + 3*3 + 1100*.2 - 100
    expect(data!.players[0].actualPoints).toBeCloseTo(100 + 9 + 220 - 100, 4);
    expect(data!.players[0].games).toBe(40);
  });
});

describe('TeamAnalyticsService — degenerate inputs', () => {
  it('an empty roster returns zeroed totals rather than null', async () => {
    const { data, error } = await svc({ roster_assignments: [] }).getProjectedVsActual('L', 'T', 2026);
    expect(error).toBeNull();
    expect(data!.rosterSize).toBe(0);
    expect(data!.totals.goals).toEqual({ projected: 0, actual: 0 });
  });

  it('surfaces a roster query error instead of reporting an empty team', async () => {
    const { data, error } = await svc(
      { roster_assignments: roster(1) }, 'roster_assignments',
    ).getProjectedVsActual('L', 'T', 2026);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it('treats a null stat as zero rather than NaN', async () => {
    const { data } = await svc({
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1, { projected_goals: null })],
      player_season_stats: [skaterStat(1, { nhl_goals: null })],
    }).getProjectedVsActual('L', 'T', 2026);

    expect(data!.totals.goals).toEqual({ projected: 0, actual: 0 });
    expect(Number.isFinite(data!.players[0].actualPoints)).toBe(true);
  });
});


describe('TeamAnalyticsService — the league\'s scoring, not the defaults', () => {
  // Defaults are goals 3 / hits 0.2. This league inverts which of those two
  // matters, which is exactly the case that reorders a ranking.
  const hitsLeague = [{
    scoring_settings: {
      skater: {
        goals: 1, assists: 1, power_play_points: 0, short_handed_points: 0,
        shots_on_goal: 0, blocks: 0, hits: 5, penalty_minutes: 0, plus_minus: 0,
      },
      goalie: { wins: 4, saves: 0.2, shutouts: 3, goals_against: -1 },
    },
  }];

  it('scores actuals with the league weights', async () => {
    const { data } = await svc({
      leagues: hitsLeague,
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    // 22 goals + 28 assists + 61 hits x 5 = 355
    expect(data!.players[0].actualPoints).toBe(22 + 28 + 61 * 5);
  });

  it('scores PROJECTIONS with the league weights too, not the stored total', async () => {
    // total_projected_points is 100, computed by the pipeline under DEFAULT
    // scoring. Reading it here would compare two different scoring systems.
    const { data } = await svc({
      leagues: hitsLeague,
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    // 20 goals + 30 assists + 50 hits x 5 = 300, not the stored 100.
    expect(data!.players[0].projectedPoints).toBe(20 + 30 + 50 * 5);
  });

  it('a league that pays hits can rank a grinder above a sniper', async () => {
    // The concrete harm of the old behaviour: under defaults the sniper wins,
    // so the ordering shown did not match what the league actually paid.
    const sniper = { ...skaterStat(1), nhl_goals: 50, nhl_hits: 5 };
    const grinder = { ...skaterStat(2), nhl_goals: 5, nhl_hits: 200 };
    const { data } = await svc({
      leagues: hitsLeague,
      roster_assignments: roster(1, 2),
      player_ros_projections: [skaterProj(1), skaterProj(2)],
      player_season_stats: [sniper, grinder],
    }).getProjectedVsActual('L', 'T', 2026);

    const byId = new Map(data!.players.map((p) => [p.id, p.actualPoints]));
    expect(byId.get(2)!).toBeGreaterThan(byId.get(1)!);
  });

  it('falls back to default scoring when the league carries none', async () => {
    const { data } = await svc({
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }).getProjectedVsActual('L', 'T', 2026);

    // 22*3 + 28*2 + 11*1 + 140*0.4 + 38*0.5 + 61*0.2 + 10*0.5
    //  = 66 + 56 + 11 + 56 + 19 + 12.2 + 5 = 225.2
    // (which also confirms ScoringCalculator's defaults are CLAUDE.md's.)
    expect(data!.players[0].actualPoints).toBeCloseTo(225.2, 4);
  });

  it('surfaces a league lookup failure instead of silently scoring by default', async () => {
    const { data, error } = await svc({
      roster_assignments: roster(1),
      player_ros_projections: [skaterProj(1)],
      player_season_stats: [skaterStat(1)],
    }, 'leagues').getProjectedVsActual('L', 'T', 2026);

    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
