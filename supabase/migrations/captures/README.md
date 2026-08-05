# supabase/migrations/captures/

Same-day `pg_get_functiondef` captures for `CREATE OR REPLACE FUNCTION`
migrations. See `docs/MIGRATION_SAFETY_GUIDE.md` § "Standing rules for
`CREATE OR REPLACE FUNCTION` migrations" (Rule 1 — Capture-before-replace).

## Naming

`YYYY-MM-DD_pre_<migration-slug>.sql`

The slug matches the migration file's slug portion (everything after the
timestamp prefix). Example:

- Migration: `20260805050000_v2_draft_completion_emitter_rebased.sql`
- Capture:   `2026-08-05_pre_v2_draft_completion_emitter_rebased.sql`

The capture MUST be committed in the same commit as the migration file it
guards. The apply script refuses to run without it.

## Format

The capture is the literal output of:

```sql
SELECT pg_get_functiondef(
  <schema>.<function_name>(<arg1_type>, <arg2_type>, ...)::regprocedure
);
```

Or, per PL/pgSQL body preservation, wrapped through:

```sql
SELECT pg_get_functiondef('<schema>.<fn>(<sig>)'::regprocedure);
```

Save the RAW output — the tool `psql -qtAX` produces the cleanest capture
(no headers, no alignment, no borders). Leading/trailing whitespace is
preserved.

## Lifecycle

Append-only. Do NOT delete captures. Do NOT edit captures after commit.
They form the historical record of the function's live shape at each
rewrite boundary. If a capture turns out to be wrong, add a new capture
with a suffix (`YYYY-MM-DD_pre_<slug>_recapture.sql`) explaining why,
and update the associated apply script — the wrong one stays as evidence.
