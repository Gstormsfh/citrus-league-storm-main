// ── VENDORED COPY — SYNC ON CHANGE ──────────────────────────────────────
// Canonical source: packages/shared/src/utils/draftHash.ts
//
// This file is a verbatim copy of the canonical source, vendored into
// supabase/functions/_shared/_vendored/ so the Supabase CLI bundler can
// resolve it on Windows. See KI-007.
//
// MAINTENANCE: when packages/shared/src/utils/draftHash.ts changes,
// this file MUST be updated to match. Drift would break the cross-
// runtime hash agreement between the v2 server pick path
// (server/src/services/DraftServiceV2.ts) and the Phase 4 autopick
// worker (this directory's index.ts), producing spurious
// idempotency_conflict errors. Phase 7 CI check enforces parity.
// ────────────────────────────────────────────────────────────────────────

/**
 * Draft Engine v2 — payload-hash utilities.
 *
 * SHARED across ALL callers that compute a `payload_hash` for the v2
 * RPCs (`submit_pick_v2`, `append_draft_event`, `record_shadow_event`).
 * Currently used by:
 *   - `server/src/services/DraftServiceV2.ts`  (user pick path).
 *   - `supabase/functions/draft-autopick/`     (Phase 4 worker).
 * Any future caller (Phase 8 shadow trigger wrapper, admin tooling)
 * MUST import from here so all callers produce identical hashes for
 * identical client intent.
 *
 * The RPCs themselves do NOT compute hashes — they accept
 * `p_payload_hash` as a parameter and use it only for idempotency
 * conflict detection (same key, different hash → reject). Therefore
 * this client-side canonicalization is the single source of truth.
 *
 * Spec §7.3: hash input shape for picks is exactly
 * `{pick_number, round, team_id, player_id}` — no league_id, no
 * actor_kind, no server-assigned fields (picked_at, is_autopick).
 *
 * Runtime portability: uses Web Crypto (`globalThis.crypto.subtle`)
 * which is available in Node 16+, Deno (Supabase Edge Functions),
 * and modern browsers. No `node:crypto` import; safe for any runtime.
 */

/**
 * Recursive sorted-key JSON serializer. No whitespace, no trailing
 * newline. Two values with identical logical content always produce
 * identical strings, regardless of source key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}

/**
 * SHA-256 of a string, returned as `'sha256:' + lowercase hex digest`.
 * Format matches the placeholder used by the lifecycle RPCs in
 * `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`
 * (`'sha256:server-generated'` for system-emitted events).
 *
 * Async: Web Crypto is async-only.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'sha256:' + hex;
}

/**
 * The pick-event payload-hash input shape per spec §7.3.
 * Extracted to a type so callers can be sure they're hashing the
 * right shape (TypeScript will enforce it). Field order does not
 * matter — `canonicalJson` sorts keys.
 */
export interface PickHashInput {
  pick_number: number;
  round:       number;
  team_id:     string;
  player_id:   number;
}

/**
 * Convenience wrapper: canonicalize the strict pick hash input and
 * SHA-256 it. The single function callers should use for picks.
 */
export async function computePickPayloadHash(
  input: PickHashInput,
): Promise<string> {
  return sha256Hex(canonicalJson(input));
}
