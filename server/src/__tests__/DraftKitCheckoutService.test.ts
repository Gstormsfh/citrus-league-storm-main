import { describe, expect, it, vi } from 'vitest';
import { checkoutReady, DraftKitCheckoutService, stripeKeyIsLive, type DraftKitCheckoutConfig } from '../services/DraftKitCheckoutService';

const config: DraftKitCheckoutConfig = {
  enabled: true, secret: 'sk_test_example', webhookSecret: 'whsec_example', priceId: 'price_example',
  currency: 'cad', amountMinor: 799, tier: 'kit', origin: 'https://citrusfantasysports.com',
  accessUntil: '2099-07-01T05:59:59Z', updatesUntil: '2099-06-30T05:59:59Z', termsVersion: 'draft-v1', termsUrl: 'https://citrusfantasysports.com/terms/draft-kit', taxMode: 'none',
};
const USER = '11111111-1111-4111-8111-111111111111';
function database() {
  const query: any = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  for (const name of ['select', 'eq', 'gt', 'limit']) query[name].mockReturnValue(query);
  return { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ error: null }) };
}
function paidSession() { return { id: 'cs_test_kit', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'cad', amount_subtotal: 799, livemode: false, client_reference_id: USER, metadata: { product: 'seasonal_draft_kit', user_id: USER, tier: 'kit', access_until: config.accessUntil, updates_until: config.updatesUntil, terms_version: config.termsVersion }, line_items: { data: [{ quantity: 1, price: { id: config.priceId } }] }, payment_intent: { id: 'pi_test_kit', status: 'succeeded' } }; }

describe('Draft Kit website checkout readiness', () => {
  it('requires every provider and commercial-term value before it can sell', () => {
    expect(checkoutReady(config)).toBe(true);
    const invalidOverrides: Array<Partial<DraftKitCheckoutConfig>> = [
      { enabled: false }, { secret: '' }, { webhookSecret: '' }, { priceId: '' }, { currency: '' },
      { amountMinor: 0 }, { origin: 'http://citrusfantasysports.com' }, { termsUrl: 'https://other.test/terms' },
      { termsVersion: '' }, { taxMode: '' }, { secret: 'pk_test_not_a_server_key' }, { secret: 'invalid' }, { accessUntil: '2000-01-01T00:00:00Z' }, { updatesUntil: '2000-01-01T00:00:00Z' }, { updatesUntil: '2100-01-01T00:00:00Z' },
    ];
    for (const partial of invalidOverrides) expect(checkoutReady({ ...config, ...partial })).toBe(false);
    expect(checkoutReady({ ...config, secret: 'rk_test_restricted' })).toBe(true);
    expect(stripeKeyIsLive('sk_live_example')).toBe(true);
    expect(stripeKeyIsLive('rk_live_example')).toBe(true);
    expect(stripeKeyIsLive('rk_test_example')).toBe(false);
  });
  it('fails closed before creating a provider checkout when launch is disabled', async () => {
    const provider = { prices: { retrieve: vi.fn() } };
    await expect(new DraftKitCheckoutService({} as any, { ...config, enabled: false }, provider as any)
      .checkout('11111111-1111-4111-8111-111111111111', USER)).rejects.toMatchObject({ status: 503 });
    expect(provider.prices.retrieve).not.toHaveBeenCalled();
  });
  it('rejects an invalid raw webhook signature before processing its payload', async () => {
    const provider = { webhooks: { constructEvent: vi.fn(() => { throw Error('bad signature'); }) } };
    await expect(new DraftKitCheckoutService({} as any, config, provider as any).webhook('{}', 'bad'))
      .rejects.toMatchObject({ status: 400 });
  });
  it('creates only a fixed-price, server-identified checkout session', async () => {
    const db = database(); const provider = { prices: { retrieve: vi.fn().mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 799 }) }, checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/c/pay/test' }) } } };
    await expect(new DraftKitCheckoutService(db as any, config, provider as any).checkout(USER, '22222222-2222-4222-8222-222222222222')).resolves.toEqual({ url: 'https://checkout.stripe.com/c/pay/test' });
    expect(provider.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ client_reference_id: USER, line_items: [{ price: config.priceId, quantity: 1 }], mode: 'payment' }), expect.any(Object));
    expect(provider.checkout.sessions.create.mock.calls[0][1].idempotencyKey).toContain('22222222-2222-4222-8222-222222222222');
  });
  it('uses the verified provider state for fulfilment retries and refund revocation', async () => {
    const db = database(); const event = { livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_test_kit' } } };
    const provider = { webhooks: { constructEvent: vi.fn().mockReturnValue(event) }, checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(paidSession()) } } };
    const service = new DraftKitCheckoutService(db as any, config, provider as any);
    await service.webhook('{}', 'sig'); await service.webhook('{}', 'sig');
    expect(db.rpc).toHaveBeenCalledWith('fulfill_draft_kit_checkout', expect.objectContaining({ p_session: 'cs_test_kit', p_user: USER, p_amount: 799 }));
    provider.webhooks.constructEvent.mockReturnValue({ livemode: false, type: 'charge.refunded', data: { object: { payment_intent: 'pi_test_kit' } } });
    await service.webhook('{}', 'sig');
    expect(db.rpc).toHaveBeenCalledWith('revoke_draft_kit_checkout', { p_intent: 'pi_test_kit' });
  });
});
