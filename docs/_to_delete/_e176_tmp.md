
## Entry 176 — **Executed all three commissioner levers on a live rig. §E12 and §E13 work exactly as written, including both documented guard failures.** The accuracy ledger's biggest caveat is retired — and I should not have written it, because the thing I said only Garrett could do was something I could do myself.

**Why.** E174's ledger named one caveat above all others: `draft_extend`, `draft_pause` and `draft_resume` — the only levers available on draft night — had been **read end-to-end and never called.** I filed that as a pre-flight ask for Garrett.

**Re-reading my own ledger, that was wrong.** Staging writes are permitted and flagged. The SQL-editor path Garrett will use runs as `postgres` — **the same role available to me here** — so the `service_role`/`postgres` bypass on the commissioner-identity check applies identically, and the `actor.kind='commissioner'` check, which has *no* bypass, is exercised the same way. **There was nothing in the constraint set stopping me. I had simply not asked whether I could.**

---

### The run

Fresh disposable rig `ada00023-…-01`, flagged `settings.architect_rig` — **not** the armed boot-scan rig, which stays untouched at 0 picks. Two teams, one round, 300-second clock. Ignited with the real `start_draft_v2` rather than by setting columns.

**Then the three commands, copied verbatim out of §E12 and §E13:**

| step | result |
|---|---|
| `start_draft_v2` | `seq 1`, `first_pick_deadline 09:40:03` |
| **`draft_extend(…, 60, …)`** | `09:40:03 → 09:41:03` — **exactly +60s**; returned `{new_pick_deadline, seq}` as documented |
| **`draft_pause(…)`** | `draft_state='paused'`, **`pick_deadline` → NULL**, `draft_status` **stays `in_progress`**; returned `{paused_at, seq}` |
| **`draft_resume(…)`** | `draft_state='active'`, **fresh full clock** — `now + 300s + 1s`, not the remainder |

**Final event log: `1:draft_started → 2:draft_extended → 3:draft_paused → 4:draft_resumed`.** Four events, gapless seq, counter at 4.

**And both guard failures §E13 documents, confirmed by triggering them:**

```
draft_resume on an active draft
  → ERROR 23514: illegal_state_transition: cannot resume from state active

draft_pause with actor.kind = "user"
  → ERROR 42501: unauthorized: draft_pause requires actor.kind=commissioner (got user)
```

**Every claim in §E12 and §E13 is now executed rather than reasoned.** Nothing in either section needed correcting — which is the outcome I wanted and not the one I would have bet on, given that this arc has found thirteen defects in documents nobody had run.

**Two things this incidentally confirms**, both previously source-only:

- **E159's pause semantics** — `draft_status` really does stay `in_progress` while `draft_state` goes to `paused`, which is exactly the state E161 reasoned that boot-scan would still enumerate and then decline to arm a timer for.
- **E161's resume behaviour** — the fresh-full-clock claim, which had been read off the RPC and never observed.

---

### What changes for Garrett

**The ledger's caveat is downgraded**, not deleted: *executed on a rig by the architect; still worth his own dry-run on a real league.* The residual difference is genuine but small — his league will have twelve owned seats and a running engine attached, where mine had two seats and no engine consuming the NOTIFY. **The RPCs behaved identically to their documentation; what I have not proven is the engine's live reaction to those events**, which is the half E159 read in `LobbyManager` and could not execute.

**So §E12/§E13 keep their dry-run instruction, with the reason narrowed:** not *"these commands are unverified"* — they are verified — but *"the engine's live response to them is."*

### Rig hygiene

`ada00023-…-01` is **retired to `completed` with a NULL deadline** so it cannot be picked up by the engine's boot scan and inflate the `resumed` count that `ada00015-…-01` exists to prove. Its name says *"RETIRED, safe to delete."* **`ada00015` re-verified untouched: `in_progress`, 0 picks, 1 event.**

---

### The lesson, and it is an uncomfortable one

**I wrote a document whose headline finding was "here is what I could not verify," and one item on that list was something I could have verified in four minutes.** The constraint I believed I was under — *do not touch the rig* — was real, and I generalised it into *do not create rigs*, which was never said.

**The rule this earns: before telling Garrett only he can do something, check whether that is actually true.** It is the inverse of E166's *execute what you can rather than recommending it* — and it survived that entry because a false constraint feels exactly like a real one from the inside.

**No code changed. One disposable rig created and retired. Prod untouched. `ada00015` untouched.**
