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

`draft.html` accepts `?picks=N` to open the room N picks deep (default 5), and
exposes `window.__harnessAdvance()` so a script can drive the draft forward one
pick at a time.

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
| `@/hooks/usePreloadedPlayers` | 240-player canned directory |

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
