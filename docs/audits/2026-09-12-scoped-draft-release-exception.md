# Scoped production draft exception — review before dispatch

PR475 merged as f19d08420e5c1f82a6fc9f45278ddd563de19921, but production run34723184930 was refused by the draft freeze before either API or web deployment. Read-only investigation established that Roster text (3fd3e70c-fa85-432f-b98a-b29ce43a519c) was actively auto-picking:62→73→81picks, current source-event timestamps and active/in_progress lifecycle. The guard was correct.

After being informed of this activity, the user explicitly instructed: “Just proceed brother it doesn’t matter don’t worry it won’t progresss”. The coordinator authorized a release exception for that known draft only, not a pause/reset or a claim that it stopped. The existing repository-wide OVERRIDE_DRAFT_FREEZE switch also affects the engine and was not used or changed.

## Mechanism and boundaries

A manual Production Deploy dispatch on master must supply the exact40-character commit SHA, the one approved league UUID and a single-line10–500-character audit reason. The script verifies event, workflow name/path, ref, SHA equality and league allowlist before reading or bypassing anything. Invalid/partial input fails closed. It still calls the live guard RPC; any additional blocking league refuses the whole run. Database failure, null/non-array payloads and malformed blocker records remain fatal. Every workflow checkout is explicitly pinned to github.sha; the web artifact is downloaded from the same run. The audit logs supplied scope, reason, GitHub actor/run/attempt and the original blocker result; it never says an excepted active draft has stopped.

Inputs are mapped only on workflow_dispatch. Push runs and engine dispatches without these inputs keep their existing guard behavior. No repository variable, engine workflow, database state or authorization change is included. The normal lint/types/build/tests and API-first→web dependency chain remain intact. New subprocess regression tests execute the real guard with mocked RPC replies and are included in normal script CI and the production gate.

The exception applies to the pre-deploy guard snapshot, matching the existing workflow's timing; it does not continuously lock draft state. A manual dispatcher still requires existing GitHub workflow permissions. No other deployment checks are skipped.

## Proposed dispatch after review

Do not rerun old34723184930 with these inputs: f19d0842 predates this workflow. After exact-head review/all normal checks and merge, resolve the new master merge SHA, inspect its delta and confirm it contains only PR475 plus this reviewed exception work relative to f19d0842. A push-triggered run remains normally guarded. If that run succeeds after genuine clearance, no exception dispatch is needed. Otherwise, once the push run is terminal, propose/execute one manual dispatch of production-deploy.yml on master with:

- release_sha: the newly verified full merge SHA (must equal the dispatched run's headSha)
- draft_exception_league: 3fd3e70c-fa85-432f-b98a-b29ce43a519c
- draft_exception_reason: User explicitly approved PR475 production release despite the verified Roster text auto-draft; exception limited to this release and league, with draft state unchanged.

Recheck all intervening changes before dispatch; if master moves, mismatch refuses deployment. Record the actual run ID and exception audit, API serving revision/digest, Hosting version and public artifact hashes, then obtain normal-cache authenticated Test/Finalsz score/navigation acceptance from the existing browser owner. Local252–265ms replay remains a virtual scheduling result, not a production benchmark.

No dispatch has been executed by this PR. Coordinator review of the exact tested change is required before invoking it. Sourceaa5/runtime30e, forecasts, league settings, injury baseline, histories and draft state remain untouched. Build19 still needs the client addition before device acceptance; existing archives are preserved and signing/install/upload remain unauthorized. Rollback is a reviewed revert through the normal workflow, not a projection rollback or draft mutation.

## Executed release

Coordinator reviewed final PR477 head `85d9e2c4ee3f6325ff03150381d89ff5f735ca8b`; all16normal checks passed (CI34723779537 and conventions34723795575). Local23guard integration tests,47script tests and strict script TypeScript passed. PR477 merged at22:54:20UTC as `43d52a2a878e1f4001527d4f9afc3f400d301fec`. Its tree equals the reviewed head; only the four approved workflow/guard/test/receipt files differ from f19d0842.

Ordinary push run34723992505 failed at22:54:56UTC on only Roster text, with both deploy jobs skipped. The approved manual dispatch [34724059444](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34724059444) used the exact43d52a2a SHA and the league/reason above. The guard audit at22:56:33UTC recorded actor Gstormsfh, run attempt1 and the original live blocker with last pick22:56:32.602167UTC. It did not claim the draft stopped. All remaining gates ran; the workflow reached terminal SUCCESS with gate, API, web and notify successful. The global override variable was absent before dispatch and after release.

At23:04:14UTC the workflow verified actual traffic on API `citrus-api-00320-kqr`, with both expected and serving digest `sha256:02a67bd781bbdb8c64b5e334270f01ac388f77978bf66b2bc4a138ad357ee2c0`. API health returned200. Firebase deployed Hosting version `8d85bf244cc57ffb`; public health, prerender and AASA checks passed.

Independent public verification at23:05:32UTC matched all eight selected artifact bytes, including index.html, sw.js, both index chunks, Matchup, FreeAgents, Roster and PlayerAvailabilityBadge. Public root/API health returned200 and index/sw retained no-cache,no-store,must-revalidate. Matchup-uhul4Xcx.js SHA256 is `74416d36eb6b50158adbc223221ea4c9383d8f42abb81eb552daa4b0f66d743e`; bootstrap files are index-BBgt5Rtl.js and index-CmAvEkeT.js. This verifies serving assets, not every client's upgrade or page performance.

A bounded read-only publication check at23:06:43UTC confirmed season2026 run06f1e1b4-8742-4cc5-bead-bfd1a63dd4d9, runtime30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce and sourceaa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1. No model refresh, source activation, settings/draft mutation or native action was performed. This bounded identity check is not a new full-table numerical audit.

Authenticated browser acceptance is recorded below when complete. Raw dispatch JSON, workflow logs, artifact and public hash receipt are retained under outputs/matchup-performance/release in the release workspace. Rollback remains a reviewed revert through the normal API-first/web release; retain prior14de Hostingda76c87419ce8521/API00319-nfn evidence. No rollback was needed. Do not use projection activation or draft mutations to roll back this client change.

### Authenticated acceptance — partial, navigation failed

The browser owner completed bounded normal-cache acceptance and restored both known week1 routes at23:09:38UTC. First Test load served priorCbn assets; one ordinary reload reached exactindex-BBgt5Rtl.js/Matchup-uhul4Xcx.js, without an UpdateReady notice, bypass or cache clearing. Testweek1 actual0/0 and projections224.2/224.0 matched; Finalszweek1 actual0/0 and projections128.6/108.9 matched.

Week navigation did not pass. Test Next changed URL to /2 while the selector remainedWeek1 and Previous disabled. Finalsz Next changed URL/selector to week2 Oct5–11 while central opponent/projections and dailySep28–Oct4 content remained from week1 and ViewMatchup was empty; after Previous changed the URL to /1, a later observation still showed week2 and AI Team2. Both initial routes/dates/scores were restored using the original URLs. No retained week2 network response or controlled timing comparison was available, so neither permanent failure nor causality from PR475 is asserted. Page and API cache source files are unchanged from14de; that is not proof that the behavior predates this release.

Guide receipt:8265/output/matchup-performance/ACCEPTANCE-43d52a2a.md. Deployment is successful but full Matchup navigation acceptance remains failed. Coordinator authorized a separate bounded deterministic reproduction and repair before another reviewed release. No navigation PASS or production speedup is claimed.
