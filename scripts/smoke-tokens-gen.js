#!/usr/bin/env node
// Phase 4.5 chunk 11g.10 sub-step 10b — smoke-test token generator.
//
// Generates the three JWTs the chunk 11g.2-step-2 smoke harness
// (scripts/smoke-uws-step2.js) needs:
//
//   TOKEN_VALID_A      — valid draft JWT for lobby-A (signed with the
//                        real SUPABASE_JWT_SECRET).
//   TOKEN_VALID_B      — valid draft JWT for lobby-B (also real-signed).
//   TOKEN_WRONG_SECRET — valid-shape JWT for lobby-A but signed with a
//                        DIFFERENT secret (so the engine should reject
//                        with 401).
//
// Usage:
//   SUPABASE_JWT_SECRET='...' node scripts/smoke-tokens-gen.js
//
// Outputs three `export VAR=value` lines on stdout, ready to source:
//   eval "$(SUPABASE_JWT_SECRET='...' node scripts/smoke-tokens-gen.js)"
//   node scripts/smoke-uws-step2.js
//
// Token payload shape mirrors `issueDraftToken` from
// server/src/draft/tokens.ts (chunk 11g.1 + 11g.2-step-2):
//   { sub: userId, draftId: leagueId, leagueId, iat, exp, iss, aud }
//
// Expiry: 5 minutes from issuance (matches draft-token convention).

import crypto from 'node:crypto';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!SUPABASE_JWT_SECRET) {
  console.error('FATAL: SUPABASE_JWT_SECRET is required');
  process.exit(2);
}

// Test user + lobby IDs — fixed so the harness can be re-run idempotently.
const TEST_USER_ID = process.env.SMOKE_TEST_USER_ID || '00000000-0000-0000-0000-000000000001';
const LOBBY_A = process.env.SMOKE_LOBBY_A || 'lobby-A';
const LOBBY_B = process.env.SMOKE_LOBBY_B || 'lobby-B';
const WRONG_SECRET = process.env.SMOKE_WRONG_SECRET || 'not-the-real-secret-deliberately-different';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  const encodedSignature = base64url(signature);
  return `${signingInput}.${encodedSignature}`;
}

function buildPayload(lobbyId) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: TEST_USER_ID,
    draftId: lobbyId,
    leagueId: lobbyId,
    iat: now,
    exp: now + 5 * 60, // 5 minutes
    iss: 'citrus-discovery',
    aud: 'citrus-draft-engine',
  };
}

const tokenValidA = signJwt(buildPayload(LOBBY_A), SUPABASE_JWT_SECRET);
const tokenValidB = signJwt(buildPayload(LOBBY_B), SUPABASE_JWT_SECRET);
const tokenWrongSecret = signJwt(buildPayload(LOBBY_A), WRONG_SECRET);

console.log(`export TOKEN_VALID_A='${tokenValidA}'`);
console.log(`export TOKEN_VALID_B='${tokenValidB}'`);
console.log(`export TOKEN_WRONG_SECRET='${tokenWrongSecret}'`);
