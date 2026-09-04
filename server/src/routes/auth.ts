import { Hono } from 'hono';
import type { Env } from '../app';
import { z } from 'zod';
import { validateBody, getValidatedBody } from '../middleware/validate';
import type { SupabaseClient, User } from '@supabase/supabase-js';
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
/**
 * Find one user by email address across the whole user list.
 *
 * CHECK-METHOD (2026-09-04): this route used to call
 *   admin.auth.admin.listUsers({ email })
 * under a @ts-expect-error that blamed loose inference. The types were right
 * and the call was wrong: GoTrue's admin list endpoint takes PageParams only
 * ({ page, perPage }), and auth-js forwards nothing but page + per_page into
 * the query string, so the email argument was dropped before the request was
 * built. The route was therefore answering from page ONE of the user list --
 * 50 rows by GoTrue's default -- against 72 real production accounts. Every
 * user past that page came back exists:false, so the caller's "this email
 * signed up with Google, use that button" guidance never fired for them and
 * an OAuth-only account got the flat "that email + password combo didn't
 * match" with no route in. 37 of the 72 accounts are Google-only.
 *
 * Paging is terminated by an EMPTY page rather than by a short one, because
 * GoTrue may cap per_page below what we ask for; a short page would then be
 * misread as the last one. MAX_PAGES bounds the work whatever the cap is.
 */
const LIST_PAGE_SIZE = 200;
const MAX_LIST_PAGES = 50;

async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ user: User | null; failed: boolean }> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) return { user: null, failed: true };
    const users: User[] = data?.users ?? [];
    if (users.length === 0) return { user: null, failed: false };
    const match = users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) return { user: match, failed: false };
  }
  // Ran out of pages without a match: report "not found" rather than an error.
  // The caller degrades to a generic sign-in message either way.
  return { user: null, failed: false };
}

authRoutes.post('/check-method', validateBody(checkMethodSchema), async (c) => {
  const body = getValidatedBody<z.infer<typeof checkMethodSchema>>(c);
  const admin = getSupabaseAdmin();

  try {
    const { user: match, failed } = await findUserByEmail(admin, body.email);
    if (failed || !match) return ok(c, { exists: false, providers: [], has_password: false });

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
