# Projection serving audit and local release notes — 12 September 2026

These changes are local and reviewable. No production data writes, deployment, App Store submission changes, or signed-in runtime screenshot validation were performed. Tests establish source behavior, not predictive accuracy. Workbook reconciliation does not publish its curated overrides into the app.

## Proven active paths and season basis

- V1 draft room requests `/api/players/ros-projections?limit=1500`, then scores returned category counts using league settings. V2 uses `/api/players/dashboard-index` through `PlayerDashboardService` and the shared dashboard hook. Both read `player_ros_projections`; server autopick/auction nomination also read that table.
- Player-card advanced projections use the dashboard ROS join. Build18 modal skater headlines instead summed daily `player_projected_stats` through `/api/matchups/player-game-log`; its goalie headline used single-player ROS when available. These are distinct serving paths, not interchangeable evidence.
- Production cron31 actively calls `rebuild_ros_projections(get_projection_target_season())` at08:50UTC; cron34 rebuilds daily projections at09:05UTC. Read-only `cron.job_run_details` showed successful September11 runs. Actual `pg_proc` definitions show ROS derives rates from `project_ros` plus `project_rookies` and multiplies by final expected GP/starts.
- Production target season returned2026; `get_season_game_count(2026)` returned84. Scaling is already present. Workbook MODEL ceiling83 is intentional and must not be replaced by84 or scaled again. The observed live skater maximum81 comes from a different shrinkage/availability layer.
- Snapshot ROS coverage:1,271 skaters and157 goalies. All1,312 current-directory identities have ROS. These populations differ from workbook model exports, lineup slots and manual rows. Rookie cohort priors are fallback estimates, not individual prospect models.

## Local fixes requiring build19 for native users

1. Player-card hero reads single-player ROS for both skaters and goalies. Missing ROS remains unavailable; valid zero stays zero. Historical log selection does not change the current-season hero source. An open card revalidates when its dashboard projection/status changes, with request-generation protection against stale responses.
2. Daily projected rows are rescored from raw category counts under league settings, including zero/negative totals. Default-scoring uncertainty intervals are omitted when their reweighting is unsupported. Raw cached payload remains unchanged. Upcoming-table FPTS columns are currently hidden; this scorer correction prevents a latent mismatch and is not evidence of a currently visible daily-table error.
3. Goalie advanced-card labels say starts and FP/start.
4. Shared dashboard data expires after120 seconds and refreshes while visible or when foregrounded. Requests are shared, disabled consumers do not poll, and the timer stops after the last active consumer unmounts. Failed background refresh retains previous rows and exposes an error; initial failure remains empty. Failure retry backoff is60 seconds.

Build18 bundles its JavaScript; backend hosting does not change these client branches or labels. Existing field-preserving server/data updates can reach its existing ROS endpoints, subject to cache expiry and a new fetch. Its V2 successful dashboard snapshot persists for the session without automatic expiry. Production integration of workbook overrides, a role-aware availability pipeline and any associated rollout were not performed. No schema migration is included in these client changes.

## Verification and reproduction

Independent combined verification:85 Vitest tests passed across seven suites;8 Python contract tests passed, totaling93. Web TypeScript checking and `git diff --check` also passed. The seven web suites are projectionScoring, PlayerStatsModal.recovery, PlayerStatsModal.writeupFallback, goalieProjectionSanityGuard, projectionFraming, PlayerAdvancedCard and usePlayerDashboardIndex. These include meaningful conflicting daily-versus-ROS fixtures, custom scoring, missing/zero ROS, historical selection, failed logs, negative totals, cache immutability and refresh/failure recovery. They are not a signed-in app replay.

Run from repository root:

```sh
npm run test --workspace=@citrus/web -- src/components/player/__tests__/projectionScoring.test.ts src/components/player/__tests__/PlayerStatsModal.recovery.test.tsx src/components/player/__tests__/PlayerStatsModal.writeupFallback.test.tsx src/__tests__/goalieProjectionSanityGuard.test.ts src/components/player/__tests__/projectionFraming.test.ts src/components/player/__tests__/PlayerAdvancedCard.test.tsx src/hooks/__tests__/usePlayerDashboardIndex.test.tsx
python3 -m unittest discover -s data-pipeline/tests -p test_projection_contract.py
node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.app.json
git diff --check
```

The local worktree reuses `/Users/gstorms/dev/citrus/node_modules` through an ignored symlink. Python contract tests use standard-library unittest; pytest is not installed in the default Python and is unnecessary.

## Evidence and limits

- Inspected archive: `/Users/gstorms/Library/Developer/Xcode/Archives/2026-09-11/App 2026-09-11, 8.19 PM.xcarchive`. Its App Info.plist identifies version1.0/build18. Capacitor config uses bundled `public/assets`, with no remote server URL; `index-B35GR88p.js` points API requests at `https://citrusfantasysports.com`. Inspected chunks include DraftRoom-BV14gFED.js, DraftRoomV2-DsrMND7G.js and PlayerStatsModal-CURLdmKz.js. Exact Git commit is not established by build number alone.
- Read-only production query provenance: Supabase project `iezwazccqqrhrjupxzvf`; actual `pg_proc`, `cron.job`, `cron.job_run_details`, schedule, directory and projection SELECTs. Query results were returned through the Supabase execute_sql connector. No writer RPC was invoked by this audit.
- Scratch evidence under `/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/`: `live-lineage.md`, `player-card-audit.md`, `player-card-daily.json`, `player-card-ros.json`, `ros.json`, `workbook-full.json`. Player-card JSON includes the exact SELECT and results. Daily/ROS timestamps differ, so observed output differences cannot all be attributed to GP alone.
- Identity correction: the earlier lineage note's exact-name search missed Viggo **Björck**, NHL8486025. Direct ID-based evidence finds24GP/111.08 stored ROS points and no daily rows. The supplied workbook profile spelling `Bjorck` does not justify a fuzzy automatic join.
- Upstream SQL reads include player_game_stats and player_xg_season; inspected refresh_xg_season_layer aggregates nhl_shots.xg_sql. Full historical acquisition provenance and the current external scheduler for the Python nightly batch were not independently established here. Legacy cleanup remains conditional on dependency evidence.
