# BRIEF, Thursday Sep 3 (midday): data integrity sweep ahead of TestFlight

**Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett. Branch `ops/sentry-error-monitoring` on top of `origin/master 5ebdd7c5`. iOS launch Sep 7.**

Everything under "verified" below was measured on production, read-only, this session, and the query is reproducible. Everything under "read" was concluded from source without running it. The two are kept apart on purpose (ACCURACY_LEDGER_2026-08-12 rule).

---

## 1. Applied to production today (Garrett's keystroke, Claude's verification)

| Change | File | Before | After | Verified by |
|---|---|---|---|---|
| `raw_shots.passer_id` team ids set to NULL | `supabase/migrations/20260903170000_null_team_ids_in_raw_shots_passer_id.sql` | 63,069 team ids (1..68), 0 player ids | 0 team ids, 0 non-null, 1,024,625 rows | Claude, read-only, ~17:55Z |
| `rebuild_player_talent_metrics()` stops wiping columns it does not own | `supabase/migrations/20260903180000_talent_metrics_rebuild_preserves_columns.sql` + capture `captures/2026-09-03_pre_talent_metrics_rebuild_preserves_columns.sql` (md5 `d29db427...` = live) | 940 rows, every non-xG column NULL, all created 08:58:00 | live body md5 `0f5796539089beace23d456309a17e10` (= proof); first run `940 / 727 / 213`, all 940 `created_at` untouched, all 940 `updated_at` fresh: upsert, not recreate | proof `scripts/proof/talent-metrics-rebuild-preserves-columns.proof.sh` ALL PASS on Postgres 16 with prod-shaped tables |

Ledger rows: `docs/PROD_CHANGE_LEDGER.md` (both written).

## 2. Verified findings (ran the query)

**The nightly wipe.** pg_cron job 33 `rebuild-talent-metrics` (58 8 * * *) ran a body that did `delete from player_talent_metrics where season = p_season` then re-inserted 8 columns. Every row had `created_at = 2026-09-03 08:58:00.060311`. `vopa_score`, `avg_toi_per_game`, `gp_last_10`, `roster_status`, `positional_*`, `ros_projection_xg`: 0 of 940 populated. Three Python writers upsert into this table on `(player_id, season)` and were being erased within 24h. This is why the player card's VOPA and TOI read empty and why IR eligibility never gated anything.

**Two ledgers.** `supabase_migrations.schema_migrations` on prod holds 450 versions. `supabase/migrations/` holds 383 files. 41 versions appear in both. 409 prod rows have no file (MCP / dashboard applies); 342 files have no prod row (psql / SQL editor applies, or never applied). Neither side can rebuild prod. Example: the repo's `20260827030000_roster_status_provenance.sql` is prod's `20260827155703`; same statements, different version. Fix shipped: `scripts/ops/dump-prod-schema.sh` now exports the prod history table (full statements) as `supabase/schema/prod_migration_history.sql`, and `schema-snapshot.yml` commits it weekly. Blocked on repo secret `PROD_DB_URL` (no `Schema Snapshot` row in `ops_ci_runs`; the workflow has never completed).

**The auction tests were destroyed twice over.** `draft_metrics` on prod:

| Date | League | draftType | safety_net_hit | Edge autopick_fired |
|---|---|---|---|---|
| 2026-08-21 | `f548834a` | auction | 83 | 42 |
| 2026-08-31 | `aaaa1111...d3b0` | snake | 96 | 48 |
| 2026-09-01 | `a1a125c8` | auction | 105 (first 17:17:35Z) | 53 over 2h36m |

The Sep 1 engine stall was 17:16:23Z (`invalid input syntax for type uuid: "close-a207306d-..."`, fixed in `LobbyManager.ts`). 72 seconds later the pgmq safety net started enqueueing and the `draft-autopick` Edge Function, which has no notion of draft format, snake-picked the auction to completion. Migration `20260824230000_chunk_11g9_decommission_pgmq_autopick.sql` retires that path; it was held back because prod had no engine. Prod has one now (`citrus-draft-engine-prod`, `wss://draft.citrusfantasysports.com` in CSP). Header addendum + same-day capture (`captures/2026-09-03_pre_chunk_11g9_decommission_pgmq_autopick.sql`, md5 `edcd02ce...` = live) written. **Order: redeploy engine, apply 11g.9 steps 1-3, then test an auction. Not before.**

The Aug 31 snake row is its own finding: 48 Edge autopicks on a snake league means the engine's own autopick was not holding that clock either. Raise, do not fix today.

**Injury sync was never scheduled.** `injury-status-sync.yml` has its `schedule` commented out because `roster_status_source` "does not exist in production yet". It does (column + `idx_player_talent_metrics_status_source`, verified). Header updated. Gate to enable: one green manual run AFTER the talent-metrics migration is applied, or the writes would not have stuck anyway.

**Telemetry gaps closed.** `critical_table_checks.py` had never run (wired into `data-invariants.yml`). `Refresh Player Directory` and `Injury Status Sync` now report to `ops_ci_runs`. `ops_ci_runs` today shows only CI, Data Invariants, Nightly Projection Batch, Production Deploy.

## 3. Read-only conclusions (did not run)

- `§5.2` of `docs/data/PIPELINE_INVENTORY_2026-09-03.md` said 29 cron-called functions had no migration. Against prod history, 38 of 41 do; only `expire_stale_trade_offers` and `process_all_faab_waivers` have no history row. Amended in the doc. The real defect is the two-ledger split above.
- Phantom-column selects (`StormyService.ts`, `demoMatchup.ts`, `matchups.ts`) fixed from source reading; covered by the existing suites Garrett runs.
- The `Auth.oauthCancel` StrictMode test was pinned to React's dev-only double-invoke count. Rewritten to drive the unmount-before-resolve case directly and to assert "no leaked handle" arithmetically under StrictMode. Not yet run (Garrett's keystroke).

## 4. Raise, do not fix (decisions that are Garrett's)

1. **Model of record for xG.** v3 vs v5 vs `xg_sql`; the 1.0010 calibration figure is not reproducible from artifacts in the repo. `CLAUDE.md:130` states an accuracy figure nobody can regenerate. Pick one, delete the claim, or regenerate it.
2. **93% of detected "passes" look like rebounds** in `raw_shots` (flagged earlier, untouched). Affects 7 of 30 xG features. Needs a definition, then a backfill, then a retrain. Not a TestFlight item.
3. **Ledger reconciliation.** After the first `Schema Snapshot` run lands, someone decides: adopt prod's history as truth and generate repo files for the 409, or the reverse. Until then `supabase db push` must never target prod (already guarded by `scripts/db-push.mjs`).
4. **Engine autopick on prod** (Aug 31 row above): why did the Edge worker fire 48 times on a snake draft with a live engine? Either the prod engine was not running lobbies for that league or its clock recovery failed. Needs engine logs from that window.
5. **Apple sign-in** (Supabase Apple provider config) is a submission blocker, not a TestFlight-upload blocker.

## 5. Still on the noon path (Garrett)

Suites (web, server, shared, scripts), typechecks (web ratchet 62), lint, one commit, `ios:sync`, Xcode archive, TestFlight upload. Then: `PROD_DB_URL` secret + `Schema Snapshot` run; engine redeploy; 11g.9 apply; auction test.
