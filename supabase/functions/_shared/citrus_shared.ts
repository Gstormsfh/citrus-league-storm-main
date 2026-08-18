// Re-export Citrus shared utilities for Deno-runtime consumers
// (Supabase Edge Functions). Imports from `./_vendored/` — verbatim
// copies of the canonical files in `packages/shared/`.
//
// HISTORICAL CONTEXT (KI-007):
// The original chunk 11b shim re-exported directly from
// `../../../packages/shared/src/...` — relative paths traversing OUT
// of the supabase/ tree. The chunk 11b smoke deploy succeeded with
// that pattern (one constant), but chunk 11d's expanded imports
// (scoring.ts, season.ts, draftHash.ts, autopickConstants.ts)
// triggered a Supabase CLI bundler bug on Windows: the bundler
// resolves relative paths Unix-style and fails on Windows hosts when
// the path crosses out of supabase/. Vendoring keeps every Edge
// Function import inside the supabase/ tree.
//
// MAINTENANCE: the vendored files in _shared/_vendored/ MUST stay
// in sync with packages/shared/. Phase 7 adds a CI check that diffs
// canonical vs vendored bodies (ignoring sync-on-change headers) and
// fails on drift. Until that CI check lands, vigilance is the only
// safeguard — see KI-007 verification protocol.

export {
  ScoringCalculator,
  DEFAULT_SCORING,
  type ScoringSettings,
} from './_vendored/scoring.ts';

export {
  computePickPayloadHash,
  canonicalJson,
  sha256Hex,
  type PickHashInput,
} from './_vendored/draftHash.ts';

export { AUTOPICK_NAMESPACE_UUID } from './_vendored/autopickConstants.ts';

export { CURRENT_SEASON } from './_vendored/season.ts';
