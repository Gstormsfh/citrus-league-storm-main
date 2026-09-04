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

## Engine image pin table

Rollback pin advances chronologically; the most recent CERTIFIED
image is the current rollback target. Each entry names the tag,
full 64-hex digest, the change that certified it, and the prior
pin that it retires. See `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b
for the tag-based rollback command shape.

| Certified date | Tag | Digest | Certification | Retires |
|---|---|---|---|---|
| 2026-08-08 | `0ecbe605-draft` | `sha256:152b79912cea9d80cf5c3147beeba48957973f5d201d54bdc9a3d6c429768a32` | F26 + F27 + F27b-1 three-chunk close (REGISTRY.md KI-035 / KI-043 / KI-044 RESOLVED entries; STEP 5' on c3615619 + STEP 6' × 2 on 804f4d68 / 38b3fd66; commit `a22338d9`) | `8b7b43f6-draft` (was previous-good pre-2026-08-08) |
| 2026-08-06 (retired 2026-08-08) | `8b7b43f6-draft` | `sha256:881024ba…` (truncated in prior docs — full digest unrecorded, do not roll back this far in an emergency) | Pre-F26/F27 image. Boot verification via §15.14 pipeline. | (baseline; predates this pin table) |

**Deploy protocol.** All engine image deploys pin their prior digest
BEFORE push per `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b. Once the new
image certifies, this table gains a row and the prior CERTIFIED
row's status flips to "retired" — but the rollback command shape
using the prior tag still works (the tag is stable in Artifact
Registry until manual delete).

**Cross-workstream note.** Engine image pins are OWNED BY this
workstream (Phase 4.5 draft engine). The DB-overhaul workstream
(`0F-OPS-N`) does NOT deploy engine images; their prod mutations
are DB-only (migrations, cron, function bodies). Nothing in this
table should ever have `0F-OPS-N` attribution — if it does,
investigate: the deploy path for the engine image is
`Docker → Artifact Registry → GCE VM metadata bump → VM reset`,
which does not touch the 0F workstream's surface area.

**When to add a row.** After a §15.14 certification passes all
boot verification + rig acceptance + architect ratification. Not
after a mere push (the push alone is not certification — only
the boot-clean + rig-clean + architect-ratified state qualifies
the image as a rollback target).

## Rule 1 recorded change: T6 site season-phase (2026-08-08 19:31Z)

**What.** Flip site season-phase display from PLAYOFFS → OFFSEASON for the single league that qualified.

**Why.** Garrett requested OFFSEASON display. Mechanism grep-verified at `apps/web/src/contexts/LeagueContext.tsx:459-479`: `showPlayoffs=true` iff `settings.playoffTeams > 0` AND `playoff_brackets` row exists for the active league. Consumers: `Navbar.tsx:42`, `MobileMenuButton.tsx:38`.

**Executed by.** Architect via MCP under Garrett's explicit same-day grant.

**Before.** The Beta League (`d907a77c-425f-4b52-83ac-8f5c281682e8`):
- `settings.playoffTeams` = 6
- `playoff_brackets` row `0fdae469`, season 2025, status completed, created 2026-04-04

**After.** Same league:
- `settings.playoffTeams` = 0
- `playoff_brackets` row `0fdae469` PRESERVED

**Effect.** Next `LeagueContext` re-eval (page load / route change / activeLeagueId change) → `showPlayoffs=false` → Navbar Playoffs tab hidden → site reads OFFSEASON.

**Reversal.** Set `settings.playoffTeams` back to 6. Bracket row is intact — playoffs view returns instantly, no regen.

**Mechanism / classification report.** Terminal outbox R5 (2026-08-08 ~19:20Z). Diagnostic + fix script at `scripts/proof/t6-site-season-phase-fix.local.sql` (commit `cf9e70a7`).

**INS-16-family note.** Terminal's diagnostic SQL at `scripts/proof/t6-site-season-phase-fix.local.sql:78-84` referenced `l.season` and `l.league_type` — neither exists on prod `leagues`. Prod has `league_size`; `season` lives on `playoff_brackets`. Composed-not-harvested schema assumptions — architect adapted live at execution time. Ledger cross-ref: `docs/INSTRUMENT_LEDGER.md` INS-16 (harvest-from-real-output rule).

**Docket task #65 candidate:** Beta League `playoffTeams` must be reconfigured (was 6) at 2026 season setup. The zero must not surprise anyone next spring. Add to Q3 2026 season-config checklist.

## Rule 1 recorded change: raw_shots.passer_id team ids set to NULL (2026-09-03 ~17:55Z)

**What.** `UPDATE public.raw_shots SET passer_id = NULL WHERE passer_id IS NOT NULL AND passer_id < 8000000;` on production, wrapped in the pre/post DO blocks of `supabase/migrations/20260903170000_null_team_ids_in_raw_shots_passer_id.sql` (full rationale block in the file).

**Why.** The column had never held a player id. All 63,069 non-null values were NHL team ids (1..68, 34 distinct) copied from `eventOwnerTeamId` by `data_acquisition.py`'s pass detector when `prev_details['playerId']` was absent, which it always was. The daily player-directory job discovered them as "players" and died on them (run #48). Writer fixed in the same change set (`data_acquisition.py:321-345`); `critical_table_checks.check_raw_shots_passer_id_is_player_id` now guards the floor.

**Executed by.** Garrett, Supabase SQL Editor (prod `iezwazccqqrhrjupxzvf`), from the migration file via `pbcopy`. Claude's MCP write was refused by the platform classifier; reads were not.

**Before** (read-only, Claude, 2026-09-03 morning): 63,069 non-null, 63,069 below floor, 0 plausible player ids, all equal to `event_owner_team_id` on the same row.

**After** (read-only, Claude, 2026-09-03 ~17:55Z): 0 below floor, 0 non-null, 1,024,625 rows total.

**Reversal.** `UPDATE public.raw_shots SET passer_id = event_owner_team_id WHERE passer_id IS NULL AND ...` restores the prior state exactly, since every affected value equalled `event_owner_team_id`. Nobody should.

**Staging.** Same defect, different road (53,022 rows, 2017-2024, historical CSV loaders; `event_owner_team_id` NULL on all staging rows so the equality cannot be used there). Not yet applied; Garrett's call was prod first for TestFlight. Same file applies unchanged.

**Ledger note.** Applied via the SQL Editor, so no `supabase_migrations.schema_migrations` row exists for it. The repo file is the record. See `scripts/ops/dump-prod-schema.sh` 4b for why the two ledgers already differ by 409/342 versions.

## Rule 1 recorded change: rebuild_player_talent_metrics() preserves foreign columns (2026-09-03 ~18:05Z)

**What.** `CREATE OR REPLACE FUNCTION public.rebuild_player_talent_metrics(integer)` from `supabase/migrations/20260903180000_talent_metrics_rebuild_preserves_columns.sql`. Signature, return shape, SECURITY DEFINER, `search_path=public`, grants unchanged. Body: the unqualified `delete ... where season = p_season` becomes a delete of only players absent from the TOI set; the insert becomes `insert ... on conflict (player_id, season) do update` touching only `xg_per_60`, `xg_rating`, `updated_at`, `last_updated`.

**Why.** pg_cron job 33 (`rebuild-talent-metrics`, 58 8 * * *) erased every column written by `fetch_injury_status.py`, `calculate_daily_projections.py` and `populate_gp_last_10_metric.py` once a day. Verified 2026-09-03: 940 rows, all `created_at = 08:58:00.060311`, 0 of 940 with `vopa_score`, `avg_toi_per_game`, `roster_status`, `positional_replacement_level`, `ros_projection_xg`, or non-zero `gp_last_10`.

**Rule 1 capture (MIGRATION_SAFETY_GUIDE).** `supabase/migrations/captures/2026-09-03_pre_talent_metrics_rebuild_preserves_columns.sql`, md5 `d29db427b148049d82e4c5452085ed41`, equal to `md5(pg_get_functiondef(...))` on prod immediately before apply.

**Rule 2 history read.** Prod history rows `20260811164221`, `20260811200656`, `20260827155703` read before authoring; their intent (preserve roster columns; write `last_updated` for the freshness SLA) is kept and made true.

**Proof.** `scripts/proof/talent-metrics-rebuild-preserves-columns.proof.sh`, Postgres 16 with prod-shaped tables: old body wipes, new body preserves, refreshes, removes stale players, excludes goalies, idempotent, grants stable. ALL PASS before apply.

**Executed by.** Garrett, Supabase SQL Editor (prod), from the file via `pbcopy`.

**After** (read-only, Claude, ~18:05Z): live body md5 `0f5796539089beace23d456309a17e10` (matches proof), scoped delete present, upsert present, wipe absent, grants `{postgres=X/postgres,service_role=X/postgres}`.

**Reversal.** `CREATE OR REPLACE` from the capture file restores the prior body byte-for-byte.

**Follow-ups this unlocks.** `injury-status-sync.yml` schedule (one green manual run first); the projections and gp_last_10 writers now stick across the nightly rebuild.

**Ledger note.** SQL Editor apply, so no `schema_migrations` row; the repo file is the record.

## Rule 1 recorded change: check_season_boundary() stops matching its own comments (2026-09-04 ~04:50Z)

**What.** `CREATE OR REPLACE FUNCTION public.check_season_boundary(integer)` from `supabase/migrations/20260904003000_check_season_boundary_ignores_comments.sql`. Signature, `RETURNS TABLE`, LANGUAGE plpgsql, STABLE SECURITY DEFINER, `search_path=public`, all three checks and every message string unchanged. Body: one predicate. `p.prosrc ~ '\mget_nhl_season_year\s*\('` becomes the same regex against `prosrc` with `--` line comments and `/* */` blocks stripped first.

**Why.** Data Invariants (daily) has been failing on `season_boundary` with `calendar_rule_called_directly: pool_playoff_season call get_nhl_season_year() directly`. It does not. What `pool_playoff_season` contains is the comment saying why it deliberately does not — "Deliberately NOT get_nhl_season_year(), which answers the regular-season question and returns 2025 for September 2026." `prosrc` includes comments, so the detector matched the note describing the fix and reported the bug as still present. A monitor that reads its own explanation as the defect is the permanently-amber failure mode this repo removed from the DB monitors on purpose, and it was red twenty-five days from opening night.

**Rule 1 capture (MIGRATION_SAFETY_GUIDE).** `supabase/migrations/captures/2026-09-04_pre_check_season_boundary.sql`, 1,905 bytes, md5 `de27d7d72285aff9e9ba18d966636978`, equal to `md5(pg_get_functiondef(...))` read off prod immediately before authoring. The migration was GENERATED from that capture by string substitution, not retyped: the diff is one hunk, four lines in place of one.

**Measured on live prod before applying** (read-only, Claude). Both predicates run side by side over every function in `public`, excluding the same three names the check excludes:

| proname | matches_today | matches_after_fix |
|---|---|---|
| pool_playoff_season | true | false |

One row, and no function matched under either predicate other than that one. So the change clears exactly the one false positive and takes no real caller with it — there were none.

**Proof.** `scripts/proof/check-season-boundary-ignores-comments.proof.sh`, scratch Postgres 16.13: **ALL PASS (17 assertions)**. It reproduces the false positive against the CAPTURED body first, so it is a reproduction rather than a restatement, and it asserts on both sides — a function that genuinely calls the rule must still be reported after the fix, which is the assertion that would fail if the "fix" were to stop looking. Block comments, the two untouched checks, idempotent re-apply, volatility, security, signature and all three message strings are pinned too.

The proof also caught a defect in this migration before it reached prod: `pg_get_functiondef` output ends `$function$` with no terminating semicolon, so wrapping the generated body in `BEGIN; … COMMIT;` made psql read `COMMIT` as part of the function body — `syntax error at or near "COMMIT"`. Fixed to `$function$;` and re-proved.

**Known limit, deliberate.** String literals are not stripped, so a function that merely NAMES the rule inside a message would still trip this. The only one that does is `check_season_boundary` itself, already in the `NOT IN` list. Stripping literals too would mean parsing dollar-quoted bodies in a regex.

**Blast radius.** Read-only, called only by the daily Data Invariants workflow, on no user-facing path. Safe to apply mid-draft.

**Reversal.** `CREATE OR REPLACE` from the capture file restores the prior body byte-for-byte.

**Executed by.** Not yet applied at the time of writing. Authored by Claude (Cowork) for Garrett Storms, launch-audit pass, 2026-09-04, the night before App Store submission; found by reading the failure out of `ops_ci_runs` rather than the GitHub inbox.
