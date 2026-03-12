import { Context, Next } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../app';
import { logger } from '@citrus/shared';

// NOTE: env vars are read inside each middleware function (not at module scope)
// because ESM import hoisting causes module-level code to run before .env is loaded.

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
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!token) {
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Empty Bearer token' } }, 401);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.error('[Auth] Missing env vars — SUPABASE_URL:', !!SUPABASE_URL, 'SUPABASE_ANON_KEY:', !!SUPABASE_ANON_KEY);
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Server configuration error' } }, 500);
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
    // Log the actual Supabase error for server-side debugging (Cloud Run logs)
    logger.error('[Auth] getUser failed:', {
      errorMessage: error?.message,
      errorStatus: error?.status,
      errorName: error?.name,
      supabaseUrl: SUPABASE_URL,
      anonKeyPrefix: SUPABASE_ANON_KEY.substring(0, 20) + '...',
      tokenPrefix: token.substring(0, 20) + '...',
      path: c.req.path,
    });
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Invalid or expired token' } }, 401);
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

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

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
