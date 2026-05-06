# Backup & Restore Verification Runbook

> **Purpose:** end-to-end verification that Supabase daily backups exist
> and actually restore. Cheapest disaster-recovery test that fits the
> current pre-launch tier — execute once, document, sleep better.
>
> **Cadence:** annually, and before any major schema migration.
>
> **Author:** R7-5 (revised 2026-05-06)
>
> **Last verified:** _PENDING — see § Verification log at the bottom._

---

## 1. Why this matters

A backup that has never been restored is a **wish**, not a backup. Until
we have observed a successful restore of Citrus data and verified the
restored database matches expectations, we don't actually know that:

- Backups are running
- Backups are complete (no missing tables / RLS / functions)
- The restore procedure works under our actual project configuration
- We know how long a restore takes

**Solo-founder context:** one corrupted-prod incident could be
existential. Knowing the restore procedure works = knowing the
worst-case recovery time + the steps to follow under pressure.

## 2. Recovery posture (current vs target)

| Phase | Mechanism | RTO | RPO | Cost |
|---|---|---|---|---|
| **Pre-launch (NOW)** | Daily snapshots, 7-day retention (Supabase free tier) | ~24h | up to 24h of writes | $0 |
| **At launch** | Daily snapshots + PITR (Supabase Pro add-on) | ~minutes | seconds | ~$100/mo |

The PITR upgrade is gated on user state — see
`docs/RECOVERY_STRATEGY.md` for the principled trigger rules.

This runbook documents the **pre-launch** procedure (free tier daily
backups). When PITR is enabled, § 5 below grows a PITR variant; the
fingerprint queries in § 4 and verification queries in § 6 stay the
same.

## 3. Project topology

| Project | Ref | Use | Restore target |
|---|---|---|---|
| Production | `iezwazccqqrhrjupxzvf` (CitrusFantasySports) | Live data | **NEVER** restore-over (destructive) |
| Staging | `jjgspcpvqaiitloglxbb` (citrus-staging) | Test environment | OK to restore over |

Both: `ca-central-1`, Postgres 17, owned by org
`zgxmcbfbwwbspmtxjmtk`.

For **the verification test** the recommended target is staging — the
pre-launch flow is "use staging to prove restore works against a
sacrificial project so prod stays untouched."

For **a real incident**, you'll restore over prod itself; the procedure
is the same, just a different project ref.

---

## 4. Pre-checks (do these in the dashboard)

### 4.1 Verify automatic backups are enabled

1. Open https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/database/backups
2. Confirm **Backups** tab shows daily backups for the last 7 days.
   - Free tier: 7 daily snapshots, retention rolls forward
   - Pro tier: 7 daily + PITR add-on
3. Note the backup timestamps and click into one to confirm it's
   restorable from the UI.
4. Document below:
   ```
   Retention observed: ___ days
   Latest backup ts:   ___
   PITR enabled:       yes / no
   ```

### 4.2 If retention is fewer than 7 days

Investigate. The free tier should always show 7 daily snapshots when
the project has been alive ≥7 days.

---

## 5. Pre-restore: capture prod fingerprint

Before triggering a restore, capture a **schema + row-count fingerprint**
of prod at a known timestamp. This is what we'll compare the restored
project against.

### 5.1 Schema fingerprint

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

### 5.2 Top-20 row-count fingerprint

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

### 5.3 RLS fingerprint

```sql
-- Tables with RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;
```

Save the count and a sample (~5 rows). After restore, verify the count
matches and the sampled tables still have RLS on.

### 5.4 Functions fingerprint

```sql
SELECT COUNT(*) AS function_count
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public';
```

---

## 6. Restore procedure (free-tier daily backup)

**⚠️ Decision required first:** the free-tier daily-backup restore
generally **overwrites the target project**. There's no
"restore-into-new-project" path on free tier — that's a Pro-tier
feature. Therefore, the verification target is **staging**, not
prod.

> **Real-incident restore against prod is the same procedure run with
> the prod project ref. We use staging here because it's the only safe
> sandbox.**

### 6.1 Pick the most recent staging backup

1. Open https://supabase.com/dashboard/project/jjgspcpvqaiitloglxbb/database/backups
2. Identify the most recent daily snapshot (top of the list).
3. Note the snapshot timestamp:
   ```
   Snapshot timestamp: ___
   ```

### 6.2 Capture staging pre-restore fingerprint

Run § 5.1 / 5.2 / 5.3 / 5.4 against staging — but expect lower row
counts than prod since staging is the sparse reload target.

This becomes our "what staging looked like before" baseline for the
verification.

### 6.3 Trigger the restore (dashboard)

1. From the staging Backups page, click **Restore** on the chosen
   snapshot.
2. Read the warning carefully — restore typically:
   - Replaces all DB content with the snapshot
   - Locks writes during restore
   - May reset auth providers / SMTP / etc. depending on what's stored
     where
3. Confirm and **note start time**.
4. Wait for restore to complete.
   ```
   Restore start (UTC): ___
   Restore complete (UTC): ___
   Total duration: ___
   ```
5. This **RTO data point** (total duration) is the worst-case "how long
   until we're back" number you can quote when the next person asks.

### 6.4 Verify nothing leaked into prod during the test

Before celebrating, run:
```sql
-- Against prod
SELECT n.nspname AS schema, COUNT(*) AS table_count
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'r' AND n.nspname IN ('auth','public','storage')
GROUP BY n.nspname;
```

Compare to § 5.1 baseline. Counts must match exactly. If they don't,
**stop and investigate** — something hit prod that shouldn't have.

---

## 7. Post-restore verification

Connect to staging (now restored). Run each fingerprint query from § 5
and compare against the **pre-restore staging fingerprint** captured in
§ 6.2.

For real incidents, you would compare the restored prod against the §
5 prod baseline.

### 7.1 Schema fingerprint match

| Schema | Pre-restore | Post-restore | Match? |
|---|---|---|---|
| auth | ___ | ___ | ☐ |
| public | ___ | ___ | ☐ |
| storage | ___ | ___ | ☐ |

If any count differs, the restore is incomplete.

### 7.2 Row-count fingerprint match

Run § 5.2 against the restored project. For the top-20 tables on prod
that also exist in staging, expect:
  - Pre-launch staging is a sparse subset of prod, so absolute counts
    will not match prod
  - But pre-restore staging vs post-restore staging should be **identical**
    (because restore goes back to a snapshot taken before this run)

### 7.3 RLS preserved

Run § 5.3 against restored. **Count must match the pre-restore staging
count exactly.** Missing RLS on any table = critical finding; pause
runbook and surface immediately.

### 7.4 Functions preserved

Run § 5.4. Count must match.

### 7.5 Sample data spot-check

Pick 3 critical tables and verify a known row pattern exists:

```sql
-- 1. Most recent NHL game (if staging has any)
SELECT game_id, game_date, status FROM nhl_games
ORDER BY game_date DESC LIMIT 1;

-- 2. raw_shots sample (Phase 0 target table)
SELECT COUNT(*) FROM raw_shots;

-- 3. player_shifts_official (Phase 0 target table)
SELECT COUNT(*) FROM player_shifts_official;

-- 4. Model output table (Phase 0d target)
SELECT COUNT(*) FROM goalie_gar;
```

Each should match what was there before the restore.

### 7.6 Run the freshness SLA matrix against the restored project

```bash
# Set env vars to point at the restored staging project, then:
python data-pipeline/monitoring/check_data_freshness.py --baseline --no-log
```

This validates that the SLA matrix's table list and timestamp columns
all exist on the restored project. End-to-end smoke test that captures
schema + RLS + data + column conventions all at once.

### 7.7 Run the critical-table data-quality checks

```bash
# Against the restored staging project:
python data-pipeline/monitoring/critical_table_checks.py --baseline --no-log
```

Same logic — validates the R7-2 checks against the restored DB.

---

## 8. Post-test — restore the staging working state

If your verification test overwrote staging with a snapshot, **the
ongoing staging-deploy.yml workflow may be affected.** Either:

  - Let it heal naturally over the next deploy cycle, OR
  - Re-run `scripts/staging/04-load-stats-data.mjs` to repopulate
    staging from the canonical export chunks

Document what you did in the verification log.

---

## 9. Limitations & known gotchas (free-tier daily backups)

- **RPO is up to 24h.** A daily snapshot taken at 02:00 UTC means a
  loss/corruption event at 23:59 UTC the same day costs you ~22 hours
  of writes.
- **Free-tier restore is destructive to the target project.** No
  "restore into new project" path until you're on Pro.
- **Cross-region failover is not available** at any tier without
  explicit replication setup. Out of scope.
- **Restore preserves:** schema + data + RLS policies + most extensions.
- **Restore does NOT preserve:**
  - Edge Functions deployment state (re-deploy from CLI/CI)
  - Storage bucket _objects_ (the bytes) — only bucket _metadata_
  - Custom auth providers / SMTP config (re-configure in dashboard)
  - Realtime subscription policies (re-apply via migrations)
  - Cron schedules in `pg_cron` (verify they re-enable post-restore)
- **Single-table restore is not possible** via dashboard restore — it's
  all-or-nothing. For targeted recovery, use `pg_dump --table=foo`
  against a Pro-tier PITR clone (post-launch path).

---

## 10. Verification log

Append a row each time this runbook is executed.

| Date | Operator | Snapshot ts | Target project | RTO | Schema match? | Row-count match? | RLS match? | Notes |
|---|---|---|---|---|---|---|---|---|
| _PENDING_ | _Garrett_ | _TBD_ | staging (`jjgspcpvqaiitloglxbb`) | _TBD_ | ☐ | ☐ | ☐ | First-ever verification — see R7-5 (revised) |

---

## 11. Pre-incident usage

> **If you suspect prod is corrupted or data is lost:**
>
> 1. **Don't restore yet.** First, identify what's broken — a recent
>    bad migration, a runaway delete, a schema accident? The fix may
>    not require restore.
> 2. **Pause writes.** Stop data-pipeline cron jobs and any in-flight
>    deploys. Identify the latest known-good snapshot.
> 3. **Decide RPO tolerance.** Free-tier restore costs up to 24h of
>    writes. If that's unacceptable for your incident, the answer is
>    "we can't fully recover" — document the loss and proceed.
> 4. **Communicate.** Post in your incident channel + DM key users with
>    the timeline and ETA.
> 5. **Execute restore** following § 6 above, but targeting prod.
> 6. **Post-restore verification** following § 7.
> 7. **Resume writes.** Re-enable cron, monitor `check_data_freshness.py`
>    + `critical_table_checks.py` for stale/inconsistent tables.
> 8. **Postmortem.** Use `docs/POSTMORTEM_TEMPLATE.md`. Include the
>    "should we have had PITR by now?" question — see
>    `docs/RECOVERY_STRATEGY.md` for the trigger criteria.

---

## 12. Related references

- [RECOVERY_STRATEGY.md](../RECOVERY_STRATEGY.md) — when to upgrade
  to PITR (principled deferral rule)
- [DATA_INVENTORY.md](../../DATA_INVENTORY.md) — what's stored where
- [check_data_freshness.py](../../data-pipeline/monitoring/check_data_freshness.py) — post-restore freshness validation
- [critical_table_checks.py](../../data-pipeline/monitoring/critical_table_checks.py) — post-restore data-quality validation
- [Supabase backup docs](https://supabase.com/docs/guides/platform/backups)
