import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { validateBody, schemas } from '../middleware/validate';

const stormyRoutes = new Hono<Env>();

stormyRoutes.use('*', authMiddleware);

// POST /api/stormy/chat — Send a message to Stormy AI assistant
stormyRoutes.post('/chat', validateBody(schemas.stormyChat), async (c) => {
  const userId = c.get('userId');
  const body = (c as any).get('validatedBody');

  const { message, leagueId, context } = body;

  // TODO: Migrate stormy-chat edge function logic here
  // For now, proxy to the existing edge function
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return c.json({ error: 'Server configuration error' }, 500);
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
    return c.json(data, response.status as any);
  } catch (error) {
    return c.json({ error: 'Failed to reach Stormy' }, 502);
  }
});

export { stormyRoutes };
