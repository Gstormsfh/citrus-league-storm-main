# Phase 0 Launch Checklist

One-page operator runbook. Companion to:
- [`PHASE_0_EXECUTION_PLAN.md`](PHASE_0_EXECUTION_PLAN.md) — what we're doing and why
- [`PRE_PHASE_0_BASELINE.md`](PRE_PHASE_0_BASELINE.md) — frozen pre-state snapshot
- [`PHASE_0_VALIDATION_QUERIES.md`](PHASE_0_VALIDATION_QUERIES.md) — runnable SQL gates per phase

> Phase 0 starts on Garrett's go-signal **after R7-5 daily-backup
> restore test closes** (proven recovery path is the rollback plan).

---

## §1. Pre-flight checklist

Before kicking off 0d-pre, confirm every line. Do not skip.

| ☐ | Item | Verify how |
|---|---|---|
| ☐ | R7-5 daily-backup restore test executed against staging | Verification log in `docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md` § 10 has a row populated |
| ☐ | Latest daily backup of prod is < 24h old | Supabase dashboard → Backups tab |
| ☐ | Pre-Phase-0 baseline snapshot is captured + committed | `apps/web/docs/PRE_PHASE_0_BASELINE.md` exists at HEAD |
| ☐ | R7-2 baseline = 11 PASS / 0 WARN / 1 FAIL | `python data-pipeline/monitoring/critical_table_checks.py --baseline --no-log` |
| ☐ | R7-3 baseline matches `R7_3_BASELINE.md` (14 WARN expected) | `python data-pipeline/monitoring/check_data_freshness.py --baseline --no-log` |
| ☐ | `populate_player_directory.py` daily cron has fired at least once | `.github/workflows/refresh-player-directory.yml` last run is < 36h ago via `gh workflow view` |
| ☐ | No active deploys / migrations / merges in flight | `git -C citrus-league-storm-staging status` clean; PR queue empty |
| ☐ | Operator workstation has env loaded | `set -a; source .env; set +a` against the main repo's `.env` (NOT staging's) |
| ☐ | NHL API access verified (no Cloudflare 403 against `api-web.nhle.com`) | `curl -sS -H 'User-Agent: Mozilla/5.0' https://api-web.nhle.com/v1/standings/now` returns JSON |
| ☐ | Cloud Run is reachable (gcloud auth current) | `gcloud auth list` shows an active account; `gcloud run jobs list --region=us-central1` returns rows |
| ☐ | At least 8GB free local disk | `shots_2017.csv` + `shots_2018-2024.csv` + working temp ≈ 500MB; CSV-load process needs 2-4GB headroom |
| ☐ | Garrett go-signal received in chat | (this message) |

If **any** ☐ is unchecked, **stop**. Fix the gap, re-verify, then proceed.

---

## §2. Per-phase execution commands

> All commands assume working directory `citrus-league-storm-staging`
> with prod env vars loaded (`set -a; source .env; set +a`).

### 0d-pre — Foundation fixes (1-2 days, sequential)

| Step | Command | Expected output | Validation gate |
|---|---|---|---|
| #1 Defender geometry extraction logic fix | `# code change in data-pipeline/acquisition/data_acquisition.py + tests` | tests pass | n/a (lands as PR + commit, no DB writes) |
| #2 Shooter shift context extraction fix | `# code change in data-pipeline/acquisition/extract_shifts.py + tests` | tests pass | n/a |
| #3 Season backfill migration | `psql ... -f supabase/migrations/YYYYMMDDHHMMSS_backfill_season_columns.sql` | row count updated for raw_shots / player_shifts / player_toi_by_situation | §B.1 in validation queries |
| #4 populate_player_directory.py one-time backfill | `python scripts/utilities/populate_player_directory.py` | "OK: Successfully upserted N players" | §B.3 — orphan count = 0 |
| #5 Daily cron schedule | `gh workflow run refresh-player-directory.yml` (verify trigger works manually) | workflow run completes green | §B.6 — recent_runs ≥ 100 |
| #6 Extraction backlog drain | `python data-pipeline/acquisition/extract_stats_backlog.py --since 2025-12-17` | "Extracted N games" | §B.4 — backlog = 0 |
| #7 Defensive GAR pipeline fix + recompute | `python data-pipeline/projections/recompute_gar.py --season 2025` | "GAR recomputed for N players" | §B.5 — evd / ppd / penalty nonzero ≥ 80% |

**Gate to advance to 0a:** queries §B.1 through §B.6 in `PHASE_0_VALIDATION_QUERIES.md` all PASS.

### 0a — Historical CSV load (1-2 days, local)

```bash
# (Script does not exist yet — must be authored as part of 0a deliverable)
python scripts/utilities/load_historical_shots_csv.py \
  --csv data-pipeline/data/historical/shots_2017.csv \
  --season 2017 \
  --moat-features NULL

python scripts/utilities/load_historical_shots_csv.py \
  --csv data-pipeline/data/historical/shots_2018-2024.csv \
  --season-from-csv \
  --moat-features NULL
```

**Expected output:** total ~905K rows inserted; per-season counts match § C.2 in validation queries.

**Gate to advance to 0b:** queries §C.1 through §C.6 all PASS.

### 0b — Oct-Dec 2025-26 gap fill (3-5 hours, local)

```bash
python data-pipeline/acquisition/replay_scraper.py \
  --season 2025 \
  --from 2025-10-07 \
  --to 2025-12-17
```

**Expected output:** ~360 games scraped + extracted; matches NHL official schedule.

**Gate to advance to 0c:** queries §D.1 through §D.3 all PASS.

### 0c — PbP API replay for moat features (3-5 calendar days, Cloud Run)

#### 0c-pre-test — 35-game smoke test (~30 min)

```bash
# Run 7 concurrent --season jobs at low volume to verify rate-limit behavior under parallel load
for season in 2017 2018 2019 2020 2021 2022 2023; do
  gcloud run jobs execute pbp-replay-moat \
    --region=us-central1 \
    --args="--season=$season --limit-games=5" \
    --async &
done
wait

# Verify no 403s, no rate-limit retries beyond expected
gcloud run jobs executions list --job=pbp-replay-moat --region=us-central1 --limit=7
```

**Decision point:**
- All 7 jobs green, no rate-limit retries → proceed to full run with 7 parallel
- Any 403 or extensive retries → throttle to 3-4 parallel for full run

#### 0c-full — Full historical replay

```bash
# After pre-test signs off, kick the full run with the chosen parallelism
for season in 2017 2018 2019 2020 2021 2022 2023; do
  gcloud run jobs execute pbp-replay-moat \
    --region=us-central1 \
    --args="--season=$season" \
    --async
done

# Monitor via:
gcloud run jobs executions list --job=pbp-replay-moat --region=us-central1
```

**Expected:** 6-8 hours per season per slot (parallel) for ~14K games / 7 ≈ 2K games per season-job.

**Gate to advance to 0d-post:** queries §E.1 through §E.4 all PASS.

### 0d-post — Full-corpus recomputes (1-2 days, local)

```bash
# Recompute GAR family across all 8 seasons
for season in 2017 2018 2019 2020 2021 2022 2023 2024 2025; do
  python data-pipeline/projections/recompute_gar.py --season $season
done

# Recompute talent metrics
python data-pipeline/projections/recompute_talent_metrics.py --all-seasons

# Refresh ROS projections (current season only — no historical)
python data-pipeline/projections/nightly_projection_batch.py --rebuild-ros
```

**Gate to declare Phase 0 complete:** queries §F.1 through §F.5 all PASS.

---

## §3. Per-phase rollback procedure

If a phase fails partway through and you need to undo:

| Phase | Rollback strategy |
|---|---|
| 0d-pre | Per-step revert. Migrations have explicit DOWN. Code changes revert via `git revert`. |
| 0a | Daily backup restore (R7-5 procedure) — restores all of Phase 0 to pre-Phase-0 state. RTO ~24h, RPO up to 24h. **NOTE:** rolls back ALL Phase 0 progress, not just 0a. Acceptable cost given the 0a load is 1-2 days of recoverable work. |
| 0b | Targeted DELETE: `DELETE FROM raw_nhl_data WHERE game_date BETWEEN '2025-10-07' AND '2025-12-17' AND scraped_at > '<phase_0b_start_ts>'` then re-run extraction. |
| 0c | Per-season targeted UPDATE: `UPDATE raw_shots SET pass_quality_score=NULL, ... WHERE season=<failed_season>` then re-run that season's job. |
| 0d-post | Per-script revert. Each recompute is idempotent; just re-run with corrected logic. |

**Whole-Phase-0 rollback (worst case):** R7-5 daily-backup restore.
This is why R7-5 is a precondition.

---

## §4. Temporary monitoring adjustments during Phase 0

### 4.1 Freshness alerts — switch to log-only mode

During 0a / 0b / 0c, the actively-written tables (`raw_shots`,
`player_shifts`, `player_toi_by_situation`, `player_gar_components`,
`goalie_*`) will appear "fresh" mid-write but their freshness
thresholds may transiently breach during long-running batches.

**Recommended:** run the freshness checker in `--baseline --no-log`
mode during active phases (continues writing data to
`integrity_check_results` for audit trail, but suppresses alert
dispatch). Re-enable normal alerting between phases.

```bash
# During active write phase — log only, no alerts
python data-pipeline/monitoring/check_data_freshness.py --baseline

# Between phases — full alerting
python data-pipeline/monitoring/check_data_freshness.py
```

**No code change required.** The `--baseline` flag is already wired in
(R7-3). Operator just changes which command is in the cron during
Phase 0 windows.

### 4.2 R7-2 critical-table checks — same treatment

```bash
# During active write phase
python data-pipeline/monitoring/critical_table_checks.py --baseline

# Between phases — full alerting
python data-pipeline/monitoring/critical_table_checks.py
```

### 4.3 New regression sentinel — add temporary `phase_0_regression_check.py`

A one-off check that runs **between** phases and fires PAGE if any
previously-PASSing check has flipped to FAIL. This catches the case
where a Phase 0 step accidentally broke something unrelated.

**Logic:**
```sql
-- Find checks that were PASS before Phase 0 started but are now FAIL/WARN
SELECT i_now.check_name, i_baseline.status AS baseline, i_now.status AS now
FROM (
  SELECT DISTINCT ON (check_name) check_name, status
  FROM integrity_check_results
  WHERE check_time < '<phase_0_start_ts>'
    AND check_time > '<phase_0_start_ts>' - interval '7 days'
  ORDER BY check_name, check_time DESC
) i_baseline
JOIN (
  SELECT DISTINCT ON (check_name) check_name, status
  FROM integrity_check_results
  WHERE check_time > '<phase_0_start_ts>'
  ORDER BY check_name, check_time DESC
) i_now USING (check_name)
WHERE i_baseline.status = 'pass' AND i_now.status IN ('warning', 'fail');
```

**This is a temporary check, not a permanent addition.** Add it under
`scripts/_one_offs/phase_0_regression_check.py`, run it between
phases, retire it after Phase 0 closeout.

### 4.4 Auto-revert — none required

All adjustments above are operational knob changes (which command runs
in cron, when to invoke `--baseline` flag). Nothing in the code or
SLA matrix needs to change. After Phase 0 closeout, the standard
runners come back automatically — no migration or revert step needed.

---

## §5. Expected baseline diff post-Phase-0

The big-picture transitions vs `PRE_PHASE_0_BASELINE.md`:

### 5.1 integrity_check_results status transitions

| Status | Pre | Expected post | Delta |
|---|---:|---:|---|
| PASS | 15 | ~30 | +15 (most freshness WARNs flip; new per-season checks add) |
| WARNING | 16 | ~3 | -13 (only `freshness_league_averages` and `freshness_team_lineups` likely stay WARN — neither is a Phase 0 target) |
| FAIL | 4 | 3 | -1 (`raw_shots_season_populated` flips PASS; the 3 unrelated FAILs persist) |

### 5.2 Row count growth

| Table | Pre | Post | Multiplier |
|---|---:|---:|---|
| `raw_shots` | 99,394 | ~1,004,000 | **~10×** |
| `player_directory` | 1,053 | ~7,000–8,000 | ~7× |
| `player_gar_components` | 935 | ~7,000 | ~7× |
| `goalie_gar` | 85 | ~600–700 | ~7× |
| `goalie_gsax` | 197 | ~1,400 | ~7× |
| `goalie_gsax_primary` | 82 | ~600 | ~7× |
| `goalie_rebound_control` | 85 | ~600–700 | ~7× |
| `nhl_games` | 1,387 | unchanged | 1× |

### 5.3 New monitoring data

After 0c lands, add these per-season checks to `critical_table_checks.py` (deferred to a follow-up R7-2 extension; tracked here so it's not forgotten):

- `raw_shots_season_<YYYY>_count_in_range` — per-season row count bounds (per § C.2)
- `raw_shots_season_<YYYY>_moat_populated` — per-season moat NULL rate ≤ 5%
- `raw_shots_season_<YYYY>_xg_value_range` — per-season xG distribution sane

These are not added pre-Phase-0 because the seasons don't exist yet —
no row to check. Add them after 0c with one CheckSpec per season.

### 5.4 What does NOT change

- RLS policies (count + per-table)
- Auth schema
- Edge Functions
- API routes
- Frontend code
- User-facing fantasy operations (drafts, lineups, transactions)

If any of these change unexpectedly during Phase 0, treat as a
regression and surface immediately.

---

## §6. Post-Phase-0 closeout

When all five phases land:

1. **Re-baseline both monitoring suites:**
   ```bash
   python data-pipeline/monitoring/check_data_freshness.py --baseline > apps/web/docs/PHASE_0_BASELINE_POST_FRESHNESS.txt
   python data-pipeline/monitoring/critical_table_checks.py --baseline > apps/web/docs/PHASE_0_BASELINE_POST_CHECKS.txt
   ```

2. **Author `apps/web/docs/PHASE_0_BASELINE_POST.md`:**
   - Diff vs `PRE_PHASE_0_BASELINE.md`
   - Confirm § 5.1 / § 5.2 transitions held
   - Surface any unexpected regressions

3. **Update `DATA_INVENTORY.md` § 1.2** — replace pre-Phase-0 row counts with post counts.

4. **Update `apps/web/docs/DATA_ORGANIZATION_AUDIT.md`** — add Phase 0 status banner indicating completion.

5. **Retire the temporary regression sentinel** (§ 4.3) — delete from `scripts/_one_offs/`.

6. **Re-enable full alerting:**
   - Cron returns to `check_data_freshness.py` (no `--baseline`)
   - Cron returns to `critical_table_checks.py` (no `--baseline`)

7. **Update `apps/web/docs/PHASE_0_EXECUTION_PLAN.md`** with status: ✅ COMPLETE date, lessons-learned section.

8. **Surface in chat:** "Phase 0 complete. Pre vs post diff attached. Phase 1 (UI surfacing) ready to begin."

---

## §7. Emergency contact / escalation

If something goes sideways mid-Phase-0:

1. **Pause writes immediately:** kill the in-flight job (`gcloud run jobs delete` or local Ctrl-C).
2. **Snapshot prod state:** rerun § A.1 + § A.2 in validation queries.
3. **Compare to last good gate:** the most recent gate that PASSed before this incident.
4. **Decide rollback vs targeted fix:** see § 3 above.
5. **If unclear:** invoke R7-5 daily backup restore. RTO ~24h is acceptable cost for any incident that can't be diagnosed in < 1h.
