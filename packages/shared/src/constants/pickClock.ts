// Phase 4.5 chunk 10c-2 batch 3 C3 (2026-07-28) — pick-clock defaults.
//
// The pick-clock audit (PROJECT_PLAN.md Decision Log 2026-07-24 report;
// summary in Q6) found the number 90 appearing as an implicit fallback
// in five separate files across the engine, API server, and UI. Each
// site independently defaulted to 90 seconds when a league's
// `settings.pickTimeLimit` was missing or unset. This is a "spooky
// action at a distance" hazard: raising the default would require
// touching every site, and a mis-sync would produce a UI showing one
// value while the engine used another.
//
// Consolidated here. Every code path that needs the default now
// imports `DEFAULT_PICK_TIME_LIMIT_SECONDS` from `@citrus/shared`.
//
// ── Paired SQL-side default ─────────────────────────────────────────
//
// The RPC's SQL-side default lives in
// `supabase/migrations/20260722000000_staging_schema_alignment.sql` §B.9:
//
//   v_pick_time := COALESCE(
//     (v_settings ->> 'pickTimeLimit')::int,
//     90                                     -- <— intentional pair
//   );
//
// The `90` in the RPC's COALESCE is the intentional pair of this
// constant. Changing this constant WITHOUT changing the RPC (or vice
// versa) produces a UI/engine value divergent from the durable event
// deadline. **The two MUST change in lockstep**, and any migration
// that touches the RPC's COALESCE must also update this file (and
// note the pair in the migration header). See PROJECT_PLAN.md
// Decision Log 2026-07-28 "C3 pick-clock fallback consolidation"
// entry for the pairing rule.
//
// ── Range boundaries ────────────────────────────────────────────────
//
// UI dropdown range: 30..300 seconds (see DraftLobby.tsx <Select>
// options). API validation clamp: `z.number().int().min(30).max(300)`
// in `server/src/middleware/validate.ts:299`. These are the same
// bounds; the shared MIN/MAX constants below let both the API layer
// and the client mirror the range without a new value drifting.

/**
 * Default pick-clock duration in SECONDS when a league's
 * `settings.pickTimeLimit` is missing/unset. **Paired** with the
 * `COALESCE(..., 90)` in `submit_pick_v2` (§B.9) — change both in
 * lockstep or the engine/UI and the durable event deadline diverge.
 */
export const DEFAULT_PICK_TIME_LIMIT_SECONDS = 90;

/**
 * Minimum pick-clock duration in seconds. Matches the UI dropdown's
 * lowest option and the API validation clamp.
 */
export const MIN_PICK_TIME_LIMIT_SECONDS = 30;

/**
 * Maximum pick-clock duration in seconds. Matches the UI dropdown's
 * highest option and the API validation clamp.
 */
export const MAX_PICK_TIME_LIMIT_SECONDS = 300;

/**
 * The +1 second pad the RPC adds to every deadline computation (see
 * `submit_pick_v2` §B.9 line 2230: `+ interval '1 second'`). Engine
 * mirrors this in `lookupLobbyConfig` (`server/src/draft/index.ts`)
 * where `pickClockSeconds = pickTimeLimit + PICK_CLOCK_PAD_SECONDS`.
 * Documented for future engineers who need to explain the "why is
 * the timer 91 s when settings say 90 s?" question.
 */
export const PICK_CLOCK_PAD_SECONDS = 1;
