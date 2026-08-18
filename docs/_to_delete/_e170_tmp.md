
## Entry 170 — Audited the **dry-run plan** — the last acceptance gate before THE TWELVE. **Every box on its checklist could be green on a draft that produced no teams.** It was blind to E142. Also: it specifies a dry run at 57% of the real length while insisting on full scale in the same sentence.

**Why this document.** The draft-night runbook's timeline puts **"T-1d — dry-run + go/no-go decision"** on the critical path, and `PRE_TWELVE_DRY_RUN.md` calls itself *"the last acceptance gate before the run."* Every other operational document has now been audited by execution. This one gates all of them and had never been read.

**Its SQL is clean** — the two queries reference `teams.id/team_name/owner_id/created_at` and `now(), version()`, all verified against the live schema. **The problems are in what it asserts and what it fails to check.**

---

### 1. It cannot detect the biggest defect on the board

The acceptance list — *"All must be green — no exceptions. Any red = HALT THE TWELVE"* — checks:

`draft_status` · `draft_state` · `pick_deadline` · `draft_event_counter` · the completion banner · four classes of engine-log warning · harness ordering violations · full event replay.

**Every one of those is green in an E142 failure.** A completed v2 draft records all 252 picks perfectly, flips both status flags, clears the deadline, emits `draft_completed`, logs nothing alarming, and replays deterministically — **and materialises no rosters at all.** The league home page then says *"Rosters are set."*

**The list checks the event log, the engine and the completion flags. It checks nothing downstream of the draft.** So the gate that decides *"If ALL green: THE TWELVE is a go"* would have passed a dry run whose entire purpose — producing twelve teams — had failed.

**Added three checks:**

- **`SELECT count(*) FROM roster_assignments WHERE league_id = …` must equal `league_size × draft_rounds`.** Until the E142 fix lands this returns **zero** — which is exactly what the gate should be catching.
- **Open `/roster` as a human participant** and confirm it shows players rather than *"Empty Roster — head to the draft room to start drafting."*
- **Exercise `draft_extend` and `draft_pause`/`draft_resume`** on the dry-run league (§E12/§E13). They are the only two levers available on the night, they have no button, and the dry run is precisely the right moment for their first execution.

With a note above §7 explaining why they were added, so nobody removes them as redundant.

### 2. "Full-scale" was 57% of scale

```
- Rounds: 12 (matches THE TWELVE) — full-scale dry run
- Do NOT abbreviate — dry-run must be full-scale to catch scale-dependent bugs.
```

**Twelve rounds does not match THE TWELVE.** The product default from `createLeague` is **21** (`roster_size` 21, `draft_rounds` 21), and 21 is what every architect soak ran at — the 252-pick league `ada00018-…-01`. **A 12-round dry run is 144 picks against a real 252.**

The instruction insisting on full scale and the number defeating it are two lines apart. And the error propagated: the `draft_event_counter` criterion read **146**, the same wrong arithmetic E166 corrected in the runbook's §5a.

**Fixed by making it derived rather than asserted** — read `draft_rounds` off the league after creating it (§T3v now selects that column, per E166) and compute `1 + league_size × draft_rounds + 1`. **Hard-coded expected values are what produced this defect twice; a formula cannot drift.**

*(Honest caveat: THE TWELVE's league does not exist yet, so its rounds are Garrett's choice at creation. The correction is therefore "match the real thing and read the number," not "the number is 21.")*

---

### The pattern, stated once more because this is its clearest instance

Thirteen defects across E164–E170, **none in code.** But this one is different in kind from the broken commands: **nothing here was syntactically wrong.** The dry-run checklist would have executed perfectly and returned all-green. It failed by **omission** — by checking the layer that works and not the layer that doesn't.

**A verification artifact inherits the blind spots of whoever wrote it.** This one was written before E142 was known, so it could not have covered it — but it also carried an unexamined "matches THE TWELVE" for a number that never did. **Broken commands announce themselves the first time you run them. A checklist that passes for the wrong reason never does.**

**That is the argument for the dry run being a real rehearsal rather than a checklist walk**: run it, then go and look at a manager's roster page with your own eyes. The document now says so.

---

**No code changed. Four corrections to `PRE_TWELVE_DRY_RUN.md`, in place. Both databases read-only for this entry.**
