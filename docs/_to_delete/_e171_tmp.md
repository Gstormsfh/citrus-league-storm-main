
## Entry 171 — **RETRACTION. E166 and E170 "corrected" two numbers that were already right.** THE TWELVE is specified as a **12-round** draft in the runbook's own T-3d section; I asserted 21 because that is the product default and what my rigs used. Both documents restored, this time to a formula rather than to my number. **The cross-document sweep that found it also confirms everything else agrees.**

**Why I caught it.** Six operational documents were corrected individually across E164–E170. **The risk that creates is disagreement between them** — whichever Garrett reads second becomes the wrong one. So I swept for contradictions rather than starting anything new. One surfaced immediately, and it was mine.

---

### The mistake

`THE_TWELVE_DRAFT_NIGHT.md` **§T-3d — league creation**, the section that tells Garrett how to create THE TWELVE:

> - League size: **12**.
> - Rounds: **12** *(one round per team — smallest possible real draft for the FIRST live-human exercise)*.

**That is deliberate, reasoned, and it is the plan of record.** Which makes the original numbers correct:

- §5a's `draft_event_counter = 146` → **1 + (12 × 12) + 1. Right.**
- `PRE_TWELVE_DRY_RUN.md`'s *"Rounds: 12 (matches THE TWELVE)"* → **it does match. Right.**

**E166 changed §5a to 254. E170 called the dry-run's line a defect and wrote a paragraph about it being "57% of the real length."** Both wrong, and E170's was worse because it was scathing about a document that was correct.

**Where my number came from:** `createLeague`'s default is `draft_rounds = 21`, and every soak rig I built used it — the 252-pick league `ada00018-…-01` is 12 × 21. **I verified 21 against my own test data and never checked it against the plan.** That is the E157 rig-artifact trap in a new costume: I have been careful all night not to quote statistics over staging leagues I created, and then quoted a *configuration* from one.

### What I changed back

Both documents now carry the **formula** — `1 + (league_size × draft_rounds) + 1` — with **146 named for 12 rounds and 254 for 21**, and an instruction to read `draft_rounds` off the league rather than trust any number written down, **including one I wrote.**

**The retraction notes stay in both files.** A silent revert would leave Garrett unable to tell which of my numbers to believe.

**What survives from E170, and it is the important half:** the roster-existence checks. Those were a genuine hole — the dry-run checklist could go all-green on a draft that produced zero rosters — and they are untouched by this retraction. **E170's finding was right; E170's arithmetic was not.**

### The decision that is actually Garrett's

**12 rounds or 21 is a product call, not a correctness one**, and it is worth him making deliberately rather than inheriting:

- **12 rounds — 144 picks.** ~2 hours at a 30-second clock. The runbook's stated reasoning: smallest real draft for a first live-human exercise. **Rosters would be 12 deep against a 21-slot roster_size**, so teams start the season two-thirds full.
- **21 rounds — 252 picks.** ~3.5 hours. Fills the roster the league is configured for, and matches every soak I ran.

**Whichever he picks, the dry run must use the same one** — that is now stated in both files.

---

### The rest of the sweep: everything agrees

| check | result |
|---|---|
| `draft_pause` / `draft_resume` / `draft_extend` signatures | ✅ identical across runbook §6d, Appendix A, §E12/§E13, the deploy sheet's PRE-FLIGHT and the morning brief — jsonb actor, `"kind":"commissioner"`, two args on resume |
| Rollback pin | ✅ `0ecbe605-draft` agrees in runbook §6c pre-reqs, `SUNDAY_EXECUTION_BLOCKS` §A-0/§A-R, and the dry-run plan; the do-not-descend-past-it ruling appears once and is unambiguous |
| E142 warning at every "go" decision point | ✅ deploy sheet Step 0, dry-run §6 acceptance, morning brief §① |
| Stale arithmetic anywhere else | ✅ none outside a dated correction note |

**One incidental find worth recording:** `draft-engine-v2-staging-preflight.md` has used the **correct** `jsonb_build_object('kind','commissioner', …)` form for pause and resume all along, as does `draft-engine-v2-rollback-playbook.md`. **The right signature was sitting in two sibling runbooks while the draft-night runbook carried the broken one** (E165). Nobody cross-checked, and neither did I until now — the sweep would have found E165's defect on its own.

---

**No code changed. Two retractions applied in place. Both databases read-only for this entry.**
