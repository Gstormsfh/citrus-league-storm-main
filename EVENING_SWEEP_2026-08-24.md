# Evening Disease Hunt — 2026-08-24 (click-by-click sweep, commissioner + league-mate)

Every page and tab on live prod was walked click-by-click as commissioner (DACOSTA!) and as a league-mate (Claude Proof League, via a temporary commissioner flip to Topher — **flipped back, verified**). Console read after every page. One console error total was found across the entire app — root-caused and fixed (disease #3 below).

## The big find: the app's dark theme was never actually "on"

`<html>` never gets the `dark` class. That means **every Tailwind `dark:` variant and every `.dark`-scoped CSS rule in the codebase is dead code** — including an entire "dark mode overrides" remap layer in index.css that a previous audit built to convert cream surfaces. Components authored light-first with `dark:` fallbacks render **light**. This is the single root cause behind the recurring "cream box in a dark app" whack-a-mole (matchup player cards, View Others, and everything below).

Why not just add `class="dark"`? Because the `.dark {}` token block is a **legacy warm-brown theme** (not the forest palette) — flipping the class would instantly re-theme the whole app off-brand. The forest-dark look lives on `:root`. So every light-first site was converted to dark-first at the source, and the dead `dark:` variants removed where touched.

## Diseases killed tonight (all verified by build + suite)

1. **Cream/light-first surfaces across 20+ live components** — now dark-first:
   - PlayerStatsModal (the fantasy card): stat cells, tabs list, bio strip, game-log rows, per-game projection boxes, footer, status badges — several were cream-on-cream (unreadable).
   - StartersGrid / BenchGrid / IRSlot / MobileRosterList (roster slots had cream `#E8EED9/50` washes — the "washed out" slop look).
   - GM Office Team Intel day cells (`bg-red-50` white tiles — screenshotted live).
   - Matchup: champion banner (cream gradient), TeamCard header, sidebar Top Performers card + rank medals, week selector (cream chips/trigger/dropdown), AdSpace house card.
   - Roster: Best Ball banner, demo/locked banners, transaction status chips.
   - Playoffs: league PlayoffBracket badges, PoolPlayoffBracket white series cards, PoolPlayoffConfidence pick states, **PoolPlayoffRoster (whole page authored light — ~25 sites converted)**, PoolPlayoffHub game cards + live strip.
   - PoolLeagueHub (pools League tab): white card with an **invisible cream join code** — screenshotted live on the pick'em page.
   - InvitePlayersButton popover: white panel with invisible cream title/code.
   - Trade: TradeGridView badges/chips, TradeReviewSection texts.
   - Old DraftRoom (Mock Draft route): auction panel, keeper/bid rows, completion badge. RosterDepthChart position tints.
   - FreeAgents schedule heading, CreateLeague dynasty note.
2. **Trade Center content painting through the footer** (tablet/mobile): the propose grid pinned `h-[calc(100vh-240px)]` at ALL widths while the 12-column layout only exists at `lg+` — below that, stacked cards overflowed the fixed box straight through the translucent footer (screenshotted live). Height now `lg:`-scoped; checked every other `h-[calc(100vh...)]` in the app — all correctly gated behind `hidden lg:block`.
3. **Pick'em standings dead on arrival (server)** — the only console error the whole sweep: `getPickemStandings` called `requireMembership(leagueId, getCurrentUserId())` where `getCurrentUserId()` is a placeholder returning `''` → SECURITY ERROR thrown on **every** standings request, swallowed client-side into a forever-empty table. Route already runs membershipMiddleware; the verified userId is now passed through. Placeholder deleted. Tests updated.
4. **Appearance toggle removed (Profile → Settings)** — live-tested it: "Dark" flipped the app to the legacy **brown** palette, "Light" visibly did nothing, "System" gave different users different apps. It's now a single-theme statement ("Citrus Dark"), plus a cleanup effect that strips the stale `.dark` class/localStorage for anyone who had toggled it.
5. **Notifications bell was a stub** — it navigated to the Matchup page, where the feed only renders in desktop-only rails; on phones a badged bell led nowhere. The bell now opens the real feed in a slide-over on every viewport (portaled to body — same containing-block trap as the mobile menu).
6. **"Claim before kickoff"** → "Claim before puck drop." (football copy in a hockey app).
7. Commissioner **Scoring tab "No scoring catalog found"** — API envelope misread in LeagueSettingsService (fixed earlier tonight, now test-covered by the suite run).

## Verified clean on live (no action needed)
League HQ, League Settings (all 7 tabs), Roster (4 tabs), Free Agents (3 tabs, search, watch-list star round-trip), Players (400-row cap note, goalie toggle, team/position filters, stat-sort — sort is by-design single-direction descending), Waiver Wire (search + chips + settings), GM Office cards, Trade Center both tabs + propose flow (partner select, player select, cancel — nothing submitted), draft-v2 Players/Board/History, Matchup (Week 1, daily strips), Standings, Profile (4 tabs — Delete Account + Export My Data present for App Review 5.1.1(v)), hamburger menu, pick'em pool (Picks/Standings/League), league-mate gating (member HQ shows lobby-wait language, no commissioner tools).

## Known and deliberately deferred (post-launch polish, not broken)
- Armchair GM suite renders as an internally-consistent light widget (cream tiles + dark text — readable, just not dark). Restyling ~20 sites blind on submission night was worse risk than the inconsistency.
- Matchup projection/points tooltips: cream with dark text (internally consistent).
- The dead `.dark` remap layer in index.css and the legacy brown token block: harmless now; delete in a calm week.
- Dead files (never rendered): components/mobile/AppShell.tsx, components/mobile/MobileBottomNav.tsx.

## Files changed tonight (deliver/commit list — all under the repo root)
apps/web/src: services/LeagueSettingsService.ts · pages/WaiverWire.tsx · components/PlayerStatsModal.tsx · components/roster/StartersGrid.tsx · components/roster/IRSlot.tsx · components/roster/BenchGrid.tsx · components/roster/MobileRosterList.tsx · components/gm-office/TeamIntelHub.tsx · pages/Roster.tsx · pages/Matchup.tsx · components/matchup/MatchupSidebar.tsx · components/matchup/MatchupScheduleSelector.tsx · components/matchup/TeamCard.tsx · components/AdSpace.tsx · pages/FreeAgents.tsx · pages/PoolPlayoffBracket.tsx · pages/PoolPlayoffConfidence.tsx · pages/PoolPlayoffRoster.tsx · pages/PoolPlayoffHub.tsx · pages/PlayoffBracket.tsx · pages/DraftRoom.tsx · pages/CreateLeague.tsx · components/trade/TradeReviewSection.tsx · components/trade/TradeGridView.tsx · components/InvitePlayersButton.tsx · components/PoolLeagueHub.tsx · components/draft/RosterDepthChart.tsx · pages/TradeAnalyzer.tsx · pages/Profile.tsx · components/Navbar.tsx
server/src: services/PoolService.ts · routes/pools.ts · __tests__/PoolService.test.ts

## Your morning (unchanged from the runbook, plus these files)
```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
git add -A
git commit -m "Evening sweep: dead-dark-variant eradication, pickem standings fix, theme toggle removal, bell slide-over, trade footer overlap"
git push
```
Then the CI/regional-builds check and manual deploy fallbacks exactly as in MORNING_RUNBOOK_2026-08-24.md. After deploy, spot-check: player card stat boxes (dark tiles), GM Office day strip, pools League tab join code readable, Trade Center on a narrow window (no footer bleed), Profile Settings (no theme toggle), bell opens the feed, pick'em Standings tab populates once a week is scored.
