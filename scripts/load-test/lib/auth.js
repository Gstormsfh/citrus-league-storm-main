// Supabase auth helper for k6 load tests.
//
// Signs in a test user against Supabase and returns a JWT that can be
// used against the API. Called from the init function in each scenario
// so every virtual user gets its own token from a pool of test accounts.

import http from 'k6/http';
import { check } from 'k6';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_ACCOUNTS } from './config.js';

/**
 * Sign in a test user and return { token, userId }.
 * Picks a deterministic account based on VU number so the same VU
 * uses the same account across iterations (mirrors real user behavior).
 */
export function signInAsTestUser(vuNumber) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Auth scenarios require SUPABASE_URL and SUPABASE_ANON_KEY env vars. ' +
      'See scripts/load-test/README.md §Setup.'
    );
  }
  if (TEST_ACCOUNTS.length === 0) {
    throw new Error(
      'No test accounts provisioned. See scripts/load-test/README.md ' +
      '§Provisioning test accounts.'
    );
  }

  // Round-robin across the test pool. VU 1 → account 0, VU 2 → account 1, etc.
  const account = TEST_ACCOUNTS[(vuNumber - 1) % TEST_ACCOUNTS.length];

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: account.email, password: account.password }),
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'auth_signin' },
    },
  );

  const ok = check(res, {
    'sign-in returned 200': (r) => r.status === 200,
    'sign-in returned a token': (r) => {
      try {
        return !!JSON.parse(r.body).access_token;
      } catch {
        return false;
      }
    },
  });

  if (!ok) {
    throw new Error(
      `Sign-in failed for ${account.email}: ${res.status} ${res.body}`,
    );
  }

  const body = JSON.parse(res.body);
  return {
    token: body.access_token,
    userId: body.user.id,
    email: account.email,
  };
}

/**
 * Build the headers object for an authenticated API request.
 */
export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
