# Manual baseline publication and remaining release acceptance

This receipt records the actual September12 manual metadata publication, verified client header/API correction and durable export-tool change. Actual normal-cache browser acceptance is recorded separately from serving artifacts; no universal cached-client guarantee is implied.

## Published source and runtime

The owner adopted the Citrus-authored workbook as the working manual baseline. References explicitly say “Citrus owner (workbook adoption only)” and “not independently verified.” The adoption date is not a fresh injury observation. Original report dates, unresolved conflicts and complete before-images remain retained; deadlines govern review, not recovery or IR eligibility.

Source `aa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1`, UUID `1764afb8-64e2-45a5-9a73-00387d52f6be`, was staged separately under exact guards. Its raw SHA256 is `ca3af814c11e045acec9a0b4c908a6c242d139f54d507b2f569fbee28e9f968b`. The patch changes 33 availability records, 7 role notes and 17 team-note text cells. All 1325 profile identities and 53151 existing source numeric tokens remain unchanged.

The separately bound effective runtime is `30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce`, UUID `06f1e1b4-8742-4cc5-bead-bfd1a63dd4d9`, raw SHA256 `72463346623f61d856e0648f1838a9e0cf71dc505ff7f43284fb488736346077`. Production validation returned `valid=true`; expected-prior revision CAS activated it at `2026-09-12T19:11:36.724301+00:00`. Inherited refresh `2026-09-12T10:02:13.183476+00:00`, `initial_activation` and null refresh error are preserved. No model refresh was invoked.

All 56347 existing runtime numerical tokens and prior source/runtime history remain unchanged. Independent live read-only verification at `19:15:09.090686 UTC` confirmed exact raw payloads, all four current/prior player collections, full schema including leagues, 674 ROS rows and 56616 daily rows. A final bounded read at19:38:38.882864UTC after the application API deployment reconfirmed publication identity, inherited refresh, counts/comparable hashes and all 70 league settings; no revalidation or refresh was invoked.

| Comparison | Before and after |
|---|---|
| ROS comparable rows | `baf006ec10582a13fccbb1bdc653e036` |
| Daily comparable rows | `ca7a9f14ef20bca7628ab481554840ce` |
| 70 league settings, broad | `986d4c3caccca2f9fa7fc410c4a742bd` |
| 70 league scoring settings, narrow | `e13cfa2f83a7a930dce05e40eaffc5a5` |

Comparable hashes exclude only run/revision/created/updated metadata and the daily surrogate projection ID; full JSONB row equality was also enforced with those exclusions. New full hashes are ROS `caa357f228aaafeadb293b16340b5d84` and daily `284607afe92f82c86ba3ca828dc5c117`. Broad settings hash orders JSONB arrays of id/scoring_settings/settings; narrow settings hash orders id plus scoring_settings text. The earlier receipt defines the same algorithms.

Private raw recovery was saved exclusively with 0600 permissions and file/directory fsync before commit. Source envelope SHA256 is `64929153c85638b0c0eb8f8a56a1f089e2b60a4674549166a30af2606005012b`; runtime envelope SHA256 is `7bfb54c3da93d9ac476081e3727a049bb344ceecbb89aebdd6e6938fa1033fd8`. Recovery integrity and recorded actual validation were independently checked. Raw recovery and payloads remain outside git.

## Editor, exports and native artifacts

Manual-authoring PR471 merged `1a4fe8be38999b124ef6108077225d306ba32d0d`. The current editor at 8766 was observed clean with No edits and explicit manual-adoption provenance. Final PR473 normal-cache Free Agents acceptance used verified `FreeAgents-DwSHiaQO.js`: Merzlikins OUT appeared in both row and modal with the exact workbook-adoption/not-independently-verified reference, September12 adoption and September19 review deadline, and separate not-IR wording. Zero starts remained a conditional forecast scenario.

Current default and Finalsz PDFs have 193 pages and passed full identity, ranking, navigation and visual verification. Current workbooks are the explicitly identified DRAFT-v2 editions. All 2650 cached fantasy-point values match the shared scorer; 43771 formulas and 62536 numeric cells are unchanged from5af. All 1325 availability/exposure records, 32 teams, 706 slots and 5335 notes match the current snapshot.

Three oversized Source History JSON records are split into numbered cells of at most 30000 UTF16 units. Lossless reconstruction was verified against the full original records; all other workbook cells and formulas match the initial30e editions. Initial30e workbooks remain noncurrent, and all 16 retained 5af/858 artifact/manifest/QA hashes are unchanged. The standard exporter now applies the same bounded chunking with surrogate-pair safety and an expanded wrap range. Seven tests include actual Node builder → XLSX → openpyxl roundtrips, exact reassembly of large history records, a 30000-unit boundary and unchanged nonhistory cached/formula cells. This changes serialization only; existing verified v2 editions are not rewritten.

Actual unsigned Build19 from exact client input `66e509e9c148cccdcc971c80722631f7d1d166ee` passed 422 focused tests, shared/web type checks, native assertions, sync, simulator compilation and an unsigned device archive. All 215 dist assets match both compiled apps and the prior232 manifest SHA256 `63883801f793ad33433d607a84ac1c71bc7e8f2ddc4e8db741ec7dab2fa3b9bc`. No worker scripts occur in the native output. Prior archives and Build18 remain preserved; no signing, installation, launch, upload or distribution occurred.

## Client release and measured Matchup behavior

PR472 merged `7f45ec9082d539bf41cefab184d2771cb4563047`; real production workflow34713132976 succeeded. At that release check, API `citrus-api-00318-xsq` served digest `sha256:d6ee27172dcf8f286d626e60011a7ae4854283cbcaf860366a97d1a5175db733`; Hosting version is `141f412514bff7a3`. Eight selected public artifacts match the workflow exactly. Public health passed.

Postdeployment header acceptance failed: `/sw.js` still had a one-year cache lifetime. Deployment reads root `firebase.json`, while the initial patch updated only `apps/web/firebase.json`. This config-selection finding supersedes the initial ordering speculation. The root-config and optional-simulation corrections merged in PR473 at `14de8bf03f921e3e45ae6f52a4dae254422262e4` after all 16 checks passed. Normal production workflow34714224113 succeeded. API `citrus-api-00319-nfn` serves verified digest `sha256:1f7a62a8c09d1e40140f19e8b32d6ca2c15ea4d6cb836df663ea5d64bb744b27`; Hosting version is `da76c87419ce8521`. Public verification at19:38:47UTC matched all 8 selected workflow artifacts, confirmed HTTP200 health and verified `no-cache, no-store, must-revalidate` on both stable worker URLs. The unused `/registerSW.js` URL still resolves to the SPA fallback; the new bootstrap emits no reference to that script.

The first PR472 attempt used a fresh authenticated tab and one ordinary reload but still loaded the older a3cd client, with no Update ready notice. That failed acceptance remains historical. After PR473 serving verification, one bounded normal-cache load reached current `index-Cbnwt9xB.js` and `Matchup-gYzRVT0u.js`, verified against the deployment artifact, with Finalsz actual 0/0 and projected 128.6/108.9 preserved. No cache bypass or clearing was used. This establishes the observed ordinary transition, not its sole cause or a guarantee for all clients. Worker bytes are identical between PR472 and PR473, so this correction does not test a new controller replacement on an already-current bootstrap. The separate local exact-helper real-worker test passed normal second-tab registration/update, a notice preserving unsaved state, and explicit reload; visibility-only behavior and every legacy transition remain unproved.

Actual normal-cache Test and Finalsz navigation baselines captured 57 and58 API requests. First daily-projection requests began 3.24 and3.03 seconds after the first API request; observed readiness timings are polling upper bounds, not a causal critical path. The web bundle was a3cd and the API revision during rollout was not pinned. The recorded activation timestamp falls between samples, but it is a transaction timestamp; commit visibility during the browser samples was not measured. No controlled before/after speedup is claimed.

The two Finalsz seven-day waves cover 39 then 41 player IDs, adding 8481559 and 8483515 for each date. They are not identical duplicate requests. A retained Finalsz simulation response was HTTP500 because optional `get_matchup_simulation` was absent from the schema cache. Main Matchup content remained visible. The separately reviewed PR473 correction returns an empty stored-simulation result only for the missing optional function/table and checks caller-visible matchup access before invoking the RPC; no simulation model or database migration was introduced. On the final current-client load, the authenticated Finalsz simulation GET returned HTTP200 with exact body `{"data":[]}`, not a service-worker response. Full Matchup content and the documented projected/actual values remained visible. This resolves the observed optional-function error; it does not claim a simulation model exists or a measured speedup.

## Retained exceptions and follow-up ownership

Retirement review is complete with retained exceptions: `projection_cache` direct-client ownership remains unknown; no-active-season wrappers, required history and reachable raw/model inputs remain necessary. No quarantine, rename, drop or speculative job change occurred.

Coverage assessment found 674 allocated forecasts, 650 unallocated rate profiles and one unresolved profile. Tij Iginla is the sole missing allocated skater plus/minus count; it remains unavailable. Supported plus/minus values include 306 negatives, 281 positives and one genuine zero. Unallocated or zero-exposure scenarios do not authorize invented rates, workloads or injury facts.

The coordinator's existing heartbeat owns genuine pg_cron31/34 scheduled acceptance. A future scheduled time, metadata activation or manual refresh is not a completed scheduler observation. Device acceptance and distribution remain outside unsigned validation.

Task-local evidence entrypoints: reconciliation `manual-availability/MANUAL-PUBLICATION-INDEPENDENT-REVIEW.md`, `BOUND-RUNTIME-REVIEW.md`, `COVERAGE-DISPOSITION.md`; guide `output/canonical-review/LATEST-REVIEW.json`, `MANUAL-BASELINE-30e-ACCEPTANCE.md`; actual browser `output/canonical-review/FINAL-APP-ACCEPTANCE-14de.md`, `output/matchup-performance/BASELINE.md` and payload comparison; current release `outputs/sw-upgrade-review/corrected-production/RESULT.md` and its `public-assets-health.json`; the original `production/public-assets-health.json` remains historical PR472 evidence. These dated receipts retain the exact limits above.
