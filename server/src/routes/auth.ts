import { Hono } from 'hono';
import type { Env } from '../app';
import { z } from 'zod';
import { validateBody, getValidatedBody } from '../middleware/validate';
import { getSupabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, created, fail } from '../lib/responses';

const authRoutes = new Hono<Env>();

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// POST /api/auth/signup — Create a new user with auto-confirmed email
// Uses admin client so the user can sign in immediately without email verification.
authRoutes.post('/signup', validateBody(signupSchema), async (c) => {
  const body = getValidatedBody<z.infer<typeof signupSchema>>(c);
  const admin = getSupabaseAdmin();

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });

    if (error) {
      if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
        return fail(c, AppError.badRequest('This email already has an account. Please sign in instead.'));
      }
      return fail(c, AppError.badRequest(error.message || 'Signup failed'));
    }

    // Sign in server-side so the client gets session tokens without
    // hitting Supabase's IP-level rate limiter on signInWithPassword.
    // The admin client uses the service role key → no user-facing throttle.
    const { data: signInData, error: signInError } = await admin.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (signInError || !signInData?.session) {
      // User created but sign-in failed — still return success, client will sign in manually
      return created(c, { user: { id: data.user.id, email: data.user.email } });
    }

    return created(c, {
      user: { id: data.user.id, email: data.user.email },
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_in: signInData.session.expires_in,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed';
    return fail(c, AppError.badRequest(message));
  }
});

// POST /api/auth/check-method — Look up which auth providers an email uses.
// Called by the client when password login fails, so we can distinguish
// "wrong password" from "account was created via Google OAuth".
//
// Returns: { exists, providers, has_password }
// No sensitive data leaked — just provider names (google/email/etc).
const checkMethodSchema = z.object({
  email: z.string().email('Invalid email address'),
});
authRoutes.post('/check-method', validateBody(checkMethodSchema), async (c) => {
  const body = getValidatedBody<z.infer<typeof checkMethodSchema>>(c);
  const admin = getSupabaseAdmin();

  try {
    // listUsers with email filter returns matching users (admin-only API)
    // @ts-expect-error Supabase types allow string but TS inference is loose
    const { data, error } = await admin.auth.admin.listUsers({ email: body.email });
    if (error) return ok(c, { exists: false, providers: [], has_password: false });

    const users = data?.users || [];
    const match = users.find((u: { email?: string }) => u.email?.toLowerCase() === body.email.toLowerCase());
    if (!match) return ok(c, { exists: false, providers: [], has_password: false });

    const providers: string[] = (match.app_metadata as { providers?: string[] } | undefined)?.providers || [];
    // Heuristic: if 'email' is in providers, a password was set; otherwise OAuth-only
    const has_password = providers.includes('email');

    return ok(c, {
      exists: true,
      providers,
      has_password,
    });
  } catch {
    // On any error, return non-committal response (don't leak existence info on failure)
    return ok(c, { exists: false, providers: [], has_password: false });
  }
});

export { authRoutes };
