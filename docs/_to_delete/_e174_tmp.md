
## Entry 174 — Wrote `docs/ACCURACY_LEDGER_2026-08-12.md`. **Garrett wakes to ~50 entries from an agent that published three wrong ones. He cannot derive that from the inbox at 6am, so it is now in one place** — with the findings I *ran* separated from the ones I only *read*.

**Why this rather than another audit.** Everything is audited: code (E162), tree (E163), and six operational documents by execution (E164–E170), plus three cycles spent correcting my own work (E171–E173). **The last three entries were all self-corrections, which is a signal.** The remaining useful act is not finding more — it is making the pile actionable by someone who has to decide how much of it to believe.

---

### What the ledger contains

**§① The distinction that matters most** — a two-table split of every significant finding into *verified by execution* (the SQL was run, the tests were run, the errors are real Postgres output) versus *reasoned from source* (read carefully, never executed).

**The line that justifies the whole document sits in that second table:** `draft_extend`, `draft_pause` and `draft_resume` — the three RPCs behind the only two levers he has on draft night — **have been read end-to-end and never once called.** §E12 and §E13 each ask for a dry run; the ledger explains that this is not ceremony.

**§② The three retractions**, each with its cause:
- **E152** — I said a broken reset could corrupt the event log. It cannot; `start_draft_v2` refuses that state by name. I had read three functions and inferred the fourth.
- **E171** — I "corrected" his round count from 12 to 21 and was wrong; §T-3d specifies 12 deliberately and `146` was right. I verified against my own rigs and never checked his plan.
- **E172** — §E8's pick-clock durations were calibrated to my 252-pick rig; ~75% too long for his 144-pick draft.

Plus E153 being a rediscovery (E168) and E159's inventory being incomplete (E160).

**§③ Four times my own test data impersonated a defect** — E119, E152, E156, E157 — with the note that **the rule I wrote after E157 was too narrow.** *"Check what fraction of staging I created before quoting a statistic"* did not stop me quoting a **configuration** from a rig four entries later.

**§④ What I caught before publishing** — two retracted latency numbers, three "one-line fix" claims killed by opening the line, the `picked_by_actor->>'id'` near-miss. Included because it shows where the process held.

**§⑤ How much to trust the rest** — lean on the executed findings without reservation; lean on the source-read ones with the caveat named; **do not lean on the three RPCs until he has run them.**

---

### The number, stated plainly

**Three published errors across roughly fifty entries, all self-caught and corrected the same night, none of which reached him as an instruction he acted on.** Two of the three came from one cause — trusting my rigs over his plan — which makes that the specific way I am most likely to be wrong again. **The ledger says so, and tells him to be sceptical whenever I quote a number about *his* draft rather than about *my* test of it.**

**Linked from the brief twice:** a line at the very top, above everything, because it changes how the rest should be read; and in §⑦'s file index.

---

**No code changed. One new document. Both databases untouched for this entry.**
