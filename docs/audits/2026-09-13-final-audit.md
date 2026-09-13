# Final Citrus audit

**As of September 13, 2026, 01:49 UTC (September 12, 19:49 Edmonton).** This closes the bounded audit using existing reconciliation and acceptance receipts, plus current read-only public, publication, scheduler and freshness observations. No application, database, export or device changes were made.

**Verdict: the current web release and tested projection/Matchup flows are accepted within the recorded scope.** No current serving or publication contradiction was found. Full operational, production-performance and native-device readiness remain unproven; passing release tests is not forecast-accuracy certification.

| Area | Finding and boundary |
|---|---|
| Source and consumers | Immutable source **aa5**, effective runtime **30e**, canonical ROS/daily outputs and the viewed league's scorer remain the operating chain. Actual earned scores remain separate from forecasts. Required raw/model inputs, history, no-active-season wrappers and reachable operator paths are retained. Direct external ownership of `projection_cache` remains unknown; retirement review does not mean every legacy dependency was removed. See the [operating map](../../scripts/ops/projection-retirement/CUTOVER.md). |
| Season and workload | Re-read the exact bound runtime artifact: every schedule value is **84**, maximum allocated MODEL skater exposure is **83**, and its count contract is `rate * exposure.used; applied exactly once`. Season length does not replace an intentional MODEL or manual exposure override. Conditional goalie rates require expected-start exposure once; canonical daily counts already contain it. Expected starts, including zero/fractional values, are forecasts rather than confirmed starts. See the [publication contract](../canonical-projection-pipeline-20260912.md). |
| Scoring and missing values | Existing reconciliation preserves saved league settings and shared custom scoring. Signed negative values and genuine zero remain valid; missing or unsupported categories stay unavailable. Default fantasy points cannot substitute for missing custom inputs. Selected web acceptance supports this contract, but does not establish every league combination or an in-season earned-score recomputation. See the [numerical and coverage receipt](2026-09-12-manual-baseline-release.md). |
| Manual facts | The workbook is the owner-adopted working baseline, explicitly **not independently verified injury reporting**. Adoption dates do not refresh original observations; review deadlines are not return dates or IR eligibility. Tanev, Mikkola and Tij uncertainties remain unresolved. Tij's missing allocated plus/minus remains unavailable. No fresh injury investigation was performed. |
| Exports and history | Current default/Finalsz exports are explicit snapshot, horizon and scoring-profile artifacts. Existing v2 workbook history chunking was verified to reconstruct the original records losslessly; prior exports and before-images remain retained. The standard launcher/exporter is repaired. These files do not update automatically when runtime or league settings change. No re-export was needed for the application-only repair. See the [export receipt](2026-09-12-manual-baseline-release.md#editor-exports-and-native-artifacts). |
| Current web and cache | Health returned HTTP200; current index, Matchup and service-worker hashes match accepted **2fe9c493**. Index/sw retain `no-cache, no-store, must-revalidate`. The browser receipt proves a normal **Update Ready → Reload** transition and coherent Test/Finalsz week **1→2→1** navigation across URL, dates, opponent, roster and actual/projected scores. Live in-flight Back and missing-week behavior were not observed in production; regression tests are separate evidence. Universal legacy-client cache behavior is not established. See the [release and navigation receipt](2026-09-12-matchup-week-navigation.md). |
| Genuine scheduled refresh | Publication remains aa5/30e with inherited September12 **10:02:13.183476 UTC**, `initial_activation`, null refresh error. Cron31/34 are active at **08:50/09:05 UTC**; latest September12 runs succeeded before this publication. September13 runs are **not yet due**. Activation metadata and a manual invocation would not prove the next genuine scheduled cycle. |
| Monitoring and alerts | Latest observed scheduled [freshness run34728843771](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34728843771), September13 **00:46:45–00:47:35 UTC**, succeeded with **8 passes, 10 warnings, 0 failures, 3 skips**. Slack webhook and PagerDuty key were empty in its environment. WARN annotates; FAIL fails the workflow. External delivery and GitHub notification receipt remain unproven. This newer run supersedes the prior readiness note's latest-run age; exact hourly execution is not established. |
| Performance and native | Local replay's 252–265 virtual milliseconds saved is not measured production latency or capacity. Older real captures were not a controlled current-release comparison. Unsigned Build19 at **66e509e9** passed its recorded build checks but predates PR475/478; current installed-device behavior and distribution remain untested. |

## Exact current observations

Public observation **01:49:43.677333 UTC**:

- index SHA256 `0254cf26ad2702fe55c33c10f531a76f185a5c72d391f73f1055a6a449ac1d0f`
- `Matchup-C3-l2DQ0.js` SHA256 `3334eca69d442c9c2569b9bed5fb2953e688631fe594e334e460c104bf0af61d`
- sw SHA256 `69f8ddb68d5a0ec05b1e38882cf3cbd225daf7877b2fb6a76abaa981e842f50f`

Database observation **01:49:23.085750 UTC**, project `iezwazccqqrhrjupxzvf`: source `aa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1`; runtime `30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce`; run `06f1e1b4-8742-4cc5-bead-bfd1a63dd4d9`. Cron31 run268975 succeeded September12 08:50:00.081500–08:50:14.171676 UTC; cron34 run269048 succeeded 09:05:00.043557–09:05:43.555041 UTC.

Release `2fe9c493bcf0c6245197119cc584aa220b100b5d`: [Production34725518936](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34725518936) succeeded. Infrastructure identities remain release-receipt evidence, not a fresh administrative deployment read. Browser evidence: `/Users/gstorms/.codex/worktrees/8265/citrus/output/matchup-performance/ACCEPTANCE-2fe9c493.md`.

Rechecked runtime file: `/Users/gstorms/.codex/worktrees/4304/citrus/outputs/projection-reconciliation-20260912/manual-availability/manual-runtime-bound.json`, raw SHA256 `72463346623f61d856e0648f1838a9e0cf71dc505ff7f43284fb488736346077`. Numerical/settings, export and native findings otherwise rely on the dated receipts above rather than a new exhaustive comparison.

## Smallest remaining actions

1. Existing coordinator monitor observes actual September13 cron31/34 executions, then checks publication/output freshness and preserved source/scoring invariants.
2. Configure the intended alert destination and verify controlled delivery within authorized scope.
3. Define a loading target and collect bounded, matched current-client timings before asserting performance readiness.
4. Update the isolated native candidate to current client code, then complete authorized device acceptance before distribution.
5. Resolve named cache ownership and dated manual-fact reviews when due; retain dependencies and unknowns meanwhile.

Audit complete. No new PR, deployment, broad investigation or speculative retirement is needed to deliver this receipt.
