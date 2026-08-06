# PROD_CHANGE_LEDGER — interim coexistence protocol

**Status.** Interim. In force from 2026-08-06 until a real shared change
ledger exists.

**Trigger.** KI-041 (docs/REGISTRY.md) closed 2026-08-06. The DB-overhaul
workstream disabled cron job 4 via prod migration
`20260805201003_disable_unsafe_auto_fix_and_repair_vacuum_job` (0F-OPS-3)
with a rationale that predicted SL-1b verbatim before this workstream
shipped v1. If that migration's history row had been read before v1
authorship began, SL-1b would not have happened. This document
codifies the read-before-write convention so cross-workstream
prevention becomes routine, not accidental.

**Scope.** Applies to any change that mutates prod state — database
migrations, cron jobs, function bodies, Cloud Run env vars, GCE VM
metadata, any secret in `citrus-fantasy-prod` project. Both workstreams
(the DB-overhaul workstream operating under `0F-OPS-N` phase names +
this workstream operating under `SL-N` / `KI-NNN` / `INS-N` names) are
bound by these rules.

## Rule 1 — every cross-cutting prod change lands as a recorded history row with rationale

- **Every** mutation lands as a `supabase/migrations/*.sql` file with a
  timestamp filename + a rationale comment block. Even mutations that
  don't fit the "schema migration" mental model (cron job on/off, secret
  version add, feature flag flip) get a recorded history row.
- **Rationale block MUST answer three questions**: (a) what changed,
  (b) why now, (c) who did it and under which workstream/phase name.
- The direct-apply harness pattern established across F24 / SL-1 / SL-1b
  / KI-041-reply MUST be reused: Rules 1-4 (capture-before-replace,
  real-SQL-in-history, client_encoding=UTF8, --quiet on interrogation)
  + INS-6 GUC bridge for `\lo_import`.
- If a change is TRULY emergency and must land before the migration
  file is written, the file MUST be written and committed with the
  actual applied SQL within the same session, referencing the direct-
  apply timestamp in its header.

## Rule 2 — read recent history before touching shared objects

- **Before** authoring any migration that modifies a shared object
  (function, view, trigger, cron job, table constraint), the author
  MUST review `supabase_migrations.schema_migrations` for that object's
  recent history. Query template:

  ```sql
  SELECT version, name, left(statements[1], 200) AS first_stmt_snip
    FROM supabase_migrations.schema_migrations
   WHERE ARRAY_TO_STRING(statements, ' ') ILIKE '%<object_name>%'
   ORDER BY version DESC LIMIT 20;
  ```

- Capture-before-replace (Rule 1 of `docs/MIGRATION_SAFETY_GUIDE.md`)
  already forces this discipline for FUNCTIONS via `pg_get_functiondef`.
  Extend the same discipline to CRON JOBS via `SELECT * FROM cron.job
  WHERE jobid = <N>` and similar interrogations for other shared surfaces.
- If recent history includes a mutation authored by the OTHER workstream,
  READ ITS RATIONALE BLOCK. If it disables/restricts something you
  intended to fix, the reply-migration convention applies (Rule 3).

## Rule 3 — reply-migration convention

- When one workstream's migration disables/restricts something the other
  workstream needs to change, the response is a REPLY MIGRATION —
  a new migration whose rationale cites the counterpart migration
  version + name in its header, addresses the counterpart's stated
  concerns point-by-point with evidence, and only then mutates state.
- Example: `20260806200000_reenable_auto_fix_after_sl1b_v2.sql` replies
  to `20260805201003_disable_unsafe_auto_fix_and_repair_vacuum_job`
  (0F-OPS-3) by naming its three defects (A/B/C) and matching each to
  SL-1b v2's remediation with live per-defect evidence. Only after the
  header establishes grounds does the migration body `UPDATE cron.job
  SET active = true WHERE jobid = 4`.
- Reply migrations use the same apply-harness pattern (STEP 0 hash pin,
  STEP 1 capture, STEP 2 apply, STEP 3 verify, STEP 4 history-row
  INSERT via `\lo_import`, STEP 5 final assert) so byte-exact history
  is preserved end-to-end.

## Rule 4 — cross-workstream phase name mapping

Both workstreams' phase / issue / instrument names are tracked here so
recent-history reads can identify authorship without back-channel.

### This workstream — Phase 4.5 draft engine + Season-Loop

- `SL-N` — Season-Loop audit findings (SL-1: auto_fix_integrity_issues; SL-2..SL-5 per REGISTRY)
- `KI-NNN` — Known Issues (KI-036: SL-1 close; KI-041: this doc's trigger; KI-042: mixed-domain player_id)
- `INS-N` — Instrument Ledger (INS-4..INS-10 to date; see `docs/INSTRUMENT_LEDGER.md`)
- `DEF-N` — Defense-cluster findings (DEF-1/2/3 = KI-038/039/040)
- `F-N` — Field-observed defects during draft-engine acceptance (F5..F26)

Migration filename convention: `YYYYMMDDHHMMSS_<short_slug>.sql`, e.g.
`20260806100000_sl1b_auto_fix_unwrap_agg.sql`.

### DB-overhaul workstream — 0F phase family

- `0F-OPS-N` — Operations changes (0F-OPS-3: disable_unsafe_auto_fix,
  applied 2026-08-05 20:10Z — the trigger for KI-041 + this doc).
- Additional 0F sub-phases likely exist; add here as they surface.

Migration filename convention (observed): same
`YYYYMMDDHHMMSS_<short_slug>.sql`, e.g.
`20260805201003_disable_unsafe_auto_fix_and_repair_vacuum_job.sql`.

## Rule 5 — audit trail

- Governance changes land in this doc (not in individual READMEs).
- KI-041's close notes: this doc's creation is the immediate deliverable.
- Longer-term deliverables (per KI-038 / DEF-1 extension):
  - Weekly cron-state diff report on-demand.
  - Operator-identity convention (git commit sha or ticket ID) attached
    to each mutation via `cron.job.jobname` or a comment column.
  - Consolidation of this file with the real shared change ledger when
    it exists — target: end of Q3 2026.

## Standing pin table pointer

Function-body md5 pins for direct-apply harnesses live in
`docs/INSTRUMENT_LEDGER.md` under INS-7 "Standing pin table."
Cron-job state snapshots live in `supabase/migrations/captures/`
alongside function captures.
