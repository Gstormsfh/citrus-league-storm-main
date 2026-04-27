// Re-export Citrus shared utilities for Deno-runtime consumers
// (Supabase Edge Functions). Single source of truth lives in
// `packages/shared/`; this shim avoids duplicating code in
// `supabase/functions/` while keeping the import path local
// (`../_shared/citrus_shared.ts`).
//
// IMPORTANT: keep this file as RE-EXPORTS ONLY. No re-implementations.
// If a shared util ever drifts between Node and Deno, the bug class is
// "different code paths produce different outputs" — the exact thing
// the @citrus/shared single-source-of-truth pattern exists to prevent.
//
// Bundling note: Supabase Edge Functions deploy via the Supabase CLI
// bundles all relative file imports, including those that traverse
// outside the `supabase/` directory. The relative paths below are
// resolved at deploy time, not at runtime.

export {
  ScoringCalculator,
  DEFAULT_SCORING,
  type ScoringSettings,
} from '../../../packages/shared/src/utils/scoring.ts';

export {
  computePickPayloadHash,
  canonicalJson,
  sha256Hex,
  type PickHashInput,
} from '../../../packages/shared/src/utils/draftHash.ts';

export { AUTOPICK_NAMESPACE_UUID } from '../../../packages/shared/src/constants/autopickConstants.ts';
