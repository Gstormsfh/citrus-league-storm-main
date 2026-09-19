# Production contextual release, September 19

Work in progress. Do not confuse a passed preparation run with publication or paid-product acceptance.

## Published state at 05:28 UTC

- Atomic production publication committed: revision `c5afa098a549236a7913f815f87e40eca7289d7937258013041cb92f8d1d8e19`, run `f5dd1ffd-20a8-4959-87f2-1b8117942ba5`, source `70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255` unchanged.
- Cron 31/34 paused in the publication transaction. Replacement worker is publish-mode, scheduled 09:10 UTC. Separate collector is scheduled every five minutes. Both use named service accounts, one task and no retries.
- Independent collector `citrus-contextual-monitor-b5zsm` confirmed healthy against the exact published revision. Failure and missing-heartbeat policies are enabled on the existing operations email/SMS routes.
- Exactly one authorized Google test email was verified in the existing operations Gmail inbox at 05:10:45 UTC. Test policy disabled after receipt. Initial event preceded policy propagation and produced no incident; a checked same-policy re-emission, rate-limited to one notification per 24 hours, produced the one verified incident/email.
- First production publication was preceded by a rollback-only exercise of the exact generated request, two create-only/readback-verified private backups and outside-transaction verification of original active/ROS/daily row hashes and cron flags.
- Actual publication recovery envelope: `gs://citrus-fantasy-prod-research-evidence/contextual-worker/production-recovery/citrus-contextual-production-6qn4f/publish-1789794935113/recovery.json`, SHA `17ed0b633e4401ec0eafb7cc8038a6cb48d057bc6755f85a83ad1ba93187c3ea`. Its CAS becomes stale after any subsequent successful publication; never modify the envelope to bypass that guard.
- All five local export-service formats from this exact production revision passed 300-player / 2,550 raw-stat comparisons, interactive checklist verification and page-bound checks. Guide 109 pages, checklist six, compact sheets four. Sample renders inspected. Private bundle remains `publicationReady=false`, not paid acceptance.
- One actual recurring-path proof was invoked through the existing Cloud Scheduler job at 05:23 UTC: worker execution `citrus-contextual-production-nmh2k`. Still running at this checkpoint. This is a forced Scheduler invocation, not proof of a future scheduled cycle. Final private edition must follow its successfully published revision.

## Historical pre-cutover state at 04:54 UTC

- Production active revision remains `225619dbdd444a509c3b2291f6192147ad994cb8a157581eace972d470449db8`.
- Cron 31 (`50 8 * * *`) and 34 (`5 9 * * *`) remain active.
- Exact reviewed source `70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255` is staged, not active, as run `1db1df04-ea83-4919-ab70-03686d45ebab`.
- Production preparation execution `citrus-contextual-production-6qn4f` started 04:53:13 UTC. No publication allowed in this mode. Maximum 30 minutes, retries zero.
- Independent collector execution `citrus-contextual-monitor-jh8p8` emitted an affirmative unhealthy heartbeat with `legacy_cron_mode_mismatch`, correctly detecting the pre-cutover state. This is not post-publication acceptance.
- Runtime image: `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-prod/citrus-projection-worker/contextual@sha256:901b96560c81a32429c3753d4c14f1e525f40cd5455da59e266b3498cae227c9`.
- Production policy SHA: `26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd`. Source, numerical methods and September 21 expiry unchanged. Customer release remains false.

## Verified

- Operational patches passed full rollback-only production parity: 131,280 daily rows and 705 ROS rows, zero whole-row differences excluding generated daily UUID only. Exact preparation bytes preserved.
- Active recovery restored exact row images for 59,220 future daily rows, 705 ROS rows, prior active pointer and cron settings in a production rollback-only exercise. Distinct-run recovery and failure cases passed local PostgreSQL fixtures.
- Read-only health RPCs passed service-only access checks and rejected anon/authenticated callers. Public wrappers are SECURITY INVOKER; privileged reads live in the non-exposed `citrus_projection_ops` schema.
- Installed production migrations: `contextual_worker_operational_health` and `contextual_worker_reviewed_operations`. Re-read all four optimized definitions/owners/ACLs and matched the rehearsed bytes. No active/source-output/cron switch. Security advisor had no findings naming the changed functions; unrelated existing notices remain.
- Current health query was approximately 822 ms in the rollback rehearsal. This is one observed read, not draft-night load certification.

## Remaining work

1. Finish and independently verify the forced Scheduler publish-mode execution, especially the real completion RPC deadline and durable journal.
2. Re-export its final live revision, verify all five private formats and supply the payments task for controlled entitled-buyer acceptance.
3. Close the paid update-window/source-review gap; see `REVIEW-WINDOW.md` and `successor-review-20260919.json`. Sales remains off.
4. Preserve this clean operational implementation, exact receipts and old definitions. No dirty numerical worktree import.

## Concrete release evidence gap

The notification delivery gap is resolved by actual Gmail receipt. The remaining paid-window gap is not resolved: source release authorization, finishing approval and Gourde/James availability records expire September 21. McAvoy/Greig availability records expire September 29 (exclusive). Today's targeted primary-source review supports the current conditional scenarios; it cannot certify future camp events. An operational policy date edit alone cannot renew those source approvals. Current worker/collector reject expiry and retain the last complete forecast, with explicit failure alerts. This fail-closed behavior is not fulfillment of the advertised paid update window.

## Files and safety

`atomic-publication.mjs` owns the transaction and defaults to rollback. It writes both preimage and final recovery envelope through a caller-supplied create-only/readback-verifying sink before commit. JSON source/envelope text never passes through a JavaScript numerical reserializer.

`restore-active.sql` is operator-only session SQL, not an installed RPC. It requires the same database date/schema, exact current revision/output fingerprints, paused legacy jobs and no active draft. Restore source pointer, outputs and exact old cron settings in one transaction. Stop the replacement scheduler and verify no in-flight completion before restoring. Never delete immutable run/player history.

`prepare-production-image.mjs` verifies every artifact in the prior policy and generates only a small operational overlay on the exact passed image. No numerical files are imported from the dirty worktree.

Optional goalie calendar stays off. MIN alternative stays review-only. Forecast consistency is not a guarantee of future hockey accuracy. No Yahoo/ESPN scope, native upsells, paid flag activation or customer charges here.
