
## Entry 169 — Swept all 328 migrations against the live database. **Five are unapplied, and three of them form a work stream to re-enable an automated integrity-repair cron that E151 showed would mis-repair every v2 league.** Also added the runbook's missing "IF SOMETHING GOES WRONG" index.

**Why.** E168's rule — *before proposing a fix, grep the migrations directory* — found two unapplied migrations by accident. **An accident is not a sweep.** With 328 files, there was no reason to think two was the whole set.

**Method note, because the bookkeeping lies.** Comparing filenames to `schema_migrations` gives false positives: the Supabase CLI rewrites timestamps on apply, so `20260811100000_start_draft_v2_row_lock.sql` appears as `20260811151237`. **So I verified by effect, not by version** — `start_draft_v2` contains `FOR UPDATE`, therefore that migration is applied regardless of what the ledger says. Same discipline as E167: check the world, not the record of the world.

---

### The five that are genuinely unapplied

| migration | what it does | matters before Aug 20? |
|---|---|---|
| `20260805200000_sl1_auto_fix_uuid_cast` | fixes a uuid cast in `auto_fix_integrity_issues` | no |
| `20260806100000_sl1b_auto_fix_unwrap_agg` | further fix to the same function | no |
| **`20260806200000_reenable_auto_fix_after_sl1b_v2`** | **re-enables the `auto_fix_integrity_issues` cron job** | **no — and see the warning** |
| `20260808120000_v2_draft_completion_clears_draft_state` | N-2 (E168) | no |
| `20260821000000_v1_completed_leagues_backfill_draft_state` | the backfill (E168), dated post-twelve on purpose | no |

Verified by effect: `auto_fix_integrity_issues` has **no** uuid cast in its live body, and `cron.job` contains **zero** auto-fix entries — consistent with E155's finding that the only scheduled job on staging is a nightly security-drift check.

**Nothing here affects Aug 20.** That is the headline and it is a good one.

---

### 🔴 The warning worth leaving behind

**Do not apply `20260806200000` until `auto_fix_integrity_issues` is made v2-aware.**

Those three migrations are a coherent repair-and-reactivate stream: the function had a bug, it was fixed twice, and the third migration turns its scheduled job back on. **Sensible work — and E151 found the thing none of them address.**

`auto_fix_integrity_issues` reads the **v1 `draft_picks`** table. Its own comment describes the repair as *"Fix missing players (restore from `draft_picks`)"*. And `check_data_integrity`, which supplies its findings, reports a healthy v2 league as corrupt — *"Phantom player in daily rosters, not in draft_picks"*, `team_lineups: 21, draft_picks: 0`.

**So re-enabling that cron today would schedule a job that:**

1. inspects 112 v2 leagues,
2. concludes every one of them is corrupt, because it is looking at the wrong table, and
3. attempts to "restore" them **from a table holding 12 rows**.

**An automated repair loop pointed at the wrong table is worse than no repair loop**, and it would run unattended on a schedule. The three migrations are individually correct and collectively hazardous, purely because of the v1/v2 split documented in `V1_TABLE_CONSUMERS.md`.

**Correct order, post-Aug-20:** make `auto_fix_integrity_issues` and `check_data_integrity` v2-aware first (E151 lists them among the ops tooling with no caller and no trigger — which is exactly why this has been safe so far), *then* apply the trio. **Applying the reactivation alone is the one sequencing mistake available here.**

---

### The runbook's missing entry point

E165 corrected the runbook's commands and E166 its SQL organs, but neither fixed the structural problem: **§E12 and §E13 are the only two levers Garrett has, and they sat at the bottom of an 831-line document.** Under pressure, findability *is* correctness.

Added **"⚡ IF SOMETHING GOES WRONG — start here"** at the head of the v4 delta: a single-screen table mapping symptom → action → section. Ten rows covering needing time, needing a break, a stalled clock, an engine bounce, a mis-pick, a missing manager, wanting to restart, starting a person short, slow acknowledgement, and full rollback.

Two things it makes explicit that were previously spread across five sections: **an engine bounce autopicks whoever's deadline passed during the outage, so extend during the outage**, and **a manager going dark needs no action at all** — the clock autopicks, and that is the designed answer (E160), not a failure to be fixed at 11pm.

---

**No migration applied. No DDL. One runbook addition. Both databases read-only for this entry.**
