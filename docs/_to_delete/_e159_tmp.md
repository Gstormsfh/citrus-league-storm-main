
## Entry 159 — **PAUSE WORKS.** `draft_pause` / `draft_resume` are complete, guarded, and effective where it counts: no autopick fires while paused, and a manager who tries to pick is told why. **But the room never says it's paused** — the clocks run to 0:00 and sit there. Usable on Aug 20 with one sentence out loud. **Runbook §E13.**

**Why I looked.** Three instances of one pattern — a commissioner tool built in the database with no way to reach it: undo (no producer at all, E150), extend (finished and unreachable, E158). `DraftRoomV2.tsx:13` says the whole `DraftControls` panel ships hidden because *"pause/resume routes don't exist"*. The **routes** don't. **The RPCs do.** So I finished the inventory.

**A working pause is worth more to a three-hour draft with twelve humans than anything else I could have gone looking for.**

---

### The RPCs are as good as `draft_extend`

Both `draft_pause(league_id, actor)` and `draft_resume(league_id, actor)` carry the same guard set, read in full:

- `actor.kind = 'commissioner'` — **unconditional, no service-role bypass**
- caller must be the commissioner (bypass only for `service_role` / `postgres`)
- `draft_pause` requires `draft_state = 'active'`; `draft_resume` requires `'paused'` — so double-pause and stray-resume both raise `illegal_state_transition`
- each updates the column **and** appends its event (`draft_paused` / `draft_resumed`) through `append_draft_event`, **in one transaction**

`draft_pause` clears `pick_deadline` and records `remaining_seconds` in the payload. **`draft_resume` ignores it and grants a fresh full clock** — `now() + pickTimeLimit + 1s`. That is deliberate and documented on both sides; the engine's comment says *"the engine does NOT use it to reconstruct the resume deadline because the `draft_resume` RPC gives a fresh full pick clock. Single source of truth: engine state mirrors RPC behavior."* **For a human draft that is the friendlier behaviour** — pause at 0:04 remaining and you come back with a full clock, not four seconds.

### The part that matters: nobody gets auto-drafted during a pause

I went looking for a defect here and did not find one. The `draft_paused` dispatcher case sets `pauseState` but **does not cancel the pending timer** — which looked like exactly the "stale timer fires against an out-of-date deadline" class that the `draft_resumed` case right below it exists to prevent.

**It is covered, twice, by defence in depth:**

```
handleClockExpired:4682   if (this.pauseState !== null) { …ignored… ; return; }
clock-liveness recovery:4765   if (this.pauseState !== null) return { recovered:false, reason:'paused' }
```

The timer still fires; the handler declines. And the log line names the gap I had spotted:

> `[lobby] clock fired while paused — ignored (pauseDraft should have cancelled)`

There **is** a `pauseDraft()` method that cancels the timer properly — the event dispatcher just doesn't call it. **The outcome is correct; the belt caught what the braces missed.** Worth a runbook note only because Garrett may see that WARN on the night and think something is wrong.

**And picks are refused correctly too.** `submit_pick_v2` requires `draft_state = 'active'`, so a pick during a pause raises `illegal_state` — which the client already maps to real copy: *"The draft is paused or completed. Picks aren't allowed right now."* **The one interaction a confused manager will actually attempt is handled.**

---

### The gap: the room doesn't show it

Four checks, all negative — the client is never told:

1. **The `draft_paused` dispatcher does not broadcast.** Every `this.broadcast` site is presence, pick events, or auction events. Pause isn't among them.
2. **`deriveDraftState` has no `draft_paused` case.** It handles `auction_paused` — the auction variant — and nothing for snake/linear.
3. **The client never reads `draft_state` at all.** Grep across the whole `draftClient` directory and `DraftRoomV2`: zero references, even though `/sync` returns the field.
4. **A reconnecting client is actively told the wrong thing.** `mapDraftStateToLobbyStatus` maps `'paused' → 'in_progress'`, with a comment calling it intentional: *"snake/linear pause is a `pauseState` side-channel; engine still treats lifecycle as `in_progress`."* (E153/§5a.)

**So the twelve see their clocks run down to 0:00 and stop there.** No autopick — correct — and no explanation. The plumbing for a paused UI exists (`DraftRoomV2:421` returns `'paused'`, `DraftTimerV2` accepts it) and nothing ever feeds it for a snake draft.

**That makes pause usable, not polished.** One sentence out loud — *"I'm pausing the draft; your clock will look stuck, that's expected"* — converts it into a working feature.

---

### The commissioner-tool inventory, complete

| tool | RPC | engine applies | route | button | verdict |
|---|---|---|---|---|---|
| **extend** | ✅ complete | ✅ live + bootstrap | ❌ | ❌ | **safe to run by hand** (E158, §E12) |
| **pause / resume** | ✅ complete | ✅ suppresses autopick; refuses picks | ❌ | ❌ | **safe to run by hand** (this entry, §E13) |
| **undo** | ❌ **no producer exists** | replay handler + projection cleanup both built | route runs v1 against the wrong table | hidden | **absent** (E150, §E10) |
| **reset** | ⚠️ v1-era, wrong table | — | ✅ | ✅ **on Profile** | **lies; bricks the league** (E151/E152, §E11) |

**The pattern, stated once:** the v2 rail's commissioner tools were built database-first and correctly — guarded, event-sourced, engine-aware — and then the HTTP and UI layers never followed. The panel was hidden for a defensible reason (*"wiring commissioner tools to nothing is worse than absence"*), and that decision, made when the RPCs didn't exist, was never revisited after they landed. **Two finished tools have been sitting there unreachable, and the only commissioner button that IS wired is the one that doesn't work.**

**After Aug 20 this is one small piece of work, not four**: three routes and three buttons over RPCs that are already done and tested. Undo is the only one needing new SQL, and E153 established that even its projection half is built.

---

**Runbook §E13 added. Nothing executed — §E13 asks Garrett to dry-run pause/resume alongside extend during pre-flight. No code changed. Both databases read-only for this entry.**
