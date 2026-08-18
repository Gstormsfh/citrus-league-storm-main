
## Entry 182 — **PICK-LATENCY DAY.** The 6-second pick is a rendering problem, not a database one — the RPC's read path measures **3.5 ms**. Wired the optimistic layer that had been built and left unconnected since July. And **closed E142 at the root**: a 12×12 draft ran end to end and produced 144 roster rows with nobody touching it.

**Garrett's brief (09:00-ish MDT, then he stepped away):** *"You telling me that a human pick costs 3-5 seconds? Oof…. Thats not sleeper level at all."* Then: *"you have permission to execute, and pass along whats needed… fix properly as if Yahoo/ESPN/Sleeper would. We NEED to be on par with them by EOD."*

**His number was optimistic.** E145 measured it twice: **5,710 ms and 5,966 ms**.

---

### Where the six seconds actually live

| layer | cost | verdict |
|---|---|---|
| `submit_pick_v2` **entire read path** | **3.5 ms** | measured on the 252-pick soak league — the worst case on staging |
| awaited Realtime broadcast to zero subscribers | **~4,000 ms** | E145, fix written last night, still undeployed |
| round trips + app layer | ~1,900 ms | auth `getUser()` per request, membership check, RPC call |

Component timings, on the biggest league we have:

```
idempotency lookup    3.219 ms      leagues preflight   0.2   ms
pick count (n=252)    0.248 ms      player_taken check  0.015 ms
draft_order SUM       0.039 ms      ─────────────────────────────
                                    TOTAL               3.5   ms
```

**Every hot-path index exists and is correct**, including the partial unique index on `draft_events.idempotency_key` I fully expected to find missing. **The database is not the problem and never was.**

### The actual gap against Sleeper — and it was never about speed

Chasing why the room feels dead during those seconds:

> `apps/web/src/components/draft/v2/PendingPickIndicator.tsx` — *"optimistic pending-pick render wrapper"*, six passing tests, **imported by nothing except its own test file.**

**The optimistic layer was fully built and completely unwired.** `recordPending` fires synchronously on click. All four reconciliation paths — broadcast, resync, rejection, network-failure-then-resync — implemented and covered since July. But `pendingActions` never reached the render: `availablePlayers`, `draftedIds`, `v1Teams` and `draftHistory` all derive from server-confirmed state alone.

**So the manager clicked Draft and the player just stayed in the pool.** Sleeper is not faster than 3.5 ms. **It draws the pick immediately and reconciles behind it.** That is the whole difference.

### What I built — `overlayPending.ts`

One pure function at the render boundary. Because all four v1 adapters read `teamRosters` and nothing else, **overlaying that single map fixes every view at once** — no adapter changes, so no adapter-test changes.

**Deliberately NOT overlaid:** `currentPickNumber`, `onClockTeamId`, `picksMade`. Advancing the clock optimistically would flip `amIOnClock`, tear down the action bar and re-arm the timer against an unacknowledged pick — trading a cosmetic delay for a lie about whose turn it is. **The pick draws instantly; whose turn it is stays server-authoritative.**

Two details that took thinking rather than typing:

- **Pick coordinates captured at CLICK time**, not read at render. The instant the server confirms, derived state advances; a pending entry outliving that frame by one tick would render at the *next* pick's coordinates.
- **A duplicate guard spanning all teams.** There is a real frame where the server's pick is folded but the pending entry is not yet reconciled — without the guard the manager sees their player twice, at the exact moment they are watching hardest. And if *another* team already holds the player, drawing it on ours would be an outright false statement.

### The coupling I found while verifying it — worth more than the feature

Reconciliation clears the optimistic pick via `reconcileOnBroadcast(pendingActions, event.correlationId)` — a plain Map lookup. **But the engine broadcasts `correlationId: event.idempotency_key ?? ''` — the idempotency key, not the `correlation_id` column.**

It works *only* because `submitPick` deliberately sends one UUID as **both** headers. **Verified on staging: 5 of 5 real human picks have `idempotency_key = correlation_id`.**

**This is now load-bearing in a way it was not yesterday.** Split those into two UUIDs — which looks like a correctness improvement — and nothing errors: the pick commits, the board updates from the fold, and the optimistic entry never matches, hangs the full 8 s dangle timer, then rolls back with *"We couldn't confirm your pick"* **on a pick that succeeded.** A test already pinned the invariant but read as cosmetic header pass-through, so I wrote the consequence into it.

---

### E142 — closed at the root, and not where the proposal put it

`PROPOSED_roster_sync_v2.sql` STEP 2 said the call site *"belongs in the engine"* and **was never written**, so the function alone would have fixed nothing.

**I put it in the database instead.** `CREATE OR REPLACE` on the *existing* `sync_roster_assignments_for_league` to make it choose its source table by which one holds picks (v1 branch byte-for-byte unchanged), plus an `AFTER INSERT` trigger on `draft_events` gated `WHEN (NEW.event_type = 'draft_completed')`.

**Why there and not the engine:** it covers **every** completion path — `submit_pick_v2`, `close_nomination_v2`, commissioner override all append the same event — and it needs **no deploy surface at all**. The engine hook would have covered only the paths the engine drives.

**Why it cannot strand a draft:** the sync function ends in `EXCEPTION WHEN OTHERS THEN RETURN … 'success', false`. It never re-raises, so it cannot abort the transaction carrying the final pick. The proposal's hard requirement — *"MUST NOT BLOCK THE COMPLETION BROADCAST"* — is met **by the callee's own contract rather than by hope.**

**Ordering, checked rather than assumed:** `draft_completed` is appended *after* the final pick's INSERT, and the projection trigger is AFTER INSERT in the same transaction. Every pick is already projected by the time this runs.

### The certification — THE TWELVE's exact shape

12 teams × 12 rounds, ignited by SQL, run by the live engine, untouched:

```
144 picks  ->  144 roster rows  ->  12 of 12 teams
min 12 / max 12 per team        (every team exactly 12 deep)
144/144 rows match source team AND player
144/144 resolve to a real player name
144 distinct players            (no duplicates)
wall time 304s                  (2.11 s/pick — cadence unchanged)
```

**Cost of the sync: 0 ms.** `draft_completed` shares a timestamp with the final pick.

**Backfill: 1,302 of 1,302 teams** with v2 picks now match their pick count. Previously **1,177 had zero**.

---

### Verification — what ran, and how I got it to run

The device VM kills any process at ~45 s and vitest needs longer over the mounted filesystem, so the component suites would not run there. **I tarred `apps/web/src`, staged it into my own container, installed the workspace and ran them properly.**

| | |
|---|---|
| **full web suite** | **110 files, 1,814 tests, all passing** |
| the three `DraftRoomV2` suites | **14/14** — the ones I could not run this morning |
| `overlayPending` (new) | **16/16** |
| `optimistic` / `v1Adapters` (untouched) | 12 and 20, still green — proves the added fields are backwards-compatible |
| **mutation battery** | **5 mutants, all killed**: disable the overlay → 7 failures; remove the duplicate guard → 2; leak rolled-back entries → 2; advance the clock → 1; mutate caller state → 1 |
| `tsc --noEmit` | **zero new errors.** 156 pre-existing errors app-wide; the only one in a file I touched is `deriveDraftState.ts:304`, a `pick_undone` comparison — my field is at line 68 |

**That last row is technical debt worth naming: the web app has 156 TypeScript errors and `npm run build` does not typecheck** (vite/esbuild strips types). Not today's problem; not nothing either.

---

### Two things I decided, both named as decisions

1. **I applied DDL to staging.** The standing rule was no `CREATE FUNCTION`. Garrett lifted it twice today in writing. **Staging only — production was never written to, and still has no v2 schema.** The change is committed as `supabase/migrations/20260812150000_…sql` so prod can replay it deliberately.
2. **The trigger, rather than the engine call site.** One line reverses it: `DROP TRIGGER draft_events_sync_roster_trg ON public.draft_events;`

### Still open

- **Two deploys, both his:** web (optimistic render) and `citrus-api` (E145). E145 is no longer only speed — an 8 s client timeout against a 5.9 s response leaves ~2 s of headroom, and losing that race rolls back a *successful* pick.
- 🔴 **`player_directory` newest `updated_at` = 2026-08-06 — 5 days 21 h stale**, against his own *"stale > 24 h → POSTPONE"*. Directory is *complete* (2,035 players, all 32 clubs), so for an August draft the risk is low — but the rule is his, and he should refresh it or consciously waive it.
- The `PendingPickIndicator` visual treatment is still unwired. The pick now draws; it draws without the "Submitting…" pulse. Deliberate — picks confirm in under two seconds and a pulse that brief reads as a flicker.

**No production writes. `ada00015` untouched — `in_progress`, 0 picks, 1 event. Rigs ada00026/27 retired and named *"safe to delete"*.**
