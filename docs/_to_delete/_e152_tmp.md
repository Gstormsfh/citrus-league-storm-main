
## Entry 152 — **CORRECTION to E151, within the hour.** I claimed pressing START after the broken reset would append a second `draft_started` to a log holding a finished draft. **It won't.** `start_draft_v2` refuses that exact state, by name, with two independent guards. The button still lies; the consequence is much smaller — and the reason why is the most reassuring thing I've read in this codebase.

**What I wrote in E151, flagged at the time as *"reasoned from source, not tested"*:**

> *"Pressing START from there appends a second `draft_started` onto a log that already contains 252 picks."*

**That is wrong.** I had read `nuclear_reset_draft` and `tg_draft_events_project_pick` but not `start_draft_v2`. Reading it changes the answer.

---

### What actually happens

`nuclear_reset_draft`, full body, 25 lines — its UPDATE touches **three** columns:

```sql
UPDATE public.leagues
   SET draft_status         = 'not_started',
       scheduled_draft_time = NULL,
       settings             = jsonb_set(…, '{timerStartedAt}', 'null')
```

**`draft_state` is not among them.** And on staging **111 of 112 completed leagues carry `draft_state = 'active'`** — completion never winds it back. So after a reset on a completed v2 league the row reads `draft_status='not_started'`, `draft_state='active'`.

`start_draft_v2` then refuses it at line 121, in a guard written for precisely this combination:

```sql
IF v_draft_status IN ('not_started','queued')
   AND v_draft_state IS DISTINCT FROM 'not_started' THEN
  RAISE EXCEPTION 'draft_state_not_startable: league % draft_status=% but draft_state=% (illegal combo)'
```

**And a second, independent guard would catch it anyway** — the reset deletes `draft_order`, so line 148 raises `draft_not_configured: league % has no round-1 draft_order`.

**The log is never polluted. No second `draft_started` is ever appended.**

---

### The rig that misled me, and the E119 lesson landing again

My evidence for the claim was my own **LOAD1 contention rig** (`ada00006-…-01`), which carries **four** `draft_started` events — three appended *after* `draft_completed`. Given the guard at line 109 (`draft_already_completed: … restart not permitted`), `start_draft_v2` cannot have produced those. **They are raw inserts from my own rig construction**, not evidence of anything about the product.

**That is the third time this week a rig artifact has looked like a finding** (E119: empty `league_scoring_rules` because I built rigs with SQL instead of the create-league flow). The rule I keep re-learning: **when the only evidence for a defect is a row in a league I built by hand, it is not evidence.**

---

### The corrected finding — still worth the runbook rule, for a different reason

**Unchanged and confirmed:** the Profile page's "Reset Draft" button deletes **zero** v2 picks, leaves `draft_picks_v2` and the entire event log intact, flips the status, and reports **"Draft reset successful — you can now start a fresh draft."** That dialog is false and the button is commissioner-reachable today.

**Changed:** the consequence is **an unstartable league, not a corrupted one.** Nothing is lost — the draft is whole in `draft_events` and `draft_picks_v2` — and the refusal is loud and named rather than silent.

**§E11 rewritten accordingly.** The rule is the same (*if a draft needs restarting, make a new league*); the reason moves from *"you'll corrupt the log"* to *"you'll brick that league and get a confusing error."* Severity drops from 🚨 to ⚠️. **The register and the morning brief have been corrected too — not annotated, corrected**, because Garrett reads those for instructions, and an instruction with a footnote is worse than one that's just right.

---

### The part that deserves to be the headline

**`start_draft_v2` is the best-defended function I have read in this codebase**, and I should say so having spent the night mostly cataloguing what's missing:

- **Step 0 — idempotency short-circuit** under `pg_advisory_xact_lock` on the key: a double-click returns `was_duplicate: true` and emits nothing. **A commissioner double-tapping START on Aug 20 is a non-event.**
- **Step 2 — `SELECT … FOR UPDATE`** on the league row, with the reason in a comment citing **E100**, the ignition race I filed: concurrent ignitions with *different* keys serialize, and the loser re-reads committed state and refuses.
- **A five-step ordered guard taxonomy** — `draft_already_completed`, `draft_already_in_progress`, `draft_state_not_startable`, `draft_not_configured` (×4 distinct configuration checks) — status checked *first*, with a comment naming the discipline it follows.
- **Payload validated** against the spec (`validate_draft_event_payload`) and **hashed** before emission.

**The failure mode I invented had already been anticipated and named by whoever wrote this.** After four entries about capabilities the v2 rail never inherited, the ignition path turns out to be the opposite: over-defended, deliberately, with the reasoning left in the source for the next person. That is the single most reassuring thing I can report eight days out — **the one irreversible action of the night is the most carefully guarded code in the product.**

---

**Discipline note.** E151 was published with the claim explicitly flagged as unverified, and the correction landed within the hour because I kept reading instead of moving on. That is the flag working as intended. **The lesson is not "flag harder" — it is that a claim about what a function will do should wait until I have read that function.** I had read the three functions around it and inferred the fourth.

**No code changed. Runbook §E11 rewritten, `V1_TABLE_CONSUMERS.md` and the morning brief corrected in place. Both databases read-only for this entry.**
