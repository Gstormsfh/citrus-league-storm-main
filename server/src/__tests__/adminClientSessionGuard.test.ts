import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ADMIN-SESSION POISONING guard (2026-09-09).
 *
 * The shared service-role client must never be able to acquire a user
 * session: on TestFlight night the signup route signed a new user in on the
 * singleton and every admin query from that Cloud Run instance then ran as
 * that user under RLS. These tests pin (1) the singleton refuses every
 * session-mutating auth call, (2) per-request service clients are distinct
 * objects, and (3) the signup route source no longer touches the singleton's
 * sign-in.
 */
describe('admin client session guard', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  });

  it('refuses signInWithPassword and setSession on the shared admin client', async () => {
    const { getSupabaseAdmin } = await import('../lib/supabase');
    const admin = getSupabaseAdmin();
    expect(() =>
      admin.auth.signInWithPassword({ email: 'a@b.c', password: 'x'.repeat(8) }),
    ).toThrow(/forbidden on the shared service-role client/);
    expect(() =>
      admin.auth.setSession({ access_token: 'a', refresh_token: 'b' }),
    ).toThrow(/forbidden on the shared service-role client/);
    // The guard is not overwritable by a later assignment either.
    expect(() => {
      (admin.auth as unknown as Record<string, unknown>).signInWithPassword = () => null;
    }).toThrow();
  });

  it('createServiceClient returns a fresh client each call, distinct from the singleton', async () => {
    const { getSupabaseAdmin, createServiceClient } = await import('../lib/supabase');
    const a = createServiceClient();
    const b = createServiceClient();
    expect(a).not.toBe(b);
    expect(a).not.toBe(getSupabaseAdmin());
    expect(typeof a.auth.signInWithPassword).toBe('function');
  });

  it('signup route signs the new user in on a per-request client, not the singleton', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/auth.ts'), 'utf8');
    expect(src).not.toMatch(/admin\.auth\.signInWithPassword/);
    expect(src).toMatch(/createServiceClient\(\)\.auth\.signInWithPassword/);
  });
});
