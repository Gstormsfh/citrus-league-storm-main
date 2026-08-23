# Citrus Audit Round 3 — Draft Types & the "Everything Works" Sweep (Aug 23 2026)

Follow-up to `AUDIT_SESSION_2026-08-22.md`. Everything below happened live on prod tonight, eyes + DB. **Verification: web suite 122 files / 1,924 tests passed · server suite 1,181 passed · builds + lint clean.**

---

## 1. Linear draft — PROVEN end-to-end on prod

Created **Claude Linear League** through the real create form (2 teams, 16 rounds, 60s clock, Linear selected), filled the second seat via the AI-teams endpoint, started the draft from the v2 lobby, and let it run: **32/32 picks, `draft_completed`, 32 roster rows materialized, ~90 seconds wall clock.** The event stream's `draft_started` payload carries `"draft_format": "linear"` and **all 16 rounds ran Gstorms → Stormy AI in identical order — zero snake reversals.** Linear sequencing works in the deployed engine. Evidence: `evidence_linear_draft_completed.jpg`, league `af22b437`.

## 2. But the draft QUALITY audit found the real monster — autopick builds unusable rosters

The completed linear draft produced: **my team 9 C / 1 D / 0 G — the AI team ELEVEN GOALIES.** Neither roster can legally fill the C2/LW2/RW2/D4/G2 lineup. Any real league where a manager no-shows draft night (the single most common draft-night event) currently gets this. Root cause is three separate defects that compound:

**A. Engine roster-shape guard is blind — caps-inflation (`autopickStrategy.ts`).** The E118 guard counts a team's positions by reading `player_directory` — which is a per-SEASON index (prod: 1,902 rows for 1,085 players). Every owned player counted ~twice, caps looked exhausted halfway through the draft, and every later pick fell through to the unshaped value board. **Fixed:** dedupe to one row per player before counting; pinned by a regression test that reproduces the double-count against a faithful per-season mock.

**B. Engine value model inflates unproven prospects (`autopickStrategy.ts`).** A player with no prior-season row was credited 55 expected games on his small-sample per-game rate — so prospect goalies ranked like 55-game starters, and once the (broken) caps let go, the board drained straight into them: nine consecutive goalie picks. **Fixed:** no-prior-season players now rank by the conservative legacy projection value (industry behavior: autopick never reaches for unproven prospects). Tests updated + new case.

**C. The client autodraft loop had NO positional logic at all (`DraftRoomV2.tsx`).** The in-room "Autodraft on" toggle picks best-season-FPTS 1.5s after your turn starts — faster than the engine's clock-expiry autopick, with zero roster awareness. That's where my 9-center team came from. **Fixed:** the client picker now counts my current roster by position against the league's `rosterSlots` caps and takes the best player at a position I still need (queue picks stay exempt — an explicit ranking outranks the guard, same as the engine).

> ⚠️ **A and B are ENGINE code.** They ship only when the `citrus-draft-engine` image on the GCE VM is rebuilt from master and the container recreated (same procedure as the Aug 21 engine deploy). The git push alone does NOT deploy them. Until the engine is rebuilt, autopick on prod still builds broken rosters — I'd treat the engine rebuild as required before any real league drafts.

## 3. VETO BYPASS — the hourly sweep executes trades the league voted down (`scheduled.ts`)

The cron workflow calls `POST /api/scheduled/trade-review-sweep`, which ran its **own** sweep: every expired under-review trade → `execute_trade`, **without ever reading `trade_votes`.** The veto-aware `process_expired_trade_reviews()` (threshold math, `vetoed_at`, rosters untouched) existed but had **no caller** in the pipeline — my earlier veto proof invoked it directly by SQL, which is why it looked correct. In production, a league's veto votes were cosmetic. **Fixed:** the route now delegates to the veto-aware function (the implementation I verified live in both directions — approve and veto).

## 4. Trade deadline — enforced, proven both directions

Set `trade_deadline` to yesterday on DACOSTA → proposal refused **400 "Trade deadline has passed"**. Removed it → identical proposal accepted (201). Setting reverted.

## 5. Pending trade offers now expire (`TradeService.ts`, `scheduled.ts`)

`expires_at` was written on every proposal and read by nothing — a stale offer stayed acceptable forever. **Fixed twice over:** the accept path refuses and marks expired offers in-line (2 new unit tests), and the hourly sweep now expires lingering pending rows. Live-proven on prod data: the control offer flipped `pending → expired` under the exact sweep predicate. (`'expired'` was already in the status CHECK constraint — the schema always expected this; only the enforcement was missing.)

## 6. Offline / Manual draft — gated "Coming soon" (it was a promise with no mechanism)

The create form sells "commissioner enters draft results after your external draft" — but there is **no import mechanism anywhere** (no route, no service, no UI; the only match for that promise is the description string itself). Pressing Start on an offline league would launch a live engine draft — the opposite of the promise. Gated exactly like Auction (disabled card + "Coming soon" badge + selection guard) until a pick-entry UI exists. Draft-type lineup at launch: **Snake ✓ proven · Linear ✓ proven · Autopick ✓ proven (with the engine fixes above) · Auction gated · Offline gated.**

## 7. v2 lobby fixes — the AI-fill promise and the wrong format label (`DraftRoomV2.tsx`)

The create page promises "fill any open slots with AI opponents at the press of a button," but the button only ever existed in the **retired v1 lobby** — a solo commissioner was stuck at "waiting for teams" with no way to do it. **Fixed:** the v2 lobby now shows "Fill N open slots with AI" (commissioner, pre-start), calling the same `/simulate-fill` endpoint (which I verified live — it created "Stormy AI" instantly). Also fixed: the lobby's format chip rendered **"Snake" for every non-auction league** — my linear league's lobby announced the wrong format on the screen whose own comment says "so nobody is surprised." Now maps snake/linear/auction/autopick/offline correctly.

## 8. Side games — rendered and sane, gameplay season-gated

Claude Pickem Pool routes correctly to `/pool/pickem` and renders with a deliberate between-slates empty state ("The board is dark tonight — swing back Wednesday for lock-in") — exactly the kind of copy the matchup page lacked. Survivor / Confidence / Bracket pools share the same pool framework and creation path; their actual pick-making needs real NHL games and lands in the same season-gated bucket as scoring. Playoff products are April concerns.

---

## Deploy checklist (two steps, in order)

1. **Push the repo** (ships server API + web): TradeService expiry guard, veto-aware sweep route, DraftRoomV2 lobby/autodraft fixes, CreateLeague offline gate — plus everything from Round 2.
2. **Rebuild + redeploy the draft engine** on the VM from that same master (autopickStrategy caps + rookie-value fixes). Same procedure as the Aug 21 engine deploy. **Engine rebuild before any real league drafts.**

Test-league state: Claude Linear League (af22b437) holds the 11-goalie evidence; DACOSTA back to normal (Celebrini re-added via the waiver-expiry proof, deadline setting reverted, control offer expired). Cleanup list unchanged.
