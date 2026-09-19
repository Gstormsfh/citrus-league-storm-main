import { EventEmitter } from 'node:events';
import { afterEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({spawn:vi.fn(),readFile:vi.fn(),access:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('node:fs/promises',()=>({readFile:mocks.readFile,access:mocks.access}));
import { DraftKitExportService, isFullPreseasonEdition } from '../services/DraftKitExportService';
function childResult(bytes:string,code=0){
  const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr={resume:vi.fn()};
  child.stdin=new EventEmitter();child.kill=vi.fn();
  child.stdin.end=vi.fn(()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(bytes));child.emit('close',code);}));
  return child;
}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('Private PDF export worker',()=>{
  function preseason(){return {canonicalRevision:'a'.repeat(64),schedule:{A:84},
    edition:{kind:'effective_runtime',horizon:'remaining_season',asOf:'2026-09-18',runtimeRevision:'a'.repeat(64)},
    players:[{team:'A',forecastStatus:'projected',games:76,canonicalExposure:{used:76},
      canonicalRemaining:{used:76,actual_gp:0,team_games:84,as_of:'2026-09-18'}}]};}
  it('allows a complete preseason refresh, not a shortened or ambiguous horizon',()=>{
    expect(isFullPreseasonEdition(preseason())).toBe(true);
    for(const mutation of [
      (d:any)=>d.players[0].canonicalRemaining.actual_gp=1,
      (d:any)=>d.players[0].canonicalRemaining.actual_gp=false,
      (d:any)=>d.players[0].canonicalRemaining.actual_gp=null,
      (d:any)=>d.players[0].canonicalRemaining.team_games=83,
      (d:any)=>d.players[0].canonicalRemaining.as_of='2026-09-17',
      (d:any)=>d.players[0].games=75,
      (d:any)=>d.schedule.B=84,
      (d:any)=>d.edition.runtimeRevision='changed',
    ]){const data=preseason();mutation(data);expect(isFullPreseasonEdition(data)).toBe(false);}
    const data:any=preseason();Object.assign(data.players[0].canonicalRemaining,
      {actual_gp:null,method:'organization_prior_remaining',participation_semantics:'not_used_by_prior'});
    expect(isFullPreseasonEdition(data)).toBe(true);
  });
  function setup(){
    vi.stubEnv('DRAFT_KIT_PDF_READY','true');mocks.access.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(JSON.stringify({canonicalRevision:'test',weights:{skater:{goals:6},goalie:{wins:5}},source:{asOf:'2026-09-12'},players:[{private:'universe'}]}));
    return new DraftKitExportService('/configured/python','/configured/guide.json');
  }
  it('requires explicit delivery readiness and exposes no player universe',async()=>{
    const service=setup();expect(await service.configuration()).toEqual({weights:{skater:{goals:6},goalie:{wins:5}},projectionDate:'2026-09-12',revision:'test'});
    vi.stubEnv('DRAFT_KIT_PDF_READY','false');await expect(service.configuration()).rejects.toMatchObject({status:503});
  });
  it('uses configured executable paths without a shell and sends data on stdin',async()=>{
    const service=setup(),child=childResult('rank,player');mocks.spawn.mockReturnValue(child);
    const result=await service.download('csv','League; injected',{});
    expect(result.toString()).toBe('rank,player');
    expect(mocks.spawn).toHaveBeenCalledWith('/configured/python',expect.arrayContaining(['/configured/guide.json']),{stdio:['pipe','pipe','pipe']});
    expect(JSON.parse(child.stdin.end.mock.calls[0][0]).league).toBe('League; injected');
  });
  it('allows only the owned direct delivery origins',async()=>{
    const service=setup();
    vi.stubEnv('DRAFT_KIT_DOWNLOAD_ORIGIN','https://citrus-api-gb5jc2sd5q-nn.a.run.app');
    expect((await service.configuration()).downloadOrigin).toBe('https://citrus-api-gb5jc2sd5q-nn.a.run.app');
    vi.stubEnv('DRAFT_KIT_DOWNLOAD_ORIGIN','https://example.com');
    await expect(service.configuration()).rejects.toMatchObject({status:503});
  });
  it('passes versioned source and editorial roots from server configuration only',async()=>{
    setup();const service=new DraftKitExportService('/configured/python','/configured/guide.json','/release/source','/release/editorial');
    const child=childResult('rank,player');mocks.spawn.mockReturnValue(child);
    await service.download('csv','League',{});
    expect(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '/configured/guide.json','--source-root','/release/source','--editorial-root','/release/editorial']));
  });
  it('rejects invalid worker output and validation failures',async()=>{
    const service=setup();mocks.spawn.mockReturnValue(childResult('not a pdf'));
    await expect(service.download('pdf','League',{})).rejects.toMatchObject({status:503});
    mocks.spawn.mockReturnValue(childResult('',2));
    await expect(service.download('csv','League',{})).rejects.toMatchObject({status:400});
    mocks.spawn.mockReturnValue(childResult('<!doctype html><html></html>'));
    await expect(service.download('desk','League',{})).resolves.toEqual(Buffer.from('<!doctype html><html></html>'));
    mocks.spawn.mockReturnValue(childResult('not html'));
    await expect(service.download('desk','League',{})).rejects.toMatchObject({status:503});
  });
  it('serializes full guides that share a portrait cache, then releases the slot',async()=>{
    const service=setup(),child=childResult('%PDF-first');
    let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    child.stdin.end.mockImplementation(started);
    mocks.spawn.mockReturnValue(child);
    const first=service.download('pdf','First',{});
    await ready;
    await expect(service.download('pdf','Second',{})).rejects.toMatchObject({status:429});
    child.stdout.emit('data',Buffer.from('%PDF-first'));child.emit('close',0);
    await expect(first).resolves.toEqual(Buffer.from('%PDF-first'));
    mocks.spawn.mockReturnValue(childResult('%PDF-next'));
    await expect(service.download('pdf','Next',{})).resolves.toEqual(Buffer.from('%PDF-next'));
  });
});
