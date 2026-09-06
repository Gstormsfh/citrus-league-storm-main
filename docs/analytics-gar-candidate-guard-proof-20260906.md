# GAR candidate preservation: local proof

Migration `20260906044310_guard_gar_candidate_replacement.sql` is UNAPPLIED.
Exact read-only production captures back up both rebuild overloads, the totals
helper and their dependencies. Original or byte-identical guarded definitions
are accepted; unknown drift is refused. Signatures, permissions, invoker mode,
replacement percentiles, shrinkage constants and component formulas are retained.

Both overloads lock recorded source tables then the output table at READ
COMMITTED. Invalid parameters/selection, absent requested inputs, missing or
invalid recorded probabilities/outcomes, nonfinite/negative/unknown TOI, missing
required rates and empty candidates cause rejection before replacement. The
underlying TOI rows are checked as well as the aggregate view, since aggregation
can hide malformed inputs. Unknown special-team rates with positive exposure
cannot become measured zero; legitimate zero-exposure defaults are retained.
Temporary-name collisions preserve caller data. Completed calls clean up only
their own temporary tables and support repeat invocation in one transaction.

The five-argument rebuild now applies the captured weighted totals formula only
to its rebuilt seasons; it no longer calls a global helper that changes unrelated
rows/timestamps. Goals per minor must be finite and positive before replacement.
The explicitly invoked zero-argument totals helper remains global, but rejects
invalid inputs before updating. A partially skipped calibration selection names
every skipped season, including `undefined` calibration, deterministically; an
all-skipped selection fails without clearing old outputs.

Sixty-six isolated PGlite checks pass: captured-formula parity for both overloads,
exact rejection/other-season snapshots, ordinary-role permission denial, service
success, legitimate zeros, temp collisions, idempotence and exact rollback.
Native PostgreSQL 17.6 passed twice with three independent connections and twelve
exact relation-lock witnesses per run. Raw-score/TOI corrections, invalid commits,
rollback, source/output writers, overlapping five-argument rebuilds and standalone
totals serialize. Both runs verified zero remaining fixture SQL objects/roles;
the disposable container was removed. Evidence:
`analytics-native-gar-races-20260906.json`.

Limits remain explicit: the four-argument legacy variant still includes goalies,
its total-rate semantics differ, and existing default-argument overload ambiguity
is not silently changed. Native races exercise the five-argument builder and
standalone totals; four-argument behavior is isolated-test coverage. Global goals
per minor retains its existing mixed-population dependency. These are recorded-
input and preservation guards, not source completeness, full model/calibration
lineage, teammate/opponent adjustment or predictive-quality proof. Full-table
locks can delay other writers until the outer transaction ends; whole-pipeline
lock order and hosted capacity need separate rollout validation. No hosted SQL
replacement, model fit, source correction or deployment occurred.
