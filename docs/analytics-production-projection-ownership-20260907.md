# Scheduled projection ownership repair

Merged [PR 416](https://github.com/Gstormsfh/citrus-league-storm-main/pull/416) at `d6f5b04135bc3d9dee657909720d3a023f1493f4`. The isolated change contains the workflow, standard-library checker, tests and telemetry runbook only. No unrelated research files or dirty pipeline changes were deployed.

## Production evidence and decision

The active database cron jobs `rebuild-ros-projections` and `rebuild-projected-stats` rebuild at 08:50 and 09:05 UTC using `get_projection_target_season()`. Both most-recent inspected runs succeeded. The older GitHub Python batch instead selected the outgoing season and exited successfully without producing projections. Leaving both writers scheduled also risked overwriting the SQL-owned outputs when the calendar rolled over.

The workflow is now `Projection Output Health`, scheduled at 10:30 UTC. It reads the database-selected season, exact schedule/output counts and oldest applicable update timestamps. Missing outputs when games remain, malformed counts, read failures, null timestamps, future timestamps and timestamps older than 36 hours fail the check. An empty remaining schedule produces an explicit `not_required_no_remaining_schedule` result, not a claim that projections were rebuilt. It does not independently certify that the schedule itself is complete.

The SQL writers and their calculations are unchanged. The Python source remains preserved for deliberate development/manual use, but this workflow no longer executes it. Its additional `team_matchup_difficulty` output table is absent from production; inspected active app/server code contains no reader for that table. This is not a certification of every legacy input or every possible external consumer.

## Verification and limits

- Seven standard-library unit tests pass, including failure cases and GET-only requests.
- Branch production check [34085945130](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34085945130) succeeded and recorded its structured read-only result in `ops_ci_runs`.
- All repository PR checks passed on head `3d7f34c5a49defede2f19ed8f2223465cb2120fe` before merge: builds, type checks, web/server/shared/script/Python tests, lint, security and migration validation.
- Post-merge master verification run [34086339822](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34086339822) completed successfully.
- The check validates availability and row freshness only. It neither proves complete player/game coverage nor measures forecast accuracy; these limitations are also emitted in the machine-readable result.
- Four bounded GET requests replace a dependency-heavy calculation job. No projection/model mutation, app scoring change, RLS change or new API endpoint is introduced. Existing CI telemetry remains the only workflow write.

Rollback: revert the isolated merge commit if necessary, reviewing the reintroduced competing writer before restoring its schedule. Do not disable the existing database cron jobs as a rollback step. Historical workflow names remain in the telemetry runbook query so older no-op successes stay visible.

The offline improved xG candidate remains non-serving. This operational repair does not close calibration, original-feature, talent, production model-admission or FPAR gates.
