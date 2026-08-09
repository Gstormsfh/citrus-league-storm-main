// T15 architect Entry 13 (2026-08-09) — feature flags.
//
// Static-const boolean flags. Simplest possible mechanism per
// DESIGN_T15_practice_draft_mode.md §4: no env plumbing, no runtime
// config, no third-party feature-flag service. Flipping a flag is a
// git commit + deploy.
//
// Additional flags land here as they arrive. Keep this file thin
// and audit-friendly.

/**
 * MOCK / PRACTICE DRAFT MODE — Sleeper-gap 4 ("the ritual").
 *
 * When TRUE: users can start a throwaway "practice draft" league
 *   from the GM Office (or wherever the ratified button lands),
 *   with 1 human seat + 11 autopick opponents, marked with
 *   `settings.practice = true`, soft-deleted on leave.
 *
 * When FALSE (default): no practice-draft UI is rendered anywhere;
 *   any server-side createPracticeLeague call returns
 *   `error: 'feature_disabled'` as defense-in-depth.
 *
 * Flip gates:
 *   1. Architect ratification of docs/DESIGN_T15_practice_draft_mode.md.
 *   2. Post-TWELVE (KI-041 discipline — no new capacity during the
 *      12-day critical window).
 *   3. Garrett-manual flip (git commit) — no automatic rollout.
 */
export const FEATURE_PRACTICE_DRAFT = false;
