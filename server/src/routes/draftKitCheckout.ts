import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { handleError, ok } from '../lib/responses';
import { DraftKitCheckoutService, checkoutConfig, checkoutReady } from '../services/DraftKitCheckoutService';

export const draftKitCheckoutRoutes = new Hono<Env>();
draftKitCheckoutRoutes.get('/offer', (c) => {
  const config = checkoutConfig(); const available = checkoutReady(config);
  return ok(c, { available, currency: available ? config.currency.toUpperCase() : null, amountMinor: available ? config.amountMinor : null,
    accessUntil: available ? config.accessUntil : null, updatesUntil: available ? config.updatesUntil : null, termsUrl: available ? config.termsUrl : null });
});
draftKitCheckoutRoutes.post('/session', authMiddleware, strictRateLimit, async (c) => {
  try {
    const attemptId = c.req.header('x-checkout-attempt') || '';
    const userDb = createUserClient(c.get('userToken'));
    const result = await new DraftKitCheckoutService(userDb, undefined, undefined, getSupabaseAdmin()).checkout(c.get('userId'), attemptId);
    void new AuditService(userDb).log('ADMIN_ACTION', null, { action: 'draft_kit_checkout_attempt' });
    return ok(c, result);
  }
  catch (error) { return handleError(c, error, 'Could not open checkout'); }
});
draftKitCheckoutRoutes.post('/webhook', async (c) => {
  try { const signature = c.req.header('stripe-signature'); if (!signature) throw AppError.badRequest('Missing payment signature.');
    const admin = getSupabaseAdmin();
    const result = await new DraftKitCheckoutService(admin).webhook(await c.req.text(), signature);
    void new AuditService(admin).log('ADMIN_ACTION', null, { action: 'draft_kit_payment_webhook_processed' });
    return ok(c, result); }
  catch (error) { return handleError(c, error, 'Payment webhook failed'); }
});
