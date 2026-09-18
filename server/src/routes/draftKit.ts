import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { DraftKitService } from '../services/DraftKitService';
import { ok, handleError } from '../lib/responses';
import { logger } from '@citrus/shared';

/**
 * Draft Kit routes — the paid analytics section.
 *
 * THE GATE IS HERE, NOT IN THE BROWSER
 * ------------------------------------
 * Every route below runs authMiddleware, and the service resolves the
 * caller's tier from their own JWT before it assembles anything. An
 * unentitled caller does not receive a full board with a `locked: true` flag
 * for the client to ignore — they receive a board that was built without the
 * paid numbers in it. Nothing in the response body can be un-hidden with CSS,
 * a devtools breakpoint or a hand-rolled fetch.
 *
 * NO ROUTE TAKES A USER ID
 * ------------------------
 * Not in a path param, not in a query string, not in a body. Identity comes
 * from the verified token via c.get('userId') and from auth.uid() inside RLS.
 * A client that wants someone else's entitlement has nowhere to put the id.
 */

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
    const { board, error } = await service.getBoard();
    if (error) return handleError(c, error, 'Failed to build draft kit board');
    return ok(c, board);
  } catch (err) {
    return handleError(c, err, 'Failed to build draft kit board');
  }
});

/**
 * POST /api/draft-kit/checkout — deliberate stub.
 *
 * There is no payment processor wired to Citrus and this route does not
 * pretend otherwise: it takes no card details, stores nothing, and grants
 * nothing. It exists so the upgrade CTA has a real endpoint to call and a
 * real answer to render, instead of a button that does nothing.
 *
 * It still demonstrates the rule every future mutation here must follow: the
 * user is c.get('userId'), read from the verified token. The request body is
 * not consulted for identity, so a client-supplied id has no effect.
 */
draftKitRoutes.post('/checkout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftKitService(supabase);
  const tier = await service.getTier();

  logger.info('[draft-kit] checkout requested', { userId, currentTier: tier });

  return ok(c, {
    status: 'not_yet_available',
    currentTier: tier,
    message:
      'Draft Kit checkout is not open yet. Your account is on the free tier and nothing has been charged.',
  });
});

export { draftKitRoutes };
