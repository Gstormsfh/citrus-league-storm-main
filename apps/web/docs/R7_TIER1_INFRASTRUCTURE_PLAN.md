# R7 — Tier 1 Data Infrastructure Plan

**Date:** 2026-05-05
**Status:** Planning doc for Garrett review. **No execution until approved.**
**Trigger:** Reorganization phases R1-R6 complete; before Phase 0 (multi-season backfill) begins, install five low-cost / high-payoff infrastructure investments. Strategic bar: "competent data engineer would review and not find embarrassing gaps" — not "match ESPN's $100M data infrastructure."

This doc is a design proposal for each of the 5 investments. After
Garrett approves the design (whole or in parts), execution follows in
separate commits, one investment at a time.

---

## R7-1 — Lineage tracking

**Goal:** every derived table documents its source. When a new metric
shows up wrong, an engineer can answer "where does this data come
from?" without reading every script in `data-pipeline/`.

### Approach

**Don't install dbt.** dbt is the obvious choice but it introduces a
parallel orchestration system on top of the existing Python pipelines
+ Supabase migrations. The cost (learn dbt, port pipelines, maintain
two systems) outweighs the benefit at our scale.

**Instead, leverage the work R4 already did.** Every script now carries
a `Reads:` and `Writes:` line in its CITRUS-CLASSIFICATION header. R7-1
is a build step that aggregates those lines into a queryable lineage
graph + renders it as a static HTML page committed to the repo.

### Concrete deliverable

`scripts/_one_offs/build_lineage_graph.py`:
- Walks every script with a CITRUS-CLASSIFICATION header
- Parses `Reads:` and `Writes:` lines
- Builds a directed graph: writers → tables → readers
- Renders two outputs:
  - `apps/web/docs/LINEAGE.md` — markdown with a per-table section listing writers + readers, and per-script section listing dependencies
  - `apps/web/docs/lineage.svg` — Graphviz-style DAG (optional, can use mermaid in markdown if Graphviz isn't available)
- CI step (extends `ci.yml`): re-runs the build script on every PR that
  touches a CITRUS-CLASSIFICATION header. If the generated docs are
  out of date, fail the PR with a "run `python scripts/_one_offs/build_lineage_graph.py`" message

### Cost / payoff

- Cost: ~3 hours to write the parser + renderer; ~30 min CI integration
- Payoff: zero new dependencies, zero new infrastructure. Lineage doc
  always reflects current code because it's derived from headers we
  already maintain. New contributors can grep `LINEAGE.md` for any
  table name to see writers + readers
- Tradeoff vs dbt: no dependency-aware re-run scheduling, no auto
  refresh logic. Citrus's pipeline already handles scheduling via
  cron + `nightly_projection_batch.py` — we don't need dbt's
  scheduler

### What this does NOT solve

- Doesn't enforce that headers stay accurate (R4 helper manifest is
  the source of truth; out-of-date headers produce out-of-date
  lineage graph). Mitigation: R7-1's CI gate fails when graph is
  stale + R4 helper is idempotent + manifest review during PR
- Doesn't track column-level lineage (only table-level). Acceptable
  trade for simplicity

---

## R7-2 — Data quality checks on critical tables  ✅ COMPLETE 2026-05-06

**Status:** landed at `data-pipeline/monitoring/critical_table_checks.py`.
12 checks declared, all wired into `integrity_check_results` writes and
`AlertManager` dispatch (PAGE → PagerDuty + Slack, WARN → Slack only).
Baseline captured in `R7_2_BASELINE.md`: 10 PASS, 1 WARN (real signal —
3 raw_shots player_ids with 17-27 playoff shots each are missing from
player_directory; ticket-worthy follow-up), 1 FAIL (raw_shots.season is
100% NULL — expected pre-Phase-0 sentinel that should flip to PASS after
Phase 0a season backfill).

**Goal:** automated tests run nightly on `raw_shots`, `player_game_stats`,
`player_season_stats`, `player_gar_components`, etc. Catch silent
failures (NULL season after derivation, expected row-count ranges,
orphan player_ids, NULL rates within thresholds for moat features by
season) before they reach the UI.

### Approach

**Don't install Great Expectations or Soda.** Like dbt, these are full
frameworks. Citrus already has `data-pipeline/monitoring/verify_data_integrity.py`
+ `integrity_check_results` table writing 200-400 events/day (per R5
§7.4). Extend that infrastructure rather than parallel-installing.

### Concrete deliverable

Add a new module `data-pipeline/monitoring/critical_table_checks.py`:

- Runs after `nightly_projection_batch.py` (existing daily 7 AM UTC cron)
- Defines a `CHECKS` list — each entry is `(check_name, sql_query, expected_pattern)` where `expected_pattern` is one of:
  - `count_in_range(min, max)` — COUNT(*) must fall in this range
  - `null_rate_below(column, threshold)` — `SUM(CASE WHEN col IS NULL ...)` must be below threshold
  - `no_orphans(fk_column, ref_table, ref_column)` — every FK value must exist in ref table
  - `monotonic_growth(timestamp_column, since_days)` — recent timestamps must grow vs prior period
- Each check writes a row to `integrity_check_results` with the existing schema (`check_name`, `status`, `details`, `affected_teams`)
- Discord alert (via existing `alerting.py`) on FAIL status

### Initial check set (post-R5 baseline)

For `raw_shots`:
1. `raw_shots_count_in_range` — expect 90K-120K rows mid-season, 130K-170K post-season
2. `raw_shots_null_xg_rate_below_1pct` — `xg_value` should be ≥99% populated
3. `raw_shots_pre_shot_moat_populated_for_2025` — the 7-feature moat (`pass_quality_score`, `pass_immediacy_score`, `goalie_movement_score`, `pass_zone_encoded`, `pass_lateral_distance`, `pass_to_net_distance`, `has_pass_before_shot`) all 100% populated for 2025 shots
4. `raw_shots_arena_coords_present` — `arena_adjusted_x_abs` + `arena_adjusted_y` not NULL
5. `raw_shots_season_derivable` — every row has a 4-digit `game_id` prefix that parses to a valid NHL season
6. `raw_shots_no_orphan_player_ids` — every `player_id` exists in `player_directory`

For `player_game_stats`:
7. `player_game_stats_nhl_columns_populated` — `nhl_goals` etc. are NOT NULL for all 2025 rows
8. `player_game_stats_no_orphan_game_ids` — every `game_id` exists in `nhl_games`

For `player_season_stats` / `player_directory` / `player_talent_metrics`:
9. `player_season_stats_freshness` — `MAX(updated_at)` within last 24 hours
10. `player_directory_count_in_range` — expect 800-1000 rows per season

For `player_gar_components`:
11. `player_gar_offensive_components_populated` — `evo_gar_per_60` non-zero for ≥80% of rows (the defensive components are known-empty per pipeline gap; flag if offensive components also flatline)

For `player_projected_stats`:
12. `player_projected_stats_freshness` — fresh writes within last 12 hours (caught by `nightly_projection_batch.py` not running)

### Cost / payoff

- Cost: ~4 hours to write `critical_table_checks.py` with 12 initial checks
- Payoff: nightly automated catch of silent failures. Existing `integrity_check_results` audit trail extends to model-output tables.
- Tradeoff: not as expressive as Great Expectations' DSL. Acceptable.

### What this does NOT solve

- Doesn't catch type-level schema drift (a column changing from `numeric` to `text`). Migration-time verification is a separate concern (R7-4).
- Doesn't enforce semantic correctness (e.g., "every shot has a non-zero xG value reasonably correlated with distance"). That's model-validation territory, not data-quality.

---

## R7-3 — Freshness SLA monitoring  ✅ COMPLETE 2026-05-06

**Status:** landed. SLA matrix declared in
`data-pipeline/monitoring/freshness_sla.py` (22 SLAs across 5 tiers, 2 PAGE +
20 WARN). `check_data_freshness.py` refactored to drive off the matrix, write
results to `integrity_check_results`, dispatch alerts via `AlertManager` with
PAGE→PagerDuty+Slack and WARN→Slack, and gate via dynamic `nhl_games` query
(both any-game and regular-season-only windows). Baseline captured in
`R7_3_BASELINE.md`: 0 PAGE breaches, 14 pre-existing WARN breaches (most of
which Phase 0 will resolve), 6 OK, 2 correctly skipped during playoffs.

**Goal:** the `StaleDataBadge` UI primitive (player dashboard) is the
last-mile signal for fans. R7-3 makes it the FIRST-mile signal too —
monitoring fires before the badge does.

### Approach

**Already 70% done.** `data-pipeline/monitoring/check_data_freshness.py`
exists (per R4 classification — ACTIVE) and `alerting.py` is wired up.
The gap is the SLA matrix and the alerting threshold.

### Concrete deliverable

Replace `check_data_freshness.py`'s ad-hoc table list with a declared
SLA matrix:

```python
FRESHNESS_SLAS = {
    # table_name: (max_staleness_hours, alert_severity)
    "raw_shots":              (24, "warn"),
    "raw_nhl_data":           (12, "warn"),
    "player_game_stats":      (24, "warn"),
    "player_season_stats":    (24, "warn"),
    "player_projected_stats": (24, "page"),  # page = wake operator
    "player_directory":       (168, "warn"),  # weekly refresh OK
    "player_talent_metrics":  (24, "warn"),
    "player_gar_components":  (168, "warn"),  # weekly OK; monthly via cron
    "goalie_gsax":            (168, "warn"),
    "nhl_games":              (24, "page"),  # required for matchup display
    "fantasy_daily_rosters":  (24, "page"),
    "matchup_scoring_snapshots": (24, "page"),
}
```

Behavior:
- Run hourly (extend the existing cron, lighter than the daily integrity check)
- For each table: check `MAX(updated_at)` (or derived equivalent for tables without `updated_at`)
- If staleness exceeds threshold: write to `integrity_check_results` with `check_name="freshness_sla"` and severity in `details`
- `severity=page` triggers a Discord alert with `@here` mention; `severity=warn` is silent log
- Grafana / Supabase dashboard query: `SELECT * FROM integrity_check_results WHERE check_name='freshness_sla' AND check_time > now() - interval '7 days'`

### Cost / payoff

- Cost: ~1 hour to refactor existing script into the SLA-matrix shape + 30 min cron config
- Payoff: catches stale model-output tables BEFORE the UI shows stale data badges. Current state has `goalie_gar` 5 months stale (per Phase 0 audit) and we found out via UI. R7-3 means we find out at the source.

### What this does NOT solve

- Doesn't auto-recover (e.g., re-run the failing pipeline). Manual operator
  responds to the page. Auto-recovery is Phase 1 territory.
- Doesn't catch partial-table staleness (e.g., 90% of rows fresh, 10%
  stale due to a partial pipeline run). Mitigated by R7-2's row-count
  range checks but not perfectly.

---

## R7-4 — Schema versioning discipline (formal PR review)

**Goal:** even solo, every migration goes through a documented
intent-and-review process. Future audits can read commit messages and
understand WHY a schema changed, not just WHAT changed.

### Approach

**No tooling install.** Pure process discipline backed by a CI gate
that enforces the discipline.

### Concrete deliverable

Add a CI check `validate-migration-message.ts` to `scripts/`:

- Runs as part of `ci.yml` on every PR that touches `supabase/migrations/`
- Parses each new migration filename (`YYYYMMDDHHMMSS_description.sql`)
- Validates the corresponding commit message includes:
  - `## Why` — one-paragraph statement of motivation
  - `## What` — bullet list of schema changes
  - `## Risk` — what could break, what's the rollback
  - `## Verification` — what query confirms the migration worked

Sample template (added as `supabase/migrations/MIGRATION_TEMPLATE.md`):

```markdown
## Why
[Why is this schema change needed? What problem does it solve, what user
ask drives it, what audit found a gap?]

## What
- [bullet listing each ADD/ALTER/DROP/CREATE]

## Risk
[What breaks if this migration runs incorrectly? What's the rollback
path? Any data-loss potential?]

## Verification
[Query or test that confirms the migration achieved its goal. Run
this after `supabase db push` against staging before merging to
master.]
```

### Cost / payoff

- Cost: ~2 hours to write the validator + 15 min adding the template
  to existing migration workflow
- Payoff: every future migration carries the four-question structure
  in its commit message. When something breaks 6 months from now,
  `git log supabase/migrations/<file>` shows the original intent +
  rollback plan
- Solo founder bonus: forces structured thinking on every migration,
  which catches half the "wait, why am I doing this" mistakes
  before they ship

### What this does NOT solve

- Doesn't enforce migration content (e.g., "every table needs RLS").
  That's `audit_rls.ts`'s job (already running weekly).
- Doesn't auto-rollback failed migrations. Supabase's migration
  framework handles that at apply time; rollback documentation in
  the commit message is for after-the-fact auditing.

---

## R7-5 — Backup verification  🟡 RUNBOOK LANDED 2026-05-06; restore pending user action

**Status:** runbook landed at `docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md`
with prod schema fingerprint baseline (84 public tables, top-20 row counts,
auth + storage schema counts) captured 2026-05-06. The runbook covers:
pre-checks, fingerprint capture, PITR trigger procedure, post-restore
verification queries, cleanup, limitations, and a pre-incident usage
section. **What remains:** the actual PITR restore execution — requires
manual dashboard action by the operator (cost + permissions). Verification
log table at the bottom of the runbook is empty pending first execution.

**Goal:** confirm that Supabase's automatic backups actually restore.
Cheapest disaster-recovery test in the world: do it once, document
the procedure, sleep better.

### Approach

**One-time end-to-end verification.** Runbook executed against the
staging Supabase project, then documented for re-execution annually
(or before any major change).

### Concrete deliverable

`docs/runbooks/BACKUP_RESTORE_VERIFICATION.md`:

The runbook walks through:

1. Check that prod (`iezwazccqqrhrjupxzvf`) has automatic backups
   enabled — confirm via Supabase dashboard
2. Note the current backup retention window (default 7 days for free
   tier, 30 for Pro). Document.
3. Test restore on staging (`jjgspcpvqaiitloglxbb`):
   a. Identify a recent backup point
   b. Use Supabase dashboard's PITR (Point-in-Time Recovery) UI to
      restore staging to that point in a NEW project
   c. Verify the restored project has the expected schema + a sample
      of expected data (e.g., `SELECT COUNT(*) FROM raw_shots` should
      match the backup time)
   d. Document any unexpected behavior, schema gaps, or data loss
4. Capture screenshots of the dashboard at each step
5. Document the procedure with a real test run's output

Then the runbook ends with:

- Annual re-run cadence (set a reminder)
- Pre-incident: "if prod is corrupted, follow steps X-Y from this doc"
- Known limitations: PITR is point-in-time only (can't restore single
  table); cross-project restore loses RLS policies that were
  configured outside migrations; etc.

### Cost / payoff

- Cost: ~2 hours to actually do the test restore + write up the
  runbook
- Payoff: once-and-done verification that backups exist + work.
  Annual re-run keeps the procedure documented + practiced.
- Critical for: solo-founder phase where one corrupted-prod incident
  could be existential. Knowing PITR works = knowing the worst-case
  recovery time + procedure.

### What this does NOT solve

- Doesn't test catastrophic failure modes (e.g., entire Supabase
  region going down). Those are covered by Supabase's SLA, not
  application-level backup verification.
- Doesn't replace external backups (e.g., periodic `pg_dump` to S3).
  At Citrus's scale, Supabase's PITR is sufficient; external backups
  are Phase 2 concern.

---

## R7 sequencing

If approved as a set, the recommended execution order is:

| Order | Investment | Time | Why first |
|---|---|---|---|
| 1 | **R7-3** (Freshness SLA) | ~1.5 hr | Cheapest; almost-done already; immediate operational value |
| 2 | **R7-5** (Backup verification) | ~2 hr | One-time test; do it before anything else can break |
| 3 | **R7-2** (Critical table checks) | ~4 hr | Builds on existing `verify_data_integrity` + `integrity_check_results` infrastructure; biggest catch-silent-failures payoff |
| 4 | **R7-4** (Schema versioning) | ~2 hr | CI gate touching `validate-migration.ts`; needs no migration churn to land |
| 5 | **R7-1** (Lineage tracking) | ~3.5 hr | Most build-from-scratch work; lowest urgency; Phase 0 backfill makes it more valuable but doesn't depend on it |

**Total: ~13 hours of work. Each investment is independent — Garrett
can approve a subset.**

Each commits in its own atomic commit referencing this doc + the audit.
After R7-N lands, the corresponding monitoring activates immediately
(no rollout phase needed).

---

## What R7 does NOT include (intentionally)

- **dbt / Great Expectations / Soda** — too heavy for current scale
- **Distributed tracing on the pipeline** (e.g., OpenTelemetry) —
  the cron + 100-IP scraper architecture is already simpler than
  what dist-tracing would add value to. Pipeline failures surface
  via `nightly_job_runs` + Discord alerts adequately
- **Data catalog UI** (Amundsen, DataHub) — overkill at current
  scale; `LINEAGE.md` from R7-1 is sufficient
- **CDC / event-streaming infrastructure** — Citrus is a batch shop;
  no real-time streaming needs that justify Kafka or equivalent
- **External backup destinations** (S3, GCS bucket) — Supabase PITR
  is the sole backup until R7-5 verification proves we need belt-AND-
  suspenders

These items live in a R8/R9 future-state list if Citrus's scale or
team size changes the calculus. They are not Tier 1 for solo-founder
phase.

---

## Garrett review prompts

Before approval, please decide:

1. **Whole set vs subset?** R7-3 + R7-5 are clear wins (cheap, almost-
   done, big payoff). R7-1 is the longest pole — defer to post-Phase-0?
2. **R7-2 check set** — the 12 initial checks are conservative.
   Anything missing that's bitten you in the past?
3. **R7-4 commit message template** — required on every migration, or
   only "schema-changing" migrations? (Some migrations are pure data
   touch-ups, e.g., RLS policy adjustments — gating those on the
   four-question template might be friction without payoff.)
4. **R7-5 cadence** — annual sufficient, or quarterly pre-Phase-0?
5. **Open: which R7 lands BEFORE Phase 0 starts?** Recommendation:
   R7-3 + R7-5 + R7-2 (the operational ones) before Phase 0; R7-1
   + R7-4 after.

After your decisions, I'll execute the approved subset in order, one
commit per investment, validating each before moving to the next.
