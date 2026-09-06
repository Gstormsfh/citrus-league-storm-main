# Local model → publication → reader checkpoint

Status: two fresh native runs completed; diagnostic transport verified. Model,
foundation, production serving and FPAR are **not accepted**. Production and
hosted databases are unchanged.

## What passed

The completed runs use the preserved first-party development model evidence,
not MoneyPuck files or legacy model deserialization. Each rehashes the full
shape checkpoint, re-evaluates the selected saved JSON calibration map on every
validation event, and publishes complete game-level diagnostic batches through
the actual Python publisher, disposable PostgreSQL/PostgREST and the actual
TypeScript publication reader. This composes with the earlier source/raw-tree
and cross-language inference proofs; it is not a new independent PBP parser or
a claim that this run alone repeated every earlier model-fitting step.

| Retained development scope | Eligible events | Game diagnostics |
|---|---:|---:|
| Fold 1 regular | 112,199 | 1,291 |
| Fold 1 playoff | 7,881 | 87 |
| Fold 2 regular | 113,607 | 1,298 |
| Fold 2 playoff | 7,426 | 85 |

Both runs produced identical diagnostic values. The separate review independently
re-aggregates the retained event predictions and checks exact game membership,
exposure and value equality. It verifies 12,971 bound files. These are eligible
validation-game diagnostics, **not player totals or full-season official actuals**.

Each run verifies:

- Four original batches with exact database value roundtrips, unchanged source
  age, complete pagination and idempotent publication replay.
- A synthetic local withheld value becoming explicit NULL, followed by an
  explicit rollback to the immutable original batch. Source age is not reset.
- Six actual-reader passes, each rejecting truncated pages, duplicate identities,
  invalid available/NULL pairs, detached model-version metadata and failed pages.
  Each also checks stale NULLs and seven absent wrong scopes.
- Actual database refusal of incomplete and failed-validation batches; unchanged
  original and synthetic-correction database evidence afterward.
- Sixteen precise table-permission denials: reads and writes for both anonymous
  and authenticated roles across all four private evidence tables. A token error
  cannot substitute for PostgreSQL SQLSTATE 42501 table denial.
- Six publication events; final disposable tables contain seven snapshots,
  seven batches and 6,633 values, including retained rejected-batch evidence.
  All four tables have RLS enabled. This is not an audit of every database policy.

The metric is explicitly named `disposable_local_development_game_xg_diagnostic`.
Its passed gate is **diagnostic transport only**. Model/foundation acceptance and
publishability remain false throughout. No scoring calculator or fantasy points
are changed; the metric is not serving-exported or enabled in the application.

## Reproducibility, failures and safety

Completed evidence roots:

- `scripts/proof/results/local-model-publication-20260906-1119`
- `scripts/proof/results/local-model-publication-20260906-1122`

The three earlier failed attempts are retained unchanged:

1. `1103`: the first launcher's tmpfs inspection assumption did not match Docker's
   legacy `--tmpfs` representation. It stopped before database/model setup.
2. `1107`: live tmpfs verification passed, but the internal-network configuration
   did not yield a usable published host port. It also stopped before setup.
3. `1110`: every diagnostic/reader/rejection phase passed; the permission test
   incorrectly expected anonymous denial to be HTTP 403. The actual response was
   HTTP 401 with SQLSTATE 42501 and the correct denied table.

The correction is versioned in proof v2 / infrastructure v4. Original launchers,
Python v1, model/aggregation bodies, migration, clients and actual reader remain
unchanged. The classifier requires exact role, HTTP status, SQLSTATE, table and
client envelope. PostgREST documents anonymous 42501 as HTTP 401 and authenticated
42501 as HTTP 403; invalid-token 401 responses have different codes.
[PostgREST error reference](https://docs.postgrest.org/en/stable/references/errors.html)

Fixtures use pinned PostgreSQL 17.6 and PostgREST images, task-owned bridge
networks, explicit verified loopback host ports, bounded memory/CPU/pool settings,
and configuration plus live-kernel verification of the database tmpfs mount.
This is not an egress firewall or hosted-load proof; tmpfs is not a guarantee
against host swapping. Only fixture-created synthetic JWTs are used.
[Docker tmpfs documentation](https://docs.docker.com/engine/storage/tmpfs/)

All five attempts retained logs and ownership-checked cleanup receipts. Only
their disposable containers/networks were removed; zero owned containers remain.
Original evidence files and Docker images were retained. No hosted connection,
deployment, push, merge or production change was performed in this checkpoint.

## Verification and preservation

- Full offline Python: 1,742 passed; 16 network tests deselected; 33 existing
  datetime-deprecation warnings. A preceding invocation from the repository root
  failed one pre-existing subprocess-import test because `projections` was not
  on that child's path; 1,741 passed and 16 self-skipped. Rerunning unchanged tests
  from the supported `data-pipeline` working directory resolved that invocation
  issue. The failed invocation is recorded, not counted as a successful run.
- Publication-reader server tests: seven passed. Server type checking and strict
  standalone proof type checking passed.
- Infrastructure contract tests: 17 passed. New checkpoint tests plus the frozen
  shape-checkpoint tests: 57 passed (39 new, 18 prior).
- All 51 separately indexed prior artifact/result/archive pins still match,
  including the original prospective reservations and 17 legacy artifact files.
  Those legacy files were hashed, never deserialized by this proof.

The [machine index](analytics-model-publication-result-index-20260906.json)
pins both run health receipts and the complete review. The create-only archiver
retains selected tracked source and both successful/all failed run evidence,
review and verification records. It checks every archive member against its
original without extraction. This remains a local duplicate, not off-machine
backup, an inventory of every external input, or quality acceptance.

## Next foundation work

This closes the bounded local diagnostic publication lane. It does not resolve
the earlier mid/high-probability calibration bias, subgroup regressions, source
quarantines, remaining writer/exposure coverage or hosted operational gates.
Keep all old research, raw observations, actuals, models and prospective
reservations unchanged.

Next trace a bounded first-party player/goalie attribution and exposure contract
from canonical event identity through local scoring and complete-population
aggregation, including traded players, regular/playoff isolation and missing
attribution. Keep it separately named and non-serving until actuals and model
quality gates pass. Audit the full nightly dependency path where the existing
native fixture still has no eligible v5 rows; diagnostic transport alone must
not silently mark that gap complete.

Only after foundation and physical-forecast gates genuinely pass should FPAR
consume validated horizon, participation, category/plus-minus availability,
eligibility and jointly feasible replacement assignments. No amount of passing
transport tests establishes industry superiority or authorizes that promotion.
