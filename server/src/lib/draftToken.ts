/**
 * Phase 4.5 chunk 11g.1 — Draft token issuance and verification.
 *
 * Issues short-lived JWTs scoped to a single draft. Used by the discovery
 * endpoint (`GET /api/drafts/:draftId/server`) to grant a client permission
 * to open the WebSocket connection to the draft engine in chunk 11g.2.
 *
 * Design decisions (locked at chunk 11g.1, do not deviate without an ADR):
 *
 * 1. **One auth surface.** Tokens are signed with `SUPABASE_JWT_SECRET` —
 *    the same secret Supabase uses to sign auth JWTs. Verification is a
 *    local HMAC check (no Supabase round-trip), which is what makes
 *    chunk 11g.2's WebSocket-upgrade fast-path possible. Don't introduce
 *    a separate `DRAFT_TOKEN_SECRET`; the user-facing auth surface stays
 *    single per ADR-001 § Decision.
 *
 * 2. **`draftId` is the canonical scope claim.** In Citrus's data model
 *    the "draft" is not a separate entity — it's the league's drafting
 *    phase, identified by `league_id` and tracked via the
 *    `leagues.draft_status` enum. The JWT's `draftId` claim is therefore
 *    the league's UUID. The "draftId" naming is preserved at the API
 *    surface (URL path and JWT claim) because it's more semantic for
 *    API consumers than "leagueId in drafting phase," but internally
 *    these are the same identifier. See `docs/DRAFT_ENGINE_V2_SPEC.md`
 *    §0 for the canonical model and `routes/drafts.ts` for the
 *    `draft_status`-gated lookup. Chunk 11g.2's WebSocket path is
 *    `/ws/draft/:draftId` for consistency.
 *
 * 3. **No `teamId` in the token.** A user may be a league member without
 *    owning a team yet (commissioner-only edge cases, pre-team-assignment
 *    flows). The on-clock check happens at pick-submission time using
 *    `(userId, draftId)` against the live state, not from the token.
 *
 * 4. **Token transport on WebSocket upgrade is `Sec-WebSocket-Protocol`.**
 *    Decided at 11g.1 so chunk 11g.2 doesn't re-litigate. Query-param
 *    transport leaks tokens into URLs (server logs, browser history,
 *    referrer headers) — exactly the leakage the LIVE_DRAFT_DISASTER
 *    postmortem warned about. Subprotocol header keeps it out of URLs
 *    and is the conventional browser-WebSocket token-on-connect pattern.
 *
 * 5. **5-minute expiration.** Per Zach's brief. The token only needs to
 *    survive the round-trip from discovery → WebSocket upgrade.
 */

import { sign, verify } from 'hono/utils/jwt/jwt';
import { JwtTokenExpired, JwtTokenInvalid, JwtTokenSignatureMismatched } from 'hono/utils/jwt/types';

export const DRAFT_TOKEN_TTL_SECONDS = 300;

export interface DraftTokenClaims {
  sub: string;       // userId
  draftId: string;
  leagueId: string;
  iat: number;
  exp: number;
}

export type DraftTokenError =
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'invalid_signature' }
  | { ok: false; reason: 'draft_mismatch' }
  | { ok: false; reason: 'missing_claim'; claim: keyof DraftTokenClaims }
  | { ok: false; reason: 'malformed' }
  | { ok: false; reason: 'service_unavailable' };

export type VerifiedDraftToken = { ok: true; claims: DraftTokenClaims };

function getSecret(): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/**
 * Sign a draft-scoped JWT. Returns the encoded token string.
 *
 * Throws if `SUPABASE_JWT_SECRET` is not set — discovery routes should
 * surface this as a 503 to the client and a structured error to logs.
 */
export async function issueDraftToken(params: {
  userId: string;
  draftId: string;
  leagueId: string;
}): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('issueDraftToken: SUPABASE_JWT_SECRET not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: DraftTokenClaims = {
    sub: params.userId,
    draftId: params.draftId,
    leagueId: params.leagueId,
    iat: now,
    exp: now + DRAFT_TOKEN_TTL_SECONDS,
  };
  // hono/utils/jwt's JWTPayload type requires an index signature; the cast
  // is safe because our claim shape is a strict subset of the JWT spec.
  return sign(payload as unknown as Record<string, unknown>, secret, 'HS256');
}

/**
 * Verify a draft token. Returns the parsed claims on success, or a typed
 * error variant on any failure mode. The `expectedDraftId` MUST match the
 * token's `draftId` claim — that's how we confirm a token issued for one
 * draft can't be replayed against another.
 */
export async function verifyDraftToken(
  token: string,
  expectedDraftId: string,
): Promise<VerifiedDraftToken | DraftTokenError> {
  const secret = getSecret();
  if (!secret) {
    return { ok: false, reason: 'service_unavailable' };
  }

  let decoded: unknown;
  try {
    decoded = await verify(token, secret, 'HS256');
  } catch (err: unknown) {
    if (err instanceof JwtTokenExpired) return { ok: false, reason: 'expired' };
    if (err instanceof JwtTokenSignatureMismatched) return { ok: false, reason: 'invalid_signature' };
    if (err instanceof JwtTokenInvalid) return { ok: false, reason: 'malformed' };
    return { ok: false, reason: 'malformed' };
  }

  if (!decoded || typeof decoded !== 'object') {
    return { ok: false, reason: 'malformed' };
  }
  const c = decoded as Partial<DraftTokenClaims>;
  for (const claim of ['sub', 'draftId', 'leagueId', 'iat', 'exp'] as const) {
    if (c[claim] === undefined || c[claim] === null) {
      return { ok: false, reason: 'missing_claim', claim };
    }
  }
  if (c.draftId !== expectedDraftId) {
    return { ok: false, reason: 'draft_mismatch' };
  }
  return { ok: true, claims: c as DraftTokenClaims };
}
