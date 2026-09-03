// Feature flags. Static-const booleans, per DESIGN_T15_practice_draft_mode.md
// §4: no env plumbing, no runtime config, no third-party flag service.
// Flipping a flag is a git commit + deploy.
//
// Keep this file thin and audit-friendly, and keep every flag's comment
// honest about WHO READS IT. A flag nobody reads is a claim, not a switch:
// the first flag below sat at `false` from 2026-08-09 with zero consumers,
// under a comment that described a server-side mode nobody had written.
// `lib/__tests__/featureFlags.test.ts` now pins the consumer list.

/**
 * PRACTICE DRAFT ENTRY ON LEAGUE HQ (Sleeper-gap 4, "the ritual").
 *
 * WHAT IT GATES (the only consumer, 2026-09-03):
 *   apps/web/src/pages/LeagueDashboard.tsx renders, inside the Draft Room
 *   card and only while `draft_status === 'not_started'`, a ghost
 *   "Run a mock draft" entry to /armchair-gm?tab=mockdraft: the Mock Draft
 *   Simulator (components/armchair-gm/MockDraftSimulator.tsx). That surface
 *   is React state only. It reads the player list and writes nothing, so a
 *   practice pick can never reach a real league, a real draft, standings,
 *   or a notification. The entry is a tertiary ghost under the real Draft
 *   Room action, never a second orange verb (DESIGN_DIRECTION.md rule 3).
 *
 * WHAT IT DOES NOT GATE:
 *   The T15 throwaway-league practice mode (a real `leagues` row carrying
 *   `settings.practice = true`, ignited through start_draft_v2, eleven
 *   autopick seats, soft-delete on leave) is DESIGN ONLY. No
 *   createPracticeLeague service, no route, no client wrapper, no
 *   aggregation-query guardrail and no janitor exist in this repo
 *   (DESIGN_T15 §6, "Files NOT authored yet"). Flipping this flag cannot
 *   turn that mode on. The test named above trips the moment such a
 *   service appears, so this flag's contract is re-read before its blast
 *   radius grows from zero DB writes to real league rows. That mode also
 *   still owes the §5 nine-bar ratification the architect deferred to
 *   post-twelve (docs/ARCHITECT_INBOX.md, Entry 17).
 *
 * Flip history:
 *   2026-08-09  false. Architect Entry 13: UI location deferred to the
 *               Sunday walk. No later inbox entry names one, and no
 *               consumer ever landed.
 *   2026-09-03  true. Launch: the ritual is on, pointed at the simulator.
 *               A one-line revert here hides the HQ entry again.
 */
export const FEATURE_PRACTICE_DRAFT = true;
