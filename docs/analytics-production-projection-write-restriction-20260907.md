# Production projection integrity change — deployed

Applied to staging and production on 2026-09-07. This is a production access-control improvement, not a new xG model or a measured increase in forecasting accuracy.

## Defect and change

Production `public.player_projected_stats` had an ALL policy named `Authenticated users can manage player projected stats`, admitting every authenticated role through both USING and WITH CHECK. Ordinary signed-in accounts also held INSERT, UPDATE and DELETE grants on these global model outputs.

The migration removes that policy and revokes those three table privileges from `authenticated`. The existing public SELECT policy is unchanged. PostgreSQL/service-role writers retain their privileges and RLS bypass; the scheduled SQL builder remains a postgres-owned security-definer function. No application reader requires direct write access. This does not audit every security-definer RPC or close all database security findings.

Production migration ledger: `20260907050403`, `restrict_global_projected_stats_writes`. Matching local migration:
`supabase/migrations/20260907050403_restrict_global_projected_stats_writes.sql`.
The hosted staging migration has its separately assigned timestamp; production is the local canonical version. No broad migration push, model publication or unrelated dirty-worktree deployment was performed.

## Verification

- Staging policy initially matched production.
- Staging migration applied successfully; role-switched SQL regression passed.
- Prior grants/policy were restored inside a staging transaction, authenticated update permission was exercised, and the transaction rolled back; hardened state remained in place.
- Production migration applied successfully; the same regression passed. Authenticated INSERT/UPDATE/DELETE raise insufficient privilege. Authenticated/anonymous reads remain permitted. Service-role zero-row INSERT/UPDATE/DELETE statements execute successfully.
- These are actual database authorization tests with zero-row writes, not full pipeline rebuild tests. No model values were changed by the test.
- McDavid's selected projection population before/after: 170 rows; ordered full-row digest `e9a03afb41d20a0643465ff5d1708002` both times. This is a selected-player preservation check, not a whole-database content checksum.
- Final policy inspection returns only the original public SELECT policy on the changed table.
- Post-change Supabase security advisor returned no finding for the changed public table. Other database findings remain; an informational missing-policy notice on the separate retired `attic.player_projected_stats_retired_phantoms` table is not this table. [Advisor documentation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Reproducible regression: `scripts/proof/projection_write_access_regression.sql`.
Emergency rollback: `scripts/proof/projection_write_access_rollback.sql`. It restores the insecure old access and must not be run routinely. Migration history and this deployment record preserve the administrative change; no new application mutation endpoint or AuditService path was introduced.

## Live path findings, still unresolved

At inspection, production contained 1,103 positive 2026 ROS rows. McDavid's upcoming per-game rows also had positive projections, labeled `v2_rates_age_home_b2b`. This verifies stored availability, not iOS rendering, projection accuracy, or credit for creating those rows.

GitHub Nightly Projection Batch run `34030329044` logged season 2025, then `No remaining games found. Exiting.` and concluded success. In contrast, database cron jobs call `get_projection_target_season()` for both ROS and per-game rebuilding. Do not simply switch the Python job to next season and overwrite the existing SQL-generated forecasts: writer ownership and model/exposure compatibility must be resolved first.

The offline recent-timing model remains non-serving. Its measured historical gains are not converted into production accuracy claims by this security deployment. Foundation, original-input, calibration, talent, consumer and FPAR gates remain open.
