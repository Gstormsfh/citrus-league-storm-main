import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { DraftKitService } from '../services/DraftKitService';
import { AppError } from '../lib/errors';
import { ok, handleError } from '../lib/responses';

// Draft Kit desktop preview. Every route requires a verified user token.

const draftKitRoutes = new Hono<Env>();

// GET /api/draft-kit/entitlement — the caller's own tier, and nobody else's.
draftKitRoutes.get('/entitlement', authMiddleware, async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));
    const service = new DraftKitService(supabase);
    const tier = await service.getTier();
    return ok(c, { tier });
  } catch (err) {
    return handleError(c, err, 'Failed to read entitlement');
  }
});

// GET /api/draft-kit/board — rankings, tiers, cards, roster changes, blurbs.
//
// Shape depends on the caller's tier. See DraftKitService.getBoard: the free
// branch builds a different object, it does not redact a paid one.
draftKitRoutes.get('/board', authMiddleware, async (c) => {
  try {
    const supabase = createUserClient(c.get('userToken'));
    const service = new DraftKitService(supabase);
    const leagueId = c.req.query('leagueId');
    if (leagueId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueId)) {
      throw AppError.badRequest('Invalid leagueId');
    }
    const { board, error } = await service.getBoard(
      leagueId ? { leagueId, userId: c.get('userId') } : undefined,
    );
    if (error) return handleError(c, error, 'Failed to build draft kit board');
    return ok(c, board);
  } catch (err) {
    return handleError(c, err, 'Failed to build draft kit board');
  }
});

// Retained for older clients; no checkout or purchase is offered.
draftKitRoutes.post('/checkout', authMiddleware, async (c) => {
  return ok(c, {
    status: 'unavailable',
    message: 'Draft Kit purchases are not available yet. Nothing has been charged.',
  });
});

export { draftKitRoutes };
