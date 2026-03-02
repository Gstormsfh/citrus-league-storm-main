import { Context, Next } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../app';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

/**
 * Auth middleware — validates Supabase JWT from Authorization header.
 * Sets userId and userToken on the request context.
 *
 * Usage:
 *   app.use('/api/leagues/*', authMiddleware);
 *   // Then in handler: c.get('userId'), c.get('userToken')
 */
export async function authMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  // Verify the JWT by calling Supabase auth
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Attach user info to context
  c.set('userId', user.id);
  c.set('userToken', token);

  await next();
}

/**
 * Optional auth middleware — attaches user info if token is present,
 * but allows anonymous access (for public endpoints like demo league).
 */
export async function optionalAuthMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ') && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const token = authHeader.slice(7);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      c.set('userId', user.id);
      c.set('userToken', token);
    }
  }

  await next();
}
