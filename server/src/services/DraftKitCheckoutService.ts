import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { logger } from '@citrus/shared';
import { AppError } from '../lib/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_SERVER_KEY = /^(?:sk|rk)_(?:test|live)_/;

/** Accept standard and restricted server keys, never publishable browser keys. */
export function stripeKeyIsLive(key: string): boolean {
  const prefix = (kind: 'sk' | 'rk') => [kind, 'live', ''].join('_');
  return key.startsWith(prefix('sk')) || key.startsWith(prefix('rk'));
}

/** All commercial terms are explicit server configuration. Missing data means no sale. */
export interface DraftKitCheckoutConfig {
  enabled: boolean; secret: string; webhookSecret: string; priceId: string;
  currency: string; amountMinor: number; tier: 'kit' | 'suite'; origin: string;
  accessUntil: string; updatesUntil: string; termsVersion: string; termsUrl: string; taxMode: 'automatic' | 'none' | '';
}

export function checkoutConfig(): DraftKitCheckoutConfig {
  return {
    enabled: process.env.DRAFT_KIT_CHECKOUT_ENABLED === 'true',
    secret: process.env.STRIPE_SECRET_KEY || '', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceId: process.env.DRAFT_KIT_STRIPE_PRICE_ID || '',
    currency: (process.env.DRAFT_KIT_CURRENCY || '').toLowerCase(),
    amountMinor: Number(process.env.DRAFT_KIT_AMOUNT_MINOR),
    tier: process.env.DRAFT_KIT_TIER === 'suite' ? 'suite' : 'kit',
    origin: process.env.DRAFT_KIT_SITE_ORIGIN || '', accessUntil: process.env.DRAFT_KIT_ACCESS_UNTIL || '', updatesUntil: process.env.DRAFT_KIT_UPDATES_UNTIL || '',
    termsVersion: process.env.DRAFT_KIT_TERMS_VERSION || '', termsUrl: process.env.DRAFT_KIT_TERMS_URL || '', taxMode: process.env.DRAFT_KIT_TAX_MODE === 'automatic' ? 'automatic' : process.env.DRAFT_KIT_TAX_MODE === 'none' ? 'none' : '',
  };
}

export function checkoutReady(c: DraftKitCheckoutConfig, now = Date.now()): boolean {
  try {
    const origin = new URL(c.origin); const terms = new URL(c.termsUrl);
    return c.enabled && STRIPE_SERVER_KEY.test(c.secret) && c.webhookSecret.startsWith('whsec_')
      && c.priceId.startsWith('price_') && /^[a-z]{3}$/.test(c.currency) && Number.isInteger(c.amountMinor) && c.amountMinor > 0
      && origin.protocol === 'https:' && origin.origin === c.origin && terms.origin === origin.origin
      && c.termsVersion.length > 0 && (c.taxMode === 'automatic' || c.taxMode === 'none') && Date.parse(c.accessUntil) > now && Date.parse(c.updatesUntil) > now
      && Date.parse(c.updatesUntil) <= Date.parse(c.accessUntil);
  } catch { return false; }
}

export class DraftKitCheckoutService {
  constructor(private db: SupabaseClient, private config = checkoutConfig(), private stripe?: Stripe, private admin?: SupabaseClient) {}
  private provider() {
    if (!this.stripe) this.stripe = new Stripe(this.config.secret, { maxNetworkRetries: 2, timeout: 15_000 });
    return this.stripe;
  }
  /**
   * The browser generates one opaque key per explicit checkout attempt.  It is
   * deliberately not a permanent user/price key: Stripe retains idempotency
   * responses, so a cancelled or expired hosted page must not trap a customer
   * on that old session.  Replays of the same click still resolve to one
   * provider session.
   */
  async checkout(userId: string, attemptId: string) {
    if (!UUID.test(userId)) throw AppError.unauthorized();
    if (!UUID.test(attemptId)) throw AppError.badRequest('Invalid checkout attempt.');
    if (!checkoutReady(this.config)) throw AppError.serviceUnavailable('Draft Kit purchases are not available yet. Nothing has been charged.');
    const { data, error } = await this.db.from('draft_kit_checkout_payments').select('checkout_session_id')
      .eq('user_id', userId).eq('status', 'paid').gt('access_until', new Date().toISOString()).limit(1).maybeSingle();
    if (error) throw AppError.serviceUnavailable('Could not verify Draft Kit access.');
    if (data) throw AppError.conflict('You already own this edition.');
    const price = await this.provider().prices.retrieve(this.config.priceId);
    if (!price.active || price.type !== 'one_time' || price.currency !== this.config.currency || price.unit_amount !== this.config.amountMinor)
      throw AppError.serviceUnavailable('The Draft Kit price needs review. Nothing has been charged.');
    if (!this.admin) throw AppError.serviceUnavailable('Checkout attempt storage is unavailable. Nothing has been charged.');
    const reservationStarted = Date.now();
    const attempt = await this.reserveAttempt(attemptId, userId);
    logger.info('[DraftKitCheckout] attempt_reserved', { reused: Boolean(attempt.checkout_session_id), wait_ms: Date.now() - reservationStarted });
    if (attempt.checkout_session_id) {
      const existing = await this.provider().checkout.sessions.retrieve(attempt.checkout_session_id);
      if (existing.status === 'open' && existing.url && new URL(existing.url).origin === 'https://checkout.stripe.com') return { url: existing.url };
      // Stripe can complete a payment just before its webhook arrives. Re-read
      // and fulfil the provider state here rather than expiring it and risking
      // a second payable session during that narrow delivery window.
      if (existing.status === 'complete') {
        if (existing.payment_status === 'paid') await this.fulfill(existing.id, this.admin);
        throw AppError.conflict(existing.payment_status === 'paid'
          ? 'You already own this edition.'
          : 'Your payment is still processing. Please check back shortly.');
      }
      await this.admin.rpc('expire_draft_kit_checkout_attempt', { p_attempt: attempt.attempt_id });
      return this.checkout(userId, randomUUID());
    }
    const metadata = { product: 'seasonal_draft_kit', user_id: userId, tier: this.config.tier,
      access_until: this.config.accessUntil, updates_until: this.config.updatesUntil, terms_version: this.config.termsVersion };
    const session = await this.provider().checkout.sessions.create({ mode: 'payment', client_reference_id: userId,
      line_items: [{ price: this.config.priceId, quantity: 1 }], metadata, payment_intent_data: { metadata }, automatic_tax: { enabled: this.config.taxMode === 'automatic' },
      success_url: `${this.config.origin}/draft-kit?checkout=complete`, cancel_url: `${this.config.origin}/draft-kit?checkout=cancelled`,
    }, { idempotencyKey: `draft-kit:${userId}:${this.config.priceId}:${this.config.termsVersion}:${attempt.attempt_id}` });
    if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw AppError.badGateway('The payment page could not be opened.');
    const { error: attemptError } = await this.admin.rpc('record_draft_kit_checkout_session', { p_attempt: attempt.attempt_id, p_session: session.id });
    if (attemptError) {
      logger.error('[DraftKitCheckout] attempt_record_failed', { code: attemptError.code });
      throw AppError.serviceUnavailable('The payment page could not be recorded. Nothing has been charged.');
    }
    return { url: session.url };
  }
  private async reserveAttempt(attemptId: string, userId: string): Promise<{ attempt_id: string; checkout_session_id: string | null }> {
    const { data, error } = await this.admin!.rpc('get_or_create_draft_kit_checkout_attempt', {
      p_attempt: attemptId, p_user: userId, p_price: this.config.priceId, p_terms: this.config.termsVersion,
    });
    const attempt = Array.isArray(data) ? data[0] : data;
    if (error || !attempt || !UUID.test(attempt.attempt_id)) throw AppError.serviceUnavailable('Could not reserve secure checkout. Nothing has been charged.');
    return attempt;
  }
  async webhook(raw: string, signature: string) {
    let event: Stripe.Event;
    try { event = this.provider().webhooks.constructEvent(raw, signature, this.config.webhookSecret); }
    catch { throw AppError.badRequest('Invalid payment signature.'); }
    if (event.livemode !== stripeKeyIsLive(this.config.secret)) throw AppError.badRequest('Payment mode mismatch.');
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded')
      await this.fulfill((event.data.object as Stripe.Checkout.Session).id);
    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = event.data.object as Stripe.Charge; const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (intent) { const { error } = await this.db.rpc('revoke_draft_kit_checkout', { p_intent: intent }); if (error) throw AppError.serviceUnavailable('Could not revoke access.'); }
    }
    return { received: true };
  }
  private async fulfill(sessionId: string, db: SupabaseClient = this.db) {
    const s = await this.provider().checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price', 'payment_intent', 'payment_intent.latest_charge'] });
    const intent = s.payment_intent as Stripe.PaymentIntent; const item = s.line_items?.data[0];
    const charge = intent?.latest_charge as Stripe.Charge | null;
    if (s.metadata?.product !== 'seasonal_draft_kit' || s.payment_status !== 'paid' || s.status !== 'complete'
      || !UUID.test(s.client_reference_id || '') || s.metadata.user_id !== s.client_reference_id || s.mode !== 'payment'
      || s.currency !== this.config.currency || s.amount_subtotal !== this.config.amountMinor || s.livemode !== stripeKeyIsLive(this.config.secret)
      || s.line_items?.data.length !== 1 || item?.quantity !== 1 || item.price?.id !== this.config.priceId || intent?.status !== 'succeeded'
      || charge?.refunded || charge?.disputed)
      throw AppError.badRequest('Payment does not match this Draft Kit offer.');
    const { error } = await db.rpc('fulfill_draft_kit_checkout', { p_session: s.id, p_user: s.client_reference_id,
      p_intent: intent.id, p_tier: this.config.tier, p_amount: this.config.amountMinor, p_currency: this.config.currency,
      p_access_until: this.config.accessUntil, p_terms: this.config.termsVersion });
    if (error) throw AppError.serviceUnavailable('Payment received; access could not be saved yet.');
  }
}
