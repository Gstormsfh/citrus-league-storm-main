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
      // Map common Supabase admin errors to user-friendly messages
      if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
        return fail(c, AppError.badRequest('This email already has an account. Please sign in instead.'));
      }
      return fail(c, AppError.badRequest(error.message || 'Signup failed'));
    }

    return created(c, { user: { id: data.user.id, email: data.user.email } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed';
    return fail(c, AppError.badRequest(message));
  }
});

export { authRoutes };
