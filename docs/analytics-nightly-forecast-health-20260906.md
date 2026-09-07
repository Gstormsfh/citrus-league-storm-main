# Nightly forecast availability correction — local, not deployed

The actual `nightly_projection_batch.py` parent now reconciles each submitted
task before any per-game, ROS or matchup write. This closes a specific failure
path: absent/failed workers previously disappeared while the job reported
completion and continued to rebuild downstream projections.

`calculate_projection_outcome` transports explicit availability and only the
current task's xG-input failure-counter deltas across the process boundary.
An input failure cannot be hidden by a partially returned forecast. Old failures
in a reused worker process do not invalidate unrelated later tasks.

`projection_batch_health` requires one outcome for every unique submitted
player/game/date/season identity. It verifies exact integer identities, dates,
role and finite role-specific physical/scoring values. Metadata-only rows,
NaNs, invalid probabilities and incompatible skater populations cannot reach
the writer's old missing-column defaults as fabricated zero forecasts. Genuine
zero values and negative league points remain valid. A shutout is not required
to be a win. The skater point-component guard explicitly allows the worst-case
rounding difference from four independently rounded thousandth-unit values.

Both sequential and out-of-order process-pool completion paths retain task
binding. Incomplete or malformed results exit **2**, including in dry run,
before any write. Empty schedules cannot certify a completed season without
affirmative source evidence. Existing projection rows are preserved but their
mere existence cannot certify source/model freshness: attempted reuse exits 2
before calculating new rows. No forced refresh or deletion is introduced.

If per-game write requests are only partly acknowledged, ROS and matchup
refreshes stop and the job exits 2. Some per-game writes may already exist; the
health record explicitly says **not rolled back**. These counts represent
successful `return=minimal` requests, not independent persisted-row readback.
The unchanged external ROS cron remains a separate writer and rollout gate.

The [engine correction](analytics-live-model-gap-20260906.md) separately stops
missing xG from becoming zero and rejects a team xGA rate whose denominator
summed player TOI rather than team elapsed exposure. That exposure provider is
still missing. Together these changes can withhold most skater forecasts and
stop existing-row reuse. They are deliberately **not ready for automatic
production rollout**. Supply verified exposure, exact source/model lineage,
complete freshness-aware refresh/reuse, atomic publication and independent
downstream coverage before deployment. Service calls stay off draft hot paths;
the complete reads need measured batch-load testing before hosted activation.

The schema-review skill's affirmative-health requirement drove this correction.
This is a submitted-task and minimum output-structure contract—not verification
of the original schedule/player universe, physical-forecast calibration, league
scoring, protected mutation authorization, atomicity, or FPAR readiness. Other
legacy defaults and scoring pathways are not endorsed by passing these tests.

Regression tests use the actual main routine with synthetic database/worker
fakes. They cover absent/throwing/wrong-scope results, cross-process order,
counter isolation, incomplete inventories, unverified reuse, partial writes,
malformed/zero physical outputs and untouched ROS behavior. The old ROS fixture
was expanded to supply explicit complete synthetic forecast fields; its original
expectations were not weakened. No test opens a hosted database.

Historical engine and runner source remain in the previous verified source
archive. Current source intentionally differs; old receipts have not been
rewritten to claim otherwise. Production and hosted data are unchanged.
