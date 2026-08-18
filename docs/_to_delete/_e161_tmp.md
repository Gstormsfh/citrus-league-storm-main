
## Entry 161 — Audited the engine's BOOT-SCAN resume path, the recovery route for the most plausible serious incident on Aug 20. **Clean, and it clears the specific risk I created three entries ago: restarting the engine during a pause preserves the pause.** §E13's advice is safe as written.

**Why I looked.** Three reasons, in ascending order of importance:

1. It is the recovery path if the GCE VM bounces mid-draft.
2. `DESIGN_DRAFT_STATUS_SPLIT` §5 calls it the one Slice-1 contract still unproven in the field.
3. **I recommended pause as a night-of tool in §E13 (E159) — and `draft_pause` sets `pick_deadline = NULL`.** If boot-scan mishandles a paused league, I handed Garrett a loaded gun. That check was owed before anything else.

I cannot restart the engine from here, so this is a read, not a run. Rig `ada00015-…-01` remains the field proof on his next restart.

---

### The pause-restart question, answered

A paused snake draft sits at `draft_status = 'in_progress'` (pause only touches `draft_state`), `draft_state = 'paused'`, `pick_deadline = NULL`.

**Boot-scan does enumerate it** — the query is `.eq('draft_status', 'in_progress')`, so a paused league is picked up rather than stranded. Good: the failure mode of "engine restarts, paused draft is forgotten" does not exist.

**And it comes back paused, with no clock**, because the snake arm site guards twice:

```ts
} else if (
  this.draftStatus === 'in_progress' &&
  this.pauseState === null &&           // ← set by replaying draft_paused
  this.initialPickDeadline !== null     // ← NULL while paused
) {
  this.armPickDeadline(this.initialPickDeadline);
```

Either guard alone would be sufficient; both apply. The replay sets `pauseState` from the durable `draft_paused` event, and the deadline the DB hands back is NULL. **No timer is armed. Nobody is auto-drafted. The pause survives the restart**, and a later `draft_resume` re-arms through the live dispatcher (E159).

**So §E13 stands unamended.** Pausing and then bouncing the engine is safe.

### The rest of the boot scan is careful work

- **The defect it fixed was measured, not theorised**: Entry 83 recorded **4.7 dead minutes** post-restart on an in-progress league that had no clients and no pending event. Lobbies were lazy — created only on client connect or NOTIFY — so a restarted draft with everyone's tab closed stalled indefinitely.
- **Non-fatal per league**: one broken league logs and the scan continues. A single bad row cannot take down the engine's boot.
- **Non-blocking**: runs in the background so the listener is serving before the scan finishes; clients that connect meanwhile force a lazy create, which is idempotent with `getOrCreate`'s placeholder pattern.
- **Sequential on purpose**, with the reasoning written down — parallel would race the shared admin connection pool, and at ~50ms per lobby (Entry 88's measurement) sequential is fine at twelve-scale. It even names the threshold at which to revisit: 100 concurrent in-progress leagues per engine.
- **`init()` is idempotent** behind an `initialized` flag, described as load-bearing because a double bootstrap would double-replay the log.

### One recorded landmine worth knowing about

The scan queries `draft_status = 'in_progress'` **only** — and the code explains why in an E111 note:

> `draft_status` enum is `('not_started','queued','in_progress','completed')` — **`paused` is NOT a member.** Pause lives on the other column. A Postgres `.in()` list containing a non-member literal is **rejected whole (22P02)** — the scan would then return zero and resume nothing.

**So the obvious-looking "fix" of adding `'paused'` to that `.in()` list would silently break the entire boot scan**, not extend it. The doc comment immediately above still describes the two-value version, which is what makes this worth flagging: **a future reader may see the comment, "correct" the query to match, and disable engine recovery entirely.**

The same note records an open docket I did not know about: `DRAFT_STATUSES` in `packages/shared/src/types/league.ts` **erroneously includes `'paused'`**, and that type-drift is why the enum mismatch survived 1,031 offline tests. Already docketed by whoever wrote it — noting it so it does not get rediscovered as new.

---

### Verdict

**The recovery path for an engine bounce is sound, and the pause interaction is safe.** Nothing to change, nothing to add to the runbook. Rig `ada00015-…-01` still proves the resume path for free on the next engine restart — watch the boot log for `resumed > 0`.

**This cycle found no defect. Saying so plainly, per E149.** The value was clearing a risk I had introduced myself: recommending a tool in §E13 obliges me to know how it behaves when the thing underneath it restarts, and now I do.

**No code changed. Both databases read-only for this entry.**
