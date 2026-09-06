# On-ice replacement guard: local proof

Migration `20260906044353_guard_onice_rebuild_inputs.sql` is UNAPPLIED. The exact
production definition captured read-only has MD5
`f4ef097e9e3c66a52b0882fc6d130e29`; its standalone capture is the rollback backup.
The guard accepts only that original or the exact guarded definition on replay.
Unknown drift is rejected. Existing ACLs and SECURITY INVOKER are preserved.

The guard validates explicit unique requested games, recorded non-shootout shot
identities, scores, clocks, teams and usable shift identities. It locks the five
source tables and the output table in the documented order at READ COMMITTED,
then stages attributed rows and replacement aggregates before deleting anything.
Every recorded eligible event needs unambiguous attribution to both teams.
Caller-owned temporary relations cause rejection, never deletion; only staging
created by the successful invocation is removed. Completion markers remain the
responsibility of the original batch function, whose transaction rolls back on
failure without needing a separate change.

Forty-six isolated PGlite checks pass, including exact ordinary-output math,
probability endpoints, shootout exclusion, repeated calls, caller temp-data
preservation, ACL preservation, migration replay, drift rejection and exact
rollback. Native PostgreSQL 17.6 passed twice with three independent connections
and ten exact relation-lock witnesses per run. Tests cover all source writers,
invalid/corrected source commits, source rollback, output writes and overlapping
builders. Invalid input preserves exact prior output rows and completion markers;
other-game output rows remain unchanged. Each native run left zero fixture
objects/roles, and the disposable container was removed. Evidence:
`analytics-native-onice-races-20260906.json`.

These checks establish basic recorded-event, both-team attribution and synthetic
concurrency behavior. They do not prove complete skater/shift coverage, official
goal/SOG adjudication, source/model lineage, the legacy flurry methodology's
quality, or deadlock freedom across unreviewed writers. Full-table SHARE locks
block concurrent writers until the outer transaction completes; hosted runtime,
whole-nightly-pipeline lock order and draft-night load remain rollout gates.
No production or staging function replacement, rebuild or row write was run.
