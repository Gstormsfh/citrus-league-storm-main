
## Entry 172 — Followed E171's failure mode through my own work. **§E8 — the section that tells Garrett how to choose the pick clock — was calibrated to my soak rig, not his draft. Every duration in it was ~75% too long.** Recalibrated, plus three contaminated claims in the morning brief.

**Why.** E171 was not a one-off arithmetic slip. It was a *mechanism*: I quoted my rig's configuration as the plan of record. **A mechanism that fired once has probably fired elsewhere**, and the honest response to a retraction is to look for its siblings rather than move on.

---

### The one that mattered

**§E8 — "How long the draft actually takes, and the clock decision that sets it."** Its whole purpose is to help Garrett pick `pickTimeLimit` before invites go out, which he is told is *"the single setting that determines what kind of evening it is."*

Every number in it was computed for **12 × 21 = 252 picks** — the size of `ada00018-…-01`, my soak rig. **§T-3d plans 12 × 12 = 144.**

| clock | what §E8 said | what it should say (12 rounds) |
|---|---|---|
| 30s | 2 h 06 m | **1 h 12 m** |
| 60s | 4 h 12 m, *"lobby will read 252 minutes"* | **2 h 24 m, lobby reads 144** |
| 90s | 6 h 18 m | **3 h 36 m** |

**Consequences if he had used it as written:** he would have believed a 60-second clock risked a 4-hour evening and chosen 30s to protect against it — a real decision, made on a worst case that was 108 minutes too pessimistic. **The advice would probably still have been right**, since a shorter clock costs little in real pace, but it would have been right by accident.

**The section's reasoning is untouched and remains correct** — owned seats burn the entire clock (60.9s measured vs ~2.4s ownerless), the lobby's estimate is `teams × rounds × clock` arithmetic rather than a forecast, and the realistic pace barely moves with the clock. **Only the arithmetic was wrong.** Both round counts are now shown side by side, with the planned one first.

**And one line in it became funny rather than wrong.** §E8 offered as advice: *"Fewer rounds is the other lever. 21 rounds at 12 teams is 252 picks. If the roster does not need 21…"* — **§T-3d had already pulled that lever before the advice was written.** It now says so, and quantifies it: choosing 12 over 21 takes **~1 h 48 m** off the 60-second worst case, at the cost of teams finishing 12 deep against a 21-slot roster. **That is the actual trade-off, stated once, in the place where the decision gets made.**

### Three more in the morning brief

The document Garrett reads first:

1. *"Saves 4 seconds on every pick, **252 times**"* → the planned draft has **144** picks.
2. *"the thing your twelve do **252 times** had never been measured"* → same; now phrased per-turn, which is the point anyway.
3. *"I ran **the real thing**: 12 teams × 21 rounds = 252 picks"* → **it was not the real thing.** It was a soak **larger** than his draft. Now labelled as such, with a note that the figures beneath it come from a longer draft than he intends to run.

**That third one is the most misleading of the three**, because it invites him to read every number in §⑥ — the drift, the memory profile, the render checks — as measured on his configuration. They were measured on a bigger one. **That makes them conservative rather than wrong**, which is the right direction, but he should know which way the error points.

---

### What this says about the night's evidence generally

**The performance and stability findings are unaffected and remain conservative:** 3ms drift across sixths, no memory leak over 252 picks, clean render at 48/252, ~30ms multi-client agreement. A 144-pick draft is a strict subset of what was exercised.

**What was affected was every number that describes *his* draft rather than *my* test of it** — durations, pick counts, event-counter expectations. Those are now either corrected or expressed as formulas.

**The general form of the error, for the record:** I built rigs at the product default, measured them exhaustively, and then let the rig's shape stand in for the plan's shape in prose. **Nothing in my method distinguished "the number I measured" from "the number he will see"** until E171 forced the distinction. Both documents now carry the round count as an input to a formula rather than as a constant, which is the only version of this that cannot drift again.

---

**No code changed. One runbook section recalibrated, three brief corrections. Both databases untouched for this entry.**
