import { Hono } from 'hono';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),checkout:vi.fn(),webhook:vi.fn(),configuration:vi.fn(),download:vi.fn(),log:vi.fn()}));
vi.mock('../middleware/auth',()=>({authMiddleware:async(c:any,next:any)=>{
  if(c.req.header('authorization')!=='Bearer test')return c.json({error:'Unauthorized'},401);
  c.set('userId','11111111-1111-4111-8111-111111111111');c.set('userToken','test');await next();
}}));
vi.mock('../middleware/rateLimit',()=>({strictRateLimit:async(_c:any,next:any)=>next()}));
vi.mock('../lib/supabase',()=>({createUserClient:vi.fn(()=>({})),getSupabaseAdmin:vi.fn(()=>({}))}));
vi.mock('../services/AuditService',()=>({AuditService:class{log=mocks.log}}));
vi.mock('../services/DraftKitAccessService',()=>({
  DraftKitAccessService:class{access=mocks.access},
}));
vi.mock('../services/DraftKitExportService',()=>({
  DraftKitExportService:class{configuration=mocks.configuration;download=mocks.download},
  DOWNLOADS:{csv:['rankings.csv','text/csv'],pdf:['kit.pdf','application/pdf'],desk:['desk.html','text/html']},
}));
import { draftKitPdfRoutes } from '../routes/draftKitPdf';
const app=new Hono().route('/pdf',draftKitPdfRoutes);
const headers={authorization:'Bearer test','Content-Type':'application/json'};
const request={format:'csv',league:'My league',weights:{skater:{goals:6},goalie:{wins:5}}};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({active:true});mocks.configuration.mockResolvedValue({weights:request.weights});mocks.download.mockResolvedValue(Buffer.from('rank,player\n1,Connor'));mocks.checkout.mockResolvedValue({url:'https://checkout.stripe.com/example'});});
describe('PDF API authorization',()=>{
  it('exposes only a disabled public offer without authentication',async()=>{
    const response=await app.request('/pdf/offer');expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({available:false,accessUntil:null,termsUrl:null});
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each(['/access','/configuration','/download'])('requires authentication for %s',async(path)=>{
    const response=await app.request('/pdf'+path,{method:['/download','/checkout'].includes(path)?'POST':'GET'});
    expect(response.status).toBe(401);expect(mocks.download).not.toHaveBeenCalled();
  });
  it('does not start generation or reveal configuration without ownership',async()=>{
    mocks.access.mockResolvedValue({active:false});
    expect((await app.request('/pdf/configuration',{headers})).status).toBe(403);
    expect((await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify(request)})).status).toBe(403);
    expect(mocks.configuration).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied identities and nonfinite/unbounded scoring',async()=>{
    for(const body of [{...request,userId:'another-user'},{...request,weights:{skater:{goals:100000},goalie:{wins:5}}}]){
      expect((await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify(body)})).status).toBe(400);
    }
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rejects malformed or oversized bodies before starting a renderer',async()=>{
    expect((await app.request('/pdf/download',{headers,method:'POST',body:'{'})).status).toBe(400);
    expect((await app.request('/pdf/download',{headers,method:'POST',body:'x'.repeat(32769)})).status).toBe(413);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rechecks access after rendering and returns no paid file after revocation',async()=>{
    mocks.access.mockResolvedValueOnce({active:true}).mockResolvedValueOnce({active:false});
    expect((await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify(request)})).status).toBe(403);
    expect(mocks.download).toHaveBeenCalledOnce();
  });
  it('returns a no-store file only to an entitled customer',async()=>{
    const response=await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify(request)});
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).data).toEqual({filename:'rankings.csv',mime:'text/csv',base64:Buffer.from('rank,player\n1,Connor').toString('base64')});
    expect(mocks.access).toHaveBeenCalledTimes(2);expect(mocks.log).toHaveBeenCalledOnce();
  });
  it('protects offline desk downloads with the same ownership checks',async()=>{
    const response=await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify({...request,format:'desk'})});
    expect(response.status).toBe(200);expect((await response.json()).data.filename).toBe('desk.html');
    expect(mocks.access).toHaveBeenCalledTimes(2);
    mocks.access.mockResolvedValue({active:false});
    expect((await app.request('/pdf/download',{headers,method:'POST',body:JSON.stringify({...request,format:'desk'})})).status).toBe(403);
  });
  it('does not expose a competing checkout or webhook',async()=>{
    expect((await app.request('/pdf/webhook',{method:'POST',body:'{}'})).status).toBe(404);
    expect((await app.request('/pdf/checkout',{headers,method:'POST'})).status).toBe(404);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it('provides configuration only after authentication',async()=>{
    expect((await app.request('/pdf/configuration',{headers})).status).toBe(200);
  });
});
