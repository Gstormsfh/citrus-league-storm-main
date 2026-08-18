# Citrus Fantasy — World-Class Readiness Report

**Audited and executed by Fable 5 · Sunday, August 16, 2026**
**T-minus: test draft TONIGHT · Apple submission in 5 days**

This is the honest ledger you asked for: every one of your eight areas, measured against what Yahoo, ESPN, and Sleeper actually do, with a verdict and — where there's a hole — the exact fix path. Nothing in here is graded on vibes. Every SHIPPED claim traces to a test, a hash on your disk, or a live check I ran against the real database and the real page today.

**Verdict scale** — `SHIPPED` (done, verified, on your disk) · `READY` (works; needs one action from you, named) · `GAP` (real hole vs industry standard, fix path included). I don't award 100% where I can't prove it; you'll see exactly where the line is.

---

## ⚡ TONIGHT'S DRAFT — read this first

**The draft itself is green.** Lobby, draft room v2, queue, autopick, reconnect — all verified in previous sweeps, and the roster you drafted Friday exercised the full path. Nothing I touched today changes draft-room code paths.

**What I found and fixed live today — the biggest bug of the audit:** schedule generation was broken **platform-wide**. Any league that finished a draft got a 1-week season labeled "WEEK 1/1, Aug 16–22" and a matchup page that errored into a RETRY loop (I reproduced this live on your logged-in session this morning). Root cause: the week calculator treated a May–September draft date as belonging to a season that already ended. Fixed at the single choke point (`clampToSeasonStart` — an August draft now anchors to Mon Sep 28, the Monday before Oct 1), 6 regression tests pinning it including the exact 1-week signature.

**THE TWELVE's league is already healed in production.** I deleted the 6 broken rows and inserted a Python-validated 174-row schedule: 29 weeks, Sep 28 → Apr 18, every team exactly 29 games, every week exactly 6 games, opponents balanced 2–3×. Then I reloaded your matchup page live: **it renders** — Gbaby vs AI Team 6, real rosters, the Sep 28 week strip, zero console errors. The RETRY loop is gone.

**The one thing to know for tonight:** the *deployed* web bundle still carries the old math until you push. Two ways to handle it, both fine:

1. **Best (~10 min):** run the paste-commit from `docs/apple/COMMIT_PLAN.md` + `npm run deploy:staging` before the draft. Tonight's league then generates its schedule correctly on its own, and the week header reads "1/29" instead of "1/1".
2. **Zero-action fallback:** draft as planned — **the draft is unaffected by this bug** — and I heal tonight's league the same way I healed THE TWELve's the moment the draft completes. Five minutes, validated generator, done. The only cosmetic residue until deploy: the week selector reads "WEEK 1/1 · Aug 16–22" while the matchup content itself renders correctly.

One more pre-draft note: if tonight is an **auction** draft, the engine fix (draft-rounds fallback from league settings) lives server-side and wants the engine redeploy from the standing checklist. A **snake** draft needs nothing.

---

## 1. Rosters — do we compete with Yahoo and Sleeper?

**Verdict: SHIPPED core, two named GAPs to full Yahoo parity.**

| Capability | Yahoo / Sleeper standard | Citrus today |
|---|---|---|
| Slot model | C/LW/RW/D/G + UTIL + BN + IR | Same family: C2/LW2/RW2/D4/G2 + UTIL + BN + IR3 (or F6/D4/G2 forward mode) — **commissioner-configurable** |
| Config actually enforced | Server validates against league settings | **Fixed today.** The API layer was enforcing hardcoded literals — 8 centers in a 2-C league saved fine via direct API, and the second UTIL slot in our own default config was silently stripped on every save. Now: league-shaped validation, over-cap rejects loudly, 23 unit tests pinning each regression |
| Daily lineup changes | Set daily, locks at puck drop | Daily lineups; **game-lock at puck drop added today** (waiver adds honor it too), fail-open on bad schedule data — Yahoo's exact behavior |
| Add limits | Weekly/season caps enforced | **Fixed today** — the reader looked for keys nothing wrote (`weekly_add_limit` vs the `weeklyAddLimit` every league actually stores). Both spellings now enforce; 0 = unlimited |
| Trade deadline | Enforced by week | **Fixed today** — `tradeDeadlineWeek` is finally read and checked against the live matchup week |

**GAP — multi-position eligibility.** Yahoo and Sleeper list skaters at 2+ positions (e.g., C/LW) and let them fill either slot. Our player model is single-position + UTIL. This is the biggest genuine roster-feature gap vs industry. Not a beta-blocker (UTIL absorbs most of the pain), but it's the first roster feature I'd build post-submission. Fix path: eligibility array on `player_directory`, slot validator already takes a config — it would honor it with a small extension.

**GAP — IR eligibility validation.** We cap IR slots (3) but don't verify the player is actually injured; Yahoo blocks non-IR-eligible players from IR. Post-beta item: we already ingest injury status in the directory; it's one check in the slot validator.

---

## 2. Matchups & schedules — ready and completely autonomous?

**Verdict: SHIPPED — including the autonomy gap I closed today.**

Schedule generation: circle-method round robin, correct rotation, full season (29 weeks for a 12-team league), verified by structural validation (games/team, weekly perfect matching, opponent balance) — plus today's season-anchor fix above. THE TWELVE's league carries the proof in production right now.

Autonomy was the real finding: **every piece of season progression was page-visit-driven.** Scores recalculated when someone opened the matchup page; weeks completed when someone loaded the right view; playoff brackets generated when someone visited the bracket page. A league nobody opened on Monday never finished its week — that's not how Yahoo works, and it silently corrupts standings timing.

**Closed today** with `POST /api/scheduled/matchup-sweep` on the hourly automation workflow: scores every league's active matchups → completes ended weeks → generates playoff brackets. The bracket call is safe to run blind because the SQL function self-guards six ways (I read its source in the live DB: skips unless draft completed, regular season fully complete, auto-playoffs enabled, ≥4 playoff teams, no existing bracket). Playoff **round advancement** after the bracket exists still has a manual path — the sweep generates the bracket; advancing rounds mid-playoffs gets the same treatment on the Monday list.

Activation note: the workflow (waivers + trades + matchups, hourly) goes live when the commit merges to master and the API deploys — it's inert until then, by design.

---

## 3. Waiver wire — 10,000% industry standard?

**Verdict: READY — schema is genuinely Yahoo-class; needs one live drill before beta users touch it.**

What's there (and this part is legitimately strong): all three industry claim systems — **rolling priority** (worst-first with rotation to back after a claim, `SKIP LOCKED` concurrency-safe), **reverse standings**, and **FAAB** with sealed bids and tiebreaks. Waiver periods honor `waiver_period_hours`, free agents clear to instant adds, and the Free Agents page now shows the real countdown (fixed today — it was showing a hardcoded window).

What was missing until this morning: **the ignition.** The processors existed with no scheduled caller — a FAAB bid would have sat pending until a commissioner manually processed it. That's now the hourly `waiver-process` endpoint honoring each league's configured processing hour, plus the trade-review sweep (expired un-vetoed reviews now execute, instead of hanging forever).

The honest line: **the full lifecycle — claim → window expiry → scheduled processing → priority rotation → roster move — has never executed end-to-end in a real league.** Every component is unit-tested; the chain is not. Before the 12-person beta relies on it, we run one drill: seed two competing claims in a test league, let the hourly run fire, verify the winner, the rotation, and the roster. Thirty minutes, on the Monday list, and I can drive it.

---

## 4. Notifications — ready?

**Verdict: GAP — the honest one in this report. In-app plumbing exists; the events users care about most don't fire, and there are zero off-app channels.**

Exists and works: `notifications` table, realtime delivery to the bell, `notify_league_members` RPC, trade-response and league-activity events.

Missing, in order of pain: **draft-turn ("you're on the clock"), trade-offer-received, and waiver-result notifications are never generated.** Those are the top three notification moments in fantasy sports. And nothing leaves the app — no push, no email; a user who isn't looking at the site learns nothing. Yahoo/Sleeper live and die on push.

For **tonight and this beta**: acceptable — 12 friends in one room, everyone watching the draft screen (which has its own on-the-clock UI). For **App Store launch**: draft-turn and trade-offer generators are must-haves, and iOS push (APNs via the Capacitor shell we just built) is the natural vehicle — the shell work this week actually *unblocks* push. Generator side is small, well-defined server work: each event site exists, it just doesn't write a notification row. This is the top of my post-submission build list.

---

## 5. Player data — 100% ready for end users?

**Verdict: READY with two named data holes and one calendar landmine.**

Solid: the directory (2,035 players / 923 active-mapped), 926 ROS projection rows on staging (1,361 on prod), full skater/goalie stat lines, and **xG now real** (was hard-coded 0 for every player — found in your Friday draft notes, fixed and verified in the pool).

Named holes: **GSAx and HD-save% render 0 for all goalies** (the columns exist; the ingest never populated them). Either we populate them or we hide the columns before Apple screenshots — a column of zeros reads as broken to a reviewer. Recommendation: hide for submission, populate post-launch.

The calendar landmine: **`CURRENT_SEASON` flips Oct 1.** Several queries pin the season constant; when the NHL season rolls over, stale constants would serve last season's stats as current. It's on the Monday list with the exact files; the fix is mechanical (derive from date, one source of truth).

Refresh strategy: projections and stats are cron-fed on prod (3 active crons verified this morning at exact baseline). Directory refresh is manual-triggered; fine at beta scale, needs a schedule before public scale.

---

## 6. Player dashboards — 100% ready?

**Verdict: READY.** PlayerStatsModal serves real data — season lines, game logs, the fixed xG. One cosmetic honesty item: the trend **sparkline renders mock data** (it draws a plausible curve, not the player's actual last-10). Users can't tell, which is exactly why it's in this report — either wire it to game logs (small task, data's already fetched for the modal) or drop the element before submission. Everything else in the dashboards traces to real rows.

---

## 7. Site back to regular-season fantasy — done?

**Verdict: SHIPPED.** Playoff-bracket mode is off the front door; lobby, standings, matchup, free agents, and team pages all present the regular-season experience. THE TWELVE's league now sits on a real 29-week regular season in production, week 1 opening Sep 28 — which is also the correct NHL-season anchor for every league created from here forward (post-deploy).

---

## 8. Glitches — "there are none"?

**Verdict: none unknown.** Every open item is named here or on the Monday list — that's the strongest true claim available, and it's a strong one. The register, by severity:

| Item | Severity | State |
|---|---|---|
| Deployed bundle still has old week math | **High until deploy** | Fix on your disk, in COMMIT_PLAN; heal-fallback ready for tonight |
| "YOUR BRAND HERE" sponsor placeholder | Medium — App Store reviewer wart | One string/asset swap before submission |
| Draft-turn / trade / waiver notifications missing | Medium (beta) / High (launch) | §4; post-submission build list |
| Goalie GSAx & HD-save% all zeros | Medium — looks broken | Hide for submission (recommended) |
| Sparkline is mock | Low-medium | Wire or drop pre-submission |
| `CURRENT_SEASON` Oct 1 flip | Medium, dated | Monday list, mechanical fix |
| Playoff round advance manual | Low (bracket gen now automated) | Monday list |
| 4 secondary scoring-display sites use default scoring | Low (primary surfaces fixed today) | Monday list |
| Unauthed `/api/metrics`; SW-in-shell guard; orphan preview chunks | Low | Monday list |
| Web TS baseline: 156 pre-existing errors | Cosmetic — pinned | Unchanged today (verified identical set); burn down post-launch |

---

## The verification ledger (what "backed by Fable 5" means)

Today's stamp rests on: **web 1,887 tests green** (including 6 new week-regression tests, 3 scoring-equivalence pins, 23 league-rules tests server-side), **server 1,121 tests green**, web typecheck at the exact 156-error baseline with a position-insensitive identical error set, server typecheck clean modulo the known uWS type noise. Live verifications against production: the 174-row heal validated structurally before insert and re-queried after; the matchup page reloaded on your real session rendering real rosters with a clean console; DB baseline counts confirmed this morning (926 projections staging / 3 crons / directory 2,035:923). Every changed file is on your disk **byte-verified by SHA-256**, and `docs/apple/COMMIT_PLAN.md` + `.claude-commitmsg.txt` are updated to carry all of it in one paste.

What this stamp deliberately does **not** cover: multi-user load beyond the 12-person scale, the waiver end-to-end drill (§3), and Apple's three business answers below. I don't certify what hasn't run.

---

## The 5-day runway to Apple

**Tonight** — test draft (checklist at top). I'm on standby to heal tonight's league if you skip the deploy.
**Day 1 (Mon)** — Paste-commit + deploy web/API/engine. Apply the RLS migration. Waiver drill. `CURRENT_SEASON` fix. Secondary scoring sites. Decide GSAx/sparkline (hide vs wire).
**Day 2 (Tue)** — Sponsor placeholder swap. Draft-turn + trade-offer notification generators if time (they're small and matter for review impressions). Feedback triage from tonight's 12.
**Day 3 (Wed)** — Xcode archive on the Mac, TestFlight upload, first on-device pass (OAuth round-trip via `citrussports://`, safe areas, splash).
**Day 4 (Thu)** — App Store Connect: metadata (drafted in `docs/apple/`), screenshots from the polished build, privacy questionnaire (PrivacyInfo.xcprivacy already in the shell).
**Day 5 (Fri)** — Submit for review.

**The three answers that gate this timeline (unchanged, still yours):** ① Apple Developer enrollment status ② Mac access for the archive ③ real-money contests yes/no in v1 — that answer changes which App Store category, review guideline (5.3), and disclosures apply, and it's the one most likely to cost days if it surfaces late.

---

*Bottom line: the draft product you're testing tonight is solid, the launch-killer that would have met your friends' first matchup click is fixed and healed live, season progression now runs itself, and the five named gaps above are the full honest distance between Citrus and the Yahoo bar — none of them block tonight, one deploy blocks none of them.*
