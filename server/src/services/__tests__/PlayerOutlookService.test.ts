import { describe, it, expect, vi } from 'vitest';
import { PlayerOutlookService } from '../PlayerOutlookService';
import { outlookEntry } from './outlookFixtures';
const NOW = new Date('2026-09-13T12:00:00Z');
const item = { player_ids:[1000],title:'Sample Forward practiced',snippet:'',url:'https://www.nhl.com/news/sample',source_id:'nhl',published_at:'2026-09-13T08:00:00Z' };

describe('standing outlook reads and revisions', () => {
 it('changes the right player after a news correction and drops expired evidence', async () => {
  const dashboard = { getDashboardIndex:vi.fn(async()=>({players:[outlookEntry(),outlookEntry({id:1001,name:'Other Forward'})],error:null})) };
  const service=new PlayerOutlookService({} as never,dashboard as never);
  const before=await service.forPlayer(1000,[],NOW);const practice=await service.forPlayer(1000,[item],NOW);
  expect(practice?.contentRevision).not.toBe(before?.contentRevision);
  expect(practice?.body).toContain('NHL.com (2026-09-13)');
  const other=await service.forPlayer(1001,[item],NOW);
  expect(other?.body).not.toContain('practice');
  const cleared=await service.forPlayer(1000,[item,{...item,title:'Sample Forward cleared to play',published_at:'2026-09-13T09:00:00Z'}],NOW);
  expect(cleared?.body).not.toContain('practice');expect(cleared?.body).toContain('clearance');
  const expired=await service.forPlayer(1000,[item],new Date('2026-10-01T12:00:00Z'));
  expect(expired?.body).toBe((await service.forPlayer(1000,[],new Date('2026-10-01T12:00:00Z')))?.body);
  expect(expired?.body).toContain('rest-of-season');
 });
 it('refreshes canonical status without changing the forecast allocation', () => {
  const service=new PlayerOutlookService({} as never);
  const entry=outlookEntry();const plain=service.render(entry,[],NOW)!;
  const canonical={season:2026,revision:'r2',run_id:'run',role:null,sources:[],availability:{status:'out',authority:'reviewed_report',as_of:'2026-09-12',review_after:'2026-09-14',reason:'Owner maintained status.',source:{file:'Owner record',locator:'player=1000',kind:'manual_confirmation'}}};
  const injured=service.render({...entry,canonical_context:canonical as never},[],new Date('2026-10-01'))!;
  expect(injured.body).toContain('remains OUT');expect(injured.contentRevision).not.toBe(plain.contentRevision);
  expect(injured.analysis).toContain('already reflects');expect(entry.proj_gp).toBe(80);
  const expired=service.render({...entry,canonical_context:{...canonical,availability:{...canonical.availability,valid_until:'2026-09-15'}} as never},[],new Date('2026-10-01'))!;
  expect(expired.body).not.toContain('remains OUT');
 });
 it('updates changed standing content, preserving publication dates; identical repeats do not write', async () => {
  const records=new Map<string,any>(); let writes=0;
  const supabase={from:()=>({select:()=>({in:async(_:string,keys:string[])=>({data:keys.flatMap(k=>records.has(k)?[records.get(k)]:[]),error:null})}),upsert:(rows:any[])=>({select:async()=>{writes++;for(const row of rows)records.set(row.dedupe_key,row);return {data:rows.map((_,i)=>({id:String(i)})),error:null};}})})};
  const service=new PlayerOutlookService(supabase as never);const note=service.render(outlookEntry(),[],NOW)!;
  expect(await service.persist([note],NOW)).toEqual({inserted:1,updated:0,unchanged:0});
  expect(await service.persist([note],new Date('2026-09-14'))).toEqual({inserted:0,updated:0,unchanged:1});
  const changed=service.render(outlookEntry({proj_assists:90}),[],NOW)!;
  expect(await service.persist([changed],new Date('2026-09-14'))).toEqual({inserted:0,updated:1,unchanged:0});
  expect(records.get(note.dedupeKey).published_at).toBe(NOW.toISOString());
  expect(records.get(note.dedupeKey).updated_at).toBe(new Date('2026-09-14').toISOString());expect(writes).toBe(2);
 });
 it('does not silently generate a partial news corpus or report failed writes as successful', async()=>{
  const q:any={select:()=>q,gte:()=>q,lte:()=>q,order:()=>q,range:async()=>({data:null,error:{message:'news offline'}})};
  const service=new PlayerOutlookService({from:()=>q} as never,{getDashboardIndex:async()=>({players:[outlookEntry()],error:null})} as never);
  await expect(service.generate(NOW)).rejects.toThrow('news offline');
  q.select=()=>({in:async()=>({data:null,error:{message:'revision offline'}})});
  await expect(service.persist([service.render(outlookEntry(),[],NOW)!],NOW)).rejects.toThrow('revision offline');
 });
 it('covers the full index including zero/unallocated forecasts and pages beyond 1000 source items',async()=>{
  const entries=Array.from({length:1325},(_,i)=>outlookEntry({id:1000+i,...(i%2?{proj_gp:null,projection_season:null,canonical_context:{season:2026} as never}:{})}));
  const calls:number[]=[];const q:any={select:()=>q,gte:()=>q,lte:()=>q,order:()=>q,range:async(start:number)=>{calls.push(start);return {data:start===0?Array.from({length:1000},(_,i)=>({...item,player_ids:[9000+i]})):[],error:null};}};
  const service=new PlayerOutlookService({from:()=>q} as never,{getDashboardIndex:async()=>({players:entries,error:null})} as never);
  expect(await service.generate(NOW)).toHaveLength(1325);expect(calls).toEqual([0,1000]);
 });
});

it('retires only missing current-season coverage and refuses incomplete reads', async () => {
 const writes:any[]=[];
 const q:any={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[{id:'keep',player_id:1000},{id:'retire',player_id:9999}],error:null})};
 const service=new PlayerOutlookService({from:()=>({...q,update:(row:any)=>({in:(_:string,ids:string[])=>({select:async()=>{writes.push({row,ids});return {data:ids.map(id=>({id})),error:null};}})})})} as never);
 const note=service.render(outlookEntry(),[],NOW)!;
 expect(await service.retireMissing([note],NOW)).toBe(1);
 expect(writes).toEqual([{row:{is_current:false,updated_at:NOW.toISOString()},ids:['retire']}]);
 await expect(service.retireMissing([],NOW)).rejects.toThrow('complete single-season');
 q.range=async()=>({data:null,error:{message:'offline'}});
 await expect(service.retireMissing([note],NOW)).rejects.toThrow('offline');
 expect(writes).toHaveLength(1);
});

it('refuses a corpus with temporarily withheld projected rows before any writes', async () => {
 const q:any={select:()=>q,gte:()=>q,lte:()=>q,order:()=>q,range:async()=>({data:[],error:null})};
 const entry=outlookEntry({proj_gp:null,canonical_context:{season:2026,status:'projected',run_id:'run',revision:'rev',exposure:{used:80}} as never});
 const service=new PlayerOutlookService({from:()=>q} as never,{getDashboardIndex:async()=>({players:[entry],error:null})} as never);
 expect(await service.forPlayer(1000,[],NOW)).toBeNull();
 await expect(service.generate(NOW)).rejects.toThrow('Incomplete outlook evidence');
});
