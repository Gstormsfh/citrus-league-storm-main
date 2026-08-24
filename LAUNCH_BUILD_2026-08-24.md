# LAUNCH BUILD — 2026-08-24 (evening)
## Every draft type NOW + polish list to zero

Directive: *"Auction draft, and all the other drafts need to be done NOW …
Also fix all the open polish items. I want that list at 0 outstanding by
submission time."* — Done. This document is the manifest, the deploy order,
and the verification plan.

**Suites: server 1188 passed (includes 486 engine tests) · web 1921 passed ·
shared + server typecheck clean · web production build clean.**

---

## 1 · WHAT SHIPPED

### Auction draft (live, real-time bidding)
- **Engine** (`server/src/draft/LobbyManager.ts`): `armAuctionTimersAfterLiveApply`
  — the live external-apply path now arms bid/nomination windows when user
  nominations and bids land over HTTP. (Appliers deliberately don't arm —
  init() owns bootstrap arming; this was the one missing rail for USER-driven
  auctions. All auction state machinery — nominate/bid/close/skip/anti-snipe/
  pause/resume/overrides/auto-nominate — was already implemented and tested.)
- **API** (`server/src/routes/draftV2Auction.ts`, mounted in `app.ts`):
  POST `/api/draft/v2/league/:id/nominate` + `/bid`. Route owns what the
  trusted-executor RPCs don't: team ownership, nomination rotation
  (draft_order round 1), player-taken, budget reserve rule
  (maxAffordable = remaining − (slotsRemaining−1)×minBid).
- **Client**: `deriveAuctionState.ts` (auction fold seeded from engine
  snapshot, watermark-deduped), `submitAuctionAction.ts` (idempotent POSTs,
  typed error mapping), `draftClientStore.ts` (auctionDerived + hook),
  `AuctionPanel.tsx` (nomination card, live countdown, quick-bid + custom bid,
  budget board, nominate search, results feed), mounted in `DraftRoomV2.tsx`
  for `format === 'auction'`. CreateLeague auction gate retired.

### Autopick draft
- Engine maps `draftType='autopick'` → snake lobby with a **4-second** pick
  clock (`server/src/draft/index.ts`); the engine's per-seat autopick does the
  drafting, users can still click faster. CreateLeague gate retired.
  (The league that bricked on this format was rescued earlier today.)

### Offline / manual draft
- **DB**: `offline_import_draft_v2` RPC (applied to prod) — one atomic
  transaction writes a REAL event stream (draft_started → N picks →
  draft_completed). Existing triggers do everything else: pick projection,
  roster build, league finalize. The league is never observable
  `in_progress`, so the engine's NOTIFY gate never builds a lobby for it.
- **API**: POST `/api/draft/v2/league/:id/offline-import`
  (`draftV2Offline.ts`) — commissioner-gated, zod-validated, idempotent.
- **Safety rails**: `draftV2Start.ts` refuses to ignite offline leagues
  (tested); the draft room never opens a WS for them.
- **Client**: `OfflineDraftRoom.tsx` — commissioner slot grid (snake-order
  team defaults, per-slot override), player search, contiguity enforcement,
  partial-import option, localStorage entry draft (survives tab close),
  results board after import. Non-commissioners see status + results.
  DraftRoomV2 branches to it via a fail-open league probe. CreateLeague
  offline gate retired (last gated type — all five now selectable).

### Keeper + Dynasty
- CreateLeague "Coming soon" gates retired on both toggles (dynasty forces
  keeper on + unlimited count — now deliberate behavior).
- **`KeeperPanel.tsx`** (league dashboard, shown when keeperEnabled): the
  designation surface that was the gate's reason — managers Keep/Release
  players from their roster against the league's keeper limit; league-wide
  keeper board; commissioner **Lock all keepers**. Rides the complete
  existing API/RPC stack (designate/release/validate/lock — all verified
  live in prod).
- League Settings dialog: new **Keepers** tab (enable, count, penalty,
  dynasty) → existing save branch → `updateKeeperSettings`.
- Season model documented in-UI: season 1 drafts are full drafts; keepers
  designated now target next season's draft and lock before it.

### Polish list → 0/10
1. **Waiver badge truth** (`WaiverWire.tsx`): search rows now surface REAL
   on-waivers state (recently-dropped window from `player_waiver_status` +
   league period) with "clears <time>", OR'd with the game-lock signal.
2. **"Draft complete · just now" re-bumping** — root-caused to
   `leagues.updated_at`; fixed at the SOURCE: completion trigger now stamps
   `settings.draftCompletedAt` once (works for live/auction/offline/override
   paths), 8 real completed leagues backfilled, client reads the stamp with
   updated_at as last-resort fallback (`LeagueDashboard.tsx`).
3. **Waiver pickups labeled "Free agent pickup"** — timeline now honors the
   ledger's `source`: waiver-won adds say **Waiver claim** (drops in a claim
   say so too), and TRADE ledger rows now render as "<team> acquired
   <player> · Trade" (`leagueTimeline.ts` + `LeagueTimelineCard.tsx`).
4. **Dead client methods removed** (`WaiverService.ts`):
   `processFAABWaivers` (POSTed to a route that doesn't exist) and client
   `WaiverService.updateWaiverSettings` (PUT to a GET-only path) — both
   404ed on every call. Tests updated. Live paths documented in-code.
5. **Unreachable save branches** — Keepers tab (above) + **Categories tab**:
   category leagues (H2H-cat / roto) now get a Categories tab (replacing
   Scoring, which edits point values they don't use) wired to the existing
   `updateCategorySettings` branch.
6. **Duplicate "Best Ball" chip** on create summary — the add-on chip now
   only renders when best ball rides a different scoring format.
7. **Playoff-pool deadline hint** — off-season creators (Jul–Feb) get an
   explicit note that the prefilled date is a placeholder and the lock
   belongs right before Round 1 Game 1 (mid-April).
8. **Sync Rosters stale copy** (dashboard + Profile) — no more
   "roster_assignments from draft_picks" v1 jargon; now honest, and true for
   live/auction/offline drafts.
9. **PPG standings footnote** — "Ranked by points per game" for PPG leagues.
10. **Off-season player cards** — "No upcoming games / PROJ —" during
    Jul–Sep now reads "Off-season — games return in October"
    (`PlayerStatsModal.tsx`).

---

## 2 · DB MIGRATIONS — ALREADY APPLIED TO PROD (nothing to run)

All five are live in `iezwazccqqrhrjupxzvf` and mirrored into
`supabase/migrations/` in this delivery for environment parity:

| version | name |
|---|---|
| 20260824165113 | faab_budget_key_both_spellings |
| 20260824171428 | sync_scoring_rules_on_insert_and_backfill |
| 20260824191610 | **offline_import_draft_v2** |
| 20260824193339 | **stamp_draft_completed_at_in_settings** |
| 20260824195748 | fix_scoring_sync_decimal_regex (defensive re-assert, no-op) |

---

## 3 · FILE MANIFEST (all delivered to your repo folder)

**Server** (deploys with your git push — API + engine):
- `server/src/draft/LobbyManager.ts` — auction live-apply timer arming
- `server/src/draft/index.ts` — autopick→snake+4s mapping
- `server/src/routes/draftV2Auction.ts` — NEW nominate/bid routes
- `server/src/routes/draftV2Offline.ts` — NEW offline-import route
- `server/src/routes/draftV2Start.ts` — offline ignition guard
- `server/src/app.ts` — route mounts
- `server/src/services/AuditService.ts` — DRAFT_OFFLINE_IMPORT event type
- `server/src/__tests__/draftV2Start.test.ts` — offline-guard test + mock

**Shared** (builds into both):
- `packages/shared/src/utils/leagueTimeline.ts` — waiver/trade labels

**Web** (deploys with your web build+deploy):
- `apps/web/src/lib/draftClient/deriveAuctionState.ts` — NEW
- `apps/web/src/lib/draftClient/submitAuctionAction.ts` — NEW
- `apps/web/src/stores/draftClientStore.ts` — auctionDerived wiring
- `apps/web/src/components/draft/v2/AuctionPanel.tsx` — NEW
- `apps/web/src/components/draft/v2/OfflineDraftRoom.tsx` — NEW
- `apps/web/src/components/league/KeeperPanel.tsx` — NEW
- `apps/web/src/pages/DraftRoomV2.tsx` — auction mount + offline branch
- `apps/web/src/pages/CreateLeague.tsx` — all gates retired + polish 6/7
- `apps/web/src/pages/LeagueDashboard.tsx` — Keepers/Categories tabs,
  KeeperPanel mount, timeline stamp, sync copy
- `apps/web/src/pages/Standings.tsx` — PPG footnote
- `apps/web/src/pages/Profile.tsx` — sync copy
- `apps/web/src/pages/WaiverWire.tsx` — real on-waivers state
- `apps/web/src/components/PlayerStatsModal.tsx` — off-season copy
- `apps/web/src/components/dashboard/LeagueTimelineCard.tsx` — source + trades
- `apps/web/src/services/WaiverService.ts` — dead methods removed
- `apps/web/src/services/__tests__/WaiverService.test.ts` — tests updated

**Migrations** (parity mirrors, already applied):
- `supabase/migrations/20260824165113_faab_budget_key_both_spellings.sql`
- `supabase/migrations/20260824171428_sync_scoring_rules_on_insert_and_backfill.sql`
- `supabase/migrations/20260824191610_offline_import_draft_v2.sql`
- `supabase/migrations/20260824193339_stamp_draft_completed_at_in_settings.sql`
- `supabase/migrations/20260824195748_fix_scoring_sync_decimal_regex.sql`

---

## 4 · DEPLOY — ORDER MATTERS

**Server FIRST** (auction/offline routes + engine arming live in the API/
engine deploy; the web build ungates the UI — web before server would let
users create auction leagues whose actions 404).

```powershell
# From C:\Users\garre\Documents\citrus-league-storm-phase45

# 1) Commit + push  → API auto-deploys (~30–40 min) + draft engine deploys
git add -A
git commit -m "Launch build: auction + autopick + offline + keeper/dynasty NOW; polish list to zero"
git push

# 2) WAIT for the API deploy to finish (~30–40 min after push).
#    Spot-check the new route exists (expect 401 Unauthorized, NOT 404):
curl.exe -s -o NUL -w "%{http_code}" https://api.citrusfantasysports.com/api/draft/v2/league/00000000-0000-0000-0000-000000000000/offline-import -X POST
#    404 = deploy not done yet, wait. 401 = routes are live, proceed.

# 3) THEN web build + deploy:
cd apps\web
npm run build
cd ..\..
firebase deploy --only hosting --project citrus-fantasy-prod
```

## 5 · AFTER YOUR DEPLOY — my live prod E2E plan
1. **Auction**: create auction league → fill with AI → start → nominate from
   the panel → bid war (two browsers) → anti-snipe extension → win →
   budget deducted → auto-nominate on idle → draft to completion → rosters.
2. **Autopick**: create autopick league → start → watch it draft itself at
   ~4s/pick → completion + rosters.
3. **Offline**: create offline league → enter results in the slot grid →
   import → picks/rosters/timeline verified (draft_status flips straight to
   completed; engine logs show zero lobby creation).
4. **Keeper**: enable keeper on a completed league → designate → lock →
   keeper_designations rows verified.

## 6 · Also running tonight (no action needed)
- The planted waiver claim (Necas, priority 1, backdated 49h) processes on
  the **03:00 UTC cron** — I get woken at 03:25 UTC to verify zero-touch
  scheduled processing, then restore the league exactly.
