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

## 3. The moment your push lands (I'm polling)

1. **Lineup swap persists** — mobile tap-swap Garand ⇄ goalie, reload, screenshot + `team_lineups.updated_at` (the centerpiece; the silent no-op fix makes pre-season saves real).
2. **Create League page** — Auction disabled + "Coming soon", Keeper toggle disabled — eyes + screenshot.
3. **Auto Lineup save on desktop** persists after reload.
4. Final consolidated evidence report.

**One human check still wanted:** one desktop drag-and-drop lineup move with a real mouse (automation can't produce trusted drag events for dnd-kit) — 10 seconds when you have the roster page open.

---

*Test-league state: DACOSTA! rosters are churned from today's trades (Tkachuks → Team 2; Ellis, Fowler → Gstorms) — all in-league, nothing touches real data. Claude Auction League / Claude Pickem Pool / Claude Proof League still exist for cleanup later.*
