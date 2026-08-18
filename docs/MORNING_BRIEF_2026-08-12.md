> # ⚠️ SUPERSEDED IN PART — read `docs/DEPLOY_2026-08-12_PICK_LATENCY.md` first
>
> Written overnight, before Garrett's 09:00 direction on pick latency. Two things below have since changed:
>
> * **Item #1 ("Write the roster sync", ~1 h) is DONE and live on staging.** Do not spend an hour on it. `sync_roster_assignments_for_league` is now v2-aware and a `draft_completed` trigger calls it. A 12×12 draft ran end to end and produced **144 roster rows across all 12 teams** with no intervention; the backfill took **1,302 of 1,302 teams** to matching counts. Committed as `supabase/migrations/20260812150000_…sql`.
> * **Item #4 ("Optional: deploy the API") is no longer optional-feeling.** The 8 s client timeout against a ~5.9 s response leaves ~2 s of headroom; losing that race rolls back a pick that actually succeeded. Still 10 minutes.
>
> **Added since:** the optimistic pick render — the drafted player now leaves the pool on click instead of ~2–6 s later. Needs the web deploy. Full web suite green at **1,814 tests**.
>
> Everything else below still stands. Receipts for the day: inbox **E182**.

# MORNING BRIEF — Wednesday Aug 12
**Architect, autonomous, overnight. 8 days to THE TWELVE (Aug 20/21), 5 to freeze (Aug 17).**
**Before you act on any of this: `docs/ACCURACY_LEDGER_2026-08-12.md` lists the three things I published tonight and then retracted, and separates the findings I *ran* from the ones I only *read*. The two levers in §①ᵇ are in the second category.**

**Reorganised around what you need to do, not the order I found things. Receipts: `docs/ARCHITECT_INBOX.md` E123–E181.**

---

# ① DO THESE, IN THIS ORDER

| # | What | Why | Who | Time |
|---|---|---|---|---|
| ~~1~~ | ~~Write the roster sync~~ **✅ DONE — live on staging, see banner** | A finished draft produced **no teams**. Fixed in the database (v2-aware sync + `draft_completed` trigger), certified at 144/144 rows. | done | — |
| **2** | **Deploy the engine** | The live engine drafts **5 goalies in 14 picks**, incl. a 4-game callup at #10 | you paste, it's written | 15 min |
| **3** | **Deploy web** (one deploy, six fixes) | timer, mobile nav, "Connection lost", league cache, board count, roster link | you paste | 10 min |
| 4 | *Optional:* deploy the API | Saves **4 seconds on every pick** — 144 of them at the planned 12 rounds | you paste | 10 min |

Commands for 2–4 are in **`docs/DEPLOY_2026-08-12.md`**, copy-paste, in order. It opens with a warning that they don't fix #1, and now has a **PRE-FLIGHT** section at the top: the tree is verified green (70/70, E163) and there are two two-minute dry-runs I need from you before Aug 20 (§E12 extend, §E13 pause/resume — the only two levers you have on the night, and neither has ever been executed).

**When you apply #1, verify it landed** — `PROPOSED_roster_sync_v2.sql` now ends with the two queries. I found one migration on staging that's recorded as applied but whose function body in `pg_proc` isn't what the migration defines (E155). One data point, on a function nobody calls, so not a broken pipeline — but checking costs one query and this is the fix everything else waits on.

**One amendment to #1, found at the end of the night:** the roster sync fixes **the roster**. It does *not* fix the stats blocks on `/roster`, `/standings` and the other-team page — those take a different route to the same question and read the **v1** pick table, so they'll still render every team at `0-0-0`, rank `-`, 0 points. **That's invisible until Sept 29** (pre-season, everyone really is 0-0-0) and it changes nothing about Aug 20 — but don't tick item #1 off as *finished* when it lands. Detail in `docs/V1_TABLE_CONSUMERS.md`.

---

# ①ᵇ TWO LEVERS YOU DIDN'T KNOW YOU HAD — 2 minutes each, before Aug 20

`draft_extend` is a finished, fully-guarded commissioner tool sitting in the database with **no button and no route**. It adds seconds to a running pick clock, the engine applies it **live**, and it's the correct response to the two most likely incidents on the night — the engine hiccupping, or somebody needing thirty more seconds.

```sql
SELECT public.draft_extend('<league-id>'::uuid, 60,
  '{"kind":"commissioner","id":"<your-user-uuid>"}'::jsonb);
```

**Update (E176): I ran all three on a rig — they work exactly as printed here, guard failures included.** So this is no longer *"unverified commands"*; it's *"the engine's live reaction to them is unverified"* — my rig had two seats and no engine attached. **Still worth two minutes on a throwaway league**, but it's now a smaller ask than it was.

**And you can PAUSE.** `draft_pause` / `draft_resume` are equally complete and equally unreachable. Nobody gets auto-drafted while paused, and a manager who tries to pick gets proper copy explaining why. **But the room never shows a paused state** — clocks run to 0:00 and sit there, so you have to say it out loud: *"I'm pausing; your clock will look stuck, nobody gets auto-picked."* Resume gives everyone a fresh full clock. §E13, and dry-run it with the other one.

**Why this is safe to run by hand when a manual undo isn't:** it appends an event the engine already consumes, rather than mutating a projection behind its back. Detail and the two behavioural gotchas are in §E12.

**And the reason it matters:** if the engine bounces mid-draft, the room shows a reconnecting banner while the clock keeps running — and when the engine returns it **immediately autopicks anyone whose deadline passed during the outage.** Extending during the outage is what protects them.

---

# ② WHAT'S BROKEN

### 🚨 A finished draft produces no roster *(E142 — not fixed, needs you)*

I walked `/roster` after a completed draft. It says **"Empty Roster — your roster will be populated after the draft is completed. Head to the draft room to start drafting!"** The draft *was* completed.

On staging, **1,177 of 1,188 teams with v2 picks have zero roster rows**. The 11 that do have rosters got them from the old v1 path. Production, which still drafts on v1, has 216 rows across 12 teams — exactly right.

Two causes, both verified in source: the sync functions read the old `draft_picks` table, and **nothing in the v2 engine calls them at all.** No scheduled job fixes it later.

**And it doesn't fail quietly — it congratulates you.** The league home page shows a DRAFT COMPLETE badge, a timeline entry reading *"⭐ Draft complete — Rosters are set"*, and a pulse line: *"12 of 12 teams in. Rosters set. Time to play."* All on a league where every roster is empty. Nobody reading that page has any reason to check. That's most of why this survived three days.

**The fix is written — and it was broken until 09:00Z**: `docs/PROPOSED_roster_sync_v2.sql`. I finally *ran* it against the live schema instead of trusting it, and it compared `text = integer` — `roster_assignments.player_id` is text, `draft_picks_v2.player_id` is **integer**, and the v1 function I copied verbatim compares text to text. It would have applied cleanly (plpgsql doesn't plan bodies until first call) and then errored the first time you ran it on a real league. **Corrected, and then actually run: the fixed predicate returns exactly 252 on the soak league, and the INSERT itself was executed against real v2 picks — correct rows, correct types, idempotent on re-run (E178).** **Everything except the DDL has now been run** (E178 + E179): both INSERT statements against real v2 picks, and the full control flow — branch selection, `GET DIAGNOSTICS` counts, return shape, exception handler — inside an anonymous `DO` block. **And the backfill's dry run is done too (E180): 109 leagues, 1,718 roster rows, all of it rig/fixture data — zero real user leagues — and the apply block's predicate matches the dry run exactly.** What's left unproven is only the `CREATE FUNCTION` statement itself (and with it `SECURITY DEFINER`), the backfill *apply*, and scale beyond 2 picks. I didn't run the apply: it mutates 109 leagues and that's your call. The same disease as E142 itself, reproduced inside the patch for E142. Detail: **E167**. Reviewed against the v1 original, with a scoped backfill (dry run first) and the two non-SQL steps. Two pieces of good news — the v2 version is *simpler* than the one it mirrors, and I chased the fallout to check it wasn't the first of several. It isn't: **nine tables look empty on staging, it's one root cause.** Lineups rebuild themselves from `roster_assignments`, so they self-heal the moment the sync lands.

### ⚠️ The "Reset Draft" button on your Profile page lies *(E151, corrected in E152 — one new thing to KNOW before Aug 20)*

There's no reset control inside the v2 draft room. There **is** one on **Profile / settings**, one per league you commission — which is exactly where you'd go if the first attempt at THE TWELVE went sideways.

It promises to *"permanently delete all draft data and reset the league to 'not started'."* On a v2 league it deletes **zero** picks, leaves `draft_picks_v2` and **the entire event log** intact, flips the status, and tells you **"Draft reset successful — you can now start a fresh draft."**

**You can't.** The league is left in a state the ignition code refuses by name — *"draft_status=not_started but draft_state=active (illegal combo)"* — and a second guard catches it too, because the reset deleted the draft order. **So nothing is corrupted and nothing is lost; that league just becomes unstartable, with no way back from inside the product.**

**On the night: if a draft needs restarting, make a new league.** Five minutes with twelve people on a call. If you press reset by accident, don't panic — the draft is still whole in the event log; move everyone to a new league and I'll recover the old one afterwards. Runbook **§E11**.

*(I first wrote that pressing START after this would corrupt the log. **That was wrong** — I'd read the reset function but not the start function. Corrected within the hour; E152. The correction is good news twice over: less damage, and the reason is that **`start_draft_v2` is the best-defended code in the product** — a double-tap on START emits nothing at all, concurrent presses serialize on a row lock, and there's a five-step guard taxonomy that had already anticipated this exact broken state. The one irreversible action of your night is the most carefully written thing I've read.)*

### 🚨 The engine drafts backup goalies *(E117/E118 — fixed, needs deploying)*

The live engine's first fourteen picks: MacKinnon, McDavid, Kucherov, Draisaitl, then **Wedgewood (G)**, **Fowler (G, 17 games)**, three skaters, **Trent Miner (G, 4 games) at #10**, Stone, **Blackwood (G)**. Any seat whose clock expires on Aug 20 picks from that list. Fixed and tested; sitting uncommitted.

### ⚡ Every pick takes 6 seconds to acknowledge *(E145 — fixed, optional deploy)*

I tested the *human* pick path for the first time — every draft all night was autopick, so the thing your twelve do on every single turn had never been measured. It's correct, but the pick is saved in **under 2 seconds** and the client isn't told for **~6**. The API awaits a Supabase Realtime broadcast on a channel with **zero subscribers**; with nobody listening the tenant shuts down, so every pick cold-starts it and hits a 5-second timeout. Your managers would see *"I clicked Draft and nothing happened"* every single turn.

*(It's also why the 2.1-second cadence I quoted all night looked so good — autopicks go through the engine and never touch that route.)*

### 🔴 Your player pool is six days stale, and the check that would have told you was broken *(E166)*

The T-60m go/no-go check — the one whose output decides HALT or POSTPONE an hour before twelve people arrive — compares `player_directory.season` to the string `'2025-26'`. **The column is an integer holding `2025`**, so the check has been erroring rather than reporting, which reads like a tooling problem instead of a data problem.

**Fixed it, ran it, and it fails on its own criteria:** 2,035 players, newest `updated_at` **2026-08-06 — six days ago**, against a rule that says stale > 24h → POSTPONE. Either the pipeline needs a run before Aug 20 or that threshold needs to match reality. **Player data is the other session's lane, so I flagged it in the runbook and touched nothing.** Same territory as E132 (the draft pool has no stats at all).

### 🚨 Your dry run would have passed a draft that produced no teams *(E170)*

`PRE_TWELVE_DRY_RUN.md` calls itself "the last acceptance gate before the run," and its checklist says *"All must be green — any red = HALT THE TWELVE."* **Every box on it is green during an E142 failure** — the event log, the engine logs, the completion flags and the replay are all correct when a draft records 252 picks and materialises zero rosters. It checked nothing downstream of the draft.

**Added:** a roster-row count that must equal `league_size × draft_rounds`, an instruction to open `/roster` as a participant and look, and a line requiring you to exercise §E12/§E13 on the dry-run league.

**And one correction I owe you (E171).** I also "fixed" that document's round count from 12 to 21 and was **wrong** — your runbook's §T-3d specifies **Rounds: 12** for THE TWELVE deliberately, *"one round per team, smallest possible real draft for the first live-human exercise,"* and 146 was the right event count for it. I assumed 21 because that's the product default and what all my soak rigs used. Both documents are restored to a **formula** — `1 + (league_size × draft_rounds) + 1` — with 146 and 254 both named, and an instruction to read the number off the league rather than trust any figure written down, mine included.

**So there's a real decision here, and it's yours:** 12 rounds is ~2 hours and leaves teams 12 deep against a 21-slot roster; 21 rounds is ~3.5 hours and fills the roster the league is configured for. Whichever you choose, the dry run must use the same one.

### ⚠️ There is no undo *(E150 — nothing to build before Aug 20; one sentence to say)*

A pick, once made, is permanent. Not hard to reverse — **there is no mechanism.** The commissioner panel isn't rendered in the v2 room, the `/undo` route runs the *v1* service against the old table and finds nothing, no database function can emit a `pick_undone` event, and **not one has ever existed across 115 drafts.** The engine knows how to replay an undo; nothing can create one for it to replay.

It's the **fourth** thing to break on the same v1/v2 table split — after the roster sync, the completion sync, and the manual `/sync` route. The v2 rail never inherited its commissioner tools, and each one fails silently rather than loudly. *(A fifth — the reset button above — turned up when I finally enumerated the whole class. See §⑤.)*

**Don't try a manual SQL fix on the night** — deleting from `draft_picks_v2` mid-draft desynchronises the running engine and turns one bad pick into a broken room.

**The whole mitigation is one sentence, said before the first pick:** *"Picks are final — there's no undo. Check the name before you hit Draft."* Every row in the player pool has its own Draft button and the table is dense; I mis-drafted **Jaromir Jagr** myself tonight by clicking the first row. Your friends will assume an undo exists because every other fantasy product has one — that assumption needs correcting out loud. It's rule §E10 in the runbook.

*(The real fix is scoped in E150 and belongs after Aug 20. The expensive half — the engine's replay handling — is already built and tested, and it turns out **so is the second half**: the projection trigger already handles the undo event. Only the RPC, a route and a button are left. E151.)*

# ③ WHAT'S FIXED AND WAITING — one web deploy

| entry | fix |
|---|---|
| **E121** | the clock reads true on the first pick (your 0:35-on-a-30s-clock) |
| **E123** | the mobile nav stops covering the bottom of the draft room on phones |
| **E124** | "Connection lost" before the draft starts → "Waiting for the draft to start" — and discovery failures finally back off instead of hammering at 1 Hz |
| **E126** | joining by code refreshes the league list immediately instead of lying for 30 seconds |
| **E129** | the board's total matches the league — no more "252 of 192 picks made" |
| **E133** | the completion panel's "View your roster" goes to the league you just drafted in |

Roughly 40 new tests, each mutation-checked (I revert the fix and confirm the right tests go red).

**Verified green on your machine at 08:30Z, against the exact tree you'll deploy (E163): 70/70 across all seven test files, `server tsc` clean.** One caveat worth ten minutes *after* Aug 20 — the first test in the server file flaked once in three runs (`returns 401 when Authorization header is missing`). It is not a regression: the route logged a correct 401 during the failing run, and two subsequent runs were 20/20. It looks like a cold-start race in `await getApp()`. **Not a reason to hold the deploy** — recorded so the next person seeing red doesn't have to re-derive it.

---

# ④ DECISIONS ONLY YOU CAN MAKE

**Where do the twelve draft?** Production has **zero** v2 schema — no tables, no functions, no engine. On the real domain they'd get the old v1 room. Recommendation: **staging**, with a custom domain if the URL bothers you (~15 min). Detail in `PROD_READINESS_GAP_ANALYSIS.md`.

**What eleven strangers see before they reach the lobby.** The arrival corridor works mechanically, but three cheap things sit on it, none implemented:

- **The auth page opens on "Welcome back."** The tab is hard-coded to sign-in, so first-timers land on a returning-user screen; if they type a password they'd *like* to use they're told *"That email + password combo didn't match."* Fix: default to signup **only** when the link carries a join code — not on any redirect, which would catch expired sessions. *(E148)*
- **89% of your real users are called `user_a1b2c3d4`** — 64 of 72 on production. The profile-setup screen exists but is gated behind a flag applied to zero routes. Your twelve would appear to each other as hex strings, including in the photo the app tells them to screenshot. Safest fix is to ask for a name *after* they've joined; enabling the gate naively would drop invitees' join codes. *(E146)*
- **An unsold ad placeholder** — *"YOUR BRAND HERE · REACH THOUSANDS OF FANTASY HOCKEY FANS"* — is live on `/matchup`. *(E147)*

**The lobby.** `DESIGN_LOBBY_CAMPAIGN.md`, L1–L7, propose-only. Two worth your attention: **L1**, collapse the three Draft Control buttons to one (only one of them starts a draft; the real button is the visually *quiet* one); and **L7**, confirm before starting below capacity — **pressing START permanently locks out anyone who hasn't joined**, and the lobby only warns you below *four* teams. Start at 11/12 and that person is out for good while their empty seat auto-drafts a full roster. Until L7 ships, the whole safety mechanism is reading "Teams joined: N/12" aloud. It's rule §E9 in the runbook.

**One security item, and my recommendation is NOT to touch it before Aug 20.** `append_draft_event` — the single write path for the entire draft event log — is `SECURITY DEFINER` with `EXECUTE` granted to `authenticated`, and has no authorization check in its body. Every guard that protects the draft (on-clock, ownership, player-taken) lives in the functions that *call* it. If an ordinary signed-in user can reach it via PostgREST, they could append a pick event to any league. **The fix is one `REVOKE` and breaks nothing** — nothing in the client calls it directly, only other `SECURITY DEFINER` functions do, and they already have EXECUTE as `postgres`.

**Why not now:** this is staging, the twelve are your friends, and it needs a hand-crafted RPC call mid-draft. Changing function permissions five days from freeze risks catching something the client *does* call and breaking the room, to prevent something that will not happen on the night. **Before Sept 8, though, it's a blocker.** Supabase's advisor flags 82 functions in this shape; the full pass is a week's work and the right shape is default-deny. Two ERROR-level lints on the dashboard are rig tables I created — `load1_timings`, `load1_leagues`, safe to drop. Detail and the exact `REVOKE`: **E156**, with the exploit bounded exactly in **E162** — which also found a cheap hardening worth doing at the same time: `draft_picks_v2` has no `UNIQUE (league_id, player_id)`, so nothing below the RPC layer prevents the same player being drafted twice.

**The join path needs one line before the beta, not before Aug 20.** `join_league_with_code` counts teams, checks capacity, then inserts — with no lock across those three steps, unlike `start_draft_v2`, which takes `FOR UPDATE` on the same table for the same reason. Concurrent joins can exceed capacity, and a join can also land microseconds *after* someone presses START, creating a member with no draft slot. **One `FOR UPDATE` fixes both.** Neither is likely on the night — the overflow needs a 13th person holding the code, and §E9 (read the count aloud before starting) already covers the second. It also hard-codes a 12-team cap when a league's settings lack `teamsCount`, which would make any non-12 league unable to start; that affects none of your real leagues. **E157.**

**Who fixes the missing player statistics.** The draft room's player list has **no stats at all** — every column zero, which is why retired players lead it. Diagnosed to the line and specified (E132), deliberately not implemented: it borders your other session's lane, and two of my own first recommendations for it turned out to be wrong.

---

# ⑤ THE ROOT CAUSE, NOW FULLY MAPPED *(E151 — read this before you plan the week)*

Five separate failures turned out to be **one divergence**, so I stopped fixing them one at a time and enumerated the whole class: every consumer of the old `draft_picks` table, 18 database functions and 6 application files. Register: **`docs/V1_TABLE_CONSUMERS.md`**.

**The two numbers:** across 112 snake leagues on staging, the old table holds **12** rows and the new one holds **1,716**. Eighteen functions read the first. **None reads the second.**

**The most important sentence in it: none of this is data loss.** `draft_events` is append-only and complete — every pick, every timestamp, every actor. All of these are *projection* failures, and every one can be repaired retroactively, from the log, on any date. **Nothing expires and nothing is lost by waiting until after Aug 20.**

**What it actually is.** Not v1-versus-v2 — **a split inside v2.** The auction path (`close_nomination_v2`) deliberately keeps writing the old ownership ledger, and says so in a comment: *"compatibility with the existing `draft_picks` shape."* The snake path doesn't. Every one of the five failures descends from that.

**Which points at a one-place fix.** Every v2 pick already flows through a single trigger on the event log. Teaching that one trigger to also write the old table repairs most of the register at once — no engine change, no API change, no client change — and it's exactly what the auction path already does. **Don't deploy it before Aug 20**: it touches the hot path of the one thing that must not break, for problems that don't bite on the night.

**And a decent amount of good news**, which is the other half of what a sweep is for: free agency isn't built on the broken table (it reads `roster_assignments`, so the E142 fix repairs it for free); account deletion works correctly; the scariest-looking function — an auto-recovery routine that "restores from `draft_picks`" — **isn't attached to any trigger and cannot fire**; and five functions I expected to matter are simply irrelevant rather than broken.

Two compliance items for the backlog, neither urgent: a user's data export omits all their v2 picks, and a deleted user's UUID survives in the event log if a league they played in outlives them.

---

### 🔧 Thirteen broken things in the documents you execute — all fixed *(E164–E172)*

Your runbook has carried a **pause-first doctrine** since v2 — §6d, referenced from the stalled-clock tree and recorded in Appendix D as a deliberate design decision. **The commands under it would all have errored.** The second argument is `jsonb` and must carry `"kind":"commissioner"`; it was written as a bare text string. `draft_resume` was called with one argument; that form doesn't exist. Four instances, two of them in the section headed *"copy-paste from here during draft night."*

It also claimed *"clients see the pause state."* They don't — clocks run to 0:00 and sit there. **All fixed in place**, with the announcement you need to make written into §6d itself, and `draft_extend` added to Appendix A where it was missing entirely.

**Nothing tests a runbook.** 1,031 offline tests and three rounds of review didn't catch this; the commands were written from the idea of the function rather than its signature. **Worth running every command in Appendix A once against a throwaway league before the 20th** — the log-tail and health-probe commands carry the same risk and the only way to know is to run them.

---

# ⑥ WHAT'S ACTUALLY IN GOOD SHAPE

I ran a **full-length soak**: 12 teams × 21 rounds = **252 picks**, end to end, room open throughout. *(Note, per E171/E172: that is the product-default 21 rounds — **larger** than the 12-round draft your §T-3d plans, which is 144 picks. Over-testing, not a mismatch, but the numbers below are from a longer draft than you intend to run.)*

- **Zero drift.** Split into sixths, the mean gap between picks was 2.1052 / 2.1045 / 2.1030 / 2.1054 / 2.1062 / 2.1032 seconds — **a 3-millisecond spread across the whole draft.** Worst single pick out of 251: 2.203s.
- **No memory leak** — heap 19→26 MB oscillating, ~4 DOM nodes per pick, over 252 picks.
- **Three tabs on one draft agreed on every pick to within ~30 ms**, including two that were backgrounded.
- **The completed room renders clean** at 48, 252, and everything between.
- **Commissioner click → live room in under 2 seconds**, every call a 200.
- **The v1 fence works**, mid-draft reload comes back correct, History renders all 252 rows, standings and matchup have proper empty states, and the league dashboard is the best-looking screen in the product.

The engine, the event log and the corridor are sound. **Everything I found was in the client, the copy, or the step after the draft** — which is where the risk should be, five days from freeze.

**One thing I could not test:** a genuinely interrupted WebSocket. Page script can't kill a real socket and there's no network-emulation tool here. The logic is unit-tested and mid-draft reload works, but that's the largest gap in what I've proven. **Thirty seconds of airplane mode on a phone during your dry run closes it.**

---

# ⑦ WHERE EVERYTHING IS

| file | what |
|---|---|
| `docs/DEPLOY_2026-08-12.md` | copy-paste deploy sheet, in order |
| `docs/PROPOSED_roster_sync_v2.sql` | the roster fix — review, don't run from here |
| `docs/V1_TABLE_CONSUMERS.md` | **the full root-cause register — 18 functions, 6 files, classified** |
| `docs/ACCURACY_LEDGER_2026-08-12.md` | **what I got wrong tonight, and which findings were executed vs. reasoned — read §① before acting** |
| `docs/ARCHITECT_INBOX.md` | 181 entries; tonight is E123–E181 |
| `docs/V2_PORT_GAP_REGISTER.md` | 11 things the v2 port dropped, ranked |
| `docs/DESIGN_LOBBY_CAMPAIGN.md` | L1–L7, propose-only |
| `docs/DESIGN_DRAFT_STATUS_SPLIT.md` | the two state columns, + a confirmed defect |
| `docs/RUNBOOKS/THE_TWELVE_DRAFT_NIGHT.md` | v4 delta §E1–E13: pre-flight, expected numbers, what will look alarming but is fine |
| `docs/NIGHT_ARC_2026-08-11.md` | the three-day story, if you want the narrative |

**Six real drafts ran overnight — 480 picks.** A rig league is armed on staging (`ada00015-…-01`) so your **next engine restart proves the boot-scan resume path for free** — watch the boot log for `resumed > 0` and send me that line. Don't join or start that one.

*Nothing touched production. Every production query was read-only.*
