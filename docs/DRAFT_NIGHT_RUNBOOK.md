# THE TWELVE — draft-night runbook

**For Aug 20/21. Written 2026-08-13, after everything below was proven against the running system.**

Read the two rules first. Everything else is a lookup table for when something goes wrong.

---

## The two rules

### 1. Do NOT deploy once the twelve are in the room.

The PWA precaches its own bundle (124 entries). It self-heals on a true page load, but **anyone with the tab already open keeps drafting on the build they arrived with.** A mid-draft deploy means twelve people on two different builds.

Freeze all deploys — web, API, engine — the moment the first manager opens the room.

### 2. Do NOT `git push` on draft day.

`production-deploy.yml` fires on push to `master`. Production has **never had the E142 migration**. A push ships everything to prod without it.

---

## Pre-flight — run 30 minutes before

### a. Engine is alive and on the right build

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging `
  --command="sudo docker logs citrus-draft-engine 2>&1 | grep -E 'deployment.fingerprint|boot_scan_complete' | tail -3"
```

Wants: a `deployment.fingerprint` line, and `boot_scan_complete` with `failed: 0`.

### b. Database health — one query

```sql
select
  (select count(*) from cron.job where active)                                        as cron_jobs,      -- expect 3
  (select count(*) from cron.job_run_details
     where status='failed' and start_time > now() - interval '1 hour')                as cron_failures,  -- expect 0
  (select count(*) from pgmq.q_draft_deadlines)                                       as queue_depth,    -- expect 0
  (select count(*) from pg_inherits i join pg_class c on c.oid=i.inhrelid
     join pg_class p on p.oid=i.inhparent where p.relname='draft_metrics'
     and c.relname = 'draft_metrics_' || to_char(now(),'YYYY_MM'))                    as this_month_partition, -- MUST be 1
  (select max(updated_at)::date from player_directory)                                as directory_date;
```

**`this_month_partition` must be 1.** A missing monthly partition is what silently killed the safety net for 13 days in August. There are partitions through **March 2027** and a `DEFAULT` catch-all, so this should not bite again — but check it anyway, because it is invisible from every other angle.

### c. Everyone hard-refreshes

Tell all twelve, in the group chat, before you start:

> **Press Ctrl+Shift+R (Cmd+Shift+R on Mac) before joining.**

This costs nothing and removes the single most confusing class of "it's broken" report.

---

## During the draft — the only thing worth watching

```sql
select
  (select count(*) from draft_picks_v2 where league_id = :league) as picks,
  (select extract(epoch from (now() - pick_deadline))::int
     from leagues where id = :league)                             as deadline_age_s,
  (select count(*) from pgmq.q_draft_deadlines)                   as net_queue;
```

- `deadline_age_s` **negative** = clock still running. Normal.
- `deadline_age_s` **positive and climbing past ~15** = the engine has not autopicked. Go to the failure table.
- `net_queue > 0` = the safety net has engaged, which means the engine is not doing its job. **Investigate the engine, do not celebrate the net.**

---

## Failure table

| symptom | most likely cause | action |
|---|---|---|
| **One manager sees a blank/stale board** | their bundle or their tab | `Ctrl+Shift+R`. If that fails, close the tab and reopen the room URL. |
| **One manager's clock looks frozen** | backgrounded tab throttling, or a dead socket their client hasn't noticed yet (detection takes up to ~48s after refocus) | Have them click into the tab and wait 5s. If still frozen, `Ctrl+Shift+R`. The **server** clock is authoritative — check `deadline_age_s` before believing the screen. |
| **Nobody's clock is moving, `deadline_age_s` climbing** | engine process down | **Restart it** (below). The safety net will keep the draft alive at roughly **one pick per 2 minutes** in the meantime — that is a floor, not a plan. |
| **`deadline_age_s` climbing AND restart doesn't fix it** | seq/counter mismatch — a silently dead draft | Run the seq check below. Do not hand-edit `draft_events`. |
| **A manager says "I got autopicked, I had time"** | check the server, not the screen | `select pick_deadline from leagues where id = :league` and compare to the pick's `created_at` in `draft_events`. The server is the record. |
| **A pick "didn't go through" but the player is gone** | the pick landed; the confirmation was lost | It's fine. The board is right. Their toast was wrong. |

### Restart the engine

```powershell
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging `
  --command="sudo docker restart citrus-draft-engine"
```

On boot it re-scans every `in_progress` league and **immediately fires any already-expired clock** — recovery is seconds, not minutes. Proven today.

### Seq/counter check — the silent killer

```sql
select draft_event_counter,
       (select max(seq) from draft_events e where e.league_id = l.id) as max_seq
from leagues l where l.id = :league;
```

**These must match.** If `draft_event_counter < max_seq`, every pick collides with the unique index on `(league_id, seq)` and is refused — the draft sits `in_progress` forever with no error visible to anyone. Fix by setting the counter to `max_seq`, then restart the engine.

---

## Rollback pins

| surface | previous-good | command |
|---|---|---|
| **API** (`citrus-api`) | `server:8b0cc346` | `gcloud run deploy citrus-api --image us-central1-docker.pkg.dev/citrus-fantasy-staging/citrus-api/server:8b0cc346 --region us-central1 --project citrus-fantasy-staging` |
| **Engine** | previous `:<sha>-draft` tag in Artifact Registry | re-run the engine block with the older tag |
| **Safety net** | — | `select cron.unschedule('draft-deadline-sweep'); select cron.unschedule('draft-autopick-keepalive');` |

**Region trap:** `citrus-api` is **us-central1**. The engine and its Artifact Registry are **northamerica-northeast1**. `docs/DEPLOY_2026-08-12.md` has the wrong region for the API — ignore it.

**Firebase trap:** both `.firebaserc` files default to **`citrus-fantasy-prod`**. Never run a bare `firebase deploy`. Use `npm run deploy:staging`.

---

## What is proven, and what is not

**Proven against the running system, at 12 × 21:**

- 252 picks, 254 events, 2.50 s/pick
- `roster_assignments` 252/252 across all 12 teams
- Position caps held — every team C5 / LW4 / RW4 / D6 / **G2**
- Zero retired players drafted across 21 rounds
- Draft queue beats projections, and skips already-taken players
- Board renders correctly on a mid-draft join at event 215
- Safety net lands picks with the engine stopped
- Engine self-recovers an unknown stalled league in ~1 second via `NOTIFY`

**NOT proven — know this going in:**

- 🔴 **Twelve concurrent humans.** Every test to date is one human plus bots. Broadcast fan-out and twelve home networks are unmeasured. **A 20-minute dry run with real people is the highest-value thing left.**
- 🟠 **The season stats look like seed data** (McDavid 138 pts in 82 GP; last updated 2026-04-23). Relative ranking is sane, so the board is credible — but a hockey person will spot the absolute numbers fast.
- 🟠 **`player_directory` is 7 days stale**, against the "stale > 24h → POSTPONE" rule.
- Reconnect has one latent gap: the seq-replay path is dead code. Snapshot-on-connect covers it now that the buffer is sized correctly, but it is a single line of defence.
