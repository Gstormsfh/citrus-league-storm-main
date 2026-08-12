
## E12 — **You CAN add time to a pick clock. It's the only lever you have, and it isn't in the UI.** *(added 2026-08-12 — inbox E158)*

`draft_extend` is a finished, fully-guarded commissioner tool sitting in the database with **no button and no route**. It is the correct response to the two most likely incidents on the night: the engine hiccupping, and somebody needing thirty more seconds.

### The command

Run it in the Supabase SQL editor on **staging** (`jjgspcpvqaiitloglxbb`):

```sql
SELECT public.draft_extend(
  '<league-id>'::uuid,
  60,                                        -- seconds to ADD
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb
);
```

Returns `{"new_pick_deadline": ..., "seq": ...}`. The engine picks it up **live** — it re-arms the running clock — and also on bootstrap, so an extension issued while the engine is restarting still applies when it comes back.

**`"kind":"commissioner"` is mandatory.** That check has no bypass, not even for the SQL editor's role.

### ⚠️ Do this once during pre-flight

**Fire it on a throwaway league before Aug 20 so you have run it once.** Confirm you get a `new_pick_deadline` back and that the clock in an open room jumps. It has been read end-to-end but never executed — do not let the first run be during the draft.

### Two things to know about how it behaves

1. **Time is added to the existing deadline, not to now.** If a clock is already 90 seconds expired, adding 60 still leaves it in the past and the pick fires anyway. **During an outage, extend generously** — 300, not 60.
2. **It refuses on a completed draft**, with `illegal_state: active draft has no pick_deadline (data corruption?)`. That message sounds alarming and is not — completion deliberately clears the deadline. Nothing is wrong.

### When to reach for it

- **The engine bounces mid-draft.** The room shows a reconnecting banner while the clock keeps running. When the engine returns, **it will immediately autopick anyone whose deadline passed during the outage** — the timer re-arms from the stored deadline and fires at once if that deadline is past. Extending during the outage is what protects the person on the clock.
- **Somebody needs a minute** — a phone call, a dropped connection, a disputed name.
- **You want the room to breathe** after any incident, before the next pick starts.

### What it does NOT do

It cannot rewind an autopick that has already fired. **There is no undo (§E10).** Extending is only useful *before* the clock runs out — which means the moment you notice trouble, extend first and diagnose second.

### Why this is safe when a manual undo is not

§E10 tells you never to hand-fix a mis-pick with SQL, and that stands. The difference is architectural: a manual undo would delete rows from `draft_picks_v2` behind the engine's back while it holds lobby state in memory, leaving the engine and the database disagreeing. **`draft_extend` appends an event the engine already knows how to consume**, both live and on replay. It works with the design instead of around it. **This is the one RPC it is appropriate to run by hand on draft night.**

---
