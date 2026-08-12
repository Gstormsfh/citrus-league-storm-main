
## Entry 158 — **`draft_extend` exists, is fully guarded, and the engine applies it LIVE — but nothing can reach it.** Same shape as E150's undo, opposite conclusion: this one is *safe to call directly*, and it is the remedy for the most likely incident on Aug 20. **Runbook §E12.** Also confirmed: an engine bounce mid-draft costs the on-clock manager their pick unless someone extends.

**Why I looked.** The open question was what the room does when discovery succeeds but the engine is unreachable — a GCE bounce mid-draft. The client half turned out fine (below). Chasing the *consequence* is what found this.

---

### First, the client is fine

`handleWsClosed` has a full disposition taxonomy — `normal`, `permanent_auth`, `permanent_lobby`, `permanent_server`, `permanent_not_initialized`, `transient` — plus the E87 terminal-completion shortcut and a distinct annotation for close code 4010 (the liveness watchdog) so the banner can say *"Connection appears stale"* rather than something generic. **An unreachable engine closes 1006 → transient → capped backoff → reconnect when the VM returns.** That is correct, and it is what E124's work already covers. **Nothing to fix.**

### But the clock does not wait

Confirmed from source, three places:

```
:4350   "If `deadline <= now()`, the timer fires on the next event-loop"
:4482   const delayMs = Math.max(0, deadline.getTime() - Date.now());
:4757   const overdueMs = deadline !== null ? Date.now() - deadline.getTime() : null;
```

**So if the engine is down for two minutes and the on-clock manager's deadline passes, the moment the engine returns it autopicks them — immediately.** Their browser will have shown a reconnecting banner and a clock running to zero with nothing happening, and then a pick they did not make.

This is **deliberate, not a defect** — `overdueMs` is computed for logging, so the authors knew. The DB-side safety net that used to cover this was retired into the engine (E155), and the engine's own recovery is exactly this: re-arm from the stored deadline, fire if already past. **It is the correct behaviour for a system whose truth is the log. It is simply expensive for the human holding the clock.**

---

### The remedy already exists — and nothing can call it

**`draft_extend(p_league_id uuid, p_extra_seconds integer, p_actor jsonb)`.** In the database, `SECURITY DEFINER`, and actively maintained — its comment tracks changes through chunk 11g.9.

**Guards, all read in full:**

| check | behaviour |
|---|---|
| `p_extra_seconds` null or ≤ 0 | `invalid_event_payload` |
| `p_actor ->> 'kind' <> 'commissioner'` | `unauthorized` — **unconditional, applies even to `postgres`** |
| caller not commissioner (unless `service_role`/`postgres`) | `unauthorized` |
| `draft_state <> 'active'` | `illegal_state_transition` |
| `pick_deadline IS NULL` | `illegal_state` — **this is what makes it refuse on a completed draft**, since completion NULLs the deadline (E153/E155) |

**What it does:** updates `leagues.pick_deadline`, then appends a `draft_extended` event through `append_draft_event` — **column and log in one transaction, no possibility of disagreement.**

**And the engine applies it live.** The dispatcher case re-arms via `setPickDeadline(parsed, 'pick')`, with a comment explaining a deliberate exemption: it does *not* route through `armPickDeadline`, because that would silently shorten a commissioner's extension back to the 2-second instant-autopick window on an ownerless seat. **Someone thought about the exact way this could quietly fail.** There is a bootstrap handler too — so an extension issued *while the engine is down* is picked up when it comes back.

**There is no HTTP route and no client path.** Grep across `server/src/routes` and all of `apps/web/src`: nothing.

---

### Why this one is safe to call by hand, and undo was not

**§E10 tells Garrett never to attempt a manual SQL fix for a mis-pick.** That warning stands, and the reason it stands is exactly why *this* is different:

- **Undo by SQL** would delete rows from `draft_picks_v2` — mutating a projection behind the engine's back, while the engine holds lobby state in memory. The log and the engine would disagree.
- **`draft_extend`** appends an event the engine consumes, both live and at bootstrap. **It works with the architecture instead of around it.** That is the whole distinction, and it is the reason a hand-run RPC is appropriate here and nowhere else.

### The command

```sql
SELECT public.draft_extend(
  '<league-id>'::uuid,
  60,                                        -- seconds to add
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb
);
```

Returns `{new_pick_deadline, seq}`. `actor.kind` **must** be `'commissioner'` — that check has no service-role bypass.

**Extension is added to the existing deadline, not to `now()`** (`v_old_deadline + interval`). On an already-expired deadline, adding 60s may still land in the past — **so during an outage, extend generously.**

**I did not execute it.** Proving it would mean either touching rig `ada00015-…-01`, which must stay pristine, or standing up a fresh draft to run a command I have read end to end — guards, event emission, live dispatcher, bootstrap handler. **Instead it goes in the runbook as a dry-run step**: §E12 tells Garrett to fire it once on a throwaway league during pre-flight, so the one lever he has is proven by him before the night rather than asserted by me.

---

### What this is worth

**Every other night-of finding has been a warning.** §E9 don't start below capacity, §E10 there is no undo, §E11 don't press reset. **This is the first one that hands him something.** A commissioner tool that is built, guarded, live-applied, and invisible — and the correct response to the two most plausible incidents on Aug 20: an engine hiccup, and somebody needing thirty more seconds.

**The post-Aug-20 fix is small and should be routed with E150's undo**, since they are the same gap: a route and a button. `draft_extend` needs no RPC work at all — it is finished. **The button is the entire remaining task.**

**No code changed. Nothing executed. Runbook §E12 added. Both databases read-only for this entry.**
