# `data/exports/` — Database export bundles

Date-stamped `pg_dump --inserts` snapshots and chunk files used by the
staging-deploy operator runbook (`scripts/staging/`).

**Contents are gitignored** (see `.gitignore`). Each operator regenerates
their own copies from prod via `pg_dump`. This README and the `.gitignore`
are the only files committed.

## Subdirectory naming

`YYYY-MM-DD-<purpose>/` — date the dump was taken + what it's for.

- `2026-04-26-staging-load/` — chunked per-table inserts consumed by
  `scripts/staging/04-load-stats-data.mjs`. Six tables (player_directory,
  player_season_stats, player_projected_stats, player_ros_projections,
  player_talent_metrics, goalie_gsax_primary) plus a `chunk__header.sql`
  artifact from `pg_dump`.
- `2026-04-26-prod-snapshot/` — full prod snapshot (`prod_data.sql`,
  `prod_data_inserts*.sql`, `prod_schema.sql`, `prod_stats_all*.sql`).
  Placeholder directory — files live in the main worktree until that
  worktree's reorg lands. See `apps/web/docs/DATA_ORGANIZATION_AUDIT.md`.

## How to regenerate

See `scripts/staging/README.md` step 3 prerequisites for the
`pg_dump --inserts` invocation pattern. Re-run that command against the
current prod DB to produce a fresh export bundle, then point the loader
at the new dated subdirectory.

## Why these are gitignored

- File sizes range from ~500 KB to **~100 MB** (the projection chunk).
  Committing them would bloat the git history and slow every clone.
- They're snapshots of production data — operators should always pull
  the freshest version rather than rely on whatever's in git.
- The schema lineage is captured in `supabase/migrations/`, not here.
