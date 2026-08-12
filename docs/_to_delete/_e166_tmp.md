
## Entry 166 — Executed the runbook's SQL organs instead of recommending someone should. **Four of them error, one has wrong arithmetic, and the T-60m go/no-go check would fail on Aug 20 for a reason that has nothing to do with the draft.** With E165's four broken commands, that is **nine defects in the runbook's executable content**.

**Why.** E165 ended by saying every command in the runbook should be executed once, and that I could not do it. **That was half true.** The gcloud and ssh commands I cannot run. **Every SQL organ I can** — they are read-only `SELECT`s, and I have staging. Recommending a check I was capable of performing was the wrong call, so I performed it.

---

### The organs, executed

| organ | when it runs | result |
|---|---|---|
| **§T3v-1** — post-creation column verify | **T-3d** | ❌ **errors** — `column l.draft_type does not exist` |
| §T3v-2 — draft_order shape | T-3d | ✅ runs; **expectation wrong** (said 12 rows, a 12×21 league has 21) |
| §T3v-3 — counters at zero | T-3d | ✅ |
| **§T60v** — player-pool freshness | **T-60m, go/no-go** | ❌ **errors** — `invalid input syntax for type integer: "2025-26"` |
| §3v — ignition verify | T-0 | ✅ both queries |
| §4b — presence + pace | steady state | ✅ |
| §5a — completion verify | T+2h | ✅ runs; **expected counter wrong** (146 vs **254**) |
| **§5c** — evidence capture | post-draft | ❌ **errors** — `p.round_number` and `pd.player_name` don't exist |
| Appendix A — snapshot / recent events | under pressure | ✅ both |

**§T3v-1** selects `leagues.draft_type`. There is no such column — draft type lives in `settings->>'draftType'`. **This is the first technical check in the entire runbook**, run three days out, and it dies on the first line.

**§T60v** compares `player_directory.season` to `'2025-26'`. The column is an **integer** holding `2025`. **This is the T-60m go/no-go check** — the one whose output decides HALT or POSTPONE an hour before twelve people arrive.

**§5c** exports the draft to evidence files using `p.round_number` and `pd.player_name`. The real columns are **`p.round`** and **`pd.full_name`**. Fixed, and the player join now carries a `season` predicate rather than casting both sides to text.

**§5a** expected `draft_event_counter = 146`, from "12 teams × 12 rounds". **THE TWELVE is 12 × 21 = 252 picks**, so the number is **254** (1 `draft_started` + 252 + 1 `draft_completed`). Confirmed against the soak league — `draft_rounds = 21`, `roster_size = 21`. The runbook flagged its own uncertainty here (*"verify math for THE TWELVE's actual config"*) and nobody did. **Now verified.** Same root cause corrected in §T3v-2's row count.

**All five corrected in place**, each with a dated note saying what was wrong, so anyone holding the old version in their head sees why it changed.

---

### 🔴 The one that is not a documentation bug

Once §T60v actually runs, **it fails on its own criteria today.**

```
season 2025 · 2,035 players · newest updated_at = 2026-08-06
```

**Six days stale.** The runbook's rule is *"if newest is stale > 24h, POSTPONE."* On Aug 20 that check trips — not because anything about the draft is broken, but because the player pipeline last ran on the 6th.

**Two possible resolutions and they are Garrett's, not mine:** run the pipeline before Aug 20, or change the threshold to match how often it actually refreshes. **Player data is the other session's lane, so I have flagged it in §T60v and touched nothing.** It connects to E132 (the draft pool shows no stats at all) — same territory, same owner.

**This is exactly the kind of thing a broken check hides.** §T60v has presumably "passed" every time anyone glanced at it, because it errored rather than reported, and an error at T-60m reads as a tooling problem rather than a data problem.

---

### What this run of entries has established about the documents

E164 found the deploy sheet contradicting itself. E165 found the most-referenced remedy in the runbook was four broken commands. E166 finds four more, in the checks that run at T-3d, T-60m and post-draft.

**Nine defects, none of them in code, all of them in the artifacts Garrett executes under time pressure.** The pattern is consistent: **every one was written from the idea of a query rather than from the schema, and nothing ever ran them.** The code has 1,031 offline tests, mutation checks and a guard-level audit. The documents that operate the code had never been executed once.

**Still outstanding and still only Garrett's to do:** the gcloud/ssh commands in Appendix A and §4a, the two RPC dry-runs (§E12, §E13). **Those are the last executable content nobody has run.**

**No code changed. Five in-place corrections. Both databases read-only — every organ was executed as a `SELECT`.**
