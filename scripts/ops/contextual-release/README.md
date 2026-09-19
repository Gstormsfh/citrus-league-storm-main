# Production contextual forecast operations

This directory contains the narrow operational release overlay, not a replacement numerical model. Numerical methods and inputs remain in the immutable reviewed base image. Do not import the dirty research worktree into an application release.

## Deployed contract

- Project: `citrus-fantasy-prod`; database project: `iezwazccqqrhrjupxzvf`.
- Worker: `citrus-contextual-production`, two CPU / four GiB, one task, zero retries, 30-minute bound.
- Collector: `citrus-contextual-monitor`, separate service account and five-minute schedule. Read-only service RPCs, journal reads and worker execution reads.
- Daily Scheduler: 09:10 UTC, after verified upstream jobs 19/20/22/32/33. Every worker still checks actual upstream completion and freshness; the clock alone is insufficient.
- Legacy writers: cron 31/34 paused atomically with first contextual publication. Their exact definitions are preserved, not deleted. No automatic fallback to flat allocation.
- Active source: `70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255`.
- Deployed image: `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-prod/citrus-projection-worker/contextual@sha256:901b96560c81a32429c3753d4c14f1e525f40cd5455da59e266b3498cae227c9`.
- Worker operational policy: SHA `26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd`, exclusive review boundary September 21. See `REVIEW-WINDOW.md` for the accepted review process. Internal review deadlines are separate from the customer's update-access window.
- Independent monitor-only amendment: image digest `sha256:c5fe621eb29a1bdc1b9f63d94f5d686eb00f6226faebfcc0ab5a18954d513214`, policy SHA `f0d16c781c839e4401f0715e28cf274a263885b3bc463d4f8731a39dadb51c37`. Adds 24-hour review notices. Worker image, source, numerical methods and every expiry date remain unchanged.

The `runtime/` files are copied to `scripts/ops/` inside that image. Their imports deliberately reference the image's reviewed model package, not a second checked-in copy of numerical code. `prepare-production-image.mjs` verifies every bound base input/method/evidence file before producing the operational overlay.

## Evidence boundaries

1. Preparation writes exact candidate, context and completion request to create-only private storage, with SHA metadata and independent readback verification.
2. `audit-prepared-attempt.mjs EXECUTION NEW_DIRECTORY` verifies a prepared-only attempt. An explicit third argument `published` instead requires successful worker completion bound to the same request. The two modes cannot substitute for one another.
3. `audit-prepared-population.py` reuses the existing independent population auditor on the saved exact request. It validates every skater/game, category conservation, exposure, simulation fields and conditional exclusions. This is a consistency check, not prospective accuracy certification.
4. `publish-prepared.mjs ... rehearse` executes the real publication and cron pause inside a transaction that rolls back. `verify-publication-rehearsal.mjs` independently verifies restored row hashes, prior cron flags and absent rehearsal run.
5. `publish-prepared.mjs ... publish` requires concrete hashed readiness receipts, creates and independently verifies both external recovery envelopes before commit, and writes a post-commit operator journal receipt. Lost commit acknowledgement is explicitly uncertain. Inspect database and saved intent before any retry.
6. The normal worker then performs guarded service-RPC completion. Independent monitoring validates the live revision, complete outputs, execution status and immutable completion journal. Failed/killed/stale workers, wrong revisions, missing categories and a missing checker fail loudly.

## Recovery

The SQL in `restore-active.sql` is session-local operator tooling, not a public mutation API. It refuses mismatched date, schema, active revision, output hashes, cron flags or draft state. Stop the replacement Scheduler and verify no in-flight worker before an authorized recovery. It restores captured exact row images, prior pointer and old cron flags atomically, preserving immutable history and other seasons.

The September 19 first-publication recovery envelope is **not** a timeless restore point. After another successful publication, its compare-and-swap guard must refuse it. Never edit a saved envelope or its expected hashes to force restoration. Diagnose and create a separately reviewed recovery operation for the current state.

Original production definitions, reviewed patches and previous staging closeout remain in the private September 19 evidence archive documented in `PROGRESS.md` and the release handoff. No historical definitions were deleted.

## Tests and private acceptance

Run `node --test scripts/ops/contextual-release/*.test.mjs` for portable operational guards, recovery fixtures, rollback behavior, journal verification and alert configuration.

Python runtime tests require the hash-verified base image's model dependencies and the existing contextual runner fixtures. Import this directory's `runtime/` before the image's `scripts/ops/`. Do not point those tests at a newer unreviewed research package and call the old image verified.

`export-production-edition.mjs REVISION NEW_DIRECTORY` reads an exact repeatable-read production snapshot and independently verifies Decimal-preserving payload/preimage pairs. Its receipt remains customer-ready false. The application export service, all-format parity check, PDF visual review and controlled entitled-buyer flow are separate acceptance steps.

Today's source review, render parity and healthy collector do not promise future hockey accuracy or certify future camp reports. Retain uncalibrated interval labels, explicit scenario semantics, the review-only MIN alternative and disabled optional goalie calendar. Never set a paid-ready flag from this README.

`review-current-source.mjs BASE_IMAGE_FILES OLD_PRODUCTION_OVERLAY EXPORTED_SOURCE NEW_RECEIPT` independently rehashes the bound release artifacts and compares the full current source to the immutable reviewed source. It records the retrospective evidence limitations and exact next scenario reviews. It does not approve future facts or extend dates.

`prepare-monitor-review-image.mjs OLD_POLICY NEW_DIRECTORY` builds only the monitoring overlay against the pinned production image. `activate-review-notice.mjs NEW_RECEIPT_DIRECTORY` requires a real healthy heartbeat containing the new notice fields, uses the existing operations email only, avoids duplicate policies and sends no test event. Do not rerun historical first-install scripts to add this notice.
