# Realtime + RLS Anti-Pattern Audit

**Date:** 2026-04-14
**Author:** On-call engineering
**Source:** `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §1, §5
**Status:** Complete — one P0 fix landed, three subscriptions reviewed and accepted.

---

## What this document is

On April 10 2026, the live draft disaster included a cross-league
notification leak. The root cause was a malformed Supabase Realtime
`postgres_changes` filter string (`filter: "a=eq.1,b=eq.2"`). The Realtime
broker does **not** parse the comma as AND — it treats the whole string as
a single filter, matches nothing, and silently degrades the subscription
to "deliver every row the JWT can SELECT". Every authenticated client with
a valid JWT got every other user's notifications.

The broader anti-pattern (postmortem §5) is:

> Trusting RLS + a client-supplied realtime filter to scope data delivery
> is a two-lock system where either lock alone is insufficient.
> A permissive SELECT policy plus a loose channel filter leaks data.

This document audits **every `postgres_changes` subscription in the app**
against **the SELECT policies of the tables they listen to**, and classifies
each pair by leak risk.

## Method

1. Enumerated every `postgres_changes` call in `apps/web/src/` with
   `grep -rn postgres_changes`.
2. For each, located the RLS SELECT policy on the target table.
3. Classified by the question: *If the server filter silently degrades to
   "deliver every row the JWT can SELECT", what does the subscribing user
   actually see?*

## Findings — summary table

| Subscription | Table | Server filter | RLS SELECT policy | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| `NotificationService.subscribeToNotifications` | `notifications` | `user_id=eq.${userId}` | `user_id = auth.uid() AND league membership` | **Was critical (April 10)** | Fixed (single-predicate filter + client-side league guard) |
| `DraftService.subscribeToDraftPicks` | `draft_picks` | `league_id=eq.${leagueId}` | league commissioner or team owner | Low | Accepted — Broadcast is primary path; postgres_changes is fallback only |
| `usePlayerNews` | `player_talent_metrics` | `season=eq.${CURRENT_SEASON}` | `USING (true)` — fully public | None | Accepted — data is intentionally public reference data |
| `DraftRoom.tsx` (league status) | `leagues` | `id=eq.${leagueId}` | commissioner or team owner, **plus** "authenticated can read by join_code" | Low-medium | Accepted — data leaked is `draft_status` + settings JSON; no PII; user must already know the league UUID |

---

## Detail — subscription by subscription

### 1. Notifications — **was the April 10 bug**

- **File:** `apps/web/src/services/NotificationService.ts:113`
- **Previous (broken) filter:** `` `league_id=eq.${leagueId},user_id=eq.${userId}` `` — the comma is literal, the filter degrades.
- **Current filter:** `` `user_id=eq.${userId}` `` (single predicate only).
- **Callback guard (line 125):**
  ```ts
  if (notification.league_id !== leagueId) return;
  ```
- **RLS policy** (`supabase/migrations/20251212180000_create_notifications_table.sql:23-40`):
  - `user_id = auth.uid()`
  - AND EXISTS membership check (commissioner or team owner of `notifications.league_id`)

**Why this is now safe:** Even if the server filter degrades, the browser
only receives rows where the row's `user_id` matches the requesting
user's JWT, and the in-callback guard drops anything from a different
league before invoking the user callback. The two layers are now
*independent* — the server filter scopes by user, the client callback
scopes by league, and a row has to pass both to reach the UI.

**Regression coverage:** `apps/web/src/services/__tests__/NotificationService.test.ts`
asserts the filter does not contain a comma and that cross-league payloads
are dropped by the callback.

### 2. Draft picks

- **File:** `apps/web/src/services/DraftService.ts:463` (INSERT) and `:478` (UPDATE)
- **Filter:** `` `league_id=eq.${leagueId}` `` (single predicate).
- **RLS policy** (`supabase/migrations/20250101000002_create_draft_tables.sql:31-47`):
  - EXISTS membership check: user is commissioner OR owns a team in the league.
- **Primary delivery path:** Supabase **Broadcast** on the same channel
  (`DraftService.ts:448-457`). The server fires `broadcast.send('new_pick', …)`
  from the Hono `draft.ts` route after a successful `makePick`/`autopick`.
  Broadcast latency is ~6 ms. `postgres_changes` is a reconciliation
  fallback for missed broadcasts only.

**Why this is safe:**
- Filter is single-predicate — cannot silently degrade the way the
  comma bug did.
- Even if it *did* degrade, RLS scopes the browser to leagues the user
  is a member of. A draft pick in a league the user is not in would
  not pass the SELECT policy and would not be delivered.
- Draft picks are not sensitive data (they're shown in the draft room).
- Client-side dedup via the `alreadyHave` check in DraftRoom makes
  double-delivery from Broadcast + postgres_changes harmless.

**No change required.**

### 3. Player news / roster-status realtime

- **File:** `apps/web/src/hooks/usePlayerNews.ts:106`
- **Filter:** `` `season=eq.${CURRENT_SEASON}` ``
- **RLS policy** (`supabase/migrations/20260301000004_add_missing_rls.sql:33-42`):
  - `USING (true)` — data is public, anyone can read.

**Why this is safe:** The data is explicitly public reference data. There
is nothing to leak. The subscription filters by season only because
we're only interested in this-season updates, not for privacy.

**No change required.**

### 4. League status changes (DraftRoom)

- **File:** `apps/web/src/pages/DraftRoom.tsx:1127`
- **Filter:** `` `id=eq.${leagueId}` `` (single predicate).
- **RLS policy** on `leagues`:
  - `league_select_commissioner` — `commissioner_id = auth.uid()`.
  - `league_select_team_owner` — user owns a team in the league.
  - `Authenticated users can find leagues by join code` — any
    authenticated user can SELECT a league if `join_code IS NOT NULL`.
    (See `supabase/migrations/20260113200000_add_join_league_by_code_rls.sql`
    — this exists so a user can validate a join code before joining.)

**Why this is low-medium risk:**
- Filter is single-predicate (`id=eq.${leagueId}`) — cannot silently degrade.
- Even in the worst case, an attacker must already know the target
  league's UUID to subscribe. League UUIDs are not enumerable from
  unauthenticated contexts.
- Data leaked: `draft_status`, `draft_rounds`, `settings` JSONB,
  `scheduled_draft_time`. No PII. Scoring rules, roster size, and draft
  timing are not considered private to league members — they're visible
  on public invite pages.

**No change required.** Flagged here for awareness so future additions
to the `leagues` SELECT surface (e.g. adding a payment/premium column)
trigger a re-audit of this subscription.

---

## Defense-in-depth principles (for future subscriptions)

When adding a new `postgres_changes` subscription, treat the server-side
filter and the RLS policy as **independent** layers:

1. **Never write a multi-predicate filter.** Supabase Realtime does not
   support comma-AND. If you need N predicates, use the single highest-
   selectivity predicate on the server and do the other N–1 checks in
   the callback. Use `.toContain(',')` as a negative assertion in tests
   to prevent regression.

2. **Ask: "what if the filter silently degrades?"** If the RLS policy on
   the table is permissive (`USING (true)` or similarly broad) and the
   table has sensitive rows, the filter is the *only* scoping mechanism
   and a degradation is a data leak. Either tighten the RLS policy or
   move the subscription server-side.

3. **Prefer Broadcast for low-latency, single-league events.** The
   `postgres_changes` pipeline (WAL → logical replication → RLS →
   WebSocket) adds 200–500 ms and couples the realtime path to
   Postgres's write path. Broadcast from the server after the write
   is 6 ms and has no RLS coupling (you explicitly choose what to
   broadcast to which channel).

4. **Regression-test the filter string shape.** Static analysis cannot
   catch a bad template-string filter. Unit-level assertions
   (`expect(filter).not.toContain(',')`, `.toMatch(/^[a-z_]+=eq\.[^,]+$/)`)
   are the cheapest tripwire.

5. **Name the callback's assumptions.** If a subscription relies on a
   post-delivery check (like the notification league guard), put that
   assertion in the callback *and* in a test — it's otherwise
   invisible at the channel-subscription site.

---

## Follow-ups tracked elsewhere

- **Server-side SSE/WebSocket notification broker** (postmortem §5, P4).
  The Broadcast pattern used for draft picks is the blueprint. Moving
  notifications off `postgres_changes` entirely would remove the
  server-filter lock from the notification path altogether. Deferred
  to a separate epic.
- **Schema-aware `COLUMNS.*` codegen** (P1). Adjacent work; not scoped
  here.
- **Real-time integration test suite** (P2). Requires a live Supabase
  instance in CI; deferred.

## Related documents

- `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §1 (cross-league notification
  leak) and §5 (anti-pattern).
- `docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md` — the "Notification cross-league
  leak is gone" smoke test at T-30.
- `apps/web/src/services/__tests__/NotificationService.test.ts` —
  regression tests for the comma filter.
