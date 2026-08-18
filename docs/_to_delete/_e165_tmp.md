
## Entry 165 — **The runbook's most-referenced remedy was four broken commands.** `draft_pause` and `draft_resume` appear in the failure trees and in the section headed *"copy-paste from here during draft night"* — with the wrong argument type and the wrong arity. **Every one of them would have errored at the moment Garrett needed it.** Fixed in place.

**Why I audited it.** E164 audited the deploy sheet on the principle that the document you *execute* deserves more scrutiny than the ones you read. **The runbook deserves more still: the deploy sheet is run once, calmly, at a desk. The runbook is read under pressure with twelve people waiting.**

---

### What was wrong

The runbook has carried a **pause-first doctrine** since v2, and it is woven through the whole failure section:

- §6d is titled *"Draft pause (buys diagnostic time — **USE EARLY, not late**)"*
- §6a's escalation says *"**PAUSE the draft (6d) first** so time isn't lost"*
- Appendix D records it as a design decision: *"20-minute ceiling doctrine added: any diagnosis > 20min → §6d pause + resume, not restart"* and *"§6d moved earlier in ladder: pause-first, not pause-late."*

**It is the single most-referenced remedy in the document.** And the commands were:

```sql
SELECT public.draft_pause('<LEAGUE_ID>'::uuid, 'diagnostic — engine issue');
SELECT public.draft_resume('<LEAGUE_ID>'::uuid);
```

**Both are wrong, in two different ways** (verified against `pg_proc`, E159):

1. **The second argument is `jsonb`, not text.** `'diagnostic — engine issue'` is not valid JSON, so the cast fails before the function is even entered. And even valid JSON would not be enough — the body requires `actor->>'kind' = 'commissioner'` and raises `unauthorized` otherwise. **There is no bypass, not even for the SQL editor's role.**
2. **`draft_resume` takes the same second argument.** The one-argument form printed here **does not exist** — `function draft_resume(uuid) does not exist`.

**Four instances**: two in §6d, two in Appendix A — the section that opens *"Copy-paste from here during draft night. Every command below is safe to run under pressure."*

**And a third error, factual rather than syntactic.** §6d claimed:

> *"Post-pause: clients see the pause state; timer is dead but state is preserved."*

**Clients do not see the pause state** (E159, four independent checks). Clocks run down to 0:00 and sit there with no explanation. A commissioner who paused and then trusted that sentence would assume the room had told everyone, and say nothing.

---

### Why this survived

**The commands were written before the functions were read.** The doctrine is sound and the reasoning behind it is excellent — pausing early during diagnosis is exactly right for a live human event. But the SQL was written from the *idea* of the function rather than its signature, and nothing since had executed it, so nothing contradicted it.

**This is the same class as E152's mistake, in a document instead of an entry**: a claim about what a function does, made without reading that function. It is also why §E13 exists at all — I only found the real signatures last cycle because I went looking for whether pause worked, not whether the runbook's pause worked.

**Note what did NOT catch it:** 1,031 offline tests, a v1→v2 reconciliation, and three deltas of review. Nothing tests a runbook.

### What I changed

- **All four commands replaced** with the verified signatures, in `sql` blocks rather than PowerShell/psql wrappers.
- **§6d's false claim corrected**, and the announcement Garrett must make written into the tree itself rather than left in §E13 five hundred lines away.
- **A correction banner** on §6d so anyone with the old version in their head sees why it changed.
- **Appendix A gained `draft_extend`** — the other lever (§E12), which had never been in the quick-reference at all — plus the mandatory-`kind` warning and a pointer to the pre-flight dry-run.
- **Resume's real behaviour documented** where it matters: a fresh full clock, not the seconds that were left.

### What I checked and found clean

Swept the v2/v3 body for other remedies tonight's work has invalidated: no stale undo path, no reference to the commissioner panel as if it were reachable, no reset instruction. §6c's rollback pins are unchanged and live in a separate document. **§6d was the only broken remedy.**

---

### The general point, because it will recur

**Runbooks rot in a way code does not.** Nothing compiles them, nothing runs them, and the failure only surfaces at the worst possible moment — which is precisely when the document is being trusted most. Tonight this one contained a doctrine referenced from four places whose implementation could not work.

**Worth doing before Aug 20, and I have not done it:** actually executing every command in Appendix A once, against a throwaway league. §E12 and §E13 already ask Garrett to dry-run the three RPCs. **The same logic applies to the rest of that appendix** — the log-tail, health-probe and container-uptime commands have the same "written from the idea" risk, and the only way to know is to run them.

**No code changed. Four command corrections + one factual correction, in place. Both databases untouched for this entry.**
