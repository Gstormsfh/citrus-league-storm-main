import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
const mocks=vi.hoisted(()=>({configuration:vi.fn(),ready:vi.fn(),checkout:vi.fn(),webhook:vi.fn(),log:vi.fn()}));
vi.mock('../middleware/auth',()=>({authMiddleware:async(c:any,next:any)=>{
  if(c.req.header('authorization')!=='Bearer test')return c.json({error:'Unauthorized'},401);
  c.set('userId','11111111-1111-4111-8111-111111111111');c.set('userToken','test');await next();
}}));
vi.mock('../middleware/rateLimit',()=>({strictRateLimit:async(_c:any,next:any)=>next()}));
vi.mock('../lib/supabase',()=>({createUserClient:vi.fn(()=>({})),getSupabaseAdmin:vi.fn(()=>({}))}));
vi.mock('../services/AuditService',()=>({AuditService:class{log=mocks.log}}));
vi.mock('../services/DraftKitExportService',()=>({DraftKitExportService:class{configuration=mocks.configuration}}));
vi.mock('../services/DraftKitCheckoutService',()=>({
  DraftKitCheckoutService:class{checkout=mocks.checkout;webhook=mocks.webhook},
  checkoutReady:mocks.ready,
  checkoutConfig:()=>({currency:'cad',amountMinor:799,accessUntil:'2027-07-01',updatesUntil:'2026-09-30',termsUrl:'https://example.com/terms'}),
}));
import { draftKitCheckoutRoutes } from '../routes/draftKitCheckout';
const app=new Hono().route('/checkout',draftKitCheckoutRoutes);
beforeEach(()=>{vi.clearAllMocks();mocks.ready.mockReturnValue(true);mocks.configuration.mockResolvedValue({});mocks.log.mockResolvedValue(undefined);mocks.checkout.mockResolvedValue({url:'https://checkout.stripe.com/test'});mocks.webhook.mockResolvedValue({received:true});});
describe('Checkout requires working delivery',()=>{
  it('hides the offer when configured commerce has no delivery',async()=>{
    mocks.configuration.mockRejectedValue(AppError.serviceUnavailable('Not ready'));
    const result=await app.request('/checkout/offer');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect((await result.json()).data).toMatchObject({available:false,amountMinor:null});
  });
  it('does not access the private edition when commerce is disabled',async()=>{
    mocks.ready.mockReturnValue(false);
    expect((await (await app.request('/checkout/offer')).json()).data.available).toBe(false);
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
  it('exposes the offer only when both checks pass',async()=>{
    expect((await (await app.request('/checkout/offer')).json()).data).toMatchObject({available:true,amountMinor:799});
  });
  it('refuses a stale buy button before any Stripe call',async()=>{
    mocks.configuration.mockRejectedValue(AppError.serviceUnavailable('Not ready'));
    expect((await app.request('/checkout/session',{method:'POST',headers:{authorization:'Bearer test'}})).status).toBe(503);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it('keeps webhook fulfilment and revocation working during a renderer outage',async()=>{
    mocks.configuration.mockRejectedValue(AppError.serviceUnavailable('Not ready'));
    expect((await app.request('/checkout/webhook',{method:'POST',headers:{'stripe-signature':'test'},body:'{}'})).status).toBe(200);
    expect(mocks.webhook).toHaveBeenCalled();expect(mocks.configuration).not.toHaveBeenCalled();
  });
});
