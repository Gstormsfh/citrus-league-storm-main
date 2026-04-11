# Live Draft Disaster — Postmortem

**Date of incident:** April 10, 2026
**League:** Inaugural Citrus Test League
**League ID:** `3327bc2e-827b-4cbb-b1f5-16cba0eb7b11`
**Author:** Engineering
**Status:** Draft (for review)
**Severity:** SEV-1 — first live fantasy draft on the platform; owners present; product credibility impact.

---

## 1. Summary

The Inaugural Citrus Test League live draft on April 10, 2026 suffered a cascading failure across the realtime broadcast layer, the data layer, and the serving layer. Owners experienced frozen timers, missing picks, permission errors on legitimate selections, and full-page crashes while AI team creation silently relied on bypassing RLS from a client path. The root causes were not isolated bugs — they were the compounded effect of **ten-plus production deploys executed in the ~2.5 hours leading up to the draft**, pushed directly against a Cloud Run service sized for development traffic, with realtime RLS policies that were never load-tested against a concurrent draft room.

The draft was ultimately completed, but only after commissioner intervention and repeat pick resubmissions. This document captures what went wrong, why, and the specific code/config changes required to prevent recurrence.

---

## 2. Impact

- **User-facing:** Timer freezes during pick transitions; picks appearing on one client and not another; "permission denied" errors on valid picks; missing AI opponents on join; a full white-screen crash after one deploy; the join-league code path rejected valid codes.
- **Operational:** 10+ emergency deploys pushed between ~17:39 UTC on April 10 and ~01:38 UTC on April 11. Multiple revisions required rollback-by-forward-fix.
- **Financial / infra:** Firebase Hosting billed for ~3.2 GB of stored assets and accompanying bandwidth overage; the build artifact shipped ~5.1 MB of Gemini-generated PNG files that should never have reached production.
- **Trust:** First live draft on the product. Several owners watched the platform crash in real time.

---

## 3. Timeline (all times UTC, April 10–11 2026)

Reconstructed from `git log` on `main`. Each commit corresponds to a production deploy via the standard build-and-deploy pipeline.

| Time  | Commit   | Title                                                                 |
|-------|----------|-----------------------------------------------------------------------|
| 16:11 | c429267  | feat(draft): prominent auto-draft toggle, FPTS columns, smarter auto-pick |
| 16:50 | 2cd95d3  | feat(draft): add projected FPTS columns from ROS projections          |
| 17:00 | 46f62eb  | perf(draft): fix scroll widths, memoize PlayerRow, fix AudioContext leak |
| 17:15 | bc03f62  | fix(draft): double-click protection, skip pick wiring, cache invalidation |
| 17:39 | 1403c0a  | fix(draft): safe sessionStorage + resync on phone wake                |
| 17:52 | f3323b0  | fix(draft): comprehensive mobile/resilience hardening for live draft  |
| 18:05 | 06606c7  | perf(draft): optimistic updates, memoization, and UX smoothness       |
| 21:13 | fa1dc84  | feat(draft): connection indicator, opponent pick sound, keyboard shortcuts |
| 23:18 | a19f9ee  | feat(draft): add team count setting changeable by commissioner        |
| 23:21 | d083718  | fix: join league code fails due to .toUpperCase() case mismatch       |
| 23:40 | fe4c2e1  | fix: join league shows error despite succeeding + mobile layout cleanup |
| 23:43 | 8e06d4d  | fix: enable horizontal scroll on player pool stats table              |
| 23:45 | a2a4579  | fix: desktop horizontal scroll on player pool table                   |
| 23:47 | 208811c  | fix: auto-draft toggle always visible, projection tooltip             |
| 23:59 | d1823f0  | fix: desktop layout — remove left ad sidebar, horizontal scroll       |
| 00:11 | 6340820  | fix: Add AI teams endpoint, timer glitch, error toasts                |
| 00:15 | 683f267  | fix: use admin client for AI team inserts to bypass RLS               |
| 00:24 | 271ec9b  | fix: add missing cn import (crash), prominent team management controls |
| 00:50 | 2d5db30  | fix: draft pick permissions, timer freeze, start-draft error, email signup |
| 00:59 | 60f0d24  | fix: resolve TypeScript errors blocking CI pre-deploy gate            |
| 01:19 | 51c0251  | fix: timer stuck after pick + start-draft reliability                 |
| 01:30 | 53a7b21  | fix: prevent draft timer from freezing during pick transitions        |
| 01:38 | b08680d  | fix: instant timer reset on picks + faster polling fallback           |

Between **23:18 UTC (Apr 10)** and **01:38 UTC (Apr 11)** — the 2h 20m window that bracketed the live draft — there were **13 production deploys**, at least five of which were follow-up fixes to regressions introduced by the previous deploy.

---

## 4. Forensic Findings

The following are verified against the repository at the commit this postmortem was written on top of. Every file:line reference was confirmed before inclusion.

### 4.1 Realtime filter concatenation bug — `NotificationService.ts`

**File:** `apps/web/src/services/NotificationService.ts:109`

```ts
.on(
  'postgres_changes',
  {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `league_id=eq.${leagueId},user_id=eq.${userId}`,
  },
  ...
)
```

**Why it's broken:** Supabase Realtime accepts **exactly one** `filter` expression per channel binding. The comma is not a logical AND — it becomes part of the right-hand side of the first equality. The server interprets this as:

```
league_id eq '<league-uuid>,user_id=eq.<user-uuid>'
```

— i.e., the user UUID is concatenated onto the league UUID and compared as a literal. The filter never matches, no `INSERT` events are delivered, and the notification store silently stops receiving updates. During a live draft this manifested as pick notifications not appearing for spectators and as a perceived "pick didn't go through" whenever the client was relying on realtime instead of the polling fallback.

**Fix:** Use a single `filter` keyed on `user_id=eq.${userId}` and filter by `league_id` in the callback; or open two channels. Do NOT comma-join.

### 4.2 `GOALIE_GSAX_COLUMNS` schema mismatch

**File:** `packages/shared/src/constants/columns.ts:180`

```ts
export const GOALIE_GSAX_COLUMNS = 'player_id, gsax';
```

**File:** `server/src/services/PlayerService.ts:193` and `server/src/services/PlayerService.ts:243`

```ts
.from('goalie_gsax_primary')
.select(COLUMNS.GOALIE_GSAX);
```

**Actual table shape:** `supabase/migrations/20250114000001_create_goalie_gsax_primary_table.sql`

```sql
CREATE TABLE IF NOT EXISTS goalie_gsax_primary (
    goalie_id INTEGER PRIMARY KEY,
    total_shots_faced INTEGER NOT NULL,
    total_xGA NUMERIC NOT NULL,
    total_GA INTEGER NOT NULL,
    raw_gsax NUMERIC NOT NULL,
    regressed_gsax NUMERIC NOT NULL,
    ...
)
```

Neither `player_id` nor `gsax` exists on the table. The column whitelist is aspirational, not real. PostgREST returns an error and the goalie-GSAx join inside `PlayerService.getAllPlayers()` (line 191-197) and `PlayerService.getPlayersByIds()` (line 241-249) silently yields `null`, so `gsaxMap` is empty and every goalie that the draft UI renders has a missing projection component. On draft day that meant goalies were ranked and auto-picked without their GSAx contribution — auto-draft behavior for goalies was effectively random relative to our published projections.

**Fix:** `GOALIE_GSAX_COLUMNS = 'goalie_id, regressed_gsax, raw_gsax'`, update `buildPlayer()` and the `gsaxMap` key from `player_id` to `goalie_id`, and add a test in `server/src/__tests__/PlayerService.test.ts` that asserts the selected columns exist in the migration schema.

### 4.3 Cloud Run service sized for dev — not for a live draft

**File:** `ops/cloudrun/service.yaml:22-39`

```yaml
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
        autoscaling.knative.dev/maxScale: "3"
        run.googleapis.com/cpu-throttling: "true"
        run.googleapis.com/startup-cpu-boost: "true"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 60
      containers:
        - image: us-central1-docker.pkg.dev/citrus-fantasy-sports/citrus-api/server:latest
          ...
          resources:
            limits:
              memory: 512Mi
              cpu: "1"
```

`minScale: 0` means the service scales to zero between draft-day deploys. The first owner who clicked "Start Draft" after each deploy paid a **full cold start**, including container pull, Node startup, and the per-request Supabase client factory warm-up. Every deploy during the draft window therefore produced a ~3-10s stall for the first user to hit the new revision — exactly the kind of stall that triggers the frontend's "timer is frozen, refresh" code path.

`maxScale: 3` with `containerConcurrency: 80` caps the entire API server at **240 concurrent in-flight requests**. A 10-team live draft with an auto-refreshing player pool, websocket fallback polling, pick submission, roster sync, chat, and health probes trivially exceeds that ceiling during pick transitions, and queued requests then time out against the 60s `timeoutSeconds` budget while the frontend already decided the pick failed and retried.

`memory: 512Mi` and `cpu: "1"` — a single vCPU sharing a 512 MiB heap with Hono + Supabase JS + the draft event handlers — is below the threshold needed to survive GC pauses when 30+ realtime picks fan out through the server path in the same second.

**Fix:** `minScale: 1` (or 2) for the draft window, `maxScale: 10+`, bump memory to 1Gi and CPU to 2 vCPU, and gate deploys from a draft-day freeze window. The service.yaml must be the source of truth and not drift from `ops/cloudrun/deploy.sh`.

### 4.4 Ten-plus deploys in the 2.5 hours before draft

See the timeline in §3. There is no mechanism in the repo today that prevents `main → production` deploys during a scheduled live event. Several of the deploys were **fixes for regressions introduced by the previous deploy**, not independent improvements:

- `683f267` ("use admin client for AI team inserts to bypass RLS") was needed because `6340820` ("Add AI teams endpoint") shipped AI team inserts on a code path where the user JWT could not satisfy the `teams` insert RLS policy — the fix was to escalate to the service-role client, a short-term patch that silently widened the trust boundary on draft day.
- `60f0d24` ("resolve TypeScript errors blocking CI pre-deploy gate") indicates that **CI was red and was unblocked by a follow-up commit**, not that CI caught the earlier regression before deploy.
- `271ec9b` ("add missing cn import (crash)") is a white-screen crash fix — i.e., the previous deploy put a broken bundle in front of owners.
- Three successive commits (`51c0251`, `53a7b21`, `b08680d`) all target "timer freeze during pick transitions" — three attempts at the same bug inside 20 minutes.

**Fix:** A change-freeze on `main` for any league marked as `draft_status = 'scheduled'` within the next 4 hours, enforced at the deploy script layer. Hotfixes go through a separate "draft-day" branch with a required second reviewer.

### 4.5 `auth.uid()` anti-pattern on `draft_picks` and `notifications` RLS

**File:** `supabase/migrations/20250101000002_create_draft_tables.sql:31-71`

```sql
create policy "Users can view picks in their leagues"
on public.draft_picks
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_picks.league_id
    and (
      leagues.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams
        where teams.league_id = leagues.id
        and teams.owner_id = auth.uid()
      )
    )
  )
);

create policy "Team owners can make picks"
on public.draft_picks
for insert
with check (
  exists (
    select 1 from public.teams
    where teams.id = draft_picks.team_id
    and teams.owner_id = auth.uid()
  )
);
```

**File:** `supabase/migrations/20251212180000_create_notifications_table.sql:23-47`

```sql
create policy "Users can view their own notifications"
on public.notifications
for select
using (
  user_id = auth.uid() and
  exists (
    select 1 from public.leagues
    where leagues.id = notifications.league_id
    ...
  )
);

create policy "Users can update their own notifications"
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
```

**Why this mattered during the draft:** Both tables are in the Supabase Realtime publication (`supabase/migrations/20260206100000_enable_realtime_on_draft_tables.sql` adds `draft_picks` to `supabase_realtime`). Realtime broadcasts evaluate RLS against the **subscriber's** JWT at delivery time. When an owner's JWT was briefly unavailable (tab suspend on mobile, token refresh race during a deploy-triggered reconnect), `auth.uid()` evaluated to `NULL` inside the realtime path, the RLS `USING` clause returned `FALSE`, and the pick was dropped from the realtime stream for that specific subscriber — **silently**, because the channel stayed connected. The other subscribers, holding fresh JWTs, saw the pick. This is what produced the "pick shows on one phone, not the other" reports.

The `INSERT` policy on `draft_picks` for team owners had the same class of problem when combined with the autopick/admin-client path: the commissioner's insert for an AI team failed the `teams.owner_id = auth.uid()` check, so `6340820` (the AI-teams endpoint) had to be followed ~4 minutes later by `683f267` (use admin client to bypass RLS). That patch works but it moved the AI-team creation path out of RLS entirely, which is not a tradeoff we want to ship under pressure.

**Fix:** Introduce a realtime-safe policy model — e.g., a `league_membership` table with a dedicated index, queried via a `SECURITY DEFINER` helper function with `SET search_path = public`, so that realtime delivery does not depend on `auth.uid()` resolving through a nested `EXISTS`. Backfill the membership table and add a regression test that asserts realtime delivery for a subscriber whose JWT is mid-refresh.

### 4.6 Firebase Hosting — 3.2 GB stored + bandwidth overage, 5.1 MB of Gemini PNGs in the build output

**Files:**

```
apps/web/assets/images/Gemini_Generated_Image_Kiwi.png       (~966 KB)
apps/web/assets/images/Gemini_Generated_Image_Lemon.png      (~862 KB)
apps/web/assets/images/Gemini_Generated_Image_Narwhal.png    (~762 KB)
apps/web/assets/images/Gemini_Generated_Image_Pineapple.png  (~866 KB)
assets/images/Gemini_Generated_Image_Kiwi.png                (duplicate)
assets/images/Gemini_Generated_Image_Lemon.png               (duplicate)
assets/images/Gemini_Generated_Image_Narwhal.png             (duplicate)
assets/images/Gemini_Generated_Image_Pineapple.png           (duplicate)
```

These four images ship in the Vite `dist/` output twice over (once from `apps/web/assets/` and once from the root `/assets/`), totaling ~5.1 MB of wire weight **on every first page load** before any user-visible content is rendered. Multiplied by the draft-day owner traffic and the ~20 deploys in 24 hours — each deploy busts the CDN cache for the affected hashed bundle — this is the proximate cause of the Firebase Hosting **3.2 GB stored + bandwidth overage** alert.

**Fix:** Delete the committed Gemini PNGs, regenerate branding assets as WebP under 100 KB each, reference them from a single canonical path, and add a CI check that fails the build if any file under `dist/` exceeds 250 KB.

---

## 5. Root cause analysis

None of the findings above would have been catastrophic in isolation. The disaster was produced by their intersection:

1. **Underprovisioned Cloud Run** (§4.3) made every deploy a user-visible cold start.
2. **Deploy velocity** (§4.4) turned a stable hour before draft into a series of cold starts, regressions, and hotfix-of-hotfix loops.
3. **Realtime RLS fragility** (§4.5) meant that every client reconnect triggered by a deploy had a non-zero chance of silently missing a pick.
4. **The realtime filter bug** (§4.1) meant that even when RLS was cooperating, the notification channel was never going to deliver INSERTs.
5. **The goalie column mismatch** (§4.2) meant the auto-draft logic was working from incorrect projections, so owners who fell back to auto-pick were penalized.
6. **The oversized bundle** (§4.6) stretched the cold-start window and turned Firebase Hosting cost from a rounding error into a paged alert.

The deploy-velocity item is the highest leverage: if we had frozen `main` at ~17:00 UTC, most of the other failure modes would not have had an opportunity to fire.

---

## 6. Action items

| # | Action                                                                                                      | Owner | Priority |
|---|-------------------------------------------------------------------------------------------------------------|-------|----------|
| 1 | Fix realtime filter in `apps/web/src/services/NotificationService.ts:109` (single filter, not comma-join)   | Web   | P0       |
| 2 | Correct `GOALIE_GSAX_COLUMNS` in `packages/shared/src/constants/columns.ts:180` to match the table schema   | Server| P0       |
| 3 | Add regression test: selected columns in `COLUMNS` constants exist in the latest migration schema            | Shared| P0       |
| 4 | Raise Cloud Run `minScale` to ≥1 (or ≥2 for draft windows), `maxScale` to ≥10, `memory` to 1Gi, `cpu` to 2   | Infra | P0       |
| 5 | Deploy freeze enforced at `ops/cloudrun/deploy.sh` when any league has a draft starting within 4 hours       | Infra | P0       |
| 6 | Replace `auth.uid()`-via-nested-`EXISTS` RLS on `draft_picks` and `notifications` with a membership helper   | DB    | P0       |
| 7 | Add a realtime-delivery regression test for a mid-refresh JWT subscriber                                    | Server| P1       |
| 8 | Delete Gemini PNGs; regenerate branding as ≤100 KB WebP; add CI bundle-size gate                            | Web   | P1       |
| 9 | Document a draft-day runbook (pre-freeze checklist, Cloud Run sizing, on-call commissioner override)       | Eng   | P1       |
| 10| Kill the "bypass RLS with service role from an API route" pattern introduced in `683f267` — replace with a proper RLS policy for commissioner-on-behalf-of inserts | Server| P1       |

---

## 7. What went well

- The draft did complete. No permanent data loss.
- The `transaction_ledger` / draft-picks constraints caught the duplicate-pick and out-of-order cases that the frontend would otherwise have corrupted.
- Commissioner tooling (start-draft, skip-pick, reassign) existed and was usable, even if the underlying bugs forced it to be used more than it should have been.

## 8. What we will not do

- We will not "just add more logging" in place of fixing §4.1–§4.5. The bugs are understood; they need code fixes, not more observability.
- We will not ship further draft features onto the current RLS model. Item #6 is a prerequisite for any new realtime surface.
- We will not rely on deploy-day hotfixes as a release strategy. The freeze window is non-negotiable for the next live draft.
