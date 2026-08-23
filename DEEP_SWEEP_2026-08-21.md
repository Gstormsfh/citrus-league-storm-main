# Citrus Deep Sweep — lineup, auction, keeper, dynasty, pools
**2026-08-21 · tested live on production, with screenshots · follow-up to the launch verification**

## The one that matters most — FIXED, needs your push

### 1. Lineup changes were silently evaporating (CRITICAL — fixed, awaiting deploy)
Swapped bench↔starter on the roster page. The UI swaps, toasts "Lineup Updated"…
and on reload the change is GONE. Traced it fully:

- The client always saves with a `target_date` (Yahoo-style per-day rosters).
- The server's per-day writer requires a **matchup covering that date**. Pre-season,
  no league has one → it hit `return;` and wrote **nothing**.
- The route still returned **200 OK**, so the client cleared its caches and its
  localStorage fallback. Two 200 PUTs measured, zero rows written.
- Impact: **every lineup edit in every league, all pre-season** — exactly what iOS
  users would do at launch — silently lost.

**Fix (in your repo, rides the next `git push`):** the per-day writer now reports
whether it wrote; when it didn't, the save falls back to the base `team_lineups`
upsert. In-season daily edits unchanged. 3 new regression tests;
**full server suite 1,177/1,177 green.** Files: `server/src/services/LineupService.ts`,
`server/src/__tests__/LineupService.silentNoop.test.ts`.

Until that push deploys, lineup edits still won't stick — don't judge the feature
until then.

### What DOES work in lineups (verified with eyes)
- **Mobile tap-to-swap is excellent**: tap a position badge → "Tap a highlighted
  position to move" → eligible slots glow → tap target → swap. Verified both
  directions (bench→start, start→bench) in a 390px viewport running the real
  MobileRosterList code path.
- Player profile modals (with DROP PLAYER), Auto Lineup button, IR slots, empty-slot
  rendering, position chips — all present and sane.
- **Desktop drag-and-drop**: automation can't fake trusted pointer events for dnd-kit,
  so I could not machine-verify the drag itself. One human drag on your machine
  (after the fix deploys) closes this. The save path it uses is the same one I fixed.

## 2. Auction drafts: configured, but they RUN AS SNAKE (product gap)
- Created "Claude Auction League" through the UI — league saves with
  `draftType: "auction"`, lobby shows **FORMAT Auction**. Looks right.
- Pressed Start: it ignited as a **snake draft** — "Round 1 · Pick 1/42", pick
  clock, no nomination, no bidding, no budgets. No error, no warning.
- Why: the v1 draft room (which contains the complete auction UI — nominations,
  bids, timers, AuctionDraftService) was **retired on 2026-08-18**; every league now
  hard-redirects to the v2 room, and v2 has no auction UI. The engine's auction
  support and all 6 auction RPCs (granted this morning) are intact but unreachable.
- **Launch recommendation:** hide/disable the "Auction Draft" option in Create League
  ("coming soon") until the v2 auction room exists. Letting users configure an
  auction and silently receive a snake draft is worse than not offering it.

## 3. Keeper & Dynasty: backend complete, manager UI missing
- Create flow has "Advanced: Keeper & Dynasty Settings" (enable, count, penalty);
  settings persist; league dashboard reads them.
- Server API is complete: designate / release / list keepers. KeeperService exists.
- **But no page or component lets a manager actually designate a keeper** — nothing
  imports the keeper service except CreateLeague's settings. Feature is
  configuration-only today. Dynasty (`dynastyMode`, unlimited keepers) is the same
  family, same gap.
- Fine for launch if keeper leagues aren't advertised; the settings don't break
  anything. Designation UI is the missing piece to actually ship it.

## 4. Pools: working
- Created a **Pick'em pool** through the UI end to end → routed to a polished hub
  (week navigation, Picks/Standings/League tabs, invite button) with a clean
  offseason empty state ("The board is dark tonight — swing back Wednesday").
- Survivor / Confidence / Playoff pool pages were visually swept earlier in the
  session (they got the team-chip contrast fixes); creation flow is the same
  pattern as Pick'em.

## 5. Incidental verifications along the way
- **Waiver protection works in the pool UI**: instant-adding a recently-dropped
  player is correctly refused server-side — "Player is on waivers. Submit a waiver
  claim instead."
- League HQ, GM Office command stack, Trade Center, Free Agents scouting page all
  render clean with real data.
- One transient burst of supabase auth-refresh failures ("Failed to fetch" ×6) was
  observed once and self-healed — worth knowing it surfaces as a silently dead
  Create button rather than an error message.

## Test artifacts to clean up when convenient
- "Claude Auction League" (a 2-team snake-mislabeled draft that will autopick
  itself to completion), "Claude Pickem Pool", "Claude Proof League" — all mine,
  all safe to delete. DACOSTA! still holds the demo rosters/waiver/trade.

## Bottom line for tomorrow's iOS submission
Core loop (create → snake draft → rosters → waivers → trades → pools): **solid, proven live.**
Ship-blockers found: **one** (lineup persistence) — **already fixed, needs your push.**
Pre-launch product calls: hide Auction (runs as snake), don't advertise Keeper/Dynasty
(no designation UI). Neither requires code you don't already have.
