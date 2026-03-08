import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { AccountService } from '../services/AccountService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const accountRoutes = new Hono<Env>();
accountRoutes.use('*', authMiddleware);

// GET /api/account/profile — Get current user's profile
accountRoutes.get('/profile', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const result = await service.getProfile();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to fetch profile'));
  return ok(c, result.data);
});

// POST /api/account/export
accountRoutes.post('/export', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const result = await service.exportUserData();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Export failed'));
  return ok(c, result.data);
});

// POST /api/account/delete
accountRoutes.post('/delete', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const result = await service.deleteAccount();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Deletion failed'));
  return ok(c, { success: true });
});

// POST /api/account/consent
accountRoutes.post('/consent', async (c) => {
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  await service.recordConsent(body.policyType, body.version);
  return ok(c, { success: true });
});

// POST /api/account/audit-log
accountRoutes.post('/audit-log', async (c) => {
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  await service.logSecurityEvent(body.eventType, body.leagueId || null, body.details || {}, body.severity || 'INFO');
  return ok(c, { success: true });
});

export { accountRoutes };
