# Live Draft Disaster — Postmortem

**Incident:** Inaugural Citrus Test League live draft failure
**League ID:** `3327bc2e-827b-4cbb-b1f5-16cba0eb7b11`
**Date:** April 10, 2026
**Status:** Post-incident forensic review
**Author:** Engineering
**Document owner:** CTO

> **2026-04-29 editorial note:** the deploy target has since changed from Cloud Run to GCE per `docs/PHASE_4_5_ARCHITECTURE.md`. The incident analysis below is preserved as-written for historical accuracy — Cloud Run was the production platform on April 10, 2026 and naming it that way matters for the forensic record. Remediation items have been annotated where Cloud Run-specific actions are no longer directly applicable; see inline notes in §3 Fix, the P0 list, and the P1 list. The underlying principles (capacity planning, pre-draft scaling, change freezes, billing alert paging) remain in force on GCE.

---

## TL;DR

The inaugural live draft for the Citrus Test League failed during primetime
for a combination of reasons that had been building up over months and were
detonated by a rushed pre-draft deploy window. No single bug caused the
outage; it was the superposition of a real-time notification leak, a
projection query that could not survive production data, an under-provisioned
Cloud Run revision, ten back-to-back deploys in the 2.5 hours before puck
drop, two RLS anti-patterns on the two tables the draft room most needed to
read, a Firebase Hosting bill that had silently tripped free-tier overage,
and a shipped build carrying 5.1 MB of unused AI mockup PNGs. Every owner
in the league was affected. The draft was paused and re-run.

This is the most expensive incident we have had since the January 15 data
loss bug (see `docs/DATA_LOSS_BUG_POSTMORTEM_JAN15.md`) and it was entirely
preventable.

---

## Timeline (April 10, 2026, all times Mountain)

- **17:30** — Draft scheduled to start at 20:00. Engineer begins "last mile"
  polish: notification filter tweak, GSAX column wiring on the player card,
  Cloud Run revision bump.
- **17:30 – 20:00** — **Ten** production deploys pushed to Firebase Hosting
  and Cloud Run in **2.5 hours**. No staging validation. No smoke test
  between deploys. Several deploys revert or reland the same change.
- **19:42** — Firebase Hosting billing alert fires: project hosting storage
  has crossed **3.2 GB** and egress is over the Spark free-tier window. No
  human sees the alert until the next morning.
- **20:00** — Draft room opens. First pick goes in.
- **20:01** — Owners report seeing notifications for picks in *other*
  leagues. Owners also report receiving pick notifications for teams they do
  not own.
- **20:03** — Player card for any goaltender returns a 500 from the API.
  Owners who click G slot players see a blank modal.
- **20:05** — Cloud Run revision starts returning 429 / 503 under draft
  fan-out. Draft picks begin timing out on the client.
- **20:07** — Commissioner pauses the draft.
- **20:40** — Draft restarted on a rolled-back revision after the on-call
  engineer manually bumped `maxScale` and cleared the realtime channel.
- **23:11** — Incident declared closed. Postmortem scheduled.

---

## Impact

- **Users affected:** All 12 owners in the Inaugural Citrus Test League.
- **Duration:** ~40 minutes of hard failure, ~2 hours of degraded service
  including the restart.
- **Data integrity:** No picks were lost. The realtime bug leaked
  notifications *out* of the league but did not corrupt draft state. The
  RLS issues on `draft_picks` meant the nuclear-reset path had already been
  hardened in February (`supabase/migrations/20260207100000_add_draft_picks_delete_policy_and_reset_rpc.sql`),
  so the rollback was clean.
- **Financial:** Firebase Hosting egress overage on the Spark plan; exact
  dollar amount pending the monthly invoice. Hosting storage sitting at
  3.2 GB against a 10 GB cap, but bandwidth is the bleed.
- **Reputational:** This was the inaugural live draft. Every owner watched
  it fail in real time.

---

## Root causes

There is no single root cause. Seven independent defects lined up.

### 1. UUID concatenation bug in the notification realtime filter

**File:** `apps/web/src/services/NotificationService.ts:109`

```ts
filter: `league_id=eq.${leagueId},user_id=eq.${userId}`,
```

Supabase Realtime `postgres_changes` filters do **not** support
comma-separated AND. The comma is parsed as a single filter value, not as
two predicates, so this subscribes the client to *every* INSERT on
`public.notifications` where `league_id` matches the concatenated string
`"<leagueUuid>,user_id=eq.<userUuid>"` — which matches nothing literally,
but because of how the realtime broker handles malformed filters, the
subscription degrades to "all rows in the table for which the user has
SELECT RLS access."

Combined with the RLS anti-pattern in §5 below, this meant every client
in every league saw every other client's notifications in real time.

**Fix:** Use a single filter on `user_id` and do the league check
client-side, or subscribe on the server side and fan out per user.

### 2. `GOALIE_GSAX_COLUMNS` schema mismatch

**File:** `packages/shared/src/constants/columns.ts:180`

```ts
export const GOALIE_GSAX_COLUMNS = 'player_id, gsax';
```

The constant selects a bare `gsax` column from the goalie talent table.
The column shipped by the projections pipeline is not named `gsax` — it is
a different name (the forensic session identified this as a rename that
happened when xG v3 landed but was never propagated to the shared column
constant). Any query routed through `COLUMNS.GOALIE_GSAX` therefore
returns a PostgREST error and the API server returns a 500 to the client.

Because the player card fetches goalie talent on open, every goaltender
player card was broken in the draft room.

**Fix:** Rename the constant to match the actual column (`gsax_per_60` or
whatever the pipeline writes) and add a schema test in
`packages/shared/src/constants/__tests__/columns.test.ts` that selects
each `COLUMNS.*` against a real schema.

### 3. Cloud Run under-provisioning

**Observed configuration (Hono API server):**

- `maxScale = 3`
- `minScale = 0`
- Memory: `512Mi`
- CPU: `1`

Cold start from zero, max three instances, half a gig of RAM. A 12-owner
live draft with realtime fan-out, player card opens, and projection
lookups is already outside this envelope; add the notification leak from
§1 (which multiplied realtime traffic by 12×) and we were guaranteed to
push the service into 429 / 503 territory.

**Fix:** `minScale = 1`, `maxScale ≥ 10`, `2Gi` RAM, `2` CPU during draft
windows. Treat "live draft is scheduled" as an operational signal and
pre-scale.

*[2026-04-29: deploy target now GCE; this remediation item should be re-evaluated against GCE-equivalent behavior — see `docs/PHASE_4_5_ARCHITECTURE.md`. The principle (capacity planned, pre-scaled before draft windows) carries forward; the specific knobs — `minScale`/`maxScale`/per-revision memory and CPU — are Cloud Run concepts that map onto Managed Instance Group sizing, machine-type selection, and pre-draft scale-up on GCE.]*

### 4. Ten deploys in 2.5 hours before the draft

Between 17:30 and 20:00 there were **ten** production deploys to Firebase
Hosting and Cloud Run. None went through staging. Several were reverts.
One of them was the deploy that introduced the `gsax` column constant
that did not exist in production. Another shipped the malformed realtime
filter.

We have no change-freeze policy for scheduled draft windows. We should.

**Fix:** Hard change freeze for the 24 hours before any scheduled live
draft in any league. Enforced in CI by checking
`leagues.scheduled_draft_time` and refusing to promote a build if any
league is inside the freeze window.

### 5. RLS `auth.uid()` anti-pattern on `draft_picks` and `notifications`

Two related RLS issues on the two tables the draft room hits hardest.

**`draft_picks`:** As of `supabase/migrations/20260207100000_add_draft_picks_delete_policy_and_reset_rpc.sql:1-5`,
the table had RLS enabled but **no DELETE policy**, meaning every
`.delete()` against `draft_picks` silently succeeded at the PostgREST
layer and removed zero rows. The nuclear-reset path used during the
20:40 restart worked only because that February migration added a
commissioner DELETE policy and a `nuclear_reset_draft` SECURITY DEFINER
RPC. If the draft had happened a month earlier, the rollback would have
been impossible.

**`notifications`:** `supabase/migrations/20251212180000_create_notifications_table.sql:46-49`

```sql
create policy "Users can update their own notifications"
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- No INSERT policy for regular users - only system/service role can insert via triggers
```

The SELECT policy in the same file (lines 23–40) is `user_id = auth.uid()
AND user is a member of the league`. That is correct on paper, but
Supabase Realtime evaluates RLS at subscription time against the *channel
filter*, not per-row at delivery. When the filter is malformed (see §1),
realtime falls back to delivering any row the subscriber's JWT could
have SELECTed — and because the SELECT policy is per-row rather than
scoped at the channel level, the client sees every row as it is
inserted.

The anti-pattern: treating `user_id = auth.uid()` in an RLS policy as if
it scoped a realtime channel. It does not. A channel filter bug plus a
permissive-looking SELECT policy equals a notification leak.

**Fix:** Subscribe to notifications on the **server** (single per-user
SSE/WebSocket stream) instead of letting clients subscribe to the
`notifications` table directly. Clients never hit Supabase realtime for
notifications again.

### 6. Firebase Hosting: 3.2 GB storage + bandwidth overage

Firebase Hosting was carrying **3.2 GB** of hosting storage and was
actively bleeding bandwidth on the Spark free tier. The storage number
alone is suspicious — the built SPA should be well under 100 MB — and
points at (a) every deploy keeping a full versioned release and (b) at
least one of those releases containing files that have no business in
the bundle (see §7).

The overage alarm fired at 19:42 and nobody saw it until the next
morning. There is no paging policy for billing alerts.

**Fix:** Firebase retention policy capped at the last 5 releases. Upgrade
to Blaze with a hard budget cap. Page on-call for any hosting billing
alert during a scheduled draft window.

### 7. 5.1 MB of Gemini mockup PNGs in the production bundle

The production `dist/` shipped on April 10 contained **5.1 MB** of PNGs
generated by Gemini during an earlier design exploration. They were
imported from a scratch "mockups" directory that was never cleaned up,
Vite happily bundled them because they were referenced by a dead import,
and every one of our users downloaded all of them on first load.

This is the entire reason the Firebase egress bill exploded: it is not
traffic, it is 5.1 MB of wasted payload per unique visitor, multiplied by
the aggressive redeploys in §4 busting the CDN cache ten times in an
afternoon.

**Fix:** Delete the mockups. Add a `vite-plugin-inspect` / bundle-size
check in CI that fails the build if `dist/**/*.png` exceeds a sane
budget (say 512 KB total). Add an ESLint rule blocking imports from any
`**/mockups/**` or `**/gemini/**` path.

---

## Why no single engineer caught it

1. The notification filter bug looks correct. It reads like a Supabase
   filter. It is not. Static analysis cannot catch it because it is a
   template string. We have no realtime integration tests.
2. The GSAX column constant looks correct. It compiles. TypeScript cannot
   check PostgREST column names without a schema-aware codegen step,
   which we do not run.
3. The Cloud Run configuration was the default from the initial Hono
   migration and had never been revisited. Nobody owned "production
   capacity for live drafts" as a task.
4. The ten-deploy sprint happened because we were trying to fix (1) and
   (2) in real time under time pressure, without a staging environment
   that could reproduce the load.
5. The RLS anti-patterns pass a casual read. `user_id = auth.uid()` is
   the correct RLS *policy*; what is wrong is relying on it as a
   *channel* boundary in realtime.
6. The Firebase billing alert went to an email nobody is paged on.
7. The 5.1 MB of PNGs in `dist/` was never noticed because no one looks
   at the bundle report after a deploy; `npm run build` is green either
   way.

Individually, each of these is a code review miss. Collectively, they
are a process failure. We have no pre-draft readiness checklist and no
change freeze.

---

## Remediation (prioritized)

**P0 — before the next live draft in any league:**

- [ ] Fix `apps/web/src/services/NotificationService.ts:109` — replace
      the comma-filter with a single `user_id` filter. Add a Vitest
      spec that fails if the filter string contains a comma.
- [ ] Rename `GOALIE_GSAX_COLUMNS` in
      `packages/shared/src/constants/columns.ts:180` to match the
      production column. Add a `columns.integration.test.ts` that
      SELECTs each `COLUMNS.*` against a real Supabase schema in CI.
- [ ] Raise Cloud Run revision for `@citrus/server` to
      `minScale=1, maxScale=10, 2Gi, 2 CPU`.
      *[2026-04-29: deploy target now GCE; this remediation item should be re-evaluated against GCE-equivalent behavior — see `docs/PHASE_4_5_ARCHITECTURE.md`.]*
- [ ] Delete every file under any `mockups/` or `gemini/` directory
      that ends up in `apps/web/dist/`. Add a bundle-size gate.
- [ ] Migrate notification realtime from client-direct Supabase
      subscription to a server-side per-user stream. Remove
      `subscribeToNotifications` from `NotificationService.ts`.

**P1 — within one sprint:**

- [ ] 24-hour production change freeze before any scheduled live draft.
      Enforced by a CI check against `leagues.scheduled_draft_time`.
- [ ] Pre-draft readiness checklist that an on-call engineer signs
      off on 1 hour before puck drop. Template in `docs/RUNBOOKS/`.
- [ ] Firebase Hosting release retention capped at 5; upgrade to Blaze
      with a hard budget cap; page on-call for billing alerts.
- [ ] Staging environment that mirrors production Cloud Run scaling so
      we can load-test a draft room before touching prod.
      *[2026-04-29: deploy target now GCE; this remediation item should be re-evaluated against GCE-equivalent behavior — see `docs/PHASE_4_5_ARCHITECTURE.md`.]*
- [ ] Schema-aware column codegen from Supabase so
      `packages/shared/src/constants/columns.ts` cannot drift.

**P2 — within one quarter:**

- [ ] Realtime integration test suite that exercises every
      `postgres_changes` subscription in the app against a real
      Supabase instance.
- [ ] Audit every RLS policy on every table for the "permissive SELECT
      + realtime channel" anti-pattern. If realtime is used, the
      subscription must be server-brokered.
- [ ] Bundle budget in CI: `dist/**/*.png` ≤ 512 KB, `dist/**` ≤ 5 MB
      gzipped, fail the build otherwise.

---

## Lessons

1. **Change freezes are not bureaucracy.** Ten deploys in 2.5 hours
   before a scheduled user-facing event is malpractice. The change
   freeze should be automatic and machine-enforced.
2. **Realtime RLS is not the same as table RLS.** Any Supabase realtime
   subscription must be audited as if it were a public endpoint, because
   channel filters are not RLS boundaries.
3. **Default Cloud Run configs are not production configs.** Every
   service deployed to production needs a capacity plan signed off by
   an engineer who can articulate the expected load.
4. **Billing alerts are paging events during live events.** We lost
   real money because the alert went to an inbox nobody reads at night.
5. **Ship what you wrote, not what Vite happened to bundle.** 5.1 MB of
   forgotten mockup PNGs in production is a bundle-hygiene failure that
   a one-line CI gate would have caught.
6. **One unrelated thing is a bug. Seven unrelated things on the same
   night is a process problem.** The fix is not seven code fixes — it
   is the process that lets seven independent defects reach production
   on the same afternoon.

---

## Appendix: verified references

- `apps/web/src/services/NotificationService.ts:109` — malformed realtime
  filter.
- `packages/shared/src/constants/columns.ts:180` — `GOALIE_GSAX_COLUMNS`
  selecting a non-existent column.
- `supabase/migrations/20251212180000_create_notifications_table.sql:23-49`
  — `notifications` RLS SELECT/UPDATE policies and the missing INSERT
  policy for regular users.
- `supabase/migrations/20260207100000_add_draft_picks_delete_policy_and_reset_rpc.sql:1-17`
  — prior fix adding the commissioner DELETE policy on `draft_picks`
  (header comment documents the "RLS enabled but no DELETE policy"
  anti-pattern this postmortem references).
- `supabase/migrations/20260207100000_add_draft_picks_delete_policy_and_reset_rpc.sql:117-160`
  — `nuclear_reset_draft` RPC used during the 20:40 restart.
- `docs/DATA_LOSS_BUG_POSTMORTEM_JAN15.md` — prior postmortem; format
  precedent for this document.
