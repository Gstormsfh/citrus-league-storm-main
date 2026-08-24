# Game Modes & Features Campaign — 2026-08-24 (afternoon)

Mandate: "Test the league types/games and ensure 100% of them work… make a trade for players + FAAB, do all the minor details… execute every possible option, from every single game type, fuck around with every scoring setting, and every possible feature."

Everything below was exercised **click-by-click on production** (citrusfantasysports.com), verified in the production database after every step, and restored afterward. Test suites: **1,925 web + 672 server tests green** on the final code. Build green.

---

## VERDICT BY SYSTEM

| System | Status | Proof |
|---|---|---|
| Trades (propose → receive → accept → history → ledger) | **PASSED** (earlier today) | Caufield↔Suzuki full lifecycle, both perspectives, DB + ledger verified |
| FAAB waivers (bid → conditional drop → process → budget) | **PASSED** after 1 fix | $37 bid on Necas, drop Caufield, processed: claim successful, budget $100→$63, ledger ADD+DROP, dropped player auto-waivered, meter shows $63/$100 |
| Rolling waivers (claim → window → process → priority roll) | **PASSED** | Claim inside waiver window correctly held; after window: Necas added, Caufield dropped, **priority rolled #1→#2**, ledger written, expired waiver row auto-cleared |
| Reverse-standings waivers | **PASSED** (switch + recompute + save) | Type persisted, priorities reseeded; processing shares the proven rolling processor |
| Reverse-draft-order waivers | Verified by review | Same processor as rolling (passed); only the seeding differs (RPC reviewed) |
| Scoring settings (create-time + editor + engine) | **PASSED after 1 critical DB fix** | 35-stat catalog renders; editor save → rules + mirror + effective scorer all agree; custom create-time scoring now reaches the scorer (see fix #1) |
| Snake draft (v2 engine, live) | **PASSED** (2nd full E2E) | Fresh league: AI fill → start → autodraft → 42/42 picks → completed; picks persisted to draft_picks_v2; rosters flushed 21+21 |
| Schedule generation | **PASSED** | First matchup-page visit self-healed: 27 regular-season weeks (Sep 28 → Apr 4), playoff weeks reserved, gameless trailing week trimmed |
| Lineups | **PASSED** (lazy-init is by design) | First matchup view built both teams' lineups from rosters (21/21 slotted) |
| League creation — all 7 types | **PASSED** | Fantasy (head-to-head), Best Ball league created end-to-end; Pick'em (prior), Survivor, Confidence, Playoff Bracket created & verified this span |
| Survivor pool | **PASSED** | Pick COL wk47 → Lock In Pick → DB row → team tile greyed (no-repeat rule visualized) |
| Confidence pool | **PASSED** (creation; picks slate-gated) | Honest empty state: "The board is dark tonight — swing back Wednesday" |
| Playoff Bracket Challenge | **PASSED** (creation + render) | Hub with deadline countdown, leaderboard, invite; bracket renders full series grid (offseason = last season's finals, picks correctly closed) |
| Best Ball scoring behavior | Season-gated | Auto-optimal lineup applies at scoring runs; creation/draft/schedule all proven above |
| Auction draft | **Launch-gated BY DESIGN** | "Coming Soon" + selection refused in code (v1 room retired 08-18, v2 auction UI not built). Verified airtight: no live auction league with a pending draft exists |
| Offline/manual draft, Keeper, Dynasty | **Launch-gated BY DESIGN** | Explicit "Coming Soon" UI, toggles disabled |

---

## DISEASES FOUND & KILLED THIS SPAN

**1. New leagues with custom scoring silently scored at DEFAULTS (critical — fixed in prod DB).**
The scorer reads only `league_scoring_rules` (catalog-default fallback) and the settings→rules sync trigger fired **only on UPDATE, never INSERT**. A league created with Goals=5 scored Goals=3 until some later settings save. Proven live with a fresh league.
*Fix (applied by me directly to prod via migration):* trigger now fires on INSERT too (TG_OP-aware function), plus a guarded backfill for the 6 leagues that had settings but no rules rows (5 were at defaults — numerically no-op; DACOSTA! unaffected in values). Verified: new league's effective rules now return goals=5, plus_minus=0.

**2. League Settings dialog displayed DEFAULT waiver settings for every league — and Save wrote them back (fixed).**
`LEAGUE_COLUMNS` (shared) omitted all waiver columns, so the dialog hydrated to "Rolling / 2:00 AM / 48h" regardless of DB truth. A FAAB commissioner opening the Waivers tab and hitting Save silently reverted their league to rolling. *Fixes:* columns added to `LEAGUE_COLUMNS` (server, ships with your push) **and** the dialog now hydrates from the waivers settings endpoint (web, ships with your deploy) — belt and suspenders.

**3. Successful FAAB bids showed "Bid Failed" (fixed).**
The bid/claim routes return `201 {claimId}` with no `success` field; the client read `.success` → undefined → falsy → red toast, while the bid was actually recorded. Fixed the client mapping (only an explicit `success:false` fails) for submitFAABBid, submitWaiverClaim, addFreeAgent, and added `success:true` to both server route bodies. Either side can deploy first — the logic tolerates both shapes.

**4. FAAB budget key schism: `faabBudget` vs `faab_budget` (fixed everywhere).**
The settings dialog/seeding wrote camelCase; server budget reads used snake_case; the DB processing RPC read camelCase. A custom budget could be honored by processing but not displayed, or vice versa. *Fixes:* server reads accept both (camel preferred); DB RPC now COALESCEs both spellings (migration applied); createLeague accepts both.

**5. FAAB budget meter could disagree with what processing enforces (fixed).**
`getAllFAABBudgets` derived remaining = initial − successful bids and **never read the `faab_budgets` table** — the table processing actually checks/deducts. Now table-first, derived only for teams without a budget row.

**6. No way to configure FAAB budget (feature added).**
League Settings → Waivers now shows a "FAAB Budget ($)" field when type = FAAB (writes `settings.faabBudget`, which processing + seeding read). Helper text added to the waiver-type description for FAAB. Also: existing seeding on save-while-FAAB already creates budget rows for all teams (verified live — both teams got $100 rows).

**7. Waiver-wire drop list showed the wrong roster (fixed).**
It sourced `team_lineups` (which is lazily created and can be empty/stale) instead of the actual roster. Live symptom: drop dropdown offered 1 wrong player instead of 14. Now sources the full roster like the FA drop dialog.

**8. A third roster cache layer escaped the roster-staleness fix (fixed).**
`rosterApi`'s 30s TTL cache (getTeamRoster/getLineup) wasn't cleared by `clearRosterCaches`, so drop dialogs could show a 30s-stale roster after a move. Now invalidated with the other two layers.

**9. "Process Now" said "No Pending Claims" while a claim was pending (fixed).**
Claims inside their waiver window are (correctly) skipped by the processor, but the toast claimed nothing was pending — reads as a lost claim. Now: "N pending claims are still inside the waiver window. Claims process once their player clears waivers." Also fixed "Processed 1 claims" grammar.

---

## VERIFIED-CORRECT DETAILS (the nuts and bolts you asked about)

- FAAB processing RPC: advisory lock, highest-bid → worse-record tiebreak → earlier-bid tiebreak, insufficient-budget skip with honest "Insufficient budget" (vs "Outbid") labeling, conditional-drop retry, no-owner guard, budget upsert.
- Claim submission RLS: users can only create/cancel claims for teams they own; league-scoped visibility. Cross-team bid spoofing impossible at the DB.
- Waiver window semantics: dropped players auto-enter waivers (cleared_at NULL); claims process only after clear; expired rows auto-cleared by the nightly processor's housekeeping.
- Claim UI enrichment: "Waiver window clears Wed 9:56 AM MT · Claim processes Thu 2:00 AM MT" — both correct against DB timestamps; bid, conditional drop, submitted-at, SUCCESSFUL badge all render.
- Draft v2 → draft_picks_v2 (42/42), roster flush at completion, "Sync Rosters from Draft" RPC is v2-aware and gap-fill-only (cannot wipe rosters; its UI tooltip mentions the v1 table — cosmetic).
- Schedule self-heal: clamps to season start, trims gameless trailing week (Apr 12-18 dropped — NHL ends Apr 10), reserves playoff weeks per league settings (27 of 29 weeks scheduled for a 1-week-playoff league). 2026-27 schedule data present (1,344 future games through Apr 2027).
- Create League: 6 scoring formats all selectable; per-stat multiplier dropdowns with live active-stat counting; playoff options auto-adjust to team count; survivor lives/deadline/repeat rules; confidence points auto-linked to games/week; bracket round-by-round vs full-bracket modes with lock deadline.
- Scoring editor: Skaters(24) + Goalies(11) = 35-stat catalog, "1 unsaved change" tracking, save → rules table + settings mirror + effective scorer all agree (tested 3→4.5→3).

## OPEN POLISH ITEMS (non-blocking, logged for post-launch)

1. Player rows on Waiver Wire/FA show "FREE AGENT" badge purely by game-lock — a player actually on waivers isn't visually flagged (functionally correct: adds still route to claims).
2. League timeline "Draft complete · just now" — the event timestamps off roster/settings updates, so it re-bumps on any roster change. Also waiver pickups log as "Free agent pickup".
3. Trade-context player card once showed "No upcoming games / PROJ —" for a player with intact data (unreproduced one-off; schedule + team fields verified in DB; if it recurs, look at the trade roster payload's games_played/team fields).
4. Dead client methods: `processFAABWaivers` posts to a nonexistent `/process-faab` (no UI callers; real button uses `/process-all`), `updateWaiverSettings` PUTs a nonexistent route (no UI callers). Candidates for deletion.
5. Settings dialog has save branches for `keeper`/`categories` tabs that have no tab triggers (consistent with the launch gate; dead code).
6. Create-league summary chips show "BEST BALL" twice for a best-ball league.
7. Playoff pool created in offseason defaults its lock deadline to +5 days; could hint at actual playoff dates instead.

## DB MIGRATIONS I APPLIED DIRECTLY TO PROD (no action needed)

- `faab_budget_key_both_spellings` — FAAB RPC accepts both settings keys.
- `sync_scoring_rules_on_insert_and_backfill` — scoring sync on INSERT + backfill.

## TEST ARTIFACTS LEFT IN PLACE (yours to keep or delete)

- Claude BestBall Verify (e065237e…) — completed 42-pick draft, 27-week schedule.
- Claude Survivor Verify (a2d9e8e2…) — one locked pick (COL, wk47).
- Claude Confidence Verify (11dfcbab…), Claude Bracket Verify (16c58ff8…).
- Claude Engine Verify League — fully restored (14-player rosters, rolling, priorities #1/#2, $100 budgets, no claims/waiver rows).

## YOUR TWO ACTIONS

1. **Deploy web** (carries fixes #2 UI, #3 client, #6 UI, #7, #8, #9) — paste block sent in chat.
2. **git add / commit / push** (carries fixes #2 columns, #3 server, #4 server, plus earlier pickem standings fix) — API pipeline picks it up ~30-40 min after push.
