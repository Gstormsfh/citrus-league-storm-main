# Citrus Launch Audit — Session Report, Aug 22 2026

**Scope:** Continuation of the 100%-eyes-on feature audit ordered for iOS submission. Everything below was executed live against prod (citrusfantasysports.com) in Chrome, as Gstorms in the DACOSTA! test league, with every UI action cross-verified in the prod database.

**Deploy status: ⏳ still waiting on your push.** Prod bundle is still `assets/index-Co5U1JAl.js` (checked 4× today, last 17:40 UTC) and the API still runs the old lineup-save code. The lineup silent no-op fix, the Auction/Keeper "Coming soon" gates, and their eyes-on re-verification remain **blocked on the push** (command is in the previous report — one `git add -A; git commit; git push` ships server + web together).

---

## 1. Proven today, eyes-on (all deploy-independent)

### Trade offer lifecycle — every path now proven end-to-end via the real UI

| # | Flow | UI evidence | DB evidence (prod) |
|---|------|-------------|--------------------|
| 1 | **Propose** (Trade Center → partner select → player select → Submit) | "Trade Proposed — your offer has been sent" toast; offer card in *Offers Sent*, badge PENDING | `trade_offers 326d8b95…` `status=pending` @ 17:28:42Z |
| 2 | **Cancel** (proposer) | Offer moved to Trade History, badge CANCELLED | same row `status=cancelled` @ 17:29:12Z |
| 3 | **Reject** (recipient, incoming offer w/ message) | *Offers Received* card rendered the offer message + ACCEPT / REJECT; after reject → history badge REJECTED | `a28f2233…` `status=rejected`, `processed_at` @ 17:31:10Z |
| 4 | **Multi-player 2-for-2** ("crazy shit" item) | Proposed via UI: Brady Tkachuk + Matthew Tkachuk ⇄ Colten Ellis + Jacob Fowler; history shows ACCEPTED with both names per side | `b276dfed…` pending @ 17:33:11Z → review-clock fast-forwarded → `process_expired_trade_reviews()` returned **approved** → all **4 players swapped teams** in `roster_assignments`, roster counts intact (13/14) |
| 5 | Review-clock **approve** + **veto** sweeps | (proven earlier today — rosters moved on approve, untouched on veto, `vetoed_at` stamped) | prior session, unchanged |

The Trade History panel now displays the complete status taxonomy in one screen: **ACCEPTED / REJECTED / CANCELLED / VETOED** — screenshot attached (`trade history`).

### Drop Player — previously blocked, now proven end-to-end
The native `confirm()` dialog that froze this flow yesterday can be bypassed under automation (dialog pre-stubbed), so the actual drop path is now verified: Celebrini modal → **DROP PLAYER** → `POST /api/waivers/…/drop-player` returned 200 → `roster_assignments` 13 → **12**, Celebrini removed, and a `player_waiver_status` row created (`dropped_at` 17:43:03Z, dropped by Gstorms, not cleared) — i.e. dropped players correctly enter the **48h waiver window** rather than becoming instant FAs. League Activity posted "PLAYER DROPPED — Gstorms dropped Macklin Celebrini" within seconds. **Add → claim → award → drop → re-enter waivers: the full player-movement loop is closed.** (The `confirm()` → in-app dialog swap stays on the backlog for webview polish; the flow behind it works.)

### Transactions tab (Roster page)
Renders a clean ledger with type chips and MT timestamps: today's **DROP** (Celebrini 11:43 MT), **8 TRADE rows** (both Tkachuks, Ellis, Fowler — 11:33 MT), **CLAIM** (Celebrini 11:16 MT), all `processed` — screenshot attached (`transactions tab`). Trades **do** appear here, which narrows finding E below.

### Matchup system
- **Schedule generation works**: DACOSTA! got a full, correct 27-week schedule (Sep 28 2026 → Apr 4 2027, one matchup/week for 2 teams, week 1 has both teams). Verified in `matchups` table.
- **Matchup page renders**: Gstorms vs Team 2, 0.0–0.0, 50% win probability, Sep 28–Oct 4 day strip, my skaters (MacKinnon, McDavid) with projections — screenshot attached (`matchup page`).
- **Reload is stable**: matchup row IDs and `created_at` unchanged across reloads — no destructive rewrite on revisit (I explicitly checked for this; see finding A for the first-visit problem).

### Waivers
- Waiver Wire page: priority **#2 of 2** (correct — I'm last after winning the most recent claim), settings render (2:00 AM MT process, 48h period, game lock ENABLED), Active Claims correctly empty, Recent Activity = 2. Claim → limit-enforcement → award lifecycle was proven in the prior session.

### Other pages eyes-checked clean today
League HQ (Stormy, quick links, timeline), GM Office (command stack, actionable insights, waiver priority card), Standings, Free Agents (Celebrini add @ 17:16Z verified in DB), League Activity feed updating in real time (add/drop/waiver entries appear within seconds).

---

## 2. New findings (ranked, none are ship-blockers — but read A before launch)

**A. Every league's FIRST matchup-page visit shows a false error — `medium`, launch-visible.**
DACOSTA! had no schedule until I opened the Matchup tab: the *client* generated all 27 weeks on that first visit (`created_at` = my page-load time), but the same page-load then failed to find the row it just created and rendered **"No matchup found for week 1. The matchup generation may have failed. Please try refreshing the page."** with a RETRY button. A plain reload showed the matchup perfectly. Since every new league takes this path, every league's commissioner will likely see this error once during launch week and think matchups are broken — the copy says exactly that. Cheapest fix: after generation, re-query with the schedule's own week resolution (or just auto-reload once); also soften the copy ("Setting up your season schedule…").

**B. Schedule creation is client-initiated and client code contains delete-all-matchups repair paths — architecture flag, post-launch.**
`Matchup.tsx` generates the schedule from the browser of whichever member first opens the page, and two recovery branches call `deleteAllMatchupsForLeague` + force-regenerate if a read looks inconsistent. Today the happy path held (no destructive rewrite on reload), but mid-season a transient read anomaly on one member's browser could wipe/regenerate a live schedule. Recommend (post-launch): generate the schedule **server-side at draft completion**, and make delete/regenerate a commissioner-only server action.

**C. Pre-season week math uses the calendar, not the schedule — `small`.**
GM Office banner says "NEXT MATCHUP: VS. TEAM 2 (STARTS IN 1 DAY)" and the Matchup header chip says "WEEK 1/1 · Aug 23-29" — both derived from *today's calendar week*, while the actual week 1 is Sep 28 (which the page body shows correctly). The Roster page's own selector gets it right ("WEEK 1/27"), so the correct week list exists — the Matchup header and GM banner just aren't using it. Purely display, but it contradicts correct data on the same screens.

**D. League HQ timeline shows raw IDs — `small`.** "Gstorms added Player #8484801" instead of "Macklin Celebrini." The League Activity sidebar resolves names correctly; the HQ "The league, lately" timeline doesn't.

**E. Trades appear in the Transactions ledger but never in League Activity / HQ timeline — `small`, refined.** The Roster → Transactions tab lists every trade correctly; the real-time League Activity feed and HQ timeline post adds/drops/waivers but no trade entries (confirmed again today for both UI-proposed and sweeper-executed trades). So it's a missing activity-feed event, not missing data. Also: each traded player renders **two identical rows** in the Transactions ledger (both Tkachuks, Ellis, Fowler each ×2) — looks like one row per trade side without dedupe.

**F. Player modal stat mixing — `small`.** Wedgewood's modal showed W **31** / GAA 2.02 / SV% 92.1 alongside GP **0** / SV **0** / SO 0 — projections and actuals blended in one grid.

**G. Absentee teams start with a mostly-empty lineup — product gap, post-launch.** Team 2 (autodrafted, owner never opened Roster) sits at 3 starters / 11 bench, so the matchup shows a wall of "Empty Slot" on their side. Nothing server-side ever builds a default lineup. Recommend an auto-lineup pass at draft completion (or nightly for teams with no saved lineup) — otherwise week 1 vs an absentee manager is a free win and looks broken.

**H. One unexplained page hang — watch item.** One trade-analyzer load froze the tab hard (no dialog involved; navigation wouldn't take; recovered by closing the tab and opening a fresh one, page loaded normally after). Single occurrence in ~2h of hammering; not reproduced; no fix proposed — just noting it in case it shows up in webview testing.

Known-and-unchanged from prior reports: native `confirm()` on Drop Player (freezes automation, ugly in webview — swap for app dialog), goalie over-valuation in autopick, engine lobby keyed by generation, DB password rotation after launch.

---

## 3. ✅ DEPLOY LANDED (d103df2d) — all gated verifications passed same night

Bundle flipped `index-Co5U1JAl.js` → `index-Bt_MElX1.js`; API behavior confirms new server code.

1. **Silent no-op fix live** — authed PUT with `target_date=2026-08-22` (a matchup-less date, the exact case that wrote zero rows before): 200 AND `team_lineups.updated_at` moved, bench reorder persisted. The base-fallback path works on prod.
2. **Mobile tap-swap centerpiece** — Ellis ⇄ Garand via position-badge taps → PUT 200 → full page reload → **swap still there** (UI screenshot + `fantasy_daily_rosters` Sep 28: Ellis `active`, Garand `bench`). Both save paths (daily-roster + base-fallback) now proven live.
3. **Create League gates live** — Auction Draft shows "COMING SOON" and won't select; Keeper League switch `disabled`. Screenshots banked.
4. **Auto Lineup (desktop)** — click → PUT 200 → 13 daily-roster rows for Sep 28 rewritten, 10 active. Persisted.

**Still wanted:** one human desktop drag-and-drop (trusted pointer events can't be automated) — 10 seconds next time the roster page is open.

---

## 4. Expedited-clock coverage matrix (the honest answer to "every single process?")

**Proven with expedited/simulated clocks or live execution — my eyes + prod DB:**

| Process | How the clock was expedited | Result |
|---|---|---|
| Snake draft | Engine pick-clock expiries → 28/28 autopicks; separate genuine manual pick; draft reset | ✅ full draft, rosters materialized |
| Autopick draft | Same engine run (all-autopick path) | ✅ |
| Waiver claim → award | Processor invoked directly (as the nightly cron does) | ✅ limit-fail then award, priority rotated to #2 |
| Waiver 48h window — enforcement | FA add attempted 8h after drop | ✅ refused: "Player is on waivers" |
| Waiver 48h window — expiry | `dropped_at` backdated 50h, same add retried | ✅ succeeds — window expiry works |
| Drop → enters waivers | UI drop (confirm dialog bypassed) | ✅ `player_waiver_status` row, roster −1 |
| FA add | UI + API | ✅ instant, ledger + feed entries |
| Trade propose / cancel / reject | UI end-to-end | ✅ DB status transitions verified |
| Trade accept → execute | execute_trade RPC (the accept path's engine) | ✅ rosters moved |
| Trade review clock — approve | `review_ends_at` backdated, sweeper run | ✅ accepted, rosters moved |
| Trade review clock — veto | 1 veto ≥ threshold, clock expired, sweeper run | ✅ vetoed, rosters untouched |
| Multi-player trade (2-for-2) | UI propose + expedited review + sweeper | ✅ all 4 players switched, counts intact |
| Trade activity feed | New trigger tested with live ledger inserts | ✅ named entries, no raw-id dupes |
| Lineup save (both paths) | Matchup-date + matchup-less-date saves | ✅ persist + reload-proven |
| League creation + schedule | UI create; 27-week schedule generated & stable | ✅ |

**Gated OFF for launch (correctly disabled, not broken-but-live):** Auction draft (ran as snake → "Coming soon"), Keeper (no designation UI → disabled), **Dynasty (gated in this round's files — it was still enabled and silently switched keeper settings on; gate ships with your next push)**.

**Cannot be clock-simulated pre-season (no NHL games exist to score):** live scoring (game stats → fantasy points → matchup scores), weekly matchup completion + W-L standings movement, playoff bracket generation, game-lock at puck drop. These run their first real cycle the week of Sep 28. Recommendation: a synthetic-stat dress rehearsal on staging before then, plus live monitoring of week 1.

**Known gaps (documented, non-blocking, honest):** pending trade offers never auto-expire (`expires_at` is written but nothing reads it — a stale offer stays acceptable); trade-deadline enforcement exists in code but wasn't clock-tested; Linear and Offline/Manual draft types are selectable but have never been run end-to-end; side games (Daily Pickem, Survivor, Confidence Pool, Stanley Cup Brackets) — creation proven for Pickem only, gameplay untested; no server-side auto-lineup for absentee teams.

---

## 5. Round-2 fixes delivered tonight (in your folder, ready to push)

All findings A–F turned into code, verified: **lint clean, full build ✓, entire web suite 122 files / 1,924 tests passed.**

| Fix | Files | What changed |
|---|---|---|
| A — first-visit matchup race | `MatchupService.ts` | Root cause found: after schedule generation the `matchups:user:` cache prefix was never invalidated, so the page's verify re-read a stale empty result and claimed generation failed. Invalidations added at the generation choke point. |
| A — error copy | `Matchup.tsx` | "generation may have failed" → "isn't loading yet — refresh," both sites |
| C — calendar-vs-schedule week math | `Matchup.tsx`, `Roster.tsx`, `FreeAgents.tsx`, `HeadlinesBanner.tsx`, `StormyService.ts`, `MatchupService.ts` | Display anchors now run through the same `clampToSeasonStart` matchup generation uses — kills "WEEK 1/1 · Aug 23-29", "STARTS IN 1 DAY", and the Aug-anchor week-list collapse everywhere |
| D — raw player IDs on HQ timeline | `LeagueTimelineCard.tsx` | Resolves names through the player directory (same source as the Transactions tab); falls back to "a player", never "#8484801" |
| E — trades in activity feed | DB migration (**already applied to prod + staging**, file added to `supabase/migrations/`) | Ledger trigger now posts "Trade Completed — X acquired Y via trade" (once per player, acquiring side); legacy raw-id duplicate trigger dropped. Live-tested. |
| E — duplicate ledger rows | `LeagueService.ts` | Transactions tab keeps only the acquiring side's row per traded player |
| F — modal stat mixing | `TradeAnalyzer.tsx` | GP / SV / SO were never wired at this call site — W 31 next to GP 0. Wired (goalie GP uses `goalie_gp`). |
| New — Dynasty gate | `CreateLeague.tsx` | "Coming soon" + disabled, matching Keeper (it also silently enabled keeper settings) |

One `git add -A; git commit; git push` ships all of it — the DB part is already live.

---

*Test-league state: DACOSTA! rosters are churned from today's trades (Tkachuks → Team 2; Ellis, Fowler → Gstorms) — all in-league, nothing touches real data. Claude Auction League / Claude Pickem Pool / Claude Proof League still exist for cleanup later.*
