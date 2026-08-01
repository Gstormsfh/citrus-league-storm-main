import { describe, it, expect } from 'vitest';
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';

// F19 amendment 3 (architect ruling 2026-07-31):
//
// UN-STUBBED CONTRACT TEST. Every other F19 test mocks
// `supabase.auth.refreshSession()` to resolve with an error object.
// That mock encodes the assumption the fix depends on — but does not
// VERIFY it. F19 existed precisely because the author's model of
// supabase-js's error-delivery behavior was wrong (they assumed `.then`
// would not run on network failure; it does). Replacing one unverified
// assumption with another unverified assumption leaves the epistemics
// that caused the bug fully intact.
//
// This test hits the REAL supabase-js client, pointed at an
// unresolvable hostname (`.invalid` per RFC 6761 §6.4 — guaranteed
// not to resolve). Asserts that `auth.refreshSession()` RESOLVES WITH
// AN ERROR rather than rejects. If supabase-js ever changes to reject
// on network failure, this test fails immediately and we know to
// revisit `refreshTokenOnce`'s .then/.catch discrimination.
//
// Hermetic — no real network needed, invalid hostname fails DNS
// resolution near-instantly.

describe('supabase-js auth client — network-failure contract', () => {
  it('signInWithPassword() RESOLVES with an error (does not reject) when the auth endpoint is unreachable', async () => {
    // Use signInWithPassword rather than refreshSession because
    // refreshSession short-circuits with AuthSessionMissingError when
    // there is no in-memory session — which prevents exercising the
    // actual network path. signInWithPassword unconditionally hits the
    // network. The library-level contract we care about ("network
    // failures resolve rather than reject") is the same for both.
    const client = createClient(
      'https://citrus-f19-contract-test.invalid',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.stub',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    let resolvedNormally = false;
    let threwOrRejected = false;
    let result: Awaited<ReturnType<typeof client.auth.signInWithPassword>> | null = null;

    try {
      result = await client.auth.signInWithPassword({
        email: 'nonexistent@example.invalid',
        password: 'irrelevant',
      });
      resolvedNormally = true;
    } catch {
      threwOrRejected = true;
    }

    // THE CONTRACT: network failure must resolve-with-error, not reject.
    // If this ever flips to reject, `refreshTokenOnce`'s .then branch
    // stops seeing the error and the .catch branch (which never signs
    // out per amendment 4) takes over — that's still safe, but the
    // discrimination logic in .then becomes dead code and needs to
    // move to .catch. This test forces us to notice.
    expect(threwOrRejected).toBe(false);
    expect(resolvedNormally).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.data.session).toBeNull();
    expect(result!.error).toBeTruthy();

    // Type-erase to inspect .name — the type guard narrows to `never`
    // in the negative branch on some TS configs.
    const errShape = result!.error as { name?: string; message?: string } | null;
    // The expected error class is AuthRetryableFetchError. Log if it
    // ever isn't so a version bump surfaces immediately.
    if (!isAuthRetryableFetchError(result!.error)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[F19 contract] signInWithPassword() returned error.name=${errShape?.name} — expected AuthRetryableFetchError. ` +
          `Verify refreshTokenOnce discrimination still covers this shape.`,
      );
    }
    expect(isAuthRetryableFetchError(result!.error)).toBe(true);

    // Timeout 45s: supabase-js retries fetch internally with backoff
    // (~3 retries visible in stderr, ~25s total). Slow-but-hermetic is
    // fine for a contract test that runs once per CI run; the
    // alternative is faking timers through supabase-js internals,
    // which is brittle.
  }, 45_000);
});
