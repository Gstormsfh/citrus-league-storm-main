# Nightly analytics transaction lock audit — 2026-09-06

Status: **implemented LOCAL / UNAPPLIED, bounded cooperating-transaction proof passed twice** on disposable PostgreSQL 17.6. The original composed lock-upgrade deadlock was reproduced first; the protocol then serialized the tested compositions. See [deadlock evidence](analytics-native-nightly-deadlock-20260906.json) and [two protocol runs](analytics-native-writer-protocol-20260906.json). Both protocol runs verified zero SQL fixture residue; root removed the exact container and verified no matching labeled container remained. No production/staging mutation or model execution. Full nightly dependency integration and workload capacity remain unverified.

## Exact evidence and scope

`supabase/migrations/captures/2026-09-06_nightly_lock_audit.json` preserves eleven complete same-day `pg_get_functiondef` results, MD5, ACL and security-definer flags. Queries used `BEGIN READ ONLY`, a local 20-second statement timeout, and `ROLLBACK`. No source rows or credentials were exported.

Key pins: nightly `d2d83cd96d845d95d9bbe14bf3128471`; official scorer `df49815cab7c24d6f733b680806c8184`; shift repair `d3c95d8be8b38dbf77b636e94c82f3c7`; legacy scorer `3016295a18bc999083fbeb9e12ba2fe6`; rink writer `3066f66cecf420c47cf503359d90560c`.

Read-only cron discovery found one matching named job, `nightly-xg-pipeline`, active, schedule `35 8 * * *`, command MD5 `8ebdade161875e875c2dd2e3ac5937a9`. This is not evidence that arbitrary manual transactions or other indirect jobs cannot overlap. A single scheduled job's run policy also does not exclude a manual invocation.

## Actual composed order

`nightly_xg_pipeline()` is a function: its nested calls share the caller's transaction; none commits between stages. Locks obtained before a successfully completed subtransaction remain held to outer transaction end. A caught failed subtransaction releases locks acquired inside that failed subtransaction, not locks acquired earlier by the outer transaction.

| Stage | Actual writer / input | Locks retained into later guard calls |
| --- | --- | --- |
| Score official rows | `citrus_score_v5_batch` updates `raw_shots` | `RowExclusiveLock(raw_shots)`, including a zero-row UPDATE |
| Repair clocks, caught exception block | `citrus_repair_shift_clocks` inserts repair log and updates shifts/build markers | Successful repair holds RX on shifts, repair log and `strength_build_state` |
| Build strength | batch → `rebuild_strength_intervals` delete/insert intervals; upsert build state | RX on `game_strength_intervals` and build state |
| Build TOI | batch → `rebuild_toi_by_state` delete/insert TOI; update build state | RX on `player_toi_by_state` and build state |
| Build on-ice | exact batch → guarded `rebuild_onice_xg`; stamp build state | Guard requests SHARE on raw shots, shifts, game teams, intervals, era config, then SRX on on-ice output |
| GAR, caught exception block | five-argument component builder → totals recomputation | New guard source locks may upgrade earlier on-ice/TOI writer locks; failure is reported as `gar=-1`, not a fatal nightly exception |
| Legacy arena/scoring | arena upsert; rink adjustment; SQL scorer | RX on arena and `nhl_shots` |
| Legacy season refresh / GSAx | guarded season refresh then guarded GSAx | SHARE on `nhl_shots`; output locks retained through audit insertion |

RX = ROW EXCLUSIVE; SRX = SHARE ROW EXCLUSIVE. Source SHARE conflicts with another transaction's RX; RX locks are mutually compatible. These rules and transaction lifetime are documented in [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).

## Concrete unsafe compositions

1. **Two composed scorers then on-ice builders:** A and B both acquire RX(raw_shots) in the exact scoring function, even with nothing to score. A requests SHARE(raw_shots) and waits for B. B requests SHARE(raw_shots) and waits for A. One transaction must abort. The standalone on-ice guard does not encounter this upgrade when called from a fresh transaction, explaining why its independent RPC tests can pass.
2. **Legacy score then refresh:** both transactions can hold RX(nhl_shots) from the exact rink/scorer UPDATE and then request SHARE(nhl_shots) in the season guard. This is the same upgrade class, not yet a separately witnessed native scenario.
3. **Manual reverse dependency composition:** a transaction that first rebuilds strength/TOI and later invokes on-ice may hold interval/TOI RX before requesting raw SHARE. Another composed writer can hold raw RX before waiting on those downstream relations. Reviewed function-local order cannot establish the order of an arbitrary caller transaction.
4. **GAR failure visibility:** a deadlock or lock timeout arising inside the nightly GAR exception block can be converted to `gar=-1` while other nightly work continues. This is not a success proof for GAR and must not be hidden by a single overall cron success indicator.

The Python shift ingestors issue separate REST upserts (`data-pipeline/acquisition/ingest_shiftcharts.py:95`, `backfill_shifts.py:218`); legacy raw acquisition upserts appear in `data_acquisition.py:2129`. Their separate requests do not demonstrate a single composed transaction, and arbitrary trigger/transitive-writer lock order is not certified here. The rebuild runbook directly exposes batch entrypoints (`docs/SHIFT_AND_XG_REBUILD_RUNBOOK.md:122`, `:255`), so testing only the named nightly entrypoint would leave a material manual-path gap.

## Native harness and honest boundary

`scripts/test_nightly_composed_locks.mjs` requires an explicit disposable empty localhost port and three independent PostgreSQL connections. It installs the exact captured nightly function, exact official scorer and on-ice batch, plus the local guarded on-ice function on synthetic relations. Scorer input is already scored, so scoring helpers deliberately raise if evaluated; this tests the real UPDATE's relation lock without introducing any fitted values.

Synthetic dependencies are explicit: repair is a shared-advisory barrier; strength, TOI, GAR and unrelated legacy/audit dependencies are no-ops. Thus the harness preserves exact nightly control flow through the relevant scorer→on-ice upgrade, but is **not a full nightly pipeline integration test**.

The synthetic fixture also passed a serial PGlite smoke execution of the captured nightly function. That verifies fixture/expression resolution, not overlapping transactions. The diagnostic native server detail identifies the exact cycle even though polling missed simultaneous waits. Acceptance now requires this server graph, not a generic timeout/deadlock code.

Required observations: both backend prefixes visibly hold granted raw RX while stopped at separate barriers; after releasing A, its ungranted raw SHARE is blocked by B's RX; releasing B produces server DETAIL proving both SHARE-wait edges for the pinned raw relation/database and exact backend IDs, with guard→batch→nightly call context; one SQLSTATE `40P01` victim and one successful committed candidate; unrelated output exact preservation; a later invalid-input nightly call preserves prior output and completion markers exactly. Finally it removes only its synthetic fixtures, unlocks its barriers, and verifies zero public objects, fixture roles and user schemas. Root owns the exact disposable container lifecycle and native result capture.

## Remediation boundary — local/unapplied implementation

A nightly-only advisory lock would serialize two named nightly calls but would not coordinate manual scorer→builder transactions or direct ingest. Do not describe that as a global fix.

Migration `20260906054106_coordinate_analytics_writer_entry_locks.sql` implements common transaction-level advisory serialization, entered **before the first UPDATE** by all reviewed entrypoints. Existing guard source locks remain; the common gate is intended to prevent competing cooperating transactions from reaching later lock upgrades together. Unconditionally acquiring raw and legacy source SRX locks at every entry would change privileges: read-only catalog inspection shows authenticated DML grants on raw_shots but no corresponding nhl_shots grant, whereas service_role/postgres have both. The implementation avoids that extra access requirement.

Exact implemented participating signatures:

1. `nightly_xg_pipeline()`
2. `citrus_score_v5_batch(integer)`
3. `citrus_repair_shift_clocks(integer)`
4. `citrus_build_strength_batch(integer)`
5. `rebuild_strength_intervals(integer[])`
6. `citrus_build_toi_batch(integer)`
7. `rebuild_toi_by_state(integer[])`
8. `citrus_build_onice_batch(integer)`
9. `rebuild_onice_xg(integer[])`
10. `citrus_rebuild_gar_components(integer[],numeric,numeric,boolean)`
11. `citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric)`
12. `citrus_recompute_gar_totals()`
13. `apply_rink_adjustment_live(integer)`
14. `score_xg_sql_v2(integer)`
15. `refresh_xg_season_layer(integer)`
16. `rebuild_goalie_gsax_primary(integer)`

The invoker helper checks actual own backend advisory-lock ownership, never a caller-settable GUC. Nested calls with the exclusive protocol lock already held proceed. A first entry rejects preexisting row/write/strong relation locks on the listed protected relations before waiting for the protocol lock. RowShareLock is included because a preceding SELECT FOR UPDATE can hold tuple locks. Manual `BEGIN → protocol → source DML → reviewed functions` is supported; manual work taking the listed protected locks before protocol is explicitly unsupported and fails closed. Every existing function signature, ACL, security mode and math is preserved; the helper call is inserted as the first executable statement. The helper performs no table writes.

The CLI-created migration pins both same-day live captures (`2026-09-06_pre_analytics_writer_entry_protocol.json`) and exact locally guarded predecessor definitions (`2026-09-06_analytics_writer_protocol_rollback.json`). It validates the entire sixteen-definition set before mutation, accepts only exact predecessors or exact already-instrumented bodies, and preserves existing ACL/security/configuration and all body text except the inserted first statement. Helper key `(60906,54106)` is coordination, not an authorization secret: SQL callers can acquire it directly. Existing session-level ownership cannot be distinguished as an authorization claim and is outside cooperating-usage proof.

`test_analytics_writer_entry_protocol.mjs` passes nine isolated PGlite checks covering all sixteen body pins, exact first-statement-only transformation, ACL/security/config preservation, reapplication, unknown body/helper drift, READ COMMITTED enforcement and exact rollback. PGlite reports NULL `pg_locks.pid`; it therefore cannot verify the real backend-ownership gate. Those tests are explicitly left to `test_analytics_writer_protocol_races.mjs`, not simulated by changing production SQL.

The native protocol harness verified all sixteen instrumented definitions before installing explicitly labeled unrelated runtime stubs. Both native runs used three backends and each recorded three witnesses: the first nightly held the gate, the second waited there before acquiring raw RX, and a direct scorer→builder transaction serialized an independent builder. Both nightly calls succeeded. Each run also passed four prior protected-lock rejection cases while the gate was occupied, explicit entry→DML→nested success, wrong advisory mode rejection, and exact failure output/marker preservation. This verifies the exercised cooperating compositions, not every runtime dependency of all sixteen functions.

### Failed attempts retained

- The first deadlock test observed both prefix RX locks but missed simultaneous SHARE waits. A diagnostic rerun returned `40P01` with both exact process/relation edges and guard→batch→nightly context. Separate barriers and that server graph made the subsequent reproduction deterministic; no timeout was substituted for cycle evidence.
- The first protocol fixture failed before witnesses because replacing a captured named parameter with an unnamed synthetic parameter is invalid (`p_tolerance`). Its initial cleanup also encountered an already-dropped synthetic signature. Known stub replacements now explicitly drop/recreate those exact signatures, and partial cleanup uses existence checks without masking the original error.
- A serial fixture smoke then caught ambiguity between a synthetic zero-argument GSAx function and the real defaulted integer signature. Only the explicitly synthetic defaulted-integer version is now installed for that unrelated runtime dependency. The protocol helper SQL was not relaxed for these fixture failures.
- PGlite backend-lock ownership remains unsupported because its `pg_locks.pid` is NULL; native ownership assertions were not replaced with mocks.

### Helper review and remaining boundary

The helper uses unqualified PostgreSQL catalog names/functions under a fixed `search_path = public, pg_temp`. Because `pg_catalog` is not explicitly moved later, PostgreSQL searches it implicitly first; `pg_locks`, `pg_class`, `pg_namespace` and standard lock/backend functions resolve to catalog objects. No confirmed catalog-shadowing defect was found in this configured path, so the successfully tested migration was not changed for cosmetic qualification.

The protected-relation list includes the reviewed source/aggregate tables and the penalty view's `player_penalty_events` base table. It is an explicit name list, not a recursive dependency or partition-descendant closure. Model parameter tables reached indirectly through scoring helpers, `xg_rebuild_audit`, future renamed/partitioned relations, and arbitrary other SQL are not automatically covered by pre-entry lock rejection. For example, arbitrary SQL could hold a conflicting strong lock on an unlisted relation later written by nightly and then request the protocol gate. That remains outside this cooperating-entrypoint proof; a broader manual transaction contract requires additional dependency/lock auditing, not a global deadlock-free claim.

Before any hosted rollout: test real full nightly dependencies together and measure the operational blocking implications of serializing long batch work, including timeout/retry behavior and ingestion overlap. Native synthetic correctness is not a load/capacity result. No relaxed validation, replaced metric math, new fitted constants, or hosted deployment is part of this implementation. Arbitrary unrelated SQL/trigger writers remain outside a bounded deadlock-freedom claim.
