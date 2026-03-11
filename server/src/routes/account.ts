import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { AccountService } from '../services/AccountService';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const accountRoutes = new Hono<Env>();
accountRoutes.use('*', authMiddleware);

// GET /api/account/profile — Get current user's profile
accountRoutes.get('/profile', async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));
    const service = new AccountService(supabase);
    const result = await service.getProfile();
    if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to fetch profile'));
    return ok(c, result.data);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch profile');
  }
});

// POST /api/account/export
accountRoutes.post('/export', validateBody(schemas.accountExport), async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const result = await service.exportUserData();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Export failed'));

  const audit = new AuditService(supabase);
  audit.log('DATA_EXPORT', null, { format: 'json' });

  return ok(c, result.data);
});

// POST /api/account/delete
accountRoutes.post('/delete', validateBody(schemas.accountDelete), async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);

  // Audit BEFORE deletion since user context will be lost after
  const audit = new AuditService(supabase);
  audit.log('ADMIN_ACTION', null, { action: 'account_delete' }, 'WARN');

  const result = await service.deleteAccount();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Deletion failed'));
  return ok(c, { success: true });
});

// POST /api/account/consent
accountRoutes.post('/consent', validateBody(schemas.recordConsent), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.recordConsent>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  await service.recordConsent(body.policyType, body.version);
  return ok(c, { success: true });
});

// POST /api/account/audit-log
accountRoutes.post('/audit-log', validateBody(schemas.auditLog), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.auditLog>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  await service.logSecurityEvent(body.eventType, body.leagueId || null, body.details || {}, body.severity || 'INFO');
  return ok(c, { success: true });
});

export { accountRoutes };
