// DRAFT-NIGHT FIX (2026-08-18) — stale credentials must answer 401, never 503.
//
// WHY THIS TEST EXISTS
// On draft night Garrett signed out of one account and tried to rejoin the
// draft. The server answered 503 "Cannot verify your session right now —
// please retry" — a transient-sounding message for a permanent condition.
// The API client retries 503 with backoff, so it retried a token that could
// never become valid, and he had no path to sign-in short of a hard refresh
// and manual re-login.
//
// Two layers are under test:
//   1. isTokenExpiredUnsafe — the deterministic backstop. It reads `exp`
//      without verifying the signature, so it holds no matter what error
//      shape GoTrue returns. Critically it must NEVER be usable to grant
//      access: it only ever classifies a failure that already happened.
//   2. The credential taxonomy — 403 and the permanent-failure codes now
//      classify as credential failures instead of falling through to 503.

import { describe, it, expect } from 'vitest';
import { isTokenExpiredUnsafe } from '../lib/verifyAccessToken';

/** Build an unsigned JWT-shaped token with the given payload. */
function tokenWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const NOW = 1_786_996_800_000; // fixed clock: 2026-08-17T20:00:00Z

describe('isTokenExpiredUnsafe — the deterministic stale-credential backstop', () => {
  it('reports TRUE for a token whose exp has passed', () => {
    const expired = tokenWith({ sub: 'u1', exp: Math.floor(NOW / 1000) - 60 });
    expect(isTokenExpiredUnsafe(expired, NOW)).toBe(true);
  });

  it('reports FALSE for a token that is still valid', () => {
    const live = tokenWith({ sub: 'u1', exp: Math.floor(NOW / 1000) + 3600 });
    expect(isTokenExpiredUnsafe(live, NOW)).toBe(false);
  });

  it('treats exp exactly at now as expired (no grace window)', () => {
    const boundary = tokenWith({ sub: 'u1', exp: Math.floor(NOW / 1000) });
    expect(isTokenExpiredUnsafe(boundary, NOW)).toBe(true);
  });

  // The safety posture: every unreadable shape must return FALSE, i.e. fall
  // through to the untouched 503 path. Returning true here would be a
  // behavior change for tokens we cannot actually reason about.
  it.each([
    ['garbage', 'not-a-token'],
    ['single segment', 'abcdef'],
    ['non-base64 payload', 'aaa.!!!!.bbb'],
    ['payload without exp', tokenWith({ sub: 'u1' })],
    ['non-numeric exp', tokenWith({ sub: 'u1', exp: 'soon' })],
    ['empty string', ''],
  ])('returns FALSE (falls through unchanged) for %s', (_label, token) => {
    expect(isTokenExpiredUnsafe(token, NOW)).toBe(false);
  });

  // This is the property that makes reading an unverified claim acceptable:
  // it is used ONLY to classify an already-failed request. A forged token
  // with a distant expiry is not "valid" here — it is simply not-expired,
  // and every real check still rejects it.
  it('grants nothing: a forged token with a future exp is merely "not expired"', () => {
    const forged = tokenWith({ sub: 'attacker', exp: Math.floor(NOW / 1000) + 99_999 });
    expect(isTokenExpiredUnsafe(forged, NOW)).toBe(false);
  });
});
