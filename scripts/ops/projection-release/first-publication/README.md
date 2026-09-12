# First committed publication: capture and recovery

This is the required activation wrapper for a **first publication only**. It is not approval to publish the source and does not alter source review metadata. The supplied run must already be staged, validated, explicitly reviewed and authorized for publication. No connection is inferred: provide an explicit psql command using a preconfigured service or other reviewed connection selection. Never put passwords in command arguments.

Example commands with deliberately non-executable identifiers:

```sh
python3 scripts/ops/projection-release/first-publication/run.py activate \
  --psql-command-json '["psql","service=reviewed_release_target"]' \
  --season 2026 --run-id REVIEWED_RUN_UUID --revision REVIEWED_SOURCE_REVISION \
  --bundle /secure/recovery/unique-first-publication.json

python3 scripts/ops/projection-release/first-publication/run.py restore \
  --psql-command-json '["psql","service=reviewed_release_target"]' \
  --bundle /secure/recovery/unique-first-publication.json
```

The backup parent directory must already exist. The file must not exist: `O_EXCL` prevents overwriting an earlier recovery bundle. The operator process needs local write/fsync permission and database privileges for the existing activation RPC, table locks, source reads and guarded restore. The read-only production check established `pg_control_system()` works for Supabase `postgres` despite SUPERUSER=false; no extra grant was added. The local full-schema test uses the same non-superuser administrator role.

## Exact transaction boundaries

`activate.sql`, `restore.sql`, and `context.sql` are the exact psql-executed SQL. `run.py` supplies only the explicit request/bundle as a dollar-quoted JSON value and transaction control; it does not implement another scorer or write a permanent backup table.

Activation opens **READ COMMITTED**, sets a 10-second lock timeout before obtaining the seasonal advisory lock, then locks active/ROS/daily tables in that order. It refuses any existing active run in **any season**, because ROS is a single global compatibility cache. Under those locks it captures the current database date, physical database identifier, schema/security/function fingerprints, all ROS rows, and only the requested season's daily rows on/after that date. It then calls the existing canonical activation RPC and captures expected post-activation fingerprints.

The runner saves the exact JSON returned by PostgreSQL inside a SHA-256 envelope. The raw JSON is preserved as text so high-precision numeric values are not rounded through Python floats. It creates the file with mode 0600, flushes/fsyncs the contents and directory, and **only then sends COMMIT**. Failure to save the backup terminates the session, rolling back the open activation. This fresh capture is at the actual activation boundary; an earlier deployment/preflight snapshot is not a substitute.

Recovery independently opens READ COMMITTED, acquires the same lock order and verifies envelope integrity, physical database/schema, captured calendar date, exact active run/revision, and every protected post-activation row hash. It refuses all mismatches; it does not refresh the expected hashes or bypass CAS. It clears only the active pointer, retains immutable run/player history, restores all ROS rows and exactly the captured season/future daily scope, verifies pre-state hashes, then **COMMITs separately**. Historical daily rows and other seasons' daily rows are outside this restoration scope. The write guard permits restore after the first active pointer has been removed.

The bundle is bound to the same database date and schema. A later date, another activation, a legitimate intervening materialization, or protected output changes require a new reviewed recovery plan. Do not modify the bundle to force acceptance. A database administrator who deliberately changes functions, grants, triggers or evidence remains a trusted administrative boundary.

## Operational limits

Both transactions hold output table locks and may contend with live writers. A lock timeout/deadlock aborts the whole transaction; investigate and retry the appropriate complete operation. The row bundle can be large: a canonical workload of 674 players has 56,616 daily rows, and the backup size depends on the actual pre-activation cache, not that illustrative count. Allow sufficient disk, memory and lock-window time. SQL aggregates and the Python runner currently materialize the JSON bundle in memory; this is not a streaming large-database backup tool. The saved bundle can contain private player/source metadata; retain it in the operator's secure recovery location.

A disconnect or interruption after COMMIT was sent can leave an **uncertain commit outcome**. Preserve the saved bundle and inspect the exact active run/revision and protected fingerprints before doing anything else. Do not automatically re-run activation or report rollback merely because the process failed. Backup existence proves durable capture, not successful commit. If activation rolled back, there is no active pointer and restore will refuse; that is expected. A committed recovery preserves history but does not mark that immutable published run as deleted or silently rewrite it.

## Rehearsal evidence

Run on an explicitly retained isolated full-schema fixture:

```sh
python3 data-pipeline/tests/rehearsal/rehearse_first_publication_recovery.py \
  --container citrus-canonical-rehearsal-EXPLICIT_ID \
  --output-dir tmp/projection-audit/first-publication-recovery
```

The fixture uses real legacy/canonical writers with the write guard installed, six synthetic projected players, and fresh legacy outputs. Its first activation and recovery are separately committed; the six ROS/eight prior daily rows are restored by exact fingerprints. Run/player history remains. File-save failure, corrupted envelope, stale CAS, calendar/schema/hash mismatch all refuse safely. A second committed activation followed by an actual committed canonical materialization invalidates the original recovery bundle, and the test leaves that newer local publication intact rather than overwriting it. The operator-created backup is retained when `--output-dir` is supplied.

See `docs/verification/first-publication-recovery-20260912.json`. This is **synthetic recovery proof**, separate from the 674-player actual-source test-copy workload proof in `canonical-source-activation-test-copy-20260912.json`. Neither is production activation or user publication approval.
