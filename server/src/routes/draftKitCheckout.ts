import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
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
  try { return ok(c, await new DraftKitCheckoutService(createUserClient(c.get('userToken'))).checkout(c.get('userId'))); }
  catch (error) { return handleError(c, error, 'Could not open checkout'); }
});
draftKitCheckoutRoutes.post('/webhook', async (c) => {
  try { const signature = c.req.header('stripe-signature'); if (!signature) throw AppError.badRequest('Missing payment signature.');
    return ok(c, await new DraftKitCheckoutService(getSupabaseAdmin()).webhook(await c.req.text(), signature)); }
  catch (error) { return handleError(c, error, 'Payment webhook failed'); }
});
