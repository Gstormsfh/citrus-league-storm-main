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
 * THE MOCK DRAFT ON LEAGUE HQ (Sleeper-gap 4, "the ritual").
 *
 * WHAT IT GATES (the only consumer):
 *   apps/web/src/pages/LeagueDashboard.tsx renders, inside the Draft Room
 *   card and only while `draft_status === 'not_started'`, a ghost
 *   "Run a mock draft" entry to /mock-draft?league=<id>. That page creates a
 *   throwaway league through POST /api/leagues/practice — a real `leagues`
 *   row carrying `settings.practice = true`, this league's size, rounds,
 *   roster slots and scoring, one human seat and AI in every other — and
 *   opens the live V2 room on it. Same room, same engine, same clock. The
 *   entry is a tertiary ghost under the real Draft Room action, never a
 *   second orange verb (DESIGN_DIRECTION.md rule 3).
 *
 * WHAT KEEPS A MOCK FROM COUNTING (pinned by lib/__tests__/featureFlags.test.ts):
 *   the server's league list filters `settings.practice`; the deploy freeze
 *   gate skips practice leagues and a nightly sweep soft-deletes them after
 *   24h (supabase/migrations/…practice_drafts_stay_out_of_the_gate.sql); the
 *   room never claims a mock as the user's active league; the only creator
 *   is server/src/services/PracticeDraftService.ts.
 *
 * The client-side Mock Draft Simulator (/armchair-gm?tab=mockdraft) is NOT
 * gated here and is not what a signed-in manager sees. It stays public for
 * the marketing pages that promise a mock "with no account needed".
 *
 * Flip history:
 *   2026-08-09  false. Architect Entry 13: UI location deferred to the
 *               Sunday walk. No later inbox entry names one, and no
 *               consumer ever landed.
 *   2026-09-03  true. Launch: the ritual is on, pointed at the simulator.
 *   2026-09-14  true. The server half landed; the entry points at the real
 *               room. A one-line revert here hides the HQ entry again.
 */
export const FEATURE_PRACTICE_DRAFT = true;

/**
 * TEAM THEMES IN THE GAME DAY SUITE.
 *
 * WHAT IT GATES (the only consumer, 2026-09-06):
 *   apps/web/src/lib/gameDay/theme.ts. With this flag off, `loadGameDayTheme`
 *   ignores any requested theme key and always reads the default row, so a
 *   public build renders neutral Citrus and nothing else.
 *
 * WHAT IT DOES NOT GATE — and this is the important half:
 *   The real lock is in the database, not here. `game_day_themes` grants
 *   SELECT only on rows with `requires_feature_flag = false`, so a club's
 *   theme row is invisible to anon and to ordinary authenticated users. A
 *   client bug, a hand-edited query string or someone flipping this constant
 *   in a fork all get the same thing back: nothing, and the neutral fallback.
 *   Turning a team theme on for real means a service-role write that clears
 *   `requires_feature_flag` on that row — a deliberate act by someone holding
 *   the key, which is the point.
 *
 * Flip history:
 *   2026-09-06  false. Team themes are built but unreachable in a public
 *               build, per the Game Day brief.
 */
export const FEATURE_GAME_DAY_TEAM_THEMES = false;
