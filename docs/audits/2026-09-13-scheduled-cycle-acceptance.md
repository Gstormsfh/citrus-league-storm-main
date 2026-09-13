# Genuine scheduled projection cycle acceptance

**Verdict: the genuine scheduled31→34 cycle and current734 export editions are accepted within the checks below.**

September13,2026. Bounded read-only production observations of the real scheduled cycle, exact payload verification and current export regeneration. No manual refresh, activation, cron/service change, forecast policy change or application/native release was performed.

## Actual executions and binding

| Job | Genuine run | Started UTC | Completed UTC | Result |
|---|---|---|---|---|
|31, ROS refresh|275708|08:50:00.039313|08:51:20.472286|succeeded,1 row|
|34, daily materialization|275781|09:05:00.024209|09:05:19.362409|succeeded,1 row|

Both completions were independently read at09:06:09.551392 UTC. The published pointer read at09:06:46.734176 UTC remained:

- Source `aa5e6bc598b74f8f7873685c28233e2f9fe831ecb029bb0e87ae2b3ea04d53f1`, UUID `1764afb8-64e2-45a5-9a73-00387d52f6be`.
- New runtime `734ca84cbf8c3c5bb8b52c4f4be50aaeb7304df6b84f9da029f186a7725aa669`, UUID `9c6ffc26-1e7e-476e-afbc-e8de55f9b0c2`; parent runtime30e.
- `last_refresh_status=success`, null error. Refresh and activation metadata are `2026-09-13T08:50:00.03978+00:00`, the transaction timestamp. Actual job completion and independent visibility times above are separate evidence.

The daily job consumed the refreshed runtime without creating another revision. This is actual postpublication scheduler acceptance, not a simulated/manual invocation or a claim based only on a configured schedule.

## Preserved source and verified outputs

Exact approved aa5 source, serialized read-only by local PostgreSQL, matches live PostgreSQL source SHA256 `4ddf4eea4fd1c6709358f7275817a904379d9757944eb5c7e0fa0a9e08a52507`. Its retained original file SHA256 is `ca3af814c11e045acec9a0b4c908a6c242d139f54d507b2f569fbee28e9f968b`.

Exact new runtime raw SHA256 is `7e46d9cedfe8363a9c0ee071415ff8aeb28bb217d9310a0ec9ccb14130e21e58`; its exact revision preimage SHA256 is734ca84c above. The existing gcloud-backed psql transport required expired-account reauthentication, so retrieval used working read-only Supabase MCP queries. SQL-proven field changes were applied to retained exact PostgreSQL bytes and checked against both live hashes. No float reserialization or authentication workaround was used.

Semantic differences from30e are only674 `remaining.as_of` dates,588 plus/minus component `as_of` dates and3 top-level lineage/refresh fields. One zero-count object (player8484220) has shorter PostgreSQL zero formatting; its numeric values are unchanged. All source/rate/count/exposure values, manual availability, roles, notes and history remain intact. The payload's top-level source `as_of` remains September12; refreshed computational dates do not create new injury observations.

| Check | Result |
|---|---|
|Published coverage|674 projected,650 rates-only,1 unresolved;674 ROS and56616 daily rows|
|Output binding|All ROS/daily rows stamped with734 runtime/run; daily method `canonical_expected_volume_v1`|
|Rate × workload once|5624 numeric source-component checks,0 discrepancies; schedule84 and MODEL skater ceiling83 retained|
|Each daily allocation|473760 category comparisons,0 mismatches,maximum error0; daily workload comparisons0 mismatches|
|ROS and summed daily categories|5640 comparisons each,0 mismatches; ROS error0,largest summed daily difference4.2e-15|
|Default points|ROS and summed daily points match category weights;0 mismatches,largest summed difference3.6e-15|
|Signed/zero/missing plus-minus|306 negative skater counts,1 genuine zero,1 missing retained|
|Saved league scoring|All70 settings equal; scoring hash `e13cfa2f83a7a930dce05e40eaffc5a5` retained|

The only broader league-settings difference from the September12 baseline is Rostertext league `3fd3e70c-fa85-432f-b98a-b29ce43a519c` gaining `draftCompletedAt=2026-09-12T23:10:35.848199+00:00`, before this cycle. It is not a scoring change or a refresh-time mutation.

Tanev, Mikkola and Tij availability remain unknown; Tij plus/minus remains unavailable. Manual workbook adoption remains owner adoption, not independent fresh reporting. Expected goalie starts are forecast exposure, not confirmed starters. No missing value was forced to zero.

## Durable evidence

Read-only receipts and exact734 payload/preimage: `/Users/gstorms/.codex/worktrees/matchup-load-critical-path/citrus/outputs/scheduled-cycle-20260913/`. Entry files: `actual-cron-completion.json`, `outputs.json`, `source-equality.json`, `reconstruction-proof.json`, `semantic-delta-proof.json`, `each-daily-row.json`, `category-identities.json`, `default-scoring.json`, `local-invariants.json`, `league-differences.json`. SQL identity comparisons use numeric tolerances1e-8 for aggregate comparisons and1e-10 for daily comparisons; observed maxima are reported above. Raw output fingerprints are fresh observations, not asserted equal to old text hashes across numeric formatting and metadata changes.

## Current exports and completion

The export owner completed734 regeneration and current bindings at09:11:24 UTC. Both default and Finalsz193-page PDFs passed full validation plus representative visual review. Both workbooks passed2650 cached-score checks;43771 formulas and62536 numeric cells are unchanged from30e v2. All11377 history records per workbook reconstruct losslessly, with maximum cell text30000 UTF-16 units. Default has674 ranked/651 unavailable profiles; Finalsz673/652, preserving scoring-dependent missing-value treatment.

The approved durable a5db32b0 exporter ran directly. `Export Current 734 Workbooks.command` passed `--check`; current input/launcher bindings point to734, with unique future output paths. Prior30e indices and launchers were archived and all prior artifacts retained. Running local servers8765/8766 were **not rebound or verified** and may still show historical30e; current export/launcher acceptance does not certify those server sessions.

Current artifact index: `/Users/gstorms/.codex/worktrees/8265/citrus/output/canonical-review/LATEST-REVIEW.json`. Export receipt and full artifact hashes: adjacent `scheduled-refresh-734ca84c/ACCEPTANCE.md` and `FINAL-MANIFEST.json`. The integration independently rehashed all22 manifest path/hash pairs successfully; manifest SHA256 `e2ae3ce05284ee520ad200127a60db860fd7b81b3c84b80b3f1ba2ba436c716c`. Independent verification is saved as `export-manifest-independent-check.json` beside the cycle receipts.

The pending first-cycle observation and export work are complete; the coordinator can close its one-time pending-cycle monitor. Alert delivery, production performance, updated native/device acceptance and unknown legacy cache ownership remain separate previously recorded boundaries. No new broad investigation or release is required by this acceptance.
