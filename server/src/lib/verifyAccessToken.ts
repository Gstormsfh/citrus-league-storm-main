/**
 * PICK-LATENCY (2026-08-12) — local verification of Supabase access tokens.
 *
 * WHY THIS EXISTS
 * ---------------
 * `authMiddleware` called `supabase.auth.getUser(token)` on EVERY request.
 * That is an HTTPS round trip to GoTrue before any real work begins — and the
 * topology makes it expensive: Cloud Run `citrus-api` runs in us-central1
 * (Iowa) while both Supabase projects live in ca-central-1 (Montreal). Every
 * request therefore crossed ~1,500 km just to answer "who is this?", a
 * question the token already answers cryptographically.
 *
 * This is not a new idea in this codebase. `lib/draftToken.ts` already says it
 * outright: *"Verification is a local HMAC check (no Supabase round-trip),
 * which is what makes chunk 11g.2's WebSocket-upgrade fast-path possible."*
 * The WebSocket upgrade path has been doing this since July. The HTTP API
 * simply never adopted it.
 *
 * SAFETY POSTURE — WHY THIS CANNOT LOCK ANYONE OUT
 * ------------------------------------------------
 * The fast path can only ever SUCCEED faster. Every failure mode — no secret
 * configured, wrong secret, an algorithm we do not handle, a malformed token,
 * a bad signature, an expired token — returns a typed miss and the caller
 * falls back to the existing `getUser()` path with its F15 error taxonomy
 * completely intact. A misconfigured `SUPABASE_JWT_SECRET` costs latency, not
 * availability. That asymmetry is deliberate and is what makes this safe to
 * ship days before a freeze.
 *
 * THE SECURITY TRAP THIS AVOIDS
 * -----------------------------
 * Supabase's ANON KEY is itself a JWT signed with the SAME secret. Verifying
 * the signature alone would therefore accept the publishable anon key as
 * proof of identity — with no `sub` at all. `role === 'authenticated'` plus a
 * present, well-formed `sub` is what separates a real user session from the
 * public key that ships in the client bundle. Do not relax either check.
 */

import { verify } from 'hono/utils/jwt/jwt';

/** Claims we rely on. Supabase access tokens carry many more; we ignore them. */
interface SupabaseAccessTokenClaims {
  sub?: unknown;
  role?: unknown;
  exp?: unknown;
  iss?: unknown;
}

export type LocalVerifyResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      /**
       * Why the fast path did not apply. Every value here means "fall back to
       * getUser()" — none of them should be surfaced to the client, because
       * the fallback produces the authoritative answer.
       */
      reason:
        | 'no_secret'
        | 'unsupported_alg'
        | 'malformed'
        | 'verify_failed'
        | 'not_an_authenticated_user';
    };

/**
 * Type predicate for the miss branch.
 *
 * Mirrors `isSubmitPickFailure` in the web app for the same reason recorded
 * there: TypeScript's narrowing on the `ok` discriminant is inconsistent
 * inside Vitest `it` closures (it works fine in application code). A
 * predicate gives every consumer clean narrowing regardless of context.
 */
export function isLocalVerifyMiss(
  r: LocalVerifyResult,
): r is Extract<LocalVerifyResult, { ok: false }> {
  return r.ok === false;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSecret(): string | null {
  const s = process.env.SUPABASE_JWT_SECRET;
  return s && s.length > 0 ? s : null;
}

/**
 * Read the `alg` from a JWT header WITHOUT verifying anything.
 *
 * This is untrusted input used only to decide whether we can take the fast
 * path — never to make an auth decision. Newer Supabase projects can issue
 * asymmetric (ES256/RS256) tokens via signing keys; those are not HMAC-
 * verifiable with the shared secret, so we decline and let `getUser()` handle
 * them rather than guessing.
 */
function readAlgUnsafe(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const header = JSON.parse(
      Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'),
    ) as { alg?: unknown };
    return typeof header.alg === 'string' ? header.alg : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Supabase access token locally. No network.
 *
 * Returns the user id on success. On ANY failure the caller must fall back to
 * `supabase.auth.getUser(token)` — see the safety posture note above.
 */
export async function verifyAccessTokenLocally(
  token: string,
): Promise<LocalVerifyResult> {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: 'no_secret' };

  const alg = readAlgUnsafe(token);
  if (alg === null) return { ok: false, reason: 'malformed' };
  // Only the shared-secret algorithm. Asymmetric tokens fall back.
  if (alg !== 'HS256') return { ok: false, reason: 'unsupported_alg' };

  let payload: SupabaseAccessTokenClaims;
  try {
    // hono's verify checks the signature AND the exp/nbf claims, throwing
    // JwtTokenExpired / JwtTokenSignatureMismatched / JwtTokenInvalid.
    payload = (await verify(token, secret, 'HS256')) as SupabaseAccessTokenClaims;
  } catch {
    // Deliberately not distinguishing expired from forged here. Both fall
    // back, and getUser() produces the answer the F15 taxonomy expects.
    return { ok: false, reason: 'verify_failed' };
  }

  // ── The anon-key guard. See the header comment. ──────────────────────
  if (payload.role !== 'authenticated') {
    return { ok: false, reason: 'not_an_authenticated_user' };
  }
  const sub = payload.sub;
  if (typeof sub !== 'string' || !UUID_RE.test(sub)) {
    return { ok: false, reason: 'not_an_authenticated_user' };
  }

  return { ok: true, userId: sub };
}
