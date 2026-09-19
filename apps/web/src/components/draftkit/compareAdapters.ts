import type { DashboardIndexEntry } from '@citrus/shared';
import type { DraftProjection } from '@citrus/shared/leagueProjection';
import { projectedGoalsAgainst } from '@citrus/shared/leagueProjection';
import type { DeskKit } from './deskConnection';
import { compareStats, type ComparePlayer } from './PlayerCompare';

export function deskComparePlayers(kit:DeskKit, unavailable:ReadonlySet<string>, status:string):ComparePlayer[] {
  return kit.players.map(p=>({id:p.key,name:p.name,team:p.team,position:p.position,rank:p.rank,points:p.points,games:p.games,goalie:p.goalie,stats:p.totals,
    status:status==='live'||status==='finished'?(unavailable.has(p.key.replace('canonical:',''))?'Drafted or kept':'Available'):'Availability unverified'}));
}
export const weightedCompareStats = (weights:Record<'skater'|'goalie',Record<string,number>>) => compareStats.map(s=>({...s,weight:weights[s.group!]?.[s.key]??0}));
export function roomComparePlayers(entries:readonly DashboardIndexEntry[],projections:Map<string,DraftProjection>,drafted:ReadonlySet<string>,verified:boolean):ComparePlayer[] {
  return entries.map(p=>{
    const projection=projections.get(String(p.id));
    return {id:String(p.id),name:p.name,team:p.team,position:p.position,image:p.headshot_url,goalie:p.is_goalie,points:projection?.total??null,games:projection?.gamesRemaining??null,
      status:verified?(drafted.has(String(p.id))?'Drafted or kept':'Available'):'Availability unverified',
      stats:{goals:p.proj_goals,assists:p.proj_assists,shots_on_goal:p.proj_sog,power_play_points:p.proj_ppp,short_handed_points:p.proj_shp,hits:p.proj_hits,blocks:p.proj_blocks,penalty_minutes:p.proj_pim,plus_minus:p.proj_plus_minus,
        wins:p.proj_wins,saves:p.proj_saves,goals_against:p.proj_goals_against??projectedGoalsAgainst(p.proj_saves,p.save_pct),shutouts:p.proj_shutouts}};
  }).sort((a,b)=>(b.points??-Infinity)-(a.points??-Infinity));
}
