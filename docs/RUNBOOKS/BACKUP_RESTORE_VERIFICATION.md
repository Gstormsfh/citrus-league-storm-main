# Backup & Restore Verification Runbook

> **Purpose:** end-to-end verification that Supabase backups exist and
> actually restore. Cheapest disaster-recovery test — execute once,
> document, sleep better.
>
> **Cadence:** annually, and before any major schema migration.
>
> **Author:** R7-5 (2026-05-06)
>
> **Last verified:** _PENDING — see § Verification log at the bottom._

---

## 1. Why this matters

A backup that has never been restored is a **wish**, not a backup. Until
we have observed a successful PITR (Point-in-Time Recovery) of Citrus
data and verified the restored database matches expectations, we don't
actually know that:

- Backups are running
- Backups are complete (no missing tables / RLS / functions)
- The restore procedure works under our actual project configuration
- We know how long a restore takes

**Solo-founder context:** one corrupted-prod incident could be existential.
Knowing PITR works = knowing the worst-case recovery time + procedure.

---

## 2. Project topology

| Project | Ref | Use | PITR target |
|---|---|---|---|
| Production | `iezwazccqqrhrjupxzvf` (CitrusFantasySports) | Live user data | **DO NOT** restore against this |
| Staging | `jjgspcpvqaiitloglxbb` (citrus-staging) | Test environment | Safe to restore against |

Both are in `ca-central-1`, both run Postgres 17, owned by org
`zgxmcbfbwwbspmtxjmtk`.

---

## 3. Pre-checks (do these in the dashboard)

### 3.1 Verify automatic backups are enabled

1. Open https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/database/backups
2. Confirm the **Backups** tab shows daily backups for at least the last
   N days where N = your retention window.
3. Note the retention window:
   - **Free tier:** 7 days, daily snapshots, no PITR
   - **Pro tier:** 7 days daily + PITR available as paid add-on
   - **Team / Enterprise:** longer retention available
4. Document below:
   ```
   Retention observed: ___ days
   Latest backup ts:   ___
   PITR enabled:       yes / no
   PITR retention:     ___ days (if enabled)
   ```

### 3.2 If PITR is NOT enabled

PITR is the only mechanism for restoring to an arbitrary point — daily
snapshot restores are your other option. Decide:

- **Enable PITR** (recommended at our scale; ~$N/month per Supabase
  pricing) — gives us per-second granularity for ~7 days
- **Stay on daily snapshots** — restores are bounded to once-per-day
  resolution; acceptable for early-stage but increases potential data
  loss window to up to 24h

If staying on daily snapshots, this runbook still applies but the
restore step becomes "select most recent snapshot" rather than "select
PITR timestamp".

---

## 4. Pre-restore: capture prod fingerprint

Before triggering a restore, capture a **schema + row-count fingerprint**
of prod at a known timestamp. This is what we'll compare the restored
project against.

### 4.1 Schema fingerprint

```sql
-- Total table count by schema
SELECT n.nspname AS schema, COUNT(*) AS table_count
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'r' AND n.nspname IN ('public','auth','storage')
GROUP BY n.nspname ORDER BY n.nspname;
```

**Baseline observed 2026-05-06:**
| schema | table_count |
|---|---|
| auth | 23 |
| public | 84 |
| storage | 8 |

### 4.2 Top-20 row-count fingerprint

```sql
SELECT schemaname || '.' || relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC LIMIT 20;
```

**Baseline observed 2026-05-06:**
| table_name | approx_rows |
|---|---|
| public.player_shifts | 341,612 |
| public.raw_shots | 99,322 |
| public.player_projected_stats | 71,158 |
| public.integrity_check_results | 68,946 |
| public.player_toi_by_situation | 66,042 |
| public.player_game_stats | 53,358 |
| public.fantasy_daily_rosters | 9,353 |
| public.projection_cache | 1,461 |
| public.nhl_games | 1,385 |
| public.raw_nhl_data | 1,352 |
| public.player_season_stats | 1,066 |
| public.player_talent_metrics | 1,012 |
| public.player_directory | 938 |
| public.player_ros_projections | 926 |
| public.security_audit_log | 711 |
| public.draft_picks | 557 |
| public.player_playoff_stats | 363 |
| public.notifications | 346 |
| public.playoff_roster_picks | 290 |
| public.roster_assignments | 216 |

(`n_live_tup` is an estimate maintained by `pg_stat_user_tables`; for a
restore-equivalence check, ±5% drift is acceptable. For an exact match,
run `SELECT COUNT(*)` on each table — slower but deterministic.)

### 4.3 RLS fingerprint

```sql
-- Tables with RLS enabled
SELECT schemaname, tablename, rowsecurity, forcerowsecurity
FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;
```

Save the count and a sample (~5 rows). After restore, verify the count
matches and the sampled tables still have RLS on.

### 4.4 Functions fingerprint

```sql
-- Count of public-schema functions
SELECT COUNT(*) AS function_count
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public';
```

---

## 5. Restore procedure (PITR variant)

**⚠️ Decision required first:** restore _into staging_ (overwrites it) or
_into a brand-new project_ (cleaner but costs an extra project slot for
the duration of the test).

**Recommended:** restore into a **brand-new short-lived project** named
`citrus-restore-test-YYYYMMDD`. After verification, delete it. This
keeps staging undisturbed and proves cross-project restore works.

### 5.1 Trigger restore (dashboard)

1. Go to https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/database/backups
2. Click **Point-in-time recovery** tab.
3. Select a target timestamp **15 minutes before now** (gives the WAL
   archive time to settle).
4. Click **Restore** → choose **Restore into new project**.
5. Name the new project `citrus-restore-test-2026-05-06` (or current
   date).
6. Confirm the cost estimate. **Note start time.**
7. Wait for the restore to complete. Expected duration:
   - Small DB (<1 GB): 5–15 min
   - Medium (1–10 GB): 15–60 min
   - Citrus current size: ~100MB-ish, expect <15 min

### 5.2 Capture restore duration

```
Restore start (UTC): ___
Restore complete (UTC): ___
Total duration: ___
```

This is your **RTO (Recovery Time Objective) data point** — the worst
case you can quote when someone asks "how fast can we recover?"

---

## 6. Post-restore verification

Connect to the restored project (new project ref shown in the dashboard
once restore completes). Then run each fingerprint query from § 4 and
compare.

### 6.1 Schema fingerprint match

Run the table-count query from § 4.1 against the restored project.

| Schema | Prod (4.1 baseline) | Restored | Match? |
|---|---|---|---|
| auth | 23 | ___ | ☐ |
| public | 84 | ___ | ☐ |
| storage | 8 | ___ | ☐ |

If counts differ by more than 0, **stop and investigate** — the restore
is incomplete.

### 6.2 Row-count fingerprint match

Run the top-20 query from § 4.2. For each table, compare:

- Within ±5% of baseline → ✅ acceptable drift (PITR target may be
  slightly off from when baseline was captured)
- More than ±5% → ⚠️ check whether the table had unusual write activity
  in the gap between baseline-capture and PITR-target

### 6.3 RLS preserved

Run the RLS query from § 4.3. **Count must match exactly.**
If RLS is missing on any table that had it on prod, that is a
**critical finding** — surface it immediately and pause the runbook.

### 6.4 Functions preserved

Run § 4.4 against the restored project. Count must match.

### 6.5 Sample data spot-check

Pick 3 tables and verify a known row exists:

```sql
-- 1. Most recent NHL game
SELECT game_id, game_date, home_team, away_team, status FROM nhl_games
ORDER BY game_date DESC LIMIT 1;

-- 2. A specific user's roster from a recent date
SELECT * FROM fantasy_daily_rosters
WHERE roster_date = '2026-04-08' ORDER BY locked_at DESC LIMIT 5;

-- 3. The xG model artifact (should be in a deterministic table)
SELECT player_id, player_name, season FROM player_directory LIMIT 5;
```

Each query should return rows. If any table is empty when prod has
data, escalate.

### 6.6 Run the freshness SLA matrix against the restored project

```bash
# Set env vars to point to the restored project, then:
python data-pipeline/monitoring/check_data_freshness.py --baseline --no-log
```

This validates that the SLA matrix's table list and timestamp columns
all exist on the restored project. Useful end-to-end smoke test that
captures schema + RLS + data + column conventions all at once.

---

## 7. Cleanup

After verification:

1. **Delete** the `citrus-restore-test-YYYYMMDD` project from the
   dashboard. Costs ~5 minutes of pro-rated billing.
2. Confirm in dashboard: **Settings → General → Delete project**.
3. Document the verification outcome in § 9 below.

---

## 8. Limitations & known gotchas

- **PITR window:** bounded by your Supabase tier's retention. Beyond
  that, only daily snapshots are available.
- **PITR resolution:** per-second within the window, but the WAL must
  have settled (don't pick a timestamp within the last 5–10 minutes).
- **Cross-project restore:** Supabase preserves schema + data + RLS
  policies, but **does NOT preserve**:
  - Edge Functions deployment state (re-deploy from CLI/CI)
  - Storage bucket _objects_ (the data) — only bucket _metadata_
  - Custom auth providers / SMTP config (re-configure in dashboard)
  - Realtime subscription policies (re-apply via migrations)
  - Cron schedules (defined in `pg_cron` and migrated, but verify they
    re-enable)
- **Restore cannot be partial** at the table level via dashboard PITR
  — it's all-or-nothing for the entire database. For single-table
  restore you'd need to:
  1. PITR-restore into a new project
  2. `pg_dump --table=foo` from the restored project
  3. `pg_restore` into the live project
  This is non-trivial; don't do it without a runbook entry of its own.
- **Region:** restored project lands in the same region as the source.
  Cross-region failover is a separate Supabase feature (not in scope).

---

## 9. Verification log

Append a row each time this runbook is executed.

| Date executed | Operator | PITR target | Restored project ref | RTO observed | Schema match? | Row-count match? | RLS match? | Notes |
|---|---|---|---|---|---|---|---|---|
| _PENDING_ | _Garrett_ | _TBD_ | _TBD_ | _TBD_ | ☐ | ☐ | ☐ | First-ever verification — see R7-5 |

---

## 10. Pre-incident usage

> **If you suspect prod is corrupted or data is lost:**
>
> 1. **Don't restore yet.** First, identify what's broken — a recent
>    bad migration, a runaway delete, a schema accident? The fix may not
>    require restore.
> 2. **Pause writes.** Stop the data pipeline cron jobs to prevent
>    further damage. Identify the latest known-good timestamp.
> 3. **Choose restore type:**
>    - **Whole DB rollback:** PITR back to known-good ts. Fast but loses
>      all writes since.
>    - **Targeted recovery:** PITR to a new project, `pg_dump` the
>      affected tables, `pg_restore` into live prod. Slower, lossless
>      for unrelated tables.
> 4. **Communicate.** Post in #incidents (or DM key users) with the
>    incident timeline + ETA for restore.
> 5. **Execute restore** following § 5 above, but targeting prod.
> 6. **Post-restore verification** following § 6.
> 7. **Resume writes.** Re-enable cron, monitor `check_data_freshness.py`
>    for stale tables.
> 8. **Postmortem.** Use `docs/POSTMORTEM_TEMPLATE.md`.

---

## 11. Related references

- [DATA_INVENTORY.md](../../DATA_INVENTORY.md) — what's stored where
- [check_data_freshness.py](../../data-pipeline/monitoring/check_data_freshness.py) — post-restore freshness validation
- [Supabase PITR docs](https://supabase.com/docs/guides/platform/backups#point-in-time-recovery)
