/** Offline adapter to the SAME Citrus player assessment engine used by the app.
 * Historical actuals are never passed off as projections. No projection writes.
 */
import { readFileSync } from 'node:fs';
import { generatePlayerWriteup } from '../../packages/shared/src/playerWriteup/index';
const { evidence, players, weights } = JSON.parse(readFileSync(0, 'utf8'));
const actuals = new Map(evidence.actuals.map((p: any) => [String(p.player_id), p]));
const aliases: Record<string, string> = {shots_on_goal:'shots',blocks:'blockedShots',power_play_points:'powerPlayPoints',short_handed_points:'shortHandedPoints',penalty_minutes:'pim',plus_minus:'plusMinus',goals_against:'goalsAgainst'};
const output = players.map((p: any) => {
  const a: any = actuals.get(String(p.playerId));
  const val = (key: string, fallback?: string) => a?.['nhl_'+key] ?? a?.[fallback || key] ?? undefined;
  const stats = a ? {
    gamesPlayed: a.is_goalie ? a.goalie_gp : a.games_played,
    goals: val('goals'), assists: val('assists') ?? (a.primary_assists != null && a.secondary_assists != null ? a.primary_assists+a.secondary_assists : undefined),
    points: val('points'), shots: val('shots_on_goal'), hits: val('hits'), blockedShots: val('blocks'),
    powerPlayPoints: val('ppp'), plusMinus: val('plus_minus'),
    wins: val('wins'), gaa: val('gaa'), savePct: val('save_pct'), shutouts: val('shutouts'),
  } : undefined;
  const scoringWeights = Object.fromEntries(Object.entries(weights[p.isGoalie ? 'goalie':'skater']).map(([k,v]) => [aliases[k] || k,v]));
  const writeup = generatePlayerWriteup({id:p.playerId || p.key, name:p.name, position:p.position, stats, statsSeason:a?.season ?? null}, {
    now:new Date(evidence.asOf), projectionSeason:2026, scoringWeights,
    newsItems:evidence.news, projFp:p.fantasyPoints, projGp:p.games,
    projectionLabel:'for 2026-27',
  });
  return {key:p.key, playerId:p.playerId, actualsSeason:a?.season ?? null, ...writeup};
});
process.stdout.write(JSON.stringify(output));
