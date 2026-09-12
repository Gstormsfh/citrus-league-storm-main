# Isolated PostgreSQL rehearsal

Run from the repository root:

```sh
python3 data-pipeline/tests/rehearsal/rehearse_canonical_postgres.py
```

Requires Docker and the cached `public.ecr.aws/supabase/postgres:17.6.1.159` image. The script starts a dedicated container with `--network none`, no host ports and a disposable local password. It loads the entire public-schema snapshot and real functions, applies the four canonical/scoring migrations, and emits assertions plus source hashes. Default cleanup removes the container; `--keep` preserves it for the cache rehearsal. It never connects to Supabase.

The base `supabase/schema/production_snapshot_20260813.sql` is the checked-in production public-schema dump, not a fabricated minimal table fixture. The September 12 pinned files were exported using read-only Supabase SQL against project `iezwazccqqrhrjupxzvf`:

- `production-functions-20260912.sql`: `pg_get_functiondef` for `get_projection_target_season`, `get_season_game_count`, `project_rookies`, `project_ros`, `rebuild_player_projected_stats`, `rebuild_ros_projections`, and `sync_scoring_settings_to_rules`. Export delimiters gained terminal semicolons only.
- `production-columns-20260912.json`: `pg_attribute`/`pg_class`/`pg_namespace`, `format_type` and `pg_get_expr` catalog definitions for the nine tables named in the file. The alignment script adds missing columns and updates differing types on the isolated snapshot.
- `production-stat-catalog-20260912.json`: all 35 `stat_catalog` rows.
- `cache-parent-rows-20260912.json`: the 27 `nhl_games` rows referenced by the supplied cache backup and their NHL team parent records, preserving real foreign keys.

The rehearsal's player observations, league, users and canonical inputs are synthetic, while model functions, relevant constraints/triggers, defaults and role policies come from the real sources. This is not an execution of every historical migration, an exact current whole-database clone, a performance benchmark, or approval to activate the real source.

The scoring regression deliberately includes the snapshot's real `sync_rules_to_scoring_settings` reverse trigger. It verifies exact source JSON and SQL NULL preservation, in addition to effective multipliers. The focused PGlite scoring fixture separately tests the forward-trigger lifecycle; it does not substitute for this reverse-trigger check.

For cache retirement, retain a rehearsal container and supply the actual exported backup and operator SQL directory explicitly:

```sh
python3 data-pipeline/tests/rehearsal/rehearse_cache_retirement.py \
  --container citrus-canonical-rehearsal-EXPLICIT_ID \
  --backup /explicit/path/projection-cache-20260912.json \
  --operations-dir /explicit/path/scripts/ops/projection-retirement
```

The cache runner requires the rehearsal container prefix and an empty cache table. `--reuse-restored` permits a repeat only after verifying the already restored rows/hash against the backup. It creates the locally preloaded `pg_cron` extension if absent, runs preflight, then quarantine and inverse rename. It compares table/data/security/dependency identity before and after. Local test attestations do not establish production release or external-caller signoff. The actual backup remains external; no private absolute backup path is embedded in these fixtures.

Actual-source rejection preflight uses `rehearse_source_validation.py --container ... --source ...` after a retained full-schema run. It replaces only synthetic directory/schedule rows inside a rollback-only transaction, stages and validates the supplied DRAFT, and never activates. `source-directory-20260912.json` is a fresh read-only `player_directory WHERE season=2026` export (1,312 rows); `source-schedule-20260912.json` contains all 1,344 regular 2026 games and NHL team parents. Neither file replaces the canonical source. The script reports every SQL validation error without clearing review blockers.
