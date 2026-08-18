# ACCURACY LEDGER — the night of Aug 11/12
**What I got wrong, what I retracted, and which findings you can lean on.**
Written 2026-08-12 by the architect. Covers inbox E123–E173.

You are about to act on ~50 entries written by an agent working unsupervised for ten hours. **Three of those entries were wrong and published before I caught them.** You cannot derive that from the inbox at 6am, so it is here in one place.

---

# ① THE DISTINCTION THAT MATTERS MOST

**"I ran it against staging" and "I read the source and concluded" are not the same claim.** I have tried to label which is which throughout, but here it is explicitly.

### Verified by execution — I ran this, and it produced the result quoted

| finding | what was executed |
|---|---|
| **E142** a finished draft produces no roster | SQL: 1,177 of 1,188 teams with v2 picks have zero `roster_assignments` |
| **E145** human picks cost 5–6s | measured from the page's own performance timeline, twice |
| **E151** the v1 `draft_picks` consumer class | SQL over `pg_proc` — 18 functions, none reading `draft_picks_v2` |
| **E155** the autopick safety net never ran | SQL: `draft_metrics` is empty; `cron.job` holds one unrelated entry |
| **E156** `append_draft_event` is grantable to `authenticated` | SQL: `has_function_privilege` + Supabase's own advisor |
| **E162** the validator is shape-only | read in full + constraint queries on `draft_picks_v2` |
| **E163** the deploy tree is green | 70/70 tests actually run on your machine; `server tsc` exit 0 |
| **E166** four runbook SQL organs error | **executed — they returned real Postgres errors** |
| **E167** the E142 fix compared `text = integer` | **executed — real error; corrected predicate then returned exactly 252** |
| **E168 / E169** which migrations are unapplied | SQL, verified **by effect** rather than by the migration ledger |
| **E117/E118** the goalie fix | unit tests + mutation checks (revert the fix, confirm the right tests go red) |
| **E176** all three commissioner levers | **executed on a rig** — extend +60s exactly, pause NULLs the deadline, resume gives a fresh clock; both documented guard failures reproduced |
| **E177** the engine is live and obeys them | **observed** — a SQL-only ignition produced autopicks; a paused draft held **52s past its deadline with zero picks**; resume re-armed and it fired |
| **E178** the corrected E142 INSERTs | **executed against real v2 picks** — right rows, `integer→text` intact, team attribution correct, idempotent on re-run |
| **E179** the E142 function's control flow | **executed in a `DO` block** — both branches, `GET DIAGNOSTICS` counts, return shape, exception handler never hit |
| **E180** the E142 backfill's blast radius | **dry run executed** — 109 leagues, 1,718 rows, **zero real user leagues**; apply predicate matches the dry run |

### Reasoned from source — I read the code carefully and did not run it

| finding | why it wasn't executed |
|---|---|
| **E152** `start_draft_v2`'s guards | would have required forcing a broken league state |
| **E154** the human-vs-autopick race is defended four ways | would have meant racing a live engine to prove what four layers of source already state |
| **E161** a paused draft survives an engine restart | I cannot restart the engine from here. *(E177 did confirm the live engine honours a pause — but not across a restart.)* |
| **E156's reachability** | the probe was blocked by a safety guardrail and I did not route around it — **reachability is asserted by Supabase's advisor, not demonstrated by me** |

**UPDATED THROUGH E180.** The caveat this section was written to carry is **gone**. All three RPCs were executed (E176) and the **live engine's reaction to them was observed** (E177): a paused draft sat 52 seconds past its clock with zero picks, and resume re-armed it. **§E12 and §E13 are verified at every layer — RPC, event, engine.** Their dry-run instruction is now an optional rehearsal, not a check.

**Item #1 has moved almost as far.** The E142 fix has been executed at every level except the DDL: the corrected predicate (E167), both INSERT branches against real picks (E178), the full plpgsql control flow (E179), and the backfill dry run (E180). **What is still unrun: `CREATE OR REPLACE FUNCTION` itself and with it `SECURITY DEFINER`/`search_path`, the backfill apply, and scale beyond 2 picks.**

**What genuinely remains yours** — each checked rather than assumed: the **gcloud/ssh** commands (`gcloud` is not installed here and I have no credentials), the **deploys**, **DDL**, the **backfill apply** (it mutates 109 leagues and is not undone by re-reading), the **12-vs-21 round decision**, and the **player pipeline** (another session's lane).

---

# ② WHAT I PUBLISHED AND THEN RETRACTED

**Three entries were wrong. All three were corrected within the same night, in place, with the correction left visible.**

### 1. I said a broken reset could corrupt your event log *(E151 → retracted in E152)*

**Claim:** pressing START after the Profile page's broken "Reset Draft" would append a second `draft_started` onto a log holding a finished draft.

**Truth:** `start_draft_v2` refuses that exact state by name (`draft_state_not_startable`), and a second guard catches it anyway. **The log can't be polluted.**

**Cause:** I had read `nuclear_reset_draft` and the projection trigger, and inferred the third function's behaviour instead of reading it. **The reset button still lies — it reports success and makes the league unstartable — but the damage is contained.**

### 2. I "corrected" your round count and was wrong *(E166 + E170 → retracted in E171)*

**Claim:** THE TWELVE is 12 × 21 = 252 picks, so `draft_event_counter = 146` was wrong and should be 254; and the dry-run plan's *"Rounds: 12 (matches THE TWELVE)"* was a defect.

**Truth:** your runbook §T-3d specifies **12 rounds**, deliberately — *"one round per team, smallest possible real draft for the FIRST live-human exercise."* **146 was right. The dry-run plan was right.** I was scathing about a correct document.

**Cause:** `createLeague` defaults to 21 rounds and every rig I built inherited it. **I verified against my own test data and never checked your plan.**

### 3. Your pick-clock table was calibrated to my test rig *(found and fixed in E172)*

**§E8 — the section that helps you choose `pickTimeLimit`** — quoted worst-case durations for 252 picks. For the planned 144 they were **~75% too long**: a 60s clock read as a 4-hour evening when it is 2h24m.

**Cause:** same as #2. The reasoning in §E8 was sound; only the arithmetic was mine.

### Also worth knowing

- **E153 was a rediscovery, not a discovery** *(E168)*. The `draft_state` fix I recommended was already written on Aug 8 — migration, rehearsal gate, rollback capture, backfill — sitting unapplied, and its header contains the same enumeration I presented as new.
- **E159's "complete" inventory was short by two** *(E160)*. I called a table complete without enumerating from the authority.

---

# ③ FOUR TIMES MY OWN TEST DATA IMPERSONATED A DEFECT

Staging is ~98% leagues I created. Each of these looked like a product bug and was mine:

| looked like | actually |
|---|---|
| `league_scoring_rules` empty on every league *(E119)* | I built rigs with raw SQL instead of the create-league flow |
| four `draft_started` events on one league *(E152)* | my own LOAD1 contention rig, raw-inserted |
| two ERROR-level security lints on your dashboard *(E156)* | `load1_timings` and `load1_leagues` — my load-test tables |
| 112 of 114 leagues missing `settings.teamsCount` *(E157)* | 111 of them are my rigs; the product path writes it correctly |

**The fourth nearly became a headline** claiming every league in the product runs on a hard-coded 12-team cap. Opening `LeagueService.createLeague` killed it.

**And the pattern outran the rule.** After E157 I wrote *"never quote a statistic over staging leagues without checking what fraction I created"* — then in E171 quoted a **configuration** from one. The rule was too narrow.

---

# ④ WHAT I CAUGHT BEFORE PUBLISHING

Listed because it shows where the process worked, and because each is a class you may see me hit again:

- **Two latency numbers retracted before use** — 13.8s and 9.9s, both artifacts of my own tool round-trips rather than the product. Fixed by measuring from the page's clock.
- **Three "one-line fix" claims killed by opening the line** — no FK between `player_directory` and `player_season_stats`; `nhl_*` vs plain stat families disagreeing on 738 of 1,066 rows; `setActiveLeagueId` being a full league-switch ceremony.
- **One key-name near-miss** — I read `picked_by_actor->>'userId'`, got null, and was one query from reporting "the ledger doesn't record who picked." The key is `id`.

---

# ⑤ HOW MUCH TO TRUST THE REST

**Lean on, without reservation:** everything in §① under *verified by execution*. Those were run and produced the quoted results.

**Lean on, with the caveat named:** the source-read findings. They are careful reads of well-written code, and where I could cross-check them against data — no `pick_undone` event in 115 drafts, `draft_metrics` empty, three event types ever written — the data agreed. **But E152 is proof that reading three functions and inferring the fourth produces confident, wrong answers.**

**No longer applies:** the *"do not lean on until you have run them"* warning about `draft_extend`/`draft_pause`/`draft_resume` — they were run, and the live engine was observed obeying them (E176/E177).

**My error rate, stated plainly: three published errors across roughly fifty entries, all self-caught and corrected the same night, none of which reached your hands as an instruction you acted on.** Two came from the same cause — trusting my own rigs over your plan. That is the specific way I am most likely to be wrong again, and it is worth your scepticism whenever I quote a number about *your* draft rather than about *my* test of it.

---

*Nothing in this ledger changes the priority order in the morning brief. E142 is still first.*
