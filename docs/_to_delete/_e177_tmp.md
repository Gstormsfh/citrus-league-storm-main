
## Entry 177 — **The engine is live, pause suppresses autopick in it, and resume re-arms it — all three proven by execution, not source.** And I accidentally demonstrated the exact hazard §E10 warns about: my own column-level `UPDATE` failed to stop a running lobby, which autopicked five minutes later.

**Why.** E176 verified the three RPCs but explicitly could not verify **the engine's live reaction** to the events they emit — my rig had no engine attached. That gap is testable without gcloud: watch `draft_events` and see whether autopick fires.

---

### Probe A — is the engine actually running right now?

Fresh rig `ada00024`, two **ownerless** seats, 20-second clock, ignited by SQL only. Waited 35 seconds:

```
1:draft_started → 2:pick autopick=true → 3:pick autopick=true → 4:draft_completed
```

**The engine received the NOTIFY, created a lobby, armed the clock, fired instant-autopick on both ownerless seats, and completed the draft — from an ignition I performed entirely in SQL.** The engine is live and consuming events as of 09:40Z.

### Probe B — does pause stop it?

Fresh rig `ada00025`, first seat **owned** (so it burns the full clock), 40-second limit. Ignited at 09:40:58, deadline 09:41:39. **Paused at 09:41:04 — 35 seconds before expiry.** Then waited past it:

```
checked 09:42:31 — 52 seconds past the original deadline
picks: 0
log:   1:draft_started → 2:draft_paused
```

**Zero picks, 52 seconds after the clock should have fired.** E159 claimed from source that `handleClockExpired` declines while `pauseState` is set. **That is now observed behaviour in the running engine, not a reading of it.**

### And does resume bring it back?

Resumed at 09:42:41 → fresh 40-second clock, deadline 09:43:22:

```
1:draft_started → 2:draft_paused → 3:draft_resumed → 4:pick autopick=true → 5:pick autopick=true → 6:draft_completed
```

**The engine re-armed on the new deadline and autopicked.** The full cycle — ignite, pause, hold past expiry, resume, fire — is proven end to end against a live engine.

**§E12 and §E13 are now verified at every layer: the RPC (E176), the event, and the engine's response (this entry).** The dry-run instruction in both sections can stand down from *"the engine's reaction is unproven"* to a genuine optional rehearsal.

---

### The accident, which is worth more than the test

While retiring the E176 rig I ran a plain column write to take it out of boot-scan's way:

```sql
UPDATE public.leagues SET draft_status='completed', pick_deadline=NULL WHERE id='ada00023…';
```

**Five minutes later the engine autopicked it anyway.**

```
seq 4  09:35:27  draft_resumed          ← my last RPC
       ~09:37    UPDATE … 'completed'   ← column write, NO event
seq 5  09:40:28  pick autopick=true     ← the engine, ignoring it entirely
seq 6  09:40:30  pick autopick=true
seq 7  09:40:30  draft_completed
```

**The running lobby never saw my UPDATE**, because its state lives in memory and is driven by the event log. `draft_status` in the leagues table is not what the engine consults mid-draft; the timer it armed at resume fired on schedule and did its job.

**This is a live demonstration of exactly why §E10 forbids hand-fixing a mis-pick with SQL, and why §E12/§E13 are safe when that is not.** The distinction I wrote in E158 — *these RPCs are safe to run by hand precisely because they append events the engine consumes* — has now been shown from the other side: **a write that does not emit an event does not reach the engine at all.** I made the mistake the runbook exists to prevent, in the least costly place possible, and it behaved exactly as documented.

**Harmless here** — a two-team disposable rig, which completed itself and is retired. **On draft night the same write would have left the engine drafting a league the database believed was finished.**

---

### State

| rig | status | note |
|---|---|---|
| `ada00015-…-01` | **in_progress, 0 picks, 1 event** | **untouched — still the boot-scan proof** |
| `ada00023 / 24 / 25` | completed, deadline NULL | retired, named *"safe to delete"* |

**Pre-flight asks for Garrett drop to one and a half:** Appendix A's gcloud commands (genuinely mine to not run), and an optional rehearsal of §E12/§E13 on a real league — no longer to check whether they work, but to see them work.

**No code changed. Three disposable rigs, all retired. Prod untouched. `ada00015` untouched.**
