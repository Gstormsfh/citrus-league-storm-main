# Matchup week route-state isolation

## Observed failure and reproduction

Deployed43d52a2a passed initial authenticated Test and Finalsz week1 scoring parity, but navigation acceptance failed. Test Next changed URL to /2 while the selector remained week1. Finalsz advanced the selector while prior-week roster/date/score content remained, and late state was observed after Previous. Guide evidence:8265/output/matchup-performance/ACCEPTANCE-43d52a2a.md. No transition network capture or controlled performance comparison exists, so the exact causal chain of every browser observation remains unproved.

Before production edits, a deterministic React test executed the actual main loader effect extracted from Matchup.tsx using the TypeScript AST. API/league boundaries and payloads were fixtures; the lock, awaits, setters and response handling were the real page code. With week1 response deferred, changing the route input to week2 made the effect return at loadingRef.current. Only week1 was requested; releasing it committed week1 under the requested week2 route. The lock release did not trigger the dropped route effect again. This establishes a concrete cause for the observed class of stale route/content failures, not merely a source resemblance.

## Narrow change

Wrap both existing Matchup routes in a fragment keyed by URL league/week. A new route receives a fresh page instance, including all week-specific state, loading locks, caches and error boundaries. Late React setters and timeout callbacks from the old page cannot overwrite the current page. No service/scoring/API cache or current-route generation policy is edited. The surrounding router/app and shared service caches remain mounted; this is not a document reload. Same-week date and matchup selection do not change the route key.

This intentionally discards page-local selections/caches when changing league/week. A per-mount lifetime stops obsolete main-loader continuations after each awaited step, including the nonfatal ensure-rosters catch and retry callbacks, before later mutation/redirect/state work. Both loader deadlines are cleared on unmount and completion; StrictMode setup gets a fresh lifetime and releases the previous lock. Already-issued requests can still finish; this patch does not add network cancellation or undo their existing side effects. Each newly visited route may start its own load instead of having that load silently dropped. No blanket cache clear or additional retry loop is introduced.

## Verification and release boundary

Fifteen lifecycle/wiring tests cover the baseline failure, a new route during an in-flight lock, old responses arriving last, sequential Next/Previous, rapid1→2→3, a missing/unavailable week response and late frozen-roster/timeout callbacks. Payload checks retain week/date, roster projection values (including negative and zero), actual daily points and opponent identity together. Tests execute the real loader effect but do not mount all production page children or exercise real network/database/scoring calculations; authenticated browser acceptance is still required.

53 tests across six focused route, service and scoring files passed, with full web TypeScript and targeted lint (zero errors; three pre-existing Matchup hook warnings). No source/runtime, draft state, league settings, forecast numbers or native archives were changed. No production speedup claim is made. Review the exact tested PR before the next merge/release. Any needed draft exception must use the newly merged exact release SHA and the existing approved league-only mechanism, never the global override.

Cancellation coverage additionally verifies that obsolete lookup results cannot initiate ensure/generate/delete, obsolete playoff responses cannot navigate, late ensure success/failure cannot bypass cancellation through its catch, current-route ensure failure remains nonfatal, both loader timers are cleared and StrictMode remount remains functional. Existing projection/live refresh timers and listeners already have cleanup. Outstanding background score updates or roster requests sent before leaving the page remain outside cancellation; no abort/rollback of server work is claimed.

## Production release

Final PR478 head `efcab8854178162c438de7cc1ed360a5aa43a8c7` passed all16normal checks (CI34725285183 and conventions34725304521) and coordinator review. Source-order/AST inspection confirmed the lifetime hook precedes the main loader and all22loader awaits are guarded, with only the guard helper's own await unwrapped. PR478 merged at23:28:45UTC as `2fe9c493bcf0c6245197119cc584aa220b100b5d`; its tree exactly matches the reviewed head.

Normal push [Production34725518936](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34725518936) reached terminal SUCCESS. The draft guard returned no blockers/upcoming24h at23:29:18UTC, so no scoped dispatch or global override was used for this repair. API-first and every remaining production gate ran normally.

The workflow verified actual API traffic on `citrus-api-00321-clr`, expected and serving digest `sha256:9064b8b9ae67af32e577df5b063ea068373acc4b027ac9c1589352ed87492bd7`. Hosting version is `9c1fde65f897b8c5`. Independent public verification at23:38:21UTC matched all eight selected artifact bytes and returned root/API health200; index.html/sw.js retained no-cache,no-store,must-revalidate. Bootstrap files are index-BHeFlMwd.js and index-CcLobiPW.js; Matchup-C3-l2DQ0.js SHA256 is `3334eca69d442c9c2569b9bed5fb2953e688631fe594e334e460c104bf0af61d`.

A bounded read-only publication check at23:38:52UTC confirmed season2026 run06f1e1b4-8742-4cc5-bead-bfd1a63dd4d9, sourceaa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1 and runtime30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce unchanged. This was not a new full-table numerical audit. No manual projection refresh, draft-state repair, league-setting edit or native action occurred.

Build19 must include both PR475 navigation-read overlap and PR478 route-state/lifetime repair before later device acceptance/submission. Existing Build18/19 archives are preserved; no signing/install/upload/distribution was performed. A rollback would revert the reviewed application changes through the normal guarded API-first/web workflow, retaining the prior43d/14de deployment evidence; no projection publication or draft data rollback is appropriate. No rollback was performed.

Raw workflow logs, exact artifact and public hashes are retained under outputs/matchup-performance/navigation-release. The earlier43dpartial browser acceptance remains historical in the scoped release receipt. Repaired authenticated acceptance is recorded below when complete.

## Repaired authenticated acceptance — PASS

Guide completed bounded normal-cache acceptance at23:45UTC, retained in8265/output/matchup-performance/ACCEPTANCE-2fe9c493.md with adjacent visible DOM JSON. Both clients independently showed index-CcLobiPW.js/Matchup-C3-l2DQ0.js. Test initially retained the old client after an ordinary reload; after a normal30-second update opportunity, a real Update ready notice appeared and its explicit Reload loaded the repaired assets. No cache bypass/clearing or worker manipulation occurred. This proves that observed deployed notice→Reload path, not every client's update timing.

| League | Week/date | Opponent | Actual | Projected |
|---|---|---|---|---|
| Test night9th | 1, Sep27–Oct3 | AI Team4 | 0/0 | 224.2/224.0 |
| Test night9th | 2, Oct4–10 | Midget | 0/0 | 294.8/280.0 |
| Finalsz | 1, Sep28–Oct4 | AI Team3 | 0/0 | 128.6/108.9 |
| Finalsz | 2, Oct5–11 | AI Team2 | 0/0 | 142.2/151.0 |

Both visible Next/Previous1→2→1 round trips passed: URL, selector, date range, View Matchup choice, opponent, day strip and visible roster agreed; week1opponent/scores/roster restored. Loading replaced prior matchup content during the initial next transitions. An extra Finalsz next→browser Back restored week1, but week2had already rendered before Back, so it does not prove a live in-flight race. Deterministic tests cover that race. No production missing-week state was encountered; no coverage claim is made for that branch. No latency/speedup claim is made. Both tested leagues ended at week1.

The earlier43d failed navigation acceptance remains retained and is superseded only by these specific repaired observations. Final master remained2fe9c493 and the global override variable remained absent. Bounded rollout and acceptance work is complete; no further release or data action is required by this task.
