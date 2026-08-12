/**
 * PICK-LATENCY (2026-08-12) — tests for local access-token verification.
 *
 * Two things are under test and only one of them is performance:
 *
 *   1. The fast path accepts exactly the tokens `getUser()` would accept.
 *   2. It rejects the ones a naive "just check the signature" version would
 *      have WRONGLY accepted — above all the Supabase ANON KEY, which is a
 *      JWT signed with the very same secret and ships publicly in the client
 *      bundle. That test is the reason this file exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sign } from 'hono/utils/jwt/jwt';
import {
  verifyAccessTokenLocally,
  isLocalVerifyMiss,
} from '../lib/verifyAccessToken';

const SECRET = 'test-jwt-secret-do-not-use-in-prod-must-be-long-enough';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function future(seconds = 3600) {
  return Math.floor(Date.now() / 1000) + seconds;
}
function past(seconds = 3600) {
  return Math.floor(Date.now() / 1000) - seconds;
}

async function token(payload: Record<string, unknown>, secret = SECRET) {
  return sign(payload, secret, 'HS256');
}

/** A realistic Supabase access token. */
async function userToken(over: Record<string, unknown> = {}) {
  return token({
    sub: USER_ID,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'https://jjgspcpvqaiitloglxbb.supabase.co/auth/v1',
    exp: future(),
    iat: Math.floor(Date.now() / 1000),
    email: 'garrett@example.com',
    is_anonymous: false,
    ...over,
  });
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.SUPABASE_JWT_SECRET;
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterEach(() => {
  if (original === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = original;
});

describe('verifyAccessTokenLocally — the happy path', () => {
  it('accepts a valid authenticated access token and returns the user id', async () => {
    const r = await verifyAccessTokenLocally(await userToken());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe(USER_ID);
  });

  it('accepts an anonymous-sign-in user (is_anonymous: true)', async () => {
    // getUser() accepts these today. The fast path must not quietly
    // tighten auth semantics — that would be a behaviour change wearing a
    // performance change's clothes.
    const r = await verifyAccessTokenLocally(
      await userToken({ is_anonymous: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('makes no network call — proven by there being no fetch to make', async () => {
    // If this ever regresses to calling GoTrue, the whole point is lost.
    // Blowing up global fetch is the bluntest possible detector.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('verifyAccessTokenLocally must not touch the network');
    }) as unknown as typeof fetch;
    try {
      const r = await verifyAccessTokenLocally(await userToken());
      expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('verifyAccessTokenLocally — THE SECURITY CASE', () => {
  it('REJECTS the Supabase anon key, which is signed with the same secret', async () => {
    // This is the trap. The publishable anon key is a real, correctly
    // signed JWT that anyone can read out of the client bundle. Signature
    // verification ALONE would accept it. It has role 'anon' and no sub.
    const anonKey = await token({
      iss: 'supabase',
      ref: 'jjgspcpvqaiitloglxbb',
      role: 'anon',
      iat: Math.floor(Date.now() / 1000),
      exp: future(60 * 60 * 24 * 365 * 10),
    });

    const r = await verifyAccessTokenLocally(anonKey);
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS role "anon" EVEN WHEN the token carries a valid sub', async () => {
    // Added after a mutation test survived: deleting the role check broke
    // NO test, because the anon-key fixture above has no `sub` and the sub
    // validation was silently doing all the work. This isolates the role
    // guard so it is actually load-bearing in the suite, not just in the
    // source.
    const r = await verifyAccessTokenLocally(
      await token({ sub: USER_ID, role: 'anon', exp: future() }),
    );
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS role "service_role" EVEN WHEN the token carries a valid sub', async () => {
    const r = await verifyAccessTokenLocally(
      await token({ sub: USER_ID, role: 'service_role', exp: future() }),
    );
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS a token with NO role claim at all', async () => {
    const r = await verifyAccessTokenLocally(
      await token({ sub: USER_ID, exp: future() }),
    );
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS a service_role key', async () => {
    const serviceKey = await token({
      iss: 'supabase',
      ref: 'jjgspcpvqaiitloglxbb',
      role: 'service_role',
      exp: future(60 * 60 * 24 * 365 * 10),
    });
    const r = await verifyAccessTokenLocally(serviceKey);
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS a correctly-signed token whose sub is not a UUID', async () => {
    const r = await verifyAccessTokenLocally(
      await userToken({ sub: 'admin' }),
    );
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('not_an_authenticated_user');
  });

  it('REJECTS a correctly-signed token with no sub at all', async () => {
    const r = await verifyAccessTokenLocally(await userToken({ sub: undefined }));
    expect(r.ok).toBe(false);
  });

  it('REJECTS a token signed with a DIFFERENT secret', async () => {
    const forged = await token(
      { sub: USER_ID, role: 'authenticated', exp: future() },
      'a-completely-different-secret-that-is-also-long-enough',
    );
    const r = await verifyAccessTokenLocally(forged);
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('verify_failed');
  });
});

describe('verifyAccessTokenLocally — every miss must fall back, never reject', () => {
  // The contract the middleware depends on: a miss is "I could not tell",
  // never "this user is invalid". getUser() gets the final word.

  it('expired token → miss', async () => {
    const r = await verifyAccessTokenLocally(
      await userToken({ exp: past(), iat: past(7200) }),
    );
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('verify_failed');
  });

  it('no secret configured → miss (never a rejection)', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const r = await verifyAccessTokenLocally(await userToken());
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('no_secret');
  });

  it('empty secret → miss', async () => {
    process.env.SUPABASE_JWT_SECRET = '';
    const r = await verifyAccessTokenLocally(await userToken());
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('no_secret');
  });

  it('asymmetric token (ES256) → miss, so signing-key projects still work', async () => {
    // Newer Supabase projects can issue ES256/RS256 via signing keys. We
    // cannot HMAC-verify those, so we decline rather than guess.
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'abc' }),
    ).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: future() }),
    ).toString('base64url');
    const r = await verifyAccessTokenLocally(`${header}.${body}.notarealsig`);
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('unsupported_alg');
  });

  it('garbage input → miss, no throw', async () => {
    for (const junk of ['', 'nodots', '...', 'a.b', '!!!.???.***']) {
      const r = await verifyAccessTokenLocally(junk);
      expect(r.ok).toBe(false);
    }
  });

  it('the "alg: none" downgrade attempt → miss', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: future() }),
    ).toString('base64url');
    const r = await verifyAccessTokenLocally(`${header}.${body}.`);
    expect(r.ok).toBe(false);
    if (isLocalVerifyMiss(r)) expect(r.reason).toBe('unsupported_alg');
  });
});
