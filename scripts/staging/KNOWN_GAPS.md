# Staging — Known Gaps Ledger

## Purpose

This is the running human-triaged record of every schema, data, or behavior
gap discovered between the **staging** Supabase project (`jjgspcpvqaiitloglxbb`)
and **production**. Each entry captures the discovery context, the source
migrations involved, an explanation for why staging diverged, the
resolution path (or rationale for accepting the divergence), and the
follow-up trail. Entries land here when a real bootstrap-time silent skip
or operational drift is identified — not for routine work-in-progress.

The ledger is a forensic + decision record, not a change log. Use commit
history for the *what*; use this file for the *why*, the *how we know
it's safe*, and the *what we should still revisit*.

## How to use this file

- **Discovery**: `scripts/staging/audit-cross-schema-ddl.mjs` is the
  programmatic auditor. Re-run it whenever a meaningful batch of
  migrations lands or a new staging-vs-prod incident surfaces; the
  output is a JSON report you can diff against prior runs.
- **Triage**: this file is the human-readable companion. The auditor
  finds raw matches; this file records which matches were real, which
  were dismissed, what was patched, and what was deliberately left
  alone. Every audit run that surfaces a new finding should produce
  one entry here with a date.
- **Sections**:
  - **Active findings** — open items that need action but haven't been
    fixed yet. Empty when staging is in sync.
  - **Resolved findings** — patched gaps, kept for institutional
    memory so a future operator doesn't repeat the diagnosis.
  - **Accepted divergences** — known differences that are NOT being
    fixed, with rationale and any conditional re-evaluation triggers.
  - **Followup tickets** — work that was scoped out of the immediate
    fix but tracked here so it doesn't get lost.

## Active findings

### 2026-04-29 — playoff series/bracket tables empty on staging

- **Discovery**: created a Stanley Cup Bracket league via `/create-league`
  on staging, but the bracket UI showed zero series available to pick.
  Diagnosed via read-only Supabase queries — `nhl_games` has 24 rows
  with `game_type='playoff'` and `playoff_round IS NOT NULL`, but
  every one has `series_id IS NULL`. Bracket UI almost certainly
  renders by joining `nhl_games` against a `playoff_series` table on
  `series_id`, so an empty join target = nothing to display.
- **Scope of empty tables** — 9 of 10 playoff-related tables are empty:
    nhl_playoff_seeds       0
    nhl_playoff_series      0
    player_playoff_stats    0
    playoff_bracket_picks   0
    playoff_brackets        0
    playoff_confidence_picks 0
    playoff_pool_standings  0
    playoff_seeds           0
    playoff_series          0
  Only `playoff_roster_picks` has data (2 rows, from manual testing).
- **Notable: dual-table pattern** — there are TWO `*series` tables
  (`nhl_playoff_series` 16 cols vs `playoff_series` 22 cols) and TWO
  `*seeds` tables (`nhl_playoff_seeds` 13 cols vs `playoff_seeds` 10
  cols). Likely the `nhl_*` tables hold upstream-canonical NHL data
  (series identity, seeding) while the unprefixed tables hold league/
  user-side state (per-league bracket structure, picks-against-series).
  Worth confirming the FK direction on each before writing any loader.
  This naming is brittle — consider documenting it (or renaming one
  side) post-Web-Summit.
- **Why staging missed it** — the `prod_data_inserts_clean.sql` dump
  used by `05-load-reference-data.mjs` only contains `nhl_teams` and
  `nhl_games` rows (and a deprecated `players` table). It was generated
  before playoffs started in prod, OR it was scoped to skip playoff
  tables at dump time. Either way, none of the playoff-series tables
  were ever populated in staging.
- **Suggested resolution path (post-Web-Summit / TBD)**:
  1. Generate a fresh dump from prod that includes the nine empty
     playoff tables — focus on `nhl_playoff_series` and `nhl_playoff_seeds`
     as the canonical upstream tables; the remaining tables populate
     organically as users interact with the pool features.
  2. Add a new loader script `scripts/staging/08-load-playoff-data.mjs`
     using the same PostgREST upsert pattern as `05-load-reference-data.mjs`.
  3. Extend `06-verify-staging-ready.mjs` to add row-count thresholds
     for `nhl_playoff_series` and `nhl_playoff_seeds`.
  4. Re-test the bracket / confidence pool / roster pool flows on
     staging end-to-end.
- **Status**: not blocking Phase 1 frontend primitive fixes (those
  don't depend on playoff data). Blocks any further QA of the playoff
  pool flows themselves.

## Resolved findings

### 2026-04-29 — handle_new_user trigger missing on auth.users

- **Discovery**: 400 on `POST /api/leagues` with FK violation
  `leagues_commissioner_id_fkey`. Root caused to a missing
  `on_auth_user_created` trigger that should auto-create
  `public.profiles` rows on signup. Without it, a row in `auth.users`
  has no companion row in `public.profiles`, so any FK pointing at
  `profiles` (e.g. `leagues.commissioner_id`) blows up with `23503`
  for newly-signed-up users.
- **Source migrations**:
  - `supabase/migrations/20250101000000_create_profiles_table.sql`
    (original function + trigger)
  - `supabase/migrations/20260331000000_fix_handle_new_user_search_path.sql`
    (latest hardened function form)
- **Why staging missed it**: the staging bootstrap script
  (`01-mark-migrations-applied.sql`) marks all 276 prod migrations as
  applied in `supabase_migrations.schema_migrations`, under the
  assumption that a prod schema dump was applied to staging
  beforehand. Schema dumps don't reliably capture cross-schema DDL —
  DDL that lives in `public` but targets the managed `auth` schema.
  The metadata claims this migration ran, but the actual trigger DDL
  was silently lost during the dump → apply step. The trigger never
  landed on staging.
- **Resolution**: applied `07-fix-missing-auth-trigger.sql`
  (idempotent: `CREATE OR REPLACE FUNCTION` for the latest hardened
  body + `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` for the
  binding). Verified via `pg_trigger` query — one row returned with
  `tgenabled='O'`. Backfilled four existing `public.profiles` rows
  for users that signed up before the trigger existed
  (`c4489220-de65-44c5-8236-677916f6d09c` plus three others).
  Verified end-to-end: signup → create-league now works.
- **Audit follow-up**: ran `audit-cross-schema-ddl.mjs` to find any
  cousins. Result: **7 total findings, 1 fixed (this trigger),
  4 verified already-installed extensions (`pg_cron`, `pg_net`,
  `pgmq`, `pg_stat_statements`), 2 dismissed as false positives
  (runtime `DELETE FROM auth.users` inside `SECURITY DEFINER`
  function bodies — those are runtime queries, not deploy-time
  cross-schema DDL; the function definitions themselves live in
  `public` and survive a schema dump).**

## Accepted divergences

### 2026-04-29 — pg_cron installed in pg_catalog instead of extensions schema

- **Migration says**: `CREATE EXTENSION pg_cron WITH SCHEMA extensions`
  (in `supabase/migrations/20260208400000_supabase_pro_upgrade.sql:32`).
- **Staging has**: `pg_cron` registered in `pg_catalog` (verified via
  `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON
  e.extnamespace = n.oid WHERE e.extname = 'pg_cron'`).
- **Why accepted**: Supabase Pro pre-installs `pg_cron` at the
  platform level. The `WITH SCHEMA extensions` directive in our
  migration is effectively a no-op when the platform has already
  installed the extension elsewhere. The *callable surface* —
  `cron.schedule`, `cron.unschedule`, `cron.job`, etc. — lives in a
  dedicated `cron` schema regardless of where `pg_extension` itself
  records the extension's home. App code that calls
  `cron.schedule(...)` works identically in either layout.
  `ALTER EXTENSION pg_cron SET SCHEMA extensions` typically requires
  elevated permissions Supabase doesn't grant the `postgres` role
  and risks destabilizing managed cron jobs with zero functional
  benefit.
- **Likely also true in prod** — both projects are Supabase Pro
  with the same managed default. Worth re-verifying next time we
  have read access to a prod schema dump or `pg_extension` query.
  If prod ever lands `pg_cron` in `extensions`, revisit this
  decision.

## Followup tickets (post-Web-Summit)

### Bootstrap script silent-skip antipattern

`01-mark-migrations-applied.sql` and `04-load-stats-data.mjs` both share
a pattern of completing successfully when they have actually skipped
real work — the migration-marker assumes a prior dump+apply that may
have dropped DDL, and the stats loader uses plain POST without
`on_conflict` (re-runs 409 silently per-batch instead of upserting).
This is the structural cause of tonight's incident.

Two paths to consider:

- **Path 3 hybrid**: replace the schema-dump + mark-applied bootstrap
  with `supabase db push --include-all` from the migrations tree
  itself, with idempotent migrations. Replays the actual DDL each
  time, eliminating the silent-skip class entirely. Cost: requires
  every migration to be safely re-runnable, which tonight's audit
  suggests they roughly are but not formally guaranteed.
- **Minimum viable fix**: add fail-loud guards to the existing
  scripts. `01-mark-migrations-applied.sql` should refuse to run if
  any expected cross-schema object (e.g., `on_auth_user_created` on
  `auth.users`) is absent; `04-load-stats-data.mjs` should switch
  to PostgREST upsert (the same pattern `05-load-reference-data.mjs`
  uses) so re-runs are no-ops instead of failures.

Either path is post-Web-Summit work. Decision can wait.

### Audit cousins on prod

`audit-cross-schema-ddl.mjs` runs against the *git tree*, not the
running database, so its findings apply equally to whatever was
deployed against prod. Today's audit confirmed prod is fine for the
specific items tonight surfaced (because prod ran the migrations
historically, not via dump + mark-applied). Re-run the audit after
any major migration batch lands so we don't accumulate a similar
surprise on the prod side that gets exposed during a future restore.

### Add `chunk_*.sql` files to `.gitignore`

The seven `chunk_*.sql` files in the repo root are currently
untracked but not git-ignored. They sum to roughly 98 MB of
prod-data dumps. A future operator could `git add .` and accidentally
commit them. Add the pattern to `.gitignore` to make that footgun
impossible.

---

*Last updated: 2026-04-29*
