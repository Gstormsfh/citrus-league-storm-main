
## E13 — **You CAN pause the draft. It works — but the room won't say so.** *(added 2026-08-12 — inbox E159)*

Like `draft_extend` (§E12), pause and resume are finished, fully-guarded tools sitting in the database with **no button and no route**. On a three-hour night with twelve people, this is the one you're most likely to want.

### The commands

Supabase SQL editor, staging (`jjgspcpvqaiitloglxbb`):

```sql
-- pause
SELECT public.draft_pause(
  '<league-id>'::uuid,
  '{"kind":"commissioner","id":"<your-user-uuid>","reason":"break"}'::jsonb
);

-- resume
SELECT public.draft_resume(
  '<league-id>'::uuid,
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb
);
```

`"kind":"commissioner"` is mandatory — no bypass. Pause requires the draft to be **active**; resume requires it to be **paused**. Double-pausing or resuming a running draft raises `illegal_state_transition` and changes nothing.

### ⚠️ Dry-run this before Aug 20, with §E12

On a throwaway league: pause, confirm nobody gets auto-drafted, resume, confirm the clock restarts. Read but never executed — don't let the first run be during the draft.

### What actually happens

**Nobody gets auto-drafted while paused.** The engine suppresses autopick, and the pick RPC refuses picks with a message the app already renders properly: *"The draft is paused or completed. Picks aren't allowed right now."* **The two things that matter both work.**

**Resume gives a fresh full clock** — not the few seconds that were left when you paused. Pause someone at 0:04 and they come back with the whole 90. That's deliberate.

### 🔴 SAY IT OUT LOUD — the room does not show a paused state

**The clocks will run down to 0:00 and sit there.** No autopick will fire, which is correct — but nothing on screen explains why. The paused UI exists in the code and nothing feeds it for a snake draft.

**So pause is a verbal feature. Announce it:**

> *"I'm pausing the draft. Your clock will look stuck at zero — that's expected, nobody gets auto-picked. I'll say when we're back."*

Then say when you resume, because their clocks will jump back to full and they won't know why either.

### One log line that looks alarming and isn't

If you're watching the engine log you'll see:

```
[lobby] clock fired while paused — ignored (pauseDraft should have cancelled)
```

**That is the safety net doing its job.** The pause path sets the flag but doesn't cancel the pending timer, so the timer fires and the handler refuses it. The pick is not made. Expect one of these per paused clock.

### When to reach for it

- Anyone needs a real break in a three-hour event.
- Something looks wrong and you need thirty seconds to think **without the clock running** — pause first, diagnose second.
- An engine hiccup (§E12): pause stops the bleeding, extend buys time for whoever was on the clock.

**Pause does not undo anything (§E10).** It stops the clock; it cannot give back a pick already made.

---
