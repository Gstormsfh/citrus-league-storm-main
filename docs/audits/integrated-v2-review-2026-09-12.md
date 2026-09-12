# Integrated V2 proof review — 12 September 2026

Independent read-only review. Only this document is owned/written by the reviewer. The guide, review editor, runtime code, database and deployment are untouched.

## Follow-up disposition — resolved locally

Rechecked4304 HEAD `96f5dc85aa368f6a53878c6d8de5246b9ba46918` plus its working tree. Both original findings below are resolved in the inspected code. The affected canonical service/dashboard and draft helper/callers are clean relative to this HEAD; unrelated working-tree edits, including shared scoring, remain. This is local code/test evidence, not deployment proof. Original review details are retained below as history.

- Publication errors now propagate from [CanonicalProjectionService:52](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/services/CanonicalProjectionService.ts:52), while only an explicitly absent pointer returns an empty map at36. Empty/malformed snapshots throw at64–69. [PlayerDashboardService:800](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/services/PlayerDashboardService.ts:800) catches unknown publication and removes forecasts while retaining actuals. [Regression:110](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/__tests__/CanonicalProjectionService.test.ts:110) verifies pointer failure cannot reveal legacy forecast999 and still returns measured goals2. Snapshot failure, mixed revision and activation-race service tests also reject. The exact former fail-open branch is closed.
- [rankDraftCandidates:150](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/components/draft/draftDecision.ts:150) now provides common finite forecast-first ordering with actuals fallback. Both [PlayerPool:246](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/components/draft/PlayerPool.tsx:246) and [DraftRoomV2:2380](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/pages/DraftRoomV2.tsx:2380) call it. Actual-category inputs match at PlayerPool206 and V22370. V2 retains league readiness2359, queue priority2363, cap filtering2382 and projected-map dependency2416. [Regression:15](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/components/draft/__tests__/draftDecision.test.ts:15) proves zero/negative forecast players precede a high-actuals unprojected player. Original rank-basis divergence is closed; the old comment at2366 still calls the basis season FPTS and should be updated as documentation cleanup, not a runtime defect.

Observed follow-up commands: `npm run test --workspace=@citrus/web -- src/components/draft/__tests__/draftDecision.test.ts` passed56 tests; `npm run test --workspace=@citrus/server -- src/__tests__/CanonicalProjectionService.test.ts src/__tests__/PlayerDashboardService.test.ts` passed65 tests (121 total). These cover actual working-tree dependencies. Full mounted auto-draft/queue/cap interaction and prior-success-then-sustained-failure dashboard sequences were not replayed by this reviewer; this is a test-coverage limit, not evidence the resolved faults persist. No new blocking issue found within this two-finding follow-up.

## Original version and evidence

Inspected checkout `/Users/gstorms/.codex/worktrees/4304/citrus`, HEAD `73b642bb12327dece651d010d110d18961eac7f0`. The working tree is advancing: DraftRoomV2, PlayerPool, PlayerDashboardService and tests have uncommitted edits. Findings and observed tests below apply to the files read during this review, not a clean detached checkout of HEAD. This qualification matters when subsequent owner fixes land. Source links are absolute and use4304.

**R**: executable repository code and tests inspected/run here. **O**: owner archive/production evidence in [release audit](/Users/gstorms/.codex/worktrees/4304/citrus/docs/projection-live-release-notes-20260912.md). No new production SELECTs, authenticated browser replay, API deployment verification or native archive inspection occurred. No claim below establishes these local changes as deployed. Build18's bundled client boundary remains owner-verified O; this implementation requires a new native client for changed hooks/formulas.

## Verified consolidation and exact requests (R)

- [usePreloadedPlayers:4](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/hooks/usePreloadedPlayers.ts:4), [52](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/hooks/usePreloadedPlayers.ts:52): V2 identity/actuals now adapt usePlayerDashboardIndex. Former direct Supabase directory/stat fan-out is gone. The adapter at20 copies measured actuals and actuals_season; it does not replace them with projected categories. Position aliases, goalie stats and source zeroes have explicit tests.
- [DraftRoomV2:271](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/pages/DraftRoomV2.tsx:271) consumes preload; its advanced/projection branch consumes the same shared module snapshot. [dashboard hook:154](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/hooks/usePlayerDashboardIndex.ts:154) makes `GET /api/players/dashboard-index`; [players route:320](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/routes/players.ts:320) is authenticated. Duplicate hook instances share the request/store, rather than duplicating the six-table index query.
- [useLeagueScoringContext:18](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/hooks/useLeagueScoringContext.ts:18) → LeagueService.getLeague → [league API:46](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/api/leagues.ts:46), `GET /api/leagues/:leagueId`. V2 uses this context at [1885](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/pages/DraftRoomV2.tsx:1885); projected map is gated on ready at2095 and recalculates from index/settings. No default league is silently selected during an unready named-league read.
- [PlayerPool:815](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/components/draft/PlayerPool.tsx:815) explicitly hides rankings while scoring is unready. `projectionSettings` and ScoringCalculator still support default settings after a legitimately loaded null/default configuration; that is distinct from missing hydration.

## Publication revision and fallback (R)

[PlayerDashboardService:779](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/services/PlayerDashboardService.ts:779) reads published canonical context before and after base index acquisition. Revision key includes run, revision and refresh timestamp. A changed key clears the base cache. The ROS query at851 requests projection_run_id/revision when canonical publication is known. The returned forecast must match context status=projected, run_id and revision at793; mismatch removes forecast fields, preserving actuals. Two detected activation races return actual-only rows at798.

[CanonicalProjectionService:26](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/services/CanonicalProjectionService.ts:26) reads canonical_published_runs. It fetches canonical_published_players scoped to season/run/revision at59, validates identity/duplicates and rechecks active pointer at82. Context snapshots are immutable-revision keyed; pointer health is read again each request. These are local source guarantees, not proof of a live activated run.

### Historical gap 1 (resolved above): absent publication and failed publication read are conflated

[CanonicalProjectionService:52](/Users/gstorms/.codex/worktrees/4304/citrus/server/src/services/CanonicalProjectionService.ts:52) catches pointer/snapshot errors and returns an empty Map, the same value used for no active publication. The dashboard interprets empty as revisionKey='', and the masking expression at794 only masks when revisionKey is truthy. If both pointer checks fail consistently, the function can expose legacy/unmatched ROS forecasts instead of actual-only/unavailable. A single transient failure may trigger retry, but sustained failure is not distinguishable from explicit absence.

This is a code-derived fail-open path, not an observed production incident. Proposed contract: separate `absent`, `available`, `unavailable` states; preserve intentional pre-publication compatibility only for a verified absent pointer. Failure or malformed/empty published snapshot should fail closed for forecast data while keeping actuals. Add integration fixtures covering successful active revision followed by errors on both checks, snapshot-page failure, and explicit no-publication compatibility. The existing service test asserting empty Map on failure does not establish dashboard forecast safety.

### Historical gap 2 (resolved above): client auto-draft and visible draft rank use different bases

[PlayerPool:241](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/components/draft/PlayerPool.tsx:241) ranks projected players first by ROS score, then unprojected players by historical actual FPTS. [DraftRoomV2:2368](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/pages/DraftRoomV2.tsx:2368) client auto-draft fallback scores only historical actual categories for all available players. It honors selected league weights and roster caps, but the comment saying it mirrors the visible number1 is not true when forecasts disagree with actuals. Queue picks are correctly explicit user overrides and should remain so.

Proposed fix: reuse one ordered candidate helper with explicit projected/unprojected tiers, league-ready guard and roster-cap filtering. Regression: player A higher past actuals, player B higher ROS; unqueued auto-draft chooses the same eligible top candidate as visible ranking. Also preserve queue priority, missing/zero/negative forecasts and position caps. Do not change server auto-pick based solely on this client finding without tracing its own path.

## Cache and scoring revision boundaries (R)

- Dashboard hook fresh120000ms; visible/focus refresh and shared request dedup,60-second failure retry. Last successful rows retained after refresh error. This is configured refresh opportunity, not a guaranteed120-second maximum source age. Hidden/no-consumer periods and failures can extend age. New publication cannot invalidate a browser snapshot before the browser fetches again.
- V2 preload now inherits this bounded refresh policy; the former permanent direct-hook population is resolved in local code. Old build18 still has its archived behavior.
- League scoring hook state is keyed by league ID and serialized seed scoring. Wrong-league/undefined/missing settings do not become ready. Request versions/cancellation reject old league responses. Poll120s; focus refresh, with30s seed grace. V2 passes no seed row, so a remote scoring change is discovered on fetch/poll, not through a scoring-revision push event.
- LeagueService request cache is30s; underlying API read cache also30s. Mutation API invalidates its league key before PUT at [leagues:108](/Users/gstorms/.codex/worktrees/4304/citrus/apps/web/src/api/leagues.ts:108), and analogous scoring-rules PUT at123. This is not evidence every existing hook immediately refreshes after a successful mutation. Do not sum TTLs into a measured lag bound.
- Projected map dependencies include index, normalized scoring and ready; reweighting does not mutate cached raw hockey counts. Changing league must clear usable derived rankings before the new league is hydrated. Targeted tests cover this hook; no signed-in cross-tab edit replay performed.
- Missing forecast still falls back to historical ranking in PlayerPool. That is an explicit active consumer choice, not equivalent to a fabricated ROS score; product labels must continue exposing which basis is shown.

## Tests actually observed

From4304, two commands completed successfully during this review:

```
npm run test --workspace=@citrus/web -- src/hooks/__tests__/usePreloadedPlayers.test.ts src/hooks/__tests__/usePlayerDashboardIndex.test.tsx src/hooks/__tests__/useLeagueScoringContext.test.tsx src/components/draft/__tests__/draftDecision.test.ts
# 4 files,83 tests passed
npm run test --workspace=@citrus/server -- src/__tests__/CanonicalProjectionService.test.ts src/__tests__/PlayerDashboardService.test.ts
# 2 files,64 tests passed
```

These147 source tests passed on the inspected evolving working tree. They are not clean-commit, runtime latency, deployed publication, predictive-accuracy or build18 tests. The two gaps above need specific integration cases; existing green tests do not negate them. No test implementation or runtime file was changed by this review.

## Original disposition (superseded by follow-up above)

Consolidated V2 data loading, measured-season propagation, selected-league readiness and revision-mismatch masking are substantiated locally. Publication-read failure semantics and client auto-draft ranking parity require owner attention before treating the integration as fully proven. Keep raw payload compatibility and actual-only fallback during any fix; do not publish, retire old paths or alter the submitted binary as part of this documentation review.
