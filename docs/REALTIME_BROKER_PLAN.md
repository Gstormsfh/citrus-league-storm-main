# Server-side notification broker — design & migration plan

**Status:** Design locked, implementation deferred
**Parent tracking:** `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §5 P4
**Prerequisite:** April 10 comma-filter fix (shipped) + callback league guard (shipped)

## Why this isn't shipped yet

During the April 10 remediation branch we evaluated whether to replace
the notification realtime path (`postgres_changes` → `notifications`
table) with a server-driven Broadcast channel, the same pattern we used
for draft picks.

The decision was **defer** for three concrete reasons:

1. **The bug is already fixed twice.** The April 10 cross-league leak
   was caused by a malformed two-predicate filter. The current code
   uses a single-predicate filter *plus* a callback-level league guard
   (`NotificationService.ts:125`). Adding Broadcast as a third layer
   would be architecture-level defense, not bug-fix.
2. **The notification creation path is in the DB, not the server.**
   Notifications are created by a Postgres trigger
   (`create_notifications_from_transaction` on `roster_transactions`)
   and by the `send_league_chat_message` RPC. The server does not
   directly write to `notifications` anywhere. Broadcasting from the
   server therefore requires either (a) modifying the RPC/trigger to
   return the inserted IDs so the server can re-emit them, or (b)
   accepting duplicate deliveries on the client and deduping by content.
3. **Dedup is non-trivial.** The draft-pick Broadcast works because
   the server both controls the write (`makePick` in `routes/draft.ts`)
   and holds the freshly-inserted pick row in memory, so the broadcast
   carries a real primary key. For notifications, the server does not
   hold the rows — the trigger writes them.

Until we either migrate creation into the server or extend the RPC to
return IDs, a Broadcast layer would be a partial patch with a real risk
of double-delivery bugs. Those bugs would look indistinguishable from
the April 10 leak to an on-call engineer glancing at a user report.

## Design — when we do build it

### Channel

- **Name:** `notifications:{userId}` (user-scoped; the server sends
  directly to the intended recipient, eliminating the filter problem
  entirely).
- **Event:** `'new_notification'`.
- **Payload:** the full `Notification` row (id, type, title, message,
  metadata, league_id, user_id, created_at).

### Server-side

New helper at `server/src/lib/notificationBroadcast.ts` mirroring
`broadcastDraftPick` in `server/src/routes/draft.ts`:

```ts
export function broadcastNotification(
  userId: string,
  notification: Notification,
): void {
  const admin = supabaseAdmin;
  const channel = admin.channel(`notifications:${userId}`, {
    config: { broadcast: { self: false } },
  });
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    channel.send({
      type: 'broadcast',
      event: 'new_notification',
      payload: { notification },
    }).catch(() => {}).finally(() => {
      admin.removeChannel(channel);
    });
  });
}
```

Call sites once wired:

- `send_league_chat_message` — needs to RETURN `notifications.id[]`
  from the RPC so the server can SELECT them and rebroadcast. Either
  (a) modify the RPC to `RETURNS SETOF notifications` or (b) change
  the signature to return a `jsonb` with a `notifications` array.
- `create_notifications_from_transaction` trigger — harder. Options:
  - Migrate the trigger to a server-side handler. The server-side
    `rosters` route already wraps every transaction; after a successful
    INSERT into `roster_transactions`, explicitly fan out notifications
    from the server and broadcast per-user.
  - Keep the trigger and add a LISTEN/NOTIFY channel from Postgres.
    The server runs a single LISTEN and broadcasts on each NOTIFY.
    More infra, but keeps the DB as source of truth.

### Client-side

Update `apps/web/src/services/NotificationService.ts:subscribeToNotifications`
to add a Broadcast listener as the first `.on()` in the chain,
mirroring `DraftService.subscribeToDraftPicks`:

```ts
const channel = supabase
  .channel(`notifications:${userId}`)
  .on('broadcast', { event: 'new_notification' }, (payload) => {
    const notification = payload.payload?.notification;
    if (notification && notification.league_id === leagueId) {
      callback(notification);
    }
  })
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${userId}` },
    (payload) => {
      // existing code — becomes reconciliation fallback
    },
  )
  .subscribe();
```

Dedup in the UI layer keys on `notification.id`. The Broadcast payload
carries the real DB id because the server SELECTs the row post-write,
so both delivery paths converge on the same key.

### Rollout

- Phase 1: ship the broker helper + the client Broadcast listener.
  Nothing changes behavior until a call site is wired, but the
  plumbing exists.
- Phase 2: wire `send_league_chat_message`. Measure: do users see
  chats within 100ms (Broadcast) vs 200-500ms (postgres_changes)?
- Phase 3: migrate `create_notifications_from_transaction`. This is
  the bigger piece — touches every add/drop/waiver/trade flow.

### Success criteria

Once phase 2 is live:

- Median notification delivery latency drops from 200-500ms to ~6ms
  (same improvement we saw for draft picks on April 12).
- Zero new double-delivery reports (monitor Sentry for 2 weeks).
- The client `postgres_changes` path can then be demoted to a
  reconciliation fallback only — the realtime privacy surface is
  reduced to the single-predicate user-scoped filter, and the
  cross-league check in the callback becomes belt-and-suspenders
  rather than the primary defense.

## What NOT to do

- Do **not** add a Broadcast layer that carries a synthesized id
  (random UUID in the server). This will produce double notifications
  in the UI: one fake id from Broadcast and one real id from
  `postgres_changes`. Users will see every chat message twice.
- Do **not** broadcast a "new notification, go refetch" signal and
  hope the refetch deduplicates. Refetch-on-ping is a 300-500ms extra
  round trip — at that point `postgres_changes` is no slower.
- Do **not** remove the existing callback league guard when the
  Broadcast path is added. It remains the defense against future
  broker bugs in Supabase itself.

## Related documents

- `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §1 and §5
- `docs/REALTIME_RLS_AUDIT.md` — classifies all current `postgres_changes`
  subscriptions by leak risk
- `server/src/routes/draft.ts` `broadcastDraftPick` (lines 27-53) —
  reference implementation of the Broadcast pattern
- `apps/web/src/services/DraftService.ts` `subscribeToDraftPicks`
  (lines 435+) — reference implementation of the client dual-listener
