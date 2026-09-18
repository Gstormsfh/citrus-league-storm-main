import { describe, it, expect, vi } from 'vitest';
import { projectionSettings, ScoringCalculator, scoreProjectedStats, projectionFor } from '@citrus/shared';
import { PublishedDraftDeskService, publishedDeskKit, DESK_SUPPORTED_WEIGHTS } from '../services/PublishedDraftDeskService';
import { roomDeskWeights } from '../services/DraftKitDeskService';
import { createChain } from './helpers';
import { readDeskFile } from '../../../apps/web/src/components/draftkit/deskConnection';

const pointer = (revision='a'.repeat(64), status='success') => ({season:2026,run_id:'run-'+revision,revision,activated_at:'2026-09-17T12:00:00Z',last_refresh_status:status});
const row = (id=1, revision='a'.repeat(64)) => ({player_id:id,player_name:'Player '+id,position:'C',team_abbrev:'CBJ',
  season:2026,projection_run_id:'run-'+revision,projection_revision:revision,is_goalie:false,games_remaining:80,
  projected_goals:30,projected_assists:40,projected_sog:220,projected_blocks:50,projected_hits:80,
  projected_ppp:20,projected_shp:1,projected_pim:40, total_projected_points:99999});
const weights = (raw:unknown=null) => roomDeskWeights(raw,DESK_SUPPORTED_WEIGHTS,{});
function client(pointers:any[],pages:any[]) {
  const chains:any[]=[];
  const db={from:vi.fn((table:string)=>{
    const chain=createChain({data:table==='canonical_published_runs'?pointers.shift():pages.shift(),error:null});
    chains.push(chain);return chain;
  })};
  return {db:db as any,chains};
}

describe('Published live Draft Desk',()=>{
  it('passes the actual browser file contract with revision, scoring and remaining totals intact',()=>{
    const kit=publishedDeskKit([row()],pointer(),'League',weights());
    const file={kind:'citrus-connected-desk',version:1,kit,progress:{version:1,fingerprint:kit.fingerprint,rows:[]}};
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    expect(kit.projectionBasis).toBe('remaining_season');
  });
  it('matches the existing draft/card scorer with exact counts and one workload application',()=>{
    for(const raw of [null,{skater:{goals:2,hits:3,penalty_minutes:-1},goalie:{wins:5}}, {skater:{blocks:-2},goalie:{}}]) {
      const w=weights(raw),r=row(),scorer=new ScoringCalculator(projectionSettings(w));
      const kit=publishedDeskKit([r],pointer(),'League',w),p=kit.players[0];
      expect(p.points).toBe(scoreProjectedStats(r,scorer));
      expect(p.points).toBe(projectionFor({is_goalie:false,proj_gp:80,proj_goals:30,proj_assists:40,
        proj_sog:220,proj_blocks:50,proj_hits:80,proj_ppp:20,proj_shp:1,proj_pim:40} as any,scorer)?.total);
      expect(p).toMatchObject({games:80,totals:{goals:30,hits:80},rank:1});
      expect(p.points).not.toBe(r.total_projected_points);
    }
  });
  it('uses goalie ROS counts including goals against, without multiplying by starts again',()=>{
    const r={...row(),is_goalie:true,position:'G',games_remaining:50,projected_wins_ros:30,projected_saves_ros:1400,projected_shutouts_ros:3,projected_ga_ros:140};
    const w=weights({skater:{},goalie:{wins:5,saves:.6,shutouts:3,goals_against:-3}});
    const kit=publishedDeskKit([r],pointer(),'League',w);
    expect(kit.players[0]).toMatchObject({points:579,games:50,totals:{wins:30,saves:1400,shutouts:3,goals_against:140}});
  });
  it('supports signed plus/minus with the same league scorer and browser contract',()=>{
    for(const weight of [-2,0,.5]) {
      const r={...row(),projected_plus_minus:-12},w=weights({skater:{goals:7,plus_minus:weight},goalie:{}});
      const kit=publishedDeskKit([r],pointer(),'Plus/minus',w);
      expect(kit.players[0].points).toBe(210-12*weight);
      expect(kit.players[0].points).toBe(scoreProjectedStats(r,new ScoringCalculator(projectionSettings(w))));
      expect(kit.players[0].totals).toMatchObject({plus_minus:-12});
      const file={kind:'citrus-connected-desk',version:1,kit,progress:{version:1,fingerprint:kit.fingerprint,rows:[]}};
      expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    }
    expect(()=>publishedDeskKit([row()],pointer(),'Missing',weights({skater:{plus_minus:1}}))).toThrow();
    expect(publishedDeskKit([row()],pointer(),'Disabled',weights({skater:{goals:7,plus_minus:0}})).players[0].totals).not.toHaveProperty('plus_minus');
  });
  it('sorts the entire population under league rules before selecting 300',()=>{
    const rows=Array.from({length:1101},(_,i)=>({...row(i+1),projected_hits:i}));
    const kit=publishedDeskKit(rows,pointer(),'Hits',weights({skater:{hits:2},goalie:{}}));
    expect(kit.players).toHaveLength(300);expect(kit.players[0]).toMatchObject({key:'canonical:1101',points:2200});
    expect(publishedDeskKit([...rows].reverse(),pointer(),'Hits',weights({skater:{hits:2},goalie:{}}))).toEqual(kit);
  });
  it('preserves real zeros, negative scoring, and missing disabled stats',()=>{
    const r={...row(),projected_hits:0,projected_goals:null};
    expect(publishedDeskKit([r],pointer(),'Zero',weights({skater:{hits:-2},goalie:{}})).players[0]).toMatchObject({points:0,totals:{hits:0}});
    expect(publishedDeskKit([r],pointer(),'Zero',weights({skater:{hits:-2},goalie:{}})).players[0].totals).not.toHaveProperty('goals');
  });
  it.each(['missing','negative_count','zero_exposure','duplicate','mixed','bad_identity','missing_gp'])('rejects %s rather than substituting old PDF numbers',reason=>{
    const r:any=row();const rows=[r];
    if(reason==='missing')r.projected_goals=null;
    if(reason==='negative_count')r.projected_goals=-1;
    if(reason==='zero_exposure')r.games_remaining=0;
    if(reason==='duplicate')rows.push({...r});
    if(reason==='mixed')r.projection_revision='b'.repeat(64);
    if(reason==='bad_identity')r.player_id='01';
    if(reason==='missing_gp')r.games_remaining=null;
    expect(()=>publishedDeskKit(rows,pointer(),'League',weights())).toThrow();
  });
  it('rejects an entirely disabled board instead of inventing rankings',()=>{
    expect(()=>publishedDeskKit([row()],pointer(),'League',weights({}))).toThrow(/scoring category/);
  });
  it('binds every page to one published revision and retries a publication race',async()=>{
    const b='b'.repeat(64),{db,chains}=client([pointer(),pointer(b),pointer(b),pointer(b)],
      [Array.from({length:1000},(_,i)=>row(i+1)),[row(1001,b)],[row(1,b)]]);
    const result=await new PublishedDraftDeskService(db).connected('League',weights(),2026);
    expect(result.kit.revision).toBe(b);expect(result.kit.players).toHaveLength(1);
    expect(db.from).toHaveBeenCalledTimes(7);
    for(const q of chains)expect(q.eq).toHaveBeenCalledWith('season',2026);
  });
  it('shows failure health while serving only the last valid publication',async()=>{
    const {db}=client([pointer(),pointer(undefined,'failed')],[[row()]]);
    const r=await new PublishedDraftDeskService(db).connected('League',weights(),2026);
    expect(r.warning).toContain('latest projection update failed');expect(r.kit.revision).toBe(pointer().revision);
  });
  it('fails on no publication, malformed metadata, empty outputs and repeated races',async()=>{
    for(const [pointers,pages] of [[ [null],[] ],[ [{...pointer(),activated_at:'wrong'}],[] ],
      [ [pointer(),pointer()],[[]] ],[ Array(4).fill(pointer()),[[row(1,'b'.repeat(64))],[row(1,'b'.repeat(64))]] ]]) {
      const {db}=client(pointers,pages);
      await expect(new PublishedDraftDeskService(db).connected('League',weights(),2026)).rejects.toMatchObject({status:503});
    }
  });
});
