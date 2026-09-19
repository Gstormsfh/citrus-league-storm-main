import { Hono } from 'hono';
import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),snapshot:vi.fn(),open:vi.fn(),log:vi.fn()}));
vi.mock('../middleware/auth',()=>({authMiddleware:async(c:any,next:any)=>{if(c.req.header('authorization')!=='Bearer test')return c.json({},401);c.set('userId','verified-user');c.set('userToken','test');await next();}}));
vi.mock('../middleware/rateLimit',()=>({rateLimitMiddleware:()=>async(_c:any,next:any)=>next()}));
vi.mock('../lib/supabase',()=>({createUserClient:vi.fn(()=>({})),supabaseAdmin:{}}));
vi.mock('../services/DraftKitAccessService',()=>({DraftKitAccessService:class{access=mocks.access}}));
vi.mock('../services/ExternalDraftGatewayService',()=>({ExternalDraftGatewayService:class{snapshot=mocks.snapshot;open=mocks.open}}));
vi.mock('../services/AuditService',()=>({AuditService:class{log=mocks.log}}));
import {draftKitExternalRoutes} from '../routes/draftKitExternal';
import {websiteDraftKit} from '../middleware/websiteDraftKit';
const app=new Hono().use('/external/*',websiteDraftKit).route('/external',draftKitExternalRoutes);
const body={platform:'espn',leagueId:'777',season:2026};
const headers={authorization:'Bearer test','content-type':'application/json'};
const post=(payload:unknown=body,path='snapshot',h:Record<string,string>=headers)=>app.request('/external/'+path,{method:'POST',headers:h,body:JSON.stringify(payload)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','false');vi.stubEnv('DRAFT_KIT_YAHOO_SYNC_ENABLED','false');mocks.access.mockResolvedValue({active:true});mocks.snapshot.mockResolvedValue({complete:true});mocks.open.mockResolvedValue({file:{}});});
afterEach(()=>vi.unstubAllEnvs());
describe('external draft release and access gates',()=>{
  it('defaults off and never calls a provider while disabled',async()=>{
    expect((await post()).status).toBe(503);expect(mocks.snapshot).not.toHaveBeenCalled();
    expect((await (await app.request('/external/capabilities',{headers})).json()).data).toMatchObject({yahoo:false,espn:false});
  });
  it('requires authentication, active purchase and website origin guard',async()=>{
    vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','true');
    expect((await post(body,'snapshot',{} as never)).status).toBe(401);
    expect((await post(body,'snapshot',{...headers,Origin:'capacitor://localhost'})).status).toBe(404);
    mocks.access.mockResolvedValue({active:false});expect((await post()).status).toBe(403);expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('rejects supplied identities, arbitrary URLs and invalid credentials',async()=>{
    vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','true');
    for(const payload of [{...body,userId:'other'},{...body,leagueId:'https://evil.invalid'},{...body,credentials:{espnS2:'x'.repeat(20)+';token=secret',swid:'bad'}}])expect((await post(payload)).status).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('uses the verified caller and checks access again after a provider read',async()=>{
    vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','true');mocks.access.mockResolvedValueOnce({active:true}).mockResolvedValueOnce({active:false});
    expect((await post()).status).toBe(403);expect(mocks.snapshot).toHaveBeenCalledWith('verified-user',body);
  });
  it('never returns provider errors that might contain credentials',async()=>{
    vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','true');mocks.snapshot.mockRejectedValue(Error('private cookie secret-value'));
    const response=await post();expect(response.status).toBe(502);expect(await response.text()).not.toContain('secret-value');
  });
  it('audits an authorized open without credentials and prevents caching',async()=>{
    vi.stubEnv('DRAFT_KIT_ESPN_SYNC_ENABLED','true');const response=await post(body,'open');
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.log).toHaveBeenCalledWith('DATA_EXPORT',null,{action:'external_draft_open',platform:'espn',season:2026});
  });
});
