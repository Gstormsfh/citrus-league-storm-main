# Mobile render harness

Renders **real pages and real components** at a phone viewport, with auth, the
league context and the network replaced by stubs — so a screen can be looked at
and measured without signing in, seeding a league, or standing up the API.

Not part of any build. `apps/web/vite.config.ts` is untouched; this directory
carries its own config and is only reachable by pointing Vite at it.

```bash
cd apps/web
npx vite --config harness/vite.config.ts
```

| URL | What it renders |
| --- | --- |
| `/harness/page.html?p=waivers` | WaiverWire, real component |
| `/harness/page.html?p=settings` | Commissioner settings, all tabs |
| `/harness/page.html?p=contact` | Contact |
| `/harness/cards.html` | HockeyPlayerCard gallery + MobileRosterList |
| `/harness/draft.html` | DraftRoomV2, live clock, scripted picks |
| `/harness/tabs.html` | Roster tab bars |
| `/harness/slot.html` | MobileRosterList + Line Change sheet, page-shaped wiring |
| `/harness/today.html` | Today strip in every state, locked chips, empty rows, Fill sheet (`?fill=slot-LW-1` opens it), Auto Lineup preview (`?auto=1` opens it; the strip's link does too) |
| `/harness/scoreboard.html` | League scoreboard strip (live / open / final / bye) and the desktop rail; `?n=10` for a 20-team league |
| `/harness/advanced.html` | `PlayerAdvancedCard` (PWS-1) — skater compact + expanded, defenceman, goalie, thin sample, and both degraded (401 / unknown player) states. `?w=NNN` sets the column width; default 353 is what the card gets inside `PlayerStatsModal` at 393. Identity is real; the xG/GAR/projection columns are derived arithmetic, and the page says so |
| `/harness/dashboard.html` | `PlayerDashboard` (Component 6.5) — the whole page at a phone viewport. `?case=skater\|defence\|goalie\|empty\|noshots\|skewed` picks the state: a forward with a season of shots, a defenceman (point-heavy zones), a goalie (GSAx hero, no rink), a player with nothing on record, a FAILED shot read, and coordinates that disagree with their own stored distances. Identity is real; the shot coordinates, per-shot xG, season rows and GSAx are generated, and a strip under the page says so |
| `/harness/matchup.html` | The mobile matchup lineup rows — real `MatchupPositionGroup` / `PlayerCard` / `CenterColumn`, week view, bench, day view, live and final states |

`draft.html` accepts `?picks=N` to open the room N picks deep (default 5), and
exposes `window.__harnessAdvance()` so a script can drive the draft forward one
pick at a time.

`matchup.html` mounts the rows directly rather than the page: `page.html?p=matchup`
renders "No matchup data available" because the harness stubs the three league GETs
and not `MatchupService`, so the rows it exists to show never mount there. The rows
themselves need only two arrays of players.

## The roster is real

Every surface above draws its players from `harness/players.ts`: **60 real NHL
players** — real names, teams, sweater numbers, NHL player ids and 2025-26 stat
lines, read out of the production `players` table on 2026-09-02. The first 18
are a legal 18-man roster (5×C, 3×LW, 3×RW, 5×D, 2×G), so any entry point that
slices the head of the list gets a lineup a manager could start.

**Faces come from the NHL CDN**, at the exact URL shape production stores:

```
https://assets.nhle.com/mugs/nhl/20252026/<TEAM>/<nhlId>.png
```

**A machine with no route to `assets.nhle.com` still shows crests or
initials.** `Mug` falls back headshot → team crest → initials on a forest
disc, and the crest is served from the same host — so on a sandboxed or
offline machine you will see initials discs, and that is the fallback working,
not the fixture being empty. Check the request, not the pixels: every row asks
for its own mug URL. If you need to prove it, open DevTools → Network and
filter on `assets.nhle.com/mugs/`.

Until 2026-09-02 the fixtures did the opposite. Three of them set
`headshot_url: null` and the rest carried no face field at all, so every
harness screenshot the repo has ever produced shows initials discs on every
row — while production serves a headshot for all 801 rows in `players`. Two
fixtures also synthesised names, wrapping a short list with a counter
("Connor McDavid 2") or numbering rows outright ("Roster Player 01"). The
regression test at `src/__tests__/harnessFixtureFaces.test.ts` fails the build
if either comes back.

The draft pool is the one place the roster CYCLES: it needs 240 rows and the
roster has 60, so four rows read "Connor McDavid", each with its own id, rank
and stat line. A fixture repeating is something a reviewer can see; a counter
welded onto a name is not.

## What is stubbed, and what is not

Only the **transport** is replaced. The state machine (`reduce`),
`deriveDraftState`, every component and all of Tailwind are the real modules —
so what renders here is what renders in the app.

| Aliased | Replaced by |
| --- | --- |
| `@/contexts/AuthContext` | signed-in stub user |
| `@/contexts/LeagueContext` | one fixed league |
| `@/api/client` | routes the three league GETs from fixtures |
| `@/lib/draftClient/runner` | scripted snapshot + events, no WebSocket |
| `@/lib/draftClient/fetchDraftOrderMatrix` | 12-team snake matrix |
| `@/lib/draftClient/submitPick` | always succeeds, advances the draft |
| `@/hooks/usePreloadedPlayers` | 240-player directory, the real roster cycled |
| `@/integrations/supabase/client` | an inert client — every call resolves `{ data: null, error }` |

The Supabase alias is not optional plumbing. The real module calls
`createClient(...)` at MODULE SCOPE and throws when `VITE_SUPABASE_*` are
unset, which they are here on purpose. `Navbar` reaches it four hops down
(`notificationStore` → `NotificationService` → the client), so any harness
entry that renders a page with the app chrome used to mount a blank
`<div id="root">` with the error visible only in the devtools console.

Stub context values are **module-level constants**, deliberately. Returning a
fresh object per render makes every consumer's dependency array compare unequal
by identity, which produces an infinite render loop rather than a page.

## Why this exists

Defects found with it that unit tests could not see, because jsdom has no
layout engine: a scroller 84px taller than the box clipping it; a player name
resolved to a 9px box; a status chip wrapping mid-score; and `position: sticky`
being inert app-wide because `body` had been made a scroll container.

Measure in a real browser, then write the source contract as the regression
test. The harness finds it; the test keeps it fixed.
