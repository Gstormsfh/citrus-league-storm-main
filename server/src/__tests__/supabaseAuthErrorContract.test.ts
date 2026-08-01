import { describe, it, expect } from 'vitest';
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';

// F15 amendment 3 (architect ruling 2026-07-31):
//
// UN-STUBBED CONTRACT TEST. Every other F15 test mocks supabase-js's
// `getUser` to resolve with an error object. That mock encodes the
// assumption the fix depends on — but does not VERIFY it. F19 existed
// precisely because the author's model of supabase-js's error-delivery
// behavior was wrong (they assumed `.then` would not run on network
// failure; it does). Replacing one unverified assumption with another
// unverified assumption leaves the epistemics that caused the bug fully
// intact.
//
// This test hits the REAL supabase-js client, pointed at an unresolvable
// hostname (`.invalid` per RFC 6761 §6.4 — guaranteed to not resolve).
// Asserts that `auth.getUser()` RESOLVES WITH AN ERROR rather than
// rejects. If supabase-js ever changes to reject on network failure,
// this test fails immediately and we know to revisit the auth
// middleware's try/catch discrimination.
//
// Hermetic — no real network needed, invalid hostname fails DNS
// resolution near-instantly.

describe('supabase-js auth.getUser() — network-failure contract', () => {
  it('RESOLVES with an error (does not reject) when the auth endpoint is unreachable', async () => {
    // .invalid TLD is reserved by RFC 6761 §6.4 for "not intended to
    // resolve". DNS resolution fails deterministically without any
    // real network activity.
    const client = createClient(
      'https://citrus-f15-contract-test.invalid',
      // Anon key doesn't need to be valid — we never reach the endpoint.
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.stub',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    let resolvedNormally = false;
    let threwOrRejected = false;
    let result: Awaited<ReturnType<typeof client.auth.getUser>> | null = null;

    try {
      result = await client.auth.getUser('any-token-value');
      resolvedNormally = true;
    } catch {
      threwOrRejected = true;
    }

    expect(threwOrRejected).toBe(false);
    expect(resolvedNormally).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.data.user).toBeNull();
    expect(result!.error).toBeTruthy();

    // Type-erase to inspect .name — the type guard narrows to `never`
    // in the negative branch on some TS configs, and we want to log the
    // actual class name if it isn't AuthRetryableFetchError.
    const err = result!.error as { name?: string; message?: string } | null;
    if (!isAuthRetryableFetchError(result!.error)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[F15 contract] getUser() returned error.name=${err?.name} — expected AuthRetryableFetchError. ` +
          `Verify auth.ts discrimination still covers this shape.`,
      );
    }
    // Assert the exact class we expect. If supabase-js ever changes
    // this, we want the test to fail (not warn silently) so the
    // discrimination in auth.ts gets revisited.
    expect(isAuthRetryableFetchError(result!.error)).toBe(true);
  }, 10_000);
});
