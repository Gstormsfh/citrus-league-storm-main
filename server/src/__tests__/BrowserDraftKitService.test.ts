import {describe,it,expect,vi} from 'vitest';
import {browserBoardMappings,BrowserDraftKitService} from '../services/BrowserDraftKitService';
import {DESK_SUPPORTED_WEIGHTS,type ConnectedKit} from '../services/PublishedDraftDeskService';
const kit={players:[{key:'canonical:8478402'},{key:'canonical:8482116'}],fingerprint:'a'.repeat(64)} as ConnectedKit;
const rows=[{external_player_id:'42',nhl_player_id:8478402,match_method:'manual',is_ambiguous:false},{external_player_id:'43',nhl_player_id:8482116,match_method:'name_team',is_ambiguous:false}];
describe('browser kit uses existing publication and reviewed crosswalk',()=>{
 it('returns only reviewed one-to-one mappings',()=>{expect(browserBoardMappings(kit,rows)).toEqual([{externalPlayerId:'42',key:'canonical:8478402'},{externalPlayerId:'43',key:'canonical:8482116'}]);});
 it('rejects missing, ambiguous, name-only and duplicate mappings',()=>{
  for(const r of [rows.slice(0,1),[rows[0],{...rows[1],is_ambiguous:true}],[rows[0],{...rows[1],match_method:'name_only'}],[...rows,rows[0]]])expect(()=>browserBoardMappings(kit,r)).toThrow();
 });
 it('builds a custom-scored published board without claiming provider scoring verification',async()=>{
  const query:any={select:vi.fn(()=>query),eq:vi.fn(()=>query),in:vi.fn(()=>query),limit:vi.fn(async()=>({data:rows,error:null}))};
  const admin:any={from:vi.fn(()=>query)},publisher:any={connected:vi.fn(async()=>({kit,warning:null}))};
  const result=await new BrowserDraftKitService({} as any,admin,publisher).open('espn','My board',DESK_SUPPORTED_WEIGHTS);
  expect(result.bundle.scoringVerified).toBe(false);expect(publisher.connected).toHaveBeenCalledWith('My board',DESK_SUPPORTED_WEIGHTS);
  expect(query.eq).toHaveBeenCalledWith('platform','espn');expect(query.in).toHaveBeenCalledWith('nhl_player_id',[8478402,8482116]);
 });
 it('does not substitute guesses when the ID query fails',async()=>{
  const q:any={select:()=>q,eq:()=>q,in:()=>q,limit:async()=>({data:null,error:{message:'private'}})};
  await expect(new BrowserDraftKitService({} as any,{from:()=>q} as any,{connected:async()=>({kit})} as any).open('yahoo','Board',DESK_SUPPORTED_WEIGHTS)).rejects.toThrow('could not be checked');
 });
});
