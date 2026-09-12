# Build 18 cutover compatibility — 12 September 2026

Build 18 can receive updated values through its existing API requests, but it cannot deliver the corrected client semantics. Recommend installing the schema first, deploying the compatible API next while no canonical run is active, and delivering the corrected web/native client before canonical activation. Do not describe server deployment or activation alone as fixing Build 18. Retiring the old cache is a separate final operation after caller checks, not a prerequisite for serving canonical data.

## Evidence boundary

The actual inspected archive is `/Users/gstorms/Library/Developer/Xcode/Archives/2026-09-11/App 2026-09-11, 8.19 PM.xcarchive/Products/Applications/App.app`. Info.plist identifies version 1.0/build 18. Capacitor uses bundled `public/assets`, with no remote server URL; `index-B35GR88p.js` targets `https://citrusfantasysports.com`. These are archive facts, not a claim that its exact Git commit or every installed user's bytes were established. No signed-in Build 18 replay was performed.

Read-only Cloud Run traffic/revision evidence identifies the observed API baseline as `citrus-api-00310-q6p`, commit label `6aef8ab7d5f4657245284377b53acbc915dc6d82`, image digest `sha256:6f8be15ac73e3f3cbdd3ff71a5934f70be735604d612c226b3737f2126a993cc`. This was 100% of observed traffic; it is not the newly prepared API. See [scheduler execution proof](scheduler-execution-proof-2026-09-12.md), [original release audit](../projection-live-release-notes-20260912.md), and `tmp/projection-audit/live-lineage.md` for production SELECT provenance and original serving trace.

## Existing request and field compatibility

| Consumer | Proven archive/baseline behavior | What reaches Build 18; what remains wrong |
|---|---|---|
| Draft V1 | Archived `DraftRoom-BV14gFED.js` requests ROS limit 1500 and scores `projected_goals/assists/sog/blocks/ppp/shp/hits/pim` and goalie `projected_wins_ros/saves_ros/shutouts_ros/ga_ros`; reads `games_remaining`. | Preserving these numeric fields allows corrected ROS counts and fractional starts to arrive on a fresh request. Source/readiness, missing-category, default-weight timing and zero/negative display fixes are bundled client changes. |
| Draft V2 and advanced card | Dashboard index request through `/api/players/dashboard-index`; V2 consumes its projection map. Original successful dashboard hook stays ready for the module/session. | Existing mapped ROS fields remain consumable. Additive canonical context is not interpreted by this archive; it cannot enforce new readiness/scoring rules or automatically expire its already-loaded successful snapshot. |
| Card headline/game log | Existing single-player ROS and `/api/matchups/player-game-log` requests; archived skater hero sums future daily data, while goalie hero uses ROS when available. | Keeping the response shape avoids a transport break, but does not move the skater hero to ROS or fix year labels, expected-start interpretation, unknown handling or custom league rescoring. |
| Free agents | Archived `FreeAgents-BeN_mJ-t.js` sums `Number(row.total_projected_points || 0)` and adds **one game per returned row** from the daily endpoint. | Unconditional canonical point counts can reduce inflated default weekly totals, but the backup still appears to have one appearance per team game. It ignores expected GP and does not gain the corrected full-pool coverage, horizon, unknown-data or league-scoring behavior. |
| Roster | Archived Roster copies `total_projected_points`, goalie categories and `projected_gp` directly. `useRosterWeek-kx1lKRa-.js` rescoring uses raw categories and increments `gamesRemaining += 1` for each future row. | Numeric fields remain readable; a returned fractional GP is not enough to correct weekly appearance counters or today's actual/forecast overlap. Some paths use stored defaults while others rescore. |
| Matchup | Archived Matchup displays copied daily fields and sums stored totals in exposed aggregate branches; baseline source also contains league-rescoring branches. | Correct backend scoreboard values can reach server-fed surfaces, but not replace local aggregators, loading/error behavior, custom-score branches or game-count labels. Treat page and server scoreboard as separate acceptance checks. |

The common archive API client posts `/api/matchups/projections/daily` with `{playerIds, date}` and caches the date/IDs request. Preserve that envelope and existing raw names. New `projection_basis`, expected-start and source metadata are additive. The inspected archive chunks contain neither `projection_basis` nor `start_probability`; their actual arithmetic above, rather than that absence alone, establishes the noted defects.

**No double-weighting claim:** the inspected old daily branches sum already returned counts/points and do not apply the newly introduced start probability. Thus the demonstrated risk on canonical unconditional rows is persistent row-count/default-scoring/fallback behavior, not proven double multiplication in Build 18. Conversely, legacy conditional rows plus additive metadata alone remain inflated on readers that ignore that metadata. New readers must distinguish conditional and unconditional rows and apply exposure once; do not globally relabel or scale the old raw contract.

## Sequencing constraints

1. **Schema before new API.** The new `CanonicalProjectionService` reads `canonical_published_runs`. A missing view is an error, not an empty successful publication. `PlayerDashboardService` catches this by withholding forecasts while retaining actuals. Deploying this reader before its schema can therefore blank dashboard forecasts even though old ROS rows exist. With the view installed and no active run, the successful empty result retains legacy serving; wrappers keep the original writers.
2. **API before canonical activation.** The current deployed baseline does not supply the new exposure/source verification contract. The prepared API recognizes `canonical_expected_volume_v1` and preserves unconditional raw counts. Activate only after verifying the installed API, source stamps, empty-publication fallback, custom scoring and failure behavior against the migrated schema.
3. **Corrected client before declaring universal correctness.** Build 19 is required for the bundled card, draft, free-agent, Roster and Matchup fixes, polling, source-year labels and explicit unknown/zero handling. Web deployment updates the website, not archived native assets. If Build 18 remains allowed after activation, disclose those exact residual defects; there is no implemented version gate or server switch in this work that removes them. An update requirement would need a separate implementation/rollout decision.
4. **Activation and cache refresh are distinct.** Activation atomically switches one canonical run and materializes stamped ROS/daily rows. Server caches and client snapshots can still be warm. The new dashboard reader checks publication stamps, but Build 18's ready session cache cannot be remotely upgraded by the migration. Require a fresh fetch/restart for a Build 18 verification; do not promise immediate refresh of open screens.
5. **Preserve writer ownership.** The observed ROS cron calls `rebuild_ros_projections` at 08:50 UTC; daily cron calls `rebuild_player_projected_stats` at 09:05 UTC. New wrappers make ROS the authoritative refresh and daily reuse the active run. Scheduler timing is not a freshness guarantee, and unresolved external Python/acquisition ownership is not permission to disable those paths. Cache quarantine follows the separate dependency/restore gates.

Source revision `6a71c8db63eb6ee43798f8ab963652b89c103d2f9dae718f3d51b0abb97dd117` remains DRAFT. The local reviewed-test-copy rehearsal proves 674 ROS rows and 56,616 daily rows preserve the 12 supported compatibility forecast categories, expected exposure, default points and revision identity; it does not supply publication approval or Build 18 runtime acceptance. Plus/minus is retained in source but not exported as a compatibility forecast component; a league requiring an unsupported forecast component must remain unavailable on corrected readers. See [test-copy report](../verification/canonical-source-activation-test-copy-20260912.json).

## Re-inspected archive hashes

SHA-256 values make these findings reproducible without assigning an unproven archive commit:

| Asset | SHA-256 |
|---|---|
| `FreeAgents-BeN_mJ-t.js` | `e6a8d79fe5f59235c8e842fef1d972c1b303316c74601dbbeab742502ea61807` |
| `useRosterWeek-kx1lKRa-.js` | `7234948b8852c97d8369bda3c07bb163ff712d509db58afbcefdebd7258fb193` |
| `DraftRoom-BV14gFED.js` | `93c3db0db4f7860c228e0135c821464e58f21aa7726a3b6e4876625e0ae6213d` |
| `DraftRoomV2-DsrMND7G.js` | `e92ec3d65df0140c213284d94187ff4bd592aa4bc983dbac2f017a5768dbbbb9` |
| `Roster-CoTmKqC-.js` | `0584784be72e8b25398ff138b021042af9377ae753d64db2c5c9df2b6bfaaca3` |
| `Matchup-C12II86e.js` | `1967df521c4627d636d09a7464d4707cc072d88a1d969edb9d5215967d8c7f61` |
| `PlayerStatsModal-CURLdmKz.js` | `35c6887550d1746570221096ebcc2acb215e9acd005ea8666938205a6e8e6bf9` |
| `index-B35GR88p.js` | `35052b5f93f33cd47747d8136088af6876f9c814d14ea3c319670eb9c18f298a` |
