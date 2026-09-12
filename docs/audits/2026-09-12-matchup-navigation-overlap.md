# Matchup navigation overlap — review evidence

The Matchup loader previously waited for roster data, daily scores and records before requesting previous/next-week matchup IDs. Those IDs depend only on the validated league, caller, week and first-week date. The change starts the same reads after current-matchup validation and consumes their result at the original response boundary. An outcome wrapper handles rejection immediately while preserving earlier roster errors.

## Identical-input comparison

Baseline: `a5db32b0e77bcc0d14d29c92df10312c44a2710d`. Run the identical `MatchupService.navigationOverlap.test.ts` replay against each checkout's actual service source, using the same dependencies, fake clock, API responses and representative roster values. The baseline runs only the `captured latency replay` tests; the candidate also runs the behavioral tests.

| Fixture | Baseline virtual ms | Candidate virtual ms | Removed tail ms |
|---|---:|---:|---:|
| Test | 1365 | 1100 | 265 |
| Finalsz | 1409 | 1157 | 252 |
| Zero-latency cached control | 1157 | 1157 | 0 |

Latency inputs come from the sanitized September 12 authenticated baseline: Test first-lineup-to-daily-score interval 568 ms, daily score 532 ms, next-week GET 265 ms; Finalsz 620, 537 and 252 ms. These model only relevant late loader phases. They do not represent total page time. Earlier browser captures used prior a3cd assets during a rollout with unpinned API identity, so they are motivating observations, not a controlled production comparison.

Complete returned JSON is identical for each paired replay, including navigation, records, actual totals, daily values and roster projection fields. SHA-256 of serialized response:

- Test: `148c38f917f1649619dd21ed4e5dc725128605748422f31d711541009b3d237f`
- Finalsz and cached control: `43b28ef9029a846baaf7c8b4b8869abec3ce6f3bc203d1f21cfab223450216c8`

The fixtures use the real shared scorer for representative signed PM, zero and unconditional goalie projection outputs, retaining unavailable projections as null and expected starts separately. Roster construction and API boundaries are mocked. This establishes loader response parity; it is not a production database, NHL projection pipeline or browser paint benchmark. No production speedup is claimed.

To reproduce, run the new test in both checkouts with `-t 'captured latency replay'`. Set `CITRUS_NAV_REPLAY_OUTPUT` to an existing directory plus filename prefix to save each fixture, trace, complete response and hash. Compare the `response` objects as well as completion events. The candidate behavioral cases additionally verify early start, late completion, validation boundaries, both navigation directions, bye behavior and error precedence.

## Validation and operational scope

85 tests across seven focused service, scoring and scoreboard test files pass; web TypeScript and targeted ESLint pass. Existing projection cache, earned stats, expected projections and projected-final slot coverage remains green. The change makes no scoring, schema, source/model, mutation, API authorization or cache-key changes. Data-access review passes.

Successful loads issue the same navigation reads. They now overlap roster work, slightly increasing concurrency; on a later roster failure a read may already have started. Reads retain the same caller-scoped route and league/week arguments. No retry or cancellation is added. A cached zero-duration response yields no replay improvement. Live contention and end-to-end rendering remain unmeasured.

This is a review-only PR. Merge and deployment require the coordinator's separate rollout decision. A later authorized browser comparison should use a pinned serving revision and matched league/date/cache conditions.

## Authorized release attempt — blocked by active draft

The user authorized normal guarded rollout after review. Exact PR head `da8230dfc81a23d45189428cc71271c1a3195bf3` was revalidated with all 16 checks passing and merged as `f19d08420e5c1f82a6fc9f45278ddd563de19921` at 2026-09-12 22:35:50 UTC.

[Production Deploy 34723184930](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34723184930) failed its normal change-freeze gate at 22:36:38 UTC: league “Roster text” had a draft in progress and a pick recorded less than one minute earlier. Both API and web deployment jobs were skipped. No bypass was attempted. This is a merged improvement, not a deployed improvement; authenticated acceptance of this new client is pending. The existing browser owner was instructed to stop new-release acceptance.

A bounded public check after the terminal failure returned HTTP 200 for `/api/health`. Public `index.html` SHA-256 remained `2bd111a6082a1c2569b8c2434e61deb353969111201312318380e221f5f8054a`, exactly matching the prior verified 14de deployment. The prior serving receipt identifies API `citrus-api-00319-nfn`, Hosting `da76c87419ce8521`; these infrastructure identities were not independently queried again in this blocked attempt.

No source/runtime activation, model refresh, schema/table deletion, league-setting edit or native action occurred. Source `aa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1` and runtime `30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce` remain the required publication boundary; this attempt did not query or mutate their contents. Build19 needs the client addition before later device acceptance/submission. Existing Build18/19 archives remain preserved; no signing, installation or upload is authorized here.

Recovery: after the live-draft freeze clears, rerun the failed jobs of the same normal production workflow, retain all gates, and verify actual API digest/traffic plus web artifact bytes before requesting authenticated Test/Finalsz acceptance. Do not alter draft state to clear the guard. No production rollback is currently needed because neither deploy ran. If the merged change must be withdrawn, revert f19d0842 through review and the normal guarded workflow; after any future deployment regression, use the same guarded revert path and retain the verified prior 14de release evidence. Do not roll back projection publications for this client scheduling change.

Raw terminal workflow and freeze logs are retained locally under `outputs/matchup-performance/release/`. The coordinator owns the next release decision; no automatic retry has been scheduled by this task.

### Disputed blocker investigation

Read-only production inspection at 22:40:38–22:41:25 UTC established a currently advancing auto draft, not stale guard data. The live RPC definition matches the checked-in function. The database timezone is UTC. Roster text has `draft_status=in_progress`, `draft_state=active`, no scheduled start and an advancing pick deadline. Its `draft_started` event occurred at 22:28:59.468826 UTC with actor kind `commissioner`; all 81 pick events observed by 22:41:25 have actor kind `autopick`. The projected pick count grew from 62 to 73 to 81 during inspection. No completion/pause/reset event appeared in the event-type aggregate.

At the 73-pick sample, every `draft_picks_v2.picked_at` equaled its source event `created_at`, and none was in the future. There are no legacy picks for this league. The reason-2 guard correctly uses the most recent non-deleted legacy/v2 pick and rounds elapsed seconds to minutes; the displayed zero was a current pick, not a default timestamp. RPC reads are direct, with no guard-side cache. The future next-pick deadline was not the reason that matched.

The live engine consumers in `server/src/draft/index.ts`, `LobbyRegistry.ts` and `orphanedDraftScanner.ts` use the in-progress lifecycle to create or rehydrate lobbies and timers. An auto-picking draft therefore need not have a human manually selecting players. This explains the discrepancy with the user's observation, but does not independently establish who initiated the commissioner action or whether the auto draft was intended. No guard correction or stored-state repair is justified by this evidence. No database mutation was performed. The coordinator was asked to reconcile intent; any stop/reset is a separate draft-state action requiring its own scope and recovery review. The existing scheduled monitor owns normal guarded retry after genuine clearance.
