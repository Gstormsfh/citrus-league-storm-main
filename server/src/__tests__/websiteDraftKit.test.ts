import { Hono } from 'hono';
import { describe,it,expect,vi } from 'vitest';
import { websiteDraftKit } from '../middleware/websiteDraftKit';
import type { Env } from '../app';
describe('website-only draft kit product boundary',()=>{
  it.each(['capacitor://localhost','ionic://localhost','https://localhost'])('does not deliver any paid kit route to native origin %s',async origin=>{
    const app=new Hono<Env>(),handler=vi.fn(c=>c.json({owned:true}));app.use('/api/draft-kit/*',websiteDraftKit);app.all('/api/draft-kit/*',handler);
    for(const path of ['desk/league/test','pdf/access','pdf/download','checkout/session','board']){
      const result=await app.request('/api/draft-kit/'+path,{headers:{origin,authorization:'Bearer buyer'}});
      expect(result.status).toBe(404);expect(result.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it.each(['https://citrusfantasysports.com','https://www.citrusfantasysports.com','http://127.0.0.1:8099',undefined])('preserves downstream authorization for browser and server calls: %s',async origin=>{
    const app=new Hono<Env>();app.use('/api/draft-kit/*',websiteDraftKit);app.get('/api/draft-kit/pdf/access',c=>c.json({error:'Unauthorized'},401));
    expect((await app.request('/api/draft-kit/pdf/access',{headers:origin?{origin}:{}})).status).toBe(401);
  });
  it('does not interfere with Stripe server webhooks or the free draft room',async()=>{
    const app=new Hono<Env>();app.use('/api/draft-kit/*',websiteDraftKit);
    app.post('/api/draft-kit/checkout/webhook',c=>c.text('signature verification still required',400));
    app.get('/api/draft/room',c=>c.json({ok:true}));
    expect((await app.request('/api/draft-kit/checkout/webhook',{method:'POST'})).status).toBe(400);
    expect((await app.request('/api/draft/room',{headers:{origin:'capacitor://localhost'}})).status).toBe(200);
  });
});
