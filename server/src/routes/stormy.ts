import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { AppError } from '../lib/errors';
import { ok, fail } from '../lib/responses';

const stormyRoutes = new Hono<Env>();

stormyRoutes.use('*', authMiddleware);

// POST /api/stormy/chat — Send a message to Stormy AI assistant
stormyRoutes.post('/chat', validateBody(schemas.stormyChat), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.stormyChat>>(c);

  const { message, leagueId, context } = body;

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return fail(c, AppError.serviceUnavailable('Server configuration error'));
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/stormy-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.get('userToken')}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ message, leagueId, context, userId }),
    });

    const data = await response.json();

    if (!response.ok) {
      return fail(c, new AppError(
        data.error || 'Stormy request failed',
        response.status,
        response.status === 429 ? 'RATE_LIMITED' : 'BAD_GATEWAY',
      ));
    }

    return ok(c, data);
  } catch {
    return fail(c, AppError.badGateway('Failed to reach Stormy'));
  }
});

export { stormyRoutes };
