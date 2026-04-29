/**
 * Phase 4.5 chunk 11g.1 — draft-token helper unit tests.
 *
 * Covers issueDraftToken + verifyDraftToken roundtrip, plus every
 * typed-error variant. Pure unit tests — no Supabase, no network.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sign as honoSign } from 'hono/utils/jwt/jwt';
import type { DraftTokenError, VerifiedDraftToken } from '../lib/draftToken';

const TEST_SECRET = 'test-jwt-secret-do-not-use-in-prod-must-be-long-enough';

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
});

function expectError(
  result: VerifiedDraftToken | DraftTokenError,
): asserts result is DraftTokenError {
  if (result.ok) throw new Error('expected verifyDraftToken to fail; got ok=true');
}

function expectOk(
  result: VerifiedDraftToken | DraftTokenError,
): asserts result is VerifiedDraftToken {
  if (!result.ok) {
    const reason = (result as DraftTokenError).reason;
    throw new Error(`expected verifyDraftToken to succeed; got reason=${reason}`);
  }
}

describe('draftToken: issueDraftToken + verifyDraftToken', () => {
  const params = {
    userId: '11111111-1111-1111-1111-111111111111',
    draftId: '22222222-2222-2222-2222-222222222222',
    leagueId: '33333333-3333-3333-3333-333333333333',
  };

  it('roundtrips: issue → verify with matching draftId returns parsed claims', async () => {
    const { issueDraftToken, verifyDraftToken } = await import('../lib/draftToken');
    const token = await issueDraftToken(params);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const result = await verifyDraftToken(token, params.draftId);
    expectOk(result);
    expect(result.claims.sub).toBe(params.userId);
    expect(result.claims.draftId).toBe(params.draftId);
    expect(result.claims.leagueId).toBe(params.leagueId);
    expect(result.claims.exp).toBe(result.claims.iat + 300);
  });

  it('expiration set to iat + 300 seconds (5 minutes per spec)', async () => {
    const { issueDraftToken, DRAFT_TOKEN_TTL_SECONDS, verifyDraftToken } = await import('../lib/draftToken');
    expect(DRAFT_TOKEN_TTL_SECONDS).toBe(300);
    const token = await issueDraftToken(params);
    const result = await verifyDraftToken(token, params.draftId);
    expectOk(result);
    expect(result.claims.exp - result.claims.iat).toBe(300);
  });
});

describe('draftToken: typed error variants', () => {
  const params = {
    userId: '11111111-1111-1111-1111-111111111111',
    draftId: '22222222-2222-2222-2222-222222222222',
    leagueId: '33333333-3333-3333-3333-333333333333',
  };

  it('returns expired when token exp is in the past', async () => {
    const { verifyDraftToken } = await import('../lib/draftToken');
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expiredToken = await honoSign(
      { sub: params.userId, draftId: params.draftId, leagueId: params.leagueId, iat: past - 300, exp: past },
      TEST_SECRET,
      'HS256',
    );
    const result = await verifyDraftToken(expiredToken, params.draftId);
    expectError(result);
    expect(result.reason).toBe('expired');
  });

  it('returns invalid_signature when token signed with wrong secret', async () => {
    const { verifyDraftToken } = await import('../lib/draftToken');
    const now = Math.floor(Date.now() / 1000);
    const wrongSecretToken = await honoSign(
      { sub: params.userId, draftId: params.draftId, leagueId: params.leagueId, iat: now, exp: now + 300 },
      'a-different-secret-than-the-server-uses-also-long-enough',
      'HS256',
    );
    const result = await verifyDraftToken(wrongSecretToken, params.draftId);
    expectError(result);
    expect(result.reason).toBe('invalid_signature');
  });

  it('returns draft_mismatch when token issued for a different draft', async () => {
    const { issueDraftToken, verifyDraftToken } = await import('../lib/draftToken');
    const token = await issueDraftToken(params);
    const result = await verifyDraftToken(token, '99999999-9999-9999-9999-999999999999');
    expectError(result);
    expect(result.reason).toBe('draft_mismatch');
  });

  it('returns missing_claim when token lacks required claim', async () => {
    const { verifyDraftToken } = await import('../lib/draftToken');
    const now = Math.floor(Date.now() / 1000);
    // token without `leagueId`
    const incomplete = await honoSign(
      { sub: params.userId, draftId: params.draftId, iat: now, exp: now + 300 },
      TEST_SECRET,
      'HS256',
    );
    const result = await verifyDraftToken(incomplete, params.draftId);
    expectError(result);
    expect(result.reason).toBe('missing_claim');
    if (result.reason === 'missing_claim') {
      expect(result.claim).toBe('leagueId');
    }
  });

  it('returns malformed for garbage input', async () => {
    const { verifyDraftToken } = await import('../lib/draftToken');
    const result = await verifyDraftToken('not-a-jwt', params.draftId);
    expectError(result);
    expect(result.reason).toBe('malformed');
  });

  it('returns service_unavailable when SUPABASE_JWT_SECRET is unset', async () => {
    vi.resetModules();
    const original = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    try {
      const { verifyDraftToken } = await import('../lib/draftToken');
      const result = await verifyDraftToken('whatever', params.draftId);
      expectError(result);
      expect(result.reason).toBe('service_unavailable');
    } finally {
      process.env.SUPABASE_JWT_SECRET = original;
      vi.resetModules();
    }
  });

  it('issueDraftToken throws when SUPABASE_JWT_SECRET is unset', async () => {
    vi.resetModules();
    const original = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    try {
      const { issueDraftToken } = await import('../lib/draftToken');
      await expect(issueDraftToken({ userId: 'u', draftId: 'd', leagueId: 'l' })).rejects.toThrow(
        /SUPABASE_JWT_SECRET not configured/,
      );
    } finally {
      process.env.SUPABASE_JWT_SECRET = original;
      vi.resetModules();
    }
  });
});
