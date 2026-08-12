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
accountRoutes.post('/export', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const result = await service.exportUserData();
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Export failed'));

  const audit = new AuditService(supabase);
  audit.log('DATA_EXPORT', null, { format: 'json' });

  return ok(c, result.data);
});

// POST /api/account/delete
accountRoutes.post('/delete', async (c) => {
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
  const consent = await service.recordConsent(body.policyType, body.version);
  if (!consent.success) {
    // Consent is GDPR evidence, not telemetry. Do not tell the client it
    // persisted when it did not — that is exactly what happened for 72 signups.
    return fail(c, AppError.internal('Failed to record consent'));
  }
  return ok(c, { success: true });
});

// GET /api/account/consent — what the user still owes (current | outdated | withdrawn | never_given)
accountRoutes.get('/consent', async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));
    const service = new AccountService(supabase);
    const result = await service.getConsentStatus();
    if (!result.success) return fail(c, AppError.internal('Failed to read consent status'));
    return ok(c, result.data);
  } catch (err) {
    return handleError(c, err, 'Failed to read consent status');
  }
});

// POST /api/account/consent/withdraw — GDPR Art. 7(3): withdrawing must be as
// easy as giving. POST, not DELETE: the grant row is kept and stamped
// withdrawn_at, because Art. 7 needs the withdrawal date as much as the
// consent date. (apiClient.delete() also sends no body.)
accountRoutes.post('/consent/withdraw', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const policyType = typeof body.policyType === 'string' ? body.policyType : null;
    if (!policyType) return fail(c, AppError.badRequest('policyType is required'));
    const supabase = createUserClient(c.get('userToken'));
    const service = new AccountService(supabase);
    const result = await service.withdrawConsent(
      policyType,
      typeof body.version === 'string' ? body.version : null,
    );
    if (!result.success) return fail(c, AppError.internal('Failed to withdraw consent'));
    return ok(c, result.data);
  } catch (err) {
    return handleError(c, err, 'Failed to withdraw consent');
  }
});

// POST /api/account/audit-log
accountRoutes.post('/audit-log', validateBody(schemas.auditLog), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.auditLog>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AccountService(supabase);
  const audit = await service.logSecurityEvent(body.eventType, body.leagueId || null, body.details || {}, body.severity || 'INFO');
  // Deliberately 200 either way — audit logging must never break a user-facing
  // path — but the body now tells the truth about whether the row landed.
  return ok(c, { success: true, recorded: audit.success });
});

// GET /api/account/stats — Get aggregated user performance stats
accountRoutes.get('/stats', async (c) => {
  try {
    const userId = c.get('userId');
    const supabase = createUserClient(c.get('userToken'));
    const service = new AccountService(supabase);
    const result = await service.getUserStats(userId);
    if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to fetch stats'));
    return ok(c, result.data);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch user stats');
  }
});

// PUT /api/account/profile — Update profile fields
accountRoutes.put('/profile', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();

    // Only allow known profile fields
    const allowedFields = ['username', 'display_name', 'first_name', 'last_name', 'phone', 'location', 'bio', 'default_team_name', 'timezone', 'avatar_url'];
    const fields: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) {
        fields[key] = body[key];
      }
    }

    if (Object.keys(fields).length === 0) {
      return fail(c, AppError.badRequest('No valid fields provided'));
    }

    const supabase = createUserClient(c.get('userToken'));
    const { data, error } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return handleError(c, error, 'Failed to update profile');
    }

    return ok(c, data);
  } catch (err) {
    return handleError(c, err, 'Failed to update profile');
  }
});

// PUT /api/account/team-name — Update default team name + sync to owned teams
accountRoutes.put('/team-name', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();
    const teamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';

    if (!teamName) {
      return fail(c, AppError.badRequest('teamName is required'));
    }

    const supabase = createUserClient(c.get('userToken'));

    // Update profile default_team_name
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ default_team_name: teamName })
      .eq('id', userId);

    if (profileErr) {
      return handleError(c, profileErr, 'Failed to update profile team name');
    }

    // Sync name to all teams owned by this user
    const { data: updatedTeams, error: teamsErr } = await supabase
      .from('teams')
      .update({ team_name: teamName })
      .eq('owner_id', userId)
      .select('id');

    if (teamsErr) {
      return handleError(c, teamsErr, 'Failed to sync team names');
    }

    return ok(c, { updatedCount: updatedTeams?.length || 0 });
  } catch (err) {
    return handleError(c, err, 'Failed to update team name');
  }
});

// GET /api/account/check-username/:username — Check username availability
accountRoutes.get('/check-username/:username', async (c) => {
  try {
    const username = c.req.param('username');
    const supabase = createUserClient(c.get('userToken'));

    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      return handleError(c, error, 'Failed to check username');
    }

    return ok(c, { available: !data });
  } catch (err) {
    return handleError(c, err, 'Failed to check username');
  }
});

export { accountRoutes };
