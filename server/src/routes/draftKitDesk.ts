import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { createUserClient } from '../lib/supabase';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';
import { DraftKitDeskService } from '../services/DraftKitDeskService';
import { AuditService } from '../services/AuditService';

export const draftKitDeskRoutes = new Hono<Env>();
draftKitDeskRoutes.use('*', bodyLimit({ maxSize: 8192 }));
draftKitDeskRoutes.use('*', authMiddleware);
draftKitDeskRoutes.use('*', rateLimitMiddleware({ name: 'draft-kit-desk', maxRequests: 600, maxUserRequests: 120, windowMs: 60_000 }));
draftKitDeskRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
const leagueId = z.string().uuid();
const update = z.object({ note: z.string().max(500), target: z.boolean(), version: z.number().int().min(1).max(2147483646).nullable() }).strict();
draftKitDeskRoutes.get('/league/:leagueId', async c => {
  try {
    const id = leagueId.safeParse(c.req.param('leagueId'));
    if (!id.success) throw AppError.badRequest('Invalid league.');
    const db = createUserClient(c.get('userToken'));
    const result = await new DraftKitDeskService(db).open(c.get('userId'), id.data);
    if (result.owned) await new AuditService(db).log('DATA_EXPORT', id.data, { action: 'draft_kit_room_open' });
    return ok(c, result);
  } catch (error) { return handleError(c, error, 'Could not open draft desk'); }
});
draftKitDeskRoutes.put('/league/:leagueId/players/:playerKey', async c => {
  try {
    const id = leagueId.safeParse(c.req.param('leagueId'));
    const key = c.req.param('playerKey');
    const parsed = update.safeParse(await c.req.json());
    if (!id.success || !/^canonical:[1-9][0-9]{0,9}$/.test(key) || !parsed.success)
      throw AppError.badRequest('Check your player note and try again.');
    const db=createUserClient(c.get('userToken'));
    const saved=await new DraftKitDeskService(db)
      .save(c.get('userId'), id.data, key, { note: parsed.data.note!, target: parsed.data.target!, version: parsed.data.version ?? null });
    await new AuditService(db).log('DATA_EXPORT',id.data,{action:'draft_kit_note_saved',playerKey:key,version:saved.version});
    return ok(c,saved);
  } catch (error) { return handleError(c, error, 'Could not save draft preparation'); }
});
