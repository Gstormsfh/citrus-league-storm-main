// ── VENDORED COPY — SYNC ON CHANGE ──────────────────────────────────────
// Canonical source: packages/shared/src/constants/autopickConstants.ts
//
// This file is a verbatim copy of the canonical source, vendored into
// supabase/functions/_shared/_vendored/ so the Supabase CLI bundler can
// resolve it on Windows. See KI-007.
//
// MAINTENANCE: when packages/shared/src/constants/autopickConstants.ts
// changes, this file MUST be updated to match. The
// AUTOPICK_NAMESPACE_UUID in particular is NEVER CHANGE — drift between
// canonical and vendored copies would produce different idempotency
// keys for the same logical pick across runtimes, causing spurious
// idempotency_conflict errors. Phase 7 CI check enforces parity.
// ────────────────────────────────────────────────────────────────────────

/**
 * AUTOPICK_NAMESPACE_UUID — NEVER CHANGE.
 *
 * UUIDv5 namespace for the Phase 4 autopick worker's idempotency-key
 * derivation. The worker computes:
 *
 *   uuid_v5(
 *     AUTOPICK_NAMESPACE_UUID,
 *     `${league_id}|${pick_number}|${generation}|autopick`
 *   )
 *
 * and passes that as `p_idempotency_key` to `submit_pick_v2`. The
 * namespace + name combination must produce a stable, globally-unique
 * UUID for every (league, pick, generation) tuple — that's what makes
 * the autopick path idempotent under pgmq redelivery.
 *
 * **If this value ever changes**, every in-flight pgmq message
 * becomes partially-broken: pre-change messages reference one key,
 * post-change messages reference another, and the same logical pick
 * could be committed twice (once under each key). The unique index
 * on `draft_events.idempotency_key` would then surface as spurious
 * `idempotency_conflict` errors for picks the client believed were
 * new.
 *
 * Generated 2026-04-27 via `node -e 'console.log(crypto.randomUUID())'`.
 * Locked permanently.
 *
 * If a future phase needs a different namespace (e.g., for a
 * separate worker class or v3 migration), introduce a NEW named
 * constant — do not modify this one.
 */
export const AUTOPICK_NAMESPACE_UUID =
  '388b7e84-2c31-454e-ab0c-6d3b7da13282';
