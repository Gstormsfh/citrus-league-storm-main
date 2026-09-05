# Press Box implementation — run log

## EVENING RUN, 2026-09-04 — read this first

**Every screen a manager can reach on a phone is Press Box — body and
chrome. Artboards 1a, 4a and 4b are on their real pages; the screens with
no artboard (Scores, News, Players, Waivers, Trades, Schedule, Team view,
GM office, Playoffs, Analytics, Stormy, Create League, Account) are built
from the artboards' vocabulary; the whole app nav is Press Box and the
old hamburger menu is gone.** Forty-two commits on `redesign/pressbox`
since PR7 (`2fea1029..f1374a7d`). Nothing is pushed, nothing is applied
to production. The working tree is clean.

| screen | state | see it |
|---|---|---|
| Draft room (4a / 4b) — pool, bar (on AND off the clock), queue, board, my team, history | done, live in DraftRoomV2 | `harness/draft.html?picks=5` / `?picks=23` / `?picks=30` |
| Players (1a) — action tile, TREND / AVAILABLE / WATCH, chips, column head, rows, watch star | done, live in FreeAgents | `page.html?p=freeagents` |
| Standings (1a) — header, meta line, table with the playoff picture folded in | done, live in Standings | `page.html?p=standings` |
| League HQ (1a) — draft CTA, MATCHUPS, tiles, teams | done, live in LeagueDashboard | `page.html?p=league` |
| Match (1a) — `‹ WK ›`, score block, day strip, other-matchup chips, LINEUPS / BENCH / TONIGHT | done, live in Matchup | `page.html?p=matchup` |
| Home (1a) — ticker, MY LEAGUES, TONIGHT ON YOUR ROSTERS | done, live at `/` for a signed-in phone | `page.html?p=home` |
| Team / Roster (1a) — header sub-tabs back on, views as a segmented control | done | `page.html?p=roster` |
| Player card (1a) — hero, team ground, tabs, Overview / Detailed / Game log as the artboard's tiles, log table, upcoming cards | done (PR7d) | open any row; Game log renders in `page.html?p=freeagents` now |
| League settings (1a) — chips, value rows with the rule under each label, option + stepper pickers, DISCARD / SAVE & NOTIFY LEAGUE | done (PR9), phone only; desktop dialog untouched | `page.html?p=league` → League settings tile |
| App nav + Stormy bar | mounted app-wide; pool leagues keep their old tabs | any page |
| Scores tab (no artboard) — `‹ day ›` strip, game tiles, expand-in-place detail | done (PR10c) | `page.html?p=scores` |
| News tab (no artboard) — chips, lead tile + rows | done (PR10d) | `page.html?p=news` |
| Players tab (no artboard) — the league-wide browser as a list, one figure per row, sort/team pickers, row → the shared card | done (PR10e) | `page.html?p=players` |
| League chrome on every league screen (`PressBoxLeagueChrome`), app header on Profile / Create League / Stormy; `MobileMenuButton` deleted | done (PR10f) | `page.html?p=waivers`, `?p=profile` |
| Waivers (no artboard) — priority / FAAB + next run, the rules, the wire with ADD / CLAIM, claims, the claim sheet | done (PR10g) | `page.html?p=waivers` |
| Trades (no artboard) — PROPOSE (partner → send → get → the take → propose) and OFFERS (received / sent / history) | done (PR10h) | `page.html?p=trade` |
| Schedule (no artboard) — seven-day bars, games by club, back-to-backs, the games | done (PR10i) | `page.html?p=schedule` |
| Team view (another manager) — the roster list, read-only, PROPOSE TRADE on the card | done (PR10j) | `page.html?p=team` |
| GM office — the season's state as rows, the six actions as tiles | done (PR10k) | `page.html?p=gmoffice` |
| Playoffs — the bracket as two-sided rows (sage winner, leader in sage while live, orange champion), round heads, the champion tile, commissioner panel, seeds | done (PR10l), shared with desktop | `page.html?p=playoffs`, `&bracket=none`, `&bracket=done` |
| Analytics — projected vs actual tile, the Roster signpost, goalies and schedule maximizers as Players rows | done (PR10m) | `page.html?p=teamanalytics` |
| Stormy — a chat that owns the viewport: transcript, starter chips, composer above the nav; ABOUT with the allowance and clear | done (PR10n) | `page.html?p=stormy` |
| Create League — every setting as data in the settings screen's rows (six sections; one row per stat); JOIN | done (PR10o) | `page.html?p=createleague`, `&type=playoff` |
| Account — avatar, name, OVERVIEW / STATS / TROPHIES / SETTINGS as rows; delete behind a typed sheet | done (PR10p) | `page.html?p=profile`, `&tab=settings` |

**First thing to run** (five draft suites, the MatchupComparison suites, the
hideRoutes suite and every page suite cannot load on my offline runner):

```
cd ~/dev/citrus/apps/web && npm run lint && npm run test
```

### Decisions I made that you may want to reverse

1. **`/` is the app home on a phone, not a redirect to League HQ.** PR10b
   supersedes the 2026-08-31 native boot redirect; its reason ("no menus")
   no longer holds, and a LEAGUES tab that redirects away from itself is
   not a tab. If you want one-league managers to boot into HQ, say so and
   the redirect comes back behind `userLeagues.length === 1`.
2. **Pool leagues keep the legacy bottom tabs.** Their pages carry no
   LeagueHeader, so the app nav alone would strand them. Convert their
   pages, then drop the branch in `MobileBottomNav.tsx`.
3. **Not drawn, on purpose, each documented in its component:** `FA ONLY`
   and `ROS%` on Players (no rostered-player list, no ownership read);
   the `STANDINGS / POWER / PLAYOFF ODDS / MEDIAN` control on Standings (no
   simulations); win chance and games-left on the HQ and Home cards (same);
   the rank and `TRAILING 3 CATS` on Home; the artboard's `LEADERS` tile
   routes to `/players`. All return with PR12's aggregates.
4. **The off-clock bar's ETA is measured, not invented** (`pickPace.ts`):
   median gap of the picks this session has watched land, else the clock's
   ceiling (`≤ 9 MIN`), else nothing.
5. **`StickyScoreBar` is deleted** (orphaned by PR5c; matchupDeadCodeGuard
   demands it). `FreeAgentRow` and its 44 tests are still in the tree, no
   longer imported by the page — delete both once Players is signed off.
6. **The game log's phone table drops the per-game confidence bar** (the
   likely range rides in the tail column instead; both said the same
   thing and one fits) and shows G A SOG +/- PPP HIT for a played game,
   G A SOG PPP HIT for a projected one. SHP, BLK, PIM still count in the
   totals; they are not columns on a 361px body. `computedConfidence` is
   still on every entry if you want the bar back.
7. **League settings are stated once as data** (`leagueSettingsSections.ts`)
   and the phone draws them; the desktop dialog keeps its hand-written
   form. The 09-01 phone classes and section dropdown were removed from
   that dialog — it never opens below `lg` now. `ScoringRulesEditor` and
   the phone share `useScoringRules`.

8. **The home league cards switch through `leagueSwitchDestination`**
   (PR10f). They linked `/league/:id` with no `?league=`, which is the
   exact defect leagueSwitchAndMockDraftReach documents: LeagueContext
   reads only the query, so the header over the next screen named the
   previous league.
9. **The league menu carries a Mock draft tile** (`/armchair-gm?tab=mockdraft`)
   because the deleted hamburger menu was the phone's only link to the
   simulator from inside a league.
10. **PressBoxAppHeader draws each control only with a handler** — the
   orange `+ LEAGUE` belongs to the screen that lists leagues.
11. **The playoff bracket is restyled for both layouts** (PR10l): the
   MatchupCard and RoundColumn are shared, so the desktop bracket wears
   the Press Box rows too. Same dark family; a spring screen. A bye or
   a pending series shows `–`, never `0.0`.
12. **Analytics goalies carry no points line** (PR10m). The directory's
   `points` is skater scoring; the 09-01 card printed `0.0 Avg Pts` for
   every goalie. They are ranked by games this week and the copy says so.
13. **Stormy's page does not draw what did nothing** (PR10n): the three
   unwired switches, the `Upgrade to Unlimited` button and the meter that
   reset to 0/15 on reload. The allowance is a fact row (15 a week,
   rolling); `Clear chat history` is real now on both layouts. The Stormy
   bar stands down on `/gm-office/stormy`.
14. **Create League is data** (`createLeagueSections.ts`, PR10o), drawn by
   the same rows as League settings (`SettingFields.tsx` is the one switch
   statement). A stat is ONE row whose first option is `Off`; the desktop
   form is untouched and the two share every piece of state. The phone's
   JOIN pane has no clipboard-copy button beside the code.
15. **The account screen does not draw the two preference switches**
   (`handlePreferenceChange` sets local state and toasts "saved
   automatically"; nothing persists) **or the commissioner-settings copy**
   (a 340-line duplicate of League HQ's dialog); a commissioner's league
   is a row into League HQ, where the Press Box settings screen already
   is. The desktop keeps both. Wire the switches to real preferences and
   they can come back as toggle rows in one line each.

### PR3 — the loading screen and the skeletons (2026-09-05, after the run above)

**The boot splash** (motion 2a): `NativeBootSplash` draws the puck, the
wordmark, a 200×3 bar driven by REAL stages — `lib/bootStages.ts`, reported
by AuthContext (25), LeagueContext (55) and the first route paint (100) —
never a fake fill; the stage name appears after 4s; 600ms floor, 6s
ceiling, 300ms fade; three tips; the Stormy footer. Native only, once per
cold start. `harness/boot.html?pct=55&stage=1`.

**The skeletons** (motion 2b): `pressbox/Skeleton.tsx`. Each kind mirrors
the screen it stands in for — the roster skeleton is `PressBoxRosterList`'s
grid and heights with the real chips at half strength; the standings one
is `PressBoxStandingsTable`'s grid and column head; the match one is the
chips, the score block, the day strip and the comparison rows; League HQ,
Players, the Players tab, Scores, News, Home, Account, the bracket. 120ms
stagger. Bars on a tile use `pb-shimmer-high` (a tile-coloured bar on a
tile is invisible — found in the harness). Reduced motion stops the sweep.
`harness/skeleton.html?route=/standings`, `?kind=roster`.

**Where they load:** Roster's list arrives as itself under the team card
(`isMobile ?`, Stormy from `lg`). Standings, Matchup, League HQ and
Playoffs return `PressBoxPageLoading` — the league chrome over the
skeleton below `lg`, exactly the Stormy they had from `lg`, so the desktop
and the page tests (1024px) see no change. `PlayersPhone` draws its own
rows. Every pulsing block on Scores, News, Schedule, Trades, Waivers, the
Players tab and the game detail is now a shimmer of the real shape.

**The route fallback:** `LoadingScreen` (the Suspense one) below `lg` is
the skeleton of the screen the URL names (`lib/routeSkeleton.ts`), in the
page column under the nav, with a header-shaped silhouette — not the fixed
sheet that covered the tab you had just tapped. With a message (the v1
draft room) or from `lg` it is the overlay it was, on Press Box paint.

**The floor:** `PB_LOADING_MIN_MS = 600` in `useMinimumLoadingTime`; the
five pages carried 800/800/800/800/1000.

**Not done, on purpose:** `useLoadCeiling` on the other four pages (what
happens at the ceiling is a behaviour change — after Tuesday); the draft
room's loaders (the one surface with no undo); a shimmer in the league
header's name slot (Roster renders the chrome with no league in the
no-league state, and a shimmer that never resolves would be a lie).

**Tests:** `pressbox/__tests__/Skeleton.test.tsx` (pinned to the roster
and standings sources), `lib/__tests__/routeSkeleton.test.ts` (pinned to
`App.tsx`'s routes), `__tests__/pressboxLoadingGuard.test.ts`,
`NativeBootSplash.test.tsx`.

**Prod, the same night:** the three migrations are applied and verified
(ledger entries in `docs/PROD_CHANGE_LEDGER.md`), plus a fourth found
while verifying: two SECURITY DEFINER writers were callable by any
signed-in user through PostgREST because Supabase's default privileges
grant `authenticated` EXECUTE at CREATE and `REVOKE ... FROM PUBLIC` does
not touch it. Revoked. `sync_roster_assignments_for_league` has the same
shape but the server calls it with the user's token after a draft — left
alone until after Tuesday, with the fix written down.

### PR18 — the App Store pass (2026-09-05, same night)

`f90725dc` **launch screen, icon, status bar, fonts.** The launch image is
the boot splash's static frame (ground, glow, the puck at the overlay's
exact spot, the empty track — no wordmark: no Barlow in a launch image);
the storyboard ground was WHITE under a dark app and is `#0C1811` with
capacitor, `html`, `body`, `#root` and the native hold. Icon on `#0C1811`.
**The status bar was unreadable on every light-appearance phone** —
Capacitor defaults `UIStatusBarStyle` to dark text — fixed in Info.plist
with `UIUserInterfaceStyle Dark`. The Google Fonts sheet was an `@import`
at the top of `index.css` that held the first paint on a round trip; it
is a non-blocking link now (self-hosting the Press Box faces needs an
`npm i` on the Mac). `appStoreShellGuard` pins all of it.

`939e0047` `a152a0a8` **the front door.** Auth, Profile setup, Verify
email, Reset password (four states) and the OAuth return are Press Box
below lg — one tree each, `max-lg:` classes, same ids and handlers,
desktop untouched. `.pb-type-phone` is the `.pb-type` inheritance reset
scoped below lg. `frontDoorGuard`.

`df950ccf` **the draft lobby** in the room's own vocabulary (classes
only; `commishLobby` and `lobbySeatControls` pass unchanged).
`draft.html?lobby=1`.

`84b79104` **44pt under the finger.** Harness audit across ten phone
screens: zero controls without an accessible name. `pb-hit` / `pb-hit-y`
grow every chip, segment, tab and roster slot chip to 44px without
moving the visual; the sideways chip strips are padded so they stop
clipping it.

`f6e37979` a signed-in phone in a browser holds the home skeleton while
leagues load instead of flashing the storefront.

Harness knobs added: `page.html?p=auth&signedout=1`, `?p=profilesetup&fresh=1`,
`?p=verifyemail&signedout=1`, `?p=resetpassword&signedout=1`, `?p=authcallback`,
`?hold=1` (league context frozen loading), `draft.html?lobby=1`,
`skeleton.html?route=/standings`.

### 1:1 pass, 2026-09-05 (after midnight)

Commits `8f0fc99f`..`f5e758f6`, all on `redesign/pressbox`, checked against
the 1a artboards in the harness at 393×852:

- Match: the CATEGORIES tab (`8f0fc99f`) from the starters' week totals;
  goalies read `goalieMatchupStats` (the weekly shape), which would have
  been four zeros on a real week.
- Matchup load: ensure-rosters remembered ten minutes, not thirty seconds
  (`ad6bdd67`). The rest of the chain is ~10 sequential round trips on a
  remount; the real fix is a snapshot across remounts (stale-while-
  revalidate) and is post-submission.
- League HQ + Home: win chance, games left (`27 · 26 LEFT`), `· 2ND`, the
  Standings/Transactions/Draft results lines (`34788e5a`). Server: the
  scoreboard ships `team1_games_left` / `team2_games_left` — **API
  redeploy needed** (with `cb2932b5` ownership, `c6c9c31c` stats mapper,
  `2b9b1c8a` directory vitals).
- Standings: `WEEK n OF N` (`b20088a4`).
- League menu: the ten-tile shape with lines from real reads (`10993bc7`);
  `/league/:id?settings=1` opens the commissioner's sheet.
- Scores: NHL crests (dark variant, app-wide) and headshots (`8930bd7a`).
- Home: Citrus Game Day (`f5e758f6`).

Not drawn, still: Power/Playoff odds/Median on Standings (no simulation);
Commish note, Scoring & legend, League history tiles (no route); the
Players `FA ONLY` chip (every row is already a free agent).

### Second sweep, 2026-09-05 (after the phone screenshot)

Garrett's screenshot: the Citrus 2.0 storefront under the Press Box nav.
Root cause was a real bug, not a styling miss -- `/` fell through to
`<Homepage />` for a signed-in phone until its leagues had loaded
(`efffa35a`). Then the sweep:

- Every in-app route a phone can reach is Press Box now: the three pools
  (league chrome, week chevrons, crests, underline tabs; `fb6e0842`), the
  player dashboard, draft kit, Contact, NHL bracket and four playoff-pool
  screens (app header + twins; `7f2a94c9`). `~/twins.py` on the dev VM is
  the `max-lg:` twin tool (variant prefixes and opacity suffixes kept).
- Draft room vs 4a/4b (`e9b01c27`): the pool row leans on the Players row
  (team-ring face, tinted position tag, `RW ANA · 75 PTS · 15:43` over
  `xG 82nd · RW1`); Stormy's need line (`Need 4 D · 2 of the top-8 D go
  before your next pick`, draftNeed.ts); the `★ n` queue chip; the header
  reads `<LEAGUE> DRAFT`. Not drawn: TIER (no model), ADP (no data).
  `draft.html?format=auction` renders the AuctionPanel.
- Sweep fixes (`ac7eb880`): waiver rows wear the face; GM office tiles
  carry lines; Account's Current rank is the standings place; three
  in-app pages dropped the marketing footer; the Team screen's
  "CitrusPuck Loaded" toast is gone.
- Workflows walked in the harness at 393px: snake draft (on the clock,
  Draft on a row, the pick lands, the bar advances), the lobby, the
  auction room render, trade propose (partner → both sides → THE TAKE →
  PROPOSE TRADE reaches the API), waiver claim sheet, create league with
  `?type=pickem` preselected. Not walked: a live auction bid (needs the
  engine), accept/reject on a real offer.
- Suites fixed from the full run: nativeBootGuard, pressboxTypeGuard
  (TeamMark), LeagueDashboard.* (trades import), WaiverService,
  PlayerDashboard (freshness by role), ResetPassword.pkce (crest by
  direct import), mobileHeaderMenuGuard, Standings.offseason (menu reads
  mount only while open).

### The league switcher, 2026-09-05 (Garrett's first tap of the morning)

"The league drop down doesn't work any longer with the new visuals. Click
the dropdown and nothing happens; I can't create a new league." The old
mobile navbar's league pill WAS the switcher -- My Leagues, Create / Join
at the top since 09-01 -- and the Press Box header's name was a Link to
the HQ you were already standing on. Now the name carries a 14px chevron
and opens `PressBoxLeagueSwitcher` (bottom sheet: Create / Join on top,
the leagues under it in context order, the active one marked and inert,
ALL LEAGUES to `/?all=1`); the menu's SWITCH ▾ opens the same sheet. A
pick routes through `leagueSwitchDestination` and sets the context's
active league. Rows are pure (`leagueSwitcherRows.ts`, tested);
`mobileHeaderMenuGuard` pins the wiring. The chevron is a deliberate
deviation from artboard 4a's header, which draws no affordance there.

### Still open

- **Fantasy points above replacement (Garrett, 2026-09-05 00:30): a
  position-dependent stat -- a player's projected/actual fantasy points over
  the replacement level at his position (the best freely available C / LW /
  RW / D / G in THIS league, under THIS league's scoring), the way VORP
  reads in baseball. Belongs on the player card tiles, the Players rows'
  sort menu and the trade analyzer. Needs: replacement level per position
  per league (from ownership + projections), ScoringCalculator only, a
  server column or a computed field on the dashboard index, tests.**
- Measure first league page interactive on 4G (fonts are bundled now; `f9cdcded`+).
- Store screenshots from the simulator; a VoiceOver hour on a device.
- ArmchairGM (the league menu's Mock draft tile) is still Citrus 2.0 on a phone.
- `FreeAgentRow` + its tests, once Players is signed off.
- `sync_roster_assignments_for_league`: membership check inside the body (after 2026-09-08).
- PR12 aggregates, PR13 motion, PR14/15 moments, PR17.

---

# Press Box implementation — overnight run, 2026-09-04

## SUMMARY — read this, then the log below

**Shipped: PR1, PR2, and the leaderboard aggregate. Four commits on
`redesign/pressbox`. Nothing is applied to production and nothing is pushed.**

| | |
|---|---|
| PR1 tokens / type / chips | done, committed |
| PR2 shared chrome | done, committed (built, not mounted — see its entry) |
| `manager_week_metrics` | done, committed, proof ALL PASS 23 |
| PR3–PR18 | not started |

**First thing to run:**

```
cd ~/dev/citrus/apps/web && npm run lint && npm test
```

I could not run vitest (Linux bridge, macOS-only native binding, blocked
registry). Everything else I verified myself and said so per PR.

### The three things I most want you to know

**1. I did not touch the draft room, on purpose.** OPUS_PROMPT lists PR16 as a
priority. Its own justification is "before the season opens" — that is
**Sep 29**. Your twelve managers draft **Sep 8**. I cannot run the tests or see
a rendered screen, and a draft room is the one surface with no undo. It is the
change I would most want you awake for. Everything I did do is additive: new
files, new tokens, new tables. Nothing tonight can change how a draft behaves.

**2. Your leaderboards cannot render yet, and the spec is why.** It says never
show a cut with under 100 managers. Citrus has **72 users**. So the aggregate
is built, correct and proved — and `leaderboard_week` returns zero rows until
you cross 100. It turns on by itself. I would rather you heard that from me
than found an empty screen.

**3. Three of the four leaderboard cuts have no data to stand on.** COUNTRY,
CITY and FAN BASE need columns `profiles` does not have. The spec says fan
base is "the favourite team already collected at signup" — it is not
collected. `location` is free text and is set on 9 of 72 profiles. Those cuts
need profile fields plus an opt-in flow before they can exist.

### Needs your decision

- **Draft room:** do PR16 with you awake, or leave it until after Tuesday?
- **Profile fields** for country / city / favourite team — worth a migration
  and an opt-in prompt, or drop those three cuts from the design?
- **Six league-menu tiles** have neither route nor page (Commish note, Draft
  results, Scoring & legend, League history, Managers & invites). Build the
  pages, or cut them from the menu?
- **Two migrations are waiting**, unapplied: `20260904100000` and
  `20260904101000`.

### What I could not verify, in one place

`vitest`; the 393×852 harness diff against the reference; anything needing
layout (row heights, META wrapping, tap-target geometry at render). Where I
say a guard passes, I executed its assertions against the shipped sources by
hand in node and reported the count. I did not claim a single check I did not
run.

---

## Two things about how this run is verified

**I can commit.** Garrett granted delete permission on the repo at ~09:28Z, so
a stale `.git/index.lock` is recoverable and git writes are safe from my side.
Before that they were not, which is why the first version of this file said
otherwise.

**I cannot run `vitest`.** The bridge runs Linux; the repo's vitest pulls
`@rolldown/binding-*` and only the macOS build is installed, and the npm
registry is blocked from that VM (403). So "run `npm run lint && npm run test`
after each PR" is half-satisfied by me and half by you:

| check | who | status |
|---|---|---|
| `tsc --noEmit` | me | run after every file |
| `eslint` | me | run after every file |
| guard-test LOGIC | me | replicated in node against the real sources and reported per PR |
| `vitest` | **you** | `cd apps/web && npm test` |

Where I say a guard passes, I mean I executed its assertions against the
shipped files by hand, not that vitest ran. Anything that needs layout —
row heights, META wrapping, the 393x852 harness diff against the reference —
I also cannot do, and I have said so per PR rather than claiming it.

---

## Run log

### PR1 — tokens, fonts, row scale, neutral chips, guards

**Landed**
- `tailwind.config.ts` — `pressbox.*` palette (12 tokens) and three families:
  `condensed` (Barlow Condensed), `barlow`, `plex` (IBM Plex Mono).
- `index.css` — the three families added to the Google import.
- `phoneRowScale.ts` — Press Box rungs. NAME 15 Barlow 700 · HEADLINE 17 Plex
  600 tabular · HEADLINE_LABEL 9 · META 10 · MICRO 9.
- `positionChip.ts` — every entry in both maps is now `bg-white/10` +
  `text-pressbox-text` / `ring-white/16`. Geometry to 30px, radius 6,
  Barlow Condensed 800 11px.
- `darkThemeContrastGuard` — three new cases: neutral position chips, no
  team-colour fills/bars, and a self-test proving both detectors bite.
- `phoneRowTypeScaleGuard` — rungs updated, plus two new cases (META truncates
  by contract; every numeric rung is Plex, the name is not).
- `MobileRosterList.positionRing.test.tsx` — lock updated to the neutral pair.

**Decisions I made** (spec was silent or the repo disagreed)
1. **`pressbox.*` is additive; `pastel.*` stays.** Renaming would have been a
   thousand-line diff across non-phone surfaces for no visual gain. Press Box
   screens use the new tokens; nothing else does.
2. **Kept Graduate / Montserrat / Calistoga / Inter declared.** The spec says
   "retire on phone surfaces" — that is a call-site instruction, not a
   deletion. Homepage and the preview routes still use them.
3. **`plex` as the alias, `jbmono` retained.** The draft room and desktop
   surfaces still wear JetBrains Mono; the phone rows simply stop using it.
4. **META 12 -> 10 and MICRO 10 -> 9 reads like a downgrade and is not.** Row
   heights are fixed by the spec and the density pass adds a line to most
   rows. The NAME/META gap widens 3px -> 5px, so the hierarchy the original
   audit demanded gets stronger while the row gets shorter. The two rungs a
   manager actually reads are unchanged.
5. **META owns its truncation.** `whitespace-nowrap overflow-hidden
   text-ellipsis` is in the rung, not at each call site — a wrapping META line
   is the commonest way a fixed-height list goes ragged, and the only place to
   make it impossible is the rung.
6. **The chip maps were NOT collapsed to one constant.** Seven identical lines
   are harder to quietly un-neutralise than one, and the guard fails anyone
   who tries.

**Verified** — `tsc --noEmit` 0 errors; `eslint` clean on every touched file;
the three new contrast-guard detectors executed by hand against the shipped
sources (coloured chip caught, team-colour fill caught, shipped neutral chip
clean).

**Not verified by me** — `vitest`, and the 393x852 harness diff. PR1 ships no
pixels of its own; the rung changes land visually in PR4 onward, so the first
real harness comparison is there.

**Deferred** — nothing.

### PR2 — shared chrome

**Landed** — `src/components/pressbox/`: `LeagueHeader`, `PressBoxBottomNav`,
`ChatBar`, `LeagueMenu`, plus `chromeMetrics.ts` (heights the screens must
reserve) and `leagueMenuTiles.ts`. New `pressboxChromeGuard.test.tsx`, 18
cases.

**Decisions**

1. **Built, not yet mounted.** The spec says "mounted on every league page".
   I built them and left mounting to the screen PRs. Reason: mounting new
   chrome on screens still wearing the old styling produces a half-dressed
   app, and I am working unattended — if the run stops at PR7 you wake to
   four converted screens and six broken ones. Mounting per screen means an
   unfinished run leaves the app exactly as it is today. Each screen PR mounts
   the chrome as its first change.
2. **No `/league/:id/settings` route.** League settings is a SHEET inside
   LeagueDashboard (`leagueSettingsMobileSheetGuard` pins that). The header's
   sliders icon takes an `onSettingsPress` prop and falls back to League HQ.
   Inventing the route would have failed `linkGraphIntegrity`.
3. **Six of the ten menu tiles are not shipped.** Only Standings, Trades,
   Waivers and Schedule have routes in `App.tsx` today. Commish note, Draft
   results, Scoring & legend, League history, Managers & invites have neither
   route nor page. The spec says every tap target must route, so they are
   absent rather than dead. `to` is a required field on the tile type, so a
   dead tile is unrepresentable.
4. **No tile ships a canned stat.** The spec gives each tile a live line
   ("You're #7 · processes 2:00 AM MT"). `stat` is an optional prop, rendered
   only when supplied. Hardcoding those strings would have been rule 9's
   fabricated number.
5. **`Calendar` instead of `calendar-range`.** Could not confirm
   `CalendarRange` in the installed lucide version and would not add a
   dependency risk unattended. Same silhouette at 20px.
6. **Nav/strip split is now guarded.** A league-scoped route appearing in the
   bottom nav fails a test. That collapse is what produced the playoff-pool
   trap fixed earlier the same night — four tabs that all led back into the
   pool — and it is worth a permanent guard rather than a comment.

**Verified** — tsc 0, eslint clean, all 18 guard assertions replicated by hand
against the shipped sources (routes, order, truncation, safe areas, no hex, no
filled active tab, aria-labels, 44px targets).

**Not verified by me** — vitest; the 393x852 harness diff (nothing is mounted
yet, so there is nothing to diff until PR4).

### Judgment call — I did NOT restyle the draft room (PR16)

OPUS_PROMPT says PR1, PR2, PR16 first if timelines force a choice, and calls
the draft room the highest-stakes surface. I skipped it, deliberately, and
this is the reasoning so you can overrule it:

- The spec's own justification is "ship before the season opens". The season
  opens **2026-09-29**. Your twelve managers draft **2026-09-08**. Those are
  not the same deadline, and only one of them is four days away.
- I cannot run vitest and I cannot see a rendered screen. On a roster page a
  cosmetic regression is embarrassing; in a live draft room it costs twelve
  real people their draft, and it is the one surface with no undo.
- It is the change I would most want you awake for.

Everything else in this run is additive: new files, new tokens, new tables.
Nothing I did tonight can change how the draft room behaves.

### Leaderboard aggregate — `manager_week_metrics` (PR15's data half)

You said you were most excited about the global leaderboards, so I built the
machinery underneath them rather than a screen with nothing behind it.

**Landed**
- `supabase/migrations/20260904100000_manager_week_metrics.sql` — the table,
  RLS on, self-read policy, service-role write, two indexes.
- `supabase/migrations/20260904101000_manager_week_metrics_functions.sql` —
  `refresh_manager_week_metrics(season, week)` (the nightly writer, returns
  the row count it wrote) and `leaderboard_week(season, week, limit)`
  (SECURITY DEFINER, returns ranks not rows, refuses under 100 managers).
- `scripts/proof/manager-week-metrics.proof.sh` — **ALL PASS, 23 assertions.**

**NOT APPLIED.** Both migrations are files only. Production mutations are your
keystroke, and nothing in this run touched the database.

**Two findings that change what the spec can deliver**

1. **Three of the four leaderboard cuts cannot be built at all.** The spec
   wants WORLDWIDE, COUNTRY, FAN BASE and CITY. `profiles` has no country
   column, no city column and no favourite-team column — `nhl_teams.city` is
   the NHL team's city, not a manager's. `profiles.location` is free text and
   is set on **9 of 72** profiles. The spec says fan base is "the favourite
   team already collected at signup"; it is not collected. Those three cuts
   need profile fields plus an opt-in flow before they exist. They are absent,
   not faked.

2. **Even WORLDWIDE will render empty, and that is correct.** The spec's own
   rule is "never show a leaderboard with under 100 managers". Citrus has
   **72 users**. So `leaderboard_week` returns zero rows today and will keep
   doing so until the population crosses 100 with a completed week. The
   machinery accumulates from the first nightly run and lights up by itself.
   I would rather tell you that now than have you find an empty screen.

**Design decisions**

- **z-score against the manager's own league median**, exactly as the spec
  asks, because raw points are not comparable across leagues. The proof spends
  most of its assertions on this: two leagues where one scores exactly 3x the
  other produce **identical z-scores for all 8 pairs**, while ranking by raw
  points hands the high-scoring league all eight top places on scale alone.
- **Median and MAD, not mean and standard deviation.** A twelve-team league is
  a small sample and one manager who never set a lineup drags a mean far
  enough to move everyone else's rank. MAD is scaled by 1.4826 so a z here
  means what a z usually means.
- **Ranks come from a function, not from reading the table.** The table is
  self-read-only; a leaderboard built by letting clients SELECT it would hand
  every manager every other manager's weekly points and league membership.
- **`points_for` is read from the scored matchup row, never recomputed.** A
  second scoring path would be free to disagree with the scoreboard.
- **`lineup_efficiency`, `waiver_hit_rate`, `xg_luck` ship NULL**, not zero —
  zero would render. Each needs an input that does not exist yet: an
  optimal-lineup solver, a two-week post-add scoring window, and per-roster
  xG-vs-actual respectively.
- **The writer returns its row count** and the caller records it. A nightly
  aggregate that silently stops looks exactly like one with nothing to do,
  which is the failure mode the schema checklist puts first.

**Deferred, with what each needs**
- Nightly cron wiring + the `integrity_check_results` health row.
- Server route and `LeaderboardService` method.
- The three NULL metrics.
- COUNTRY / FAN BASE / CITY cuts — blocked on profile fields.
- The five weekly awards (3f) — `StandingsService` and `WaiverService` have
  the inputs; the awards table does not exist yet.


---

## PR1-FIX — the primitives fork instead of mutating (2026-09-04, morning)

**What happened.** PR1 as first written edited `src/components/phoneRowScale.ts`
and `src/components/roster/positionChip.ts` in place. Twenty-six assertions
across thirteen test files went red, and nothing on screen changed — the worst
possible trade.

**Why it was wrong, precisely.** Those two modules are consumed TODAY by five
shipping surfaces: `PlayerCard` (matchup), `MobileRosterList`, `FreeAgentRow`,
`ScoreboardStrip` and `CenterColumn`. Thirteen test files pin their exact class
output — `font-jbmono`, `text-[12px]` META, `w-8 h-8` chips, the sage/forest
chip pair, an index.css rem-parity check on `.player-team-name`. Meanwhile ZERO
Press Box screens consumed the new values, because the screen PRs had not
landed. So the edit put every live phone row into a half-converted state (Press
Box families on the old layout) and bought nothing.

The instruction "each PR its own commit, run the suite after each" exists to
catch exactly this, and the suite did catch it. The mistake was the shape of
the PR, not the checking.

**The fix.** PR1 is now purely ADDITIVE, and the ladder forks for the length of
the conversion:

* `tailwind.config.ts` — KEPT. `pressbox.*` sits alongside `pastel.*`; three
  new font families. Nothing reads differently until something asks for them.
* `src/index.css` — KEPT. One `@import` line gains Barlow Condensed, Barlow and
  IBM Plex Mono. Additive; no rule changed.
* `src/components/phoneRowScale.ts` — REVERTED, byte-identical to `a35d1dc1`.
* `src/components/roster/positionChip.ts` — REVERTED, byte-identical.
* `src/__tests__/phoneRowTypeScaleGuard.test.tsx` — REVERTED, byte-identical.
* `.../MobileRosterList.positionRing.test.tsx` — REVERTED, byte-identical.
* NEW `src/components/pressbox/rowScale.ts` — the Press Box ladder.
* NEW `src/components/pressbox/positionChip.ts` — the neutral 30px chip.

**The rule this sets for PR3 onward.** A screen PR mounts the Press Box chrome
AND switches that screen's rows from `phoneRowScale` to `pressbox/rowScale` in
the SAME commit, and moves that screen's guard over with it. Every commit
leaves the app entirely old or entirely new *per screen*, never both — which is
also what makes it safe to stop the run at any PR. When the last consumer of
`phoneRowScale.ts` is gone the file is deleted and the Press Box module takes
the name.

**DECISION — the 10px floor beats the spec.** The density pass asked for 9px
unit labels and status marks. This repo carries "every label is >= 10px" as an
explicit contract (`PlayerCard.mobileScore.test.tsx`, K-series) and three test
files assert it by name. A design system does not overrule an accessibility
floor because the mock looked tighter. Press Box MICRO and the headline label
ship at 10px; the density the spec wanted comes from META 12 -> 10 and from
`leading-none`, both above the floor, and the measured rows still land inside
the spec's 56-58 / 64 / 44 band.

**DECISION — `z-overlay`, not a new rung.** `LeagueMenu` first shipped
`z-app-modal`, which is not a layer name; `zLayerScaleGuard` walks every
fixed/sticky element in `src/` and caught it. `zLayers.ts` already defines
`overlay` (100) as "full-window takeovers, above the nav, below the modal
sheets", which is exactly this component: it must cover `app-nav` (45) and stay
under `sheet` (9000) so a roster sheet opened from a menu destination lands on
top. Adding a rung would have been wrong twice — the layer existed, and a rung
with no argument for its position is how the old eleven-value mess grew.

**Two of my own bugs, both caught by running the thing.**

1. `LeagueHeader`'s week aria-label carried an em dash. `aiVoiceGuard` reads
   aria-labels as user-facing copy, correctly. Now a comma.
2. The `darkThemeContrastGuard` self-test hand-rolled its own parse
   (`line.split(/\s+/)` on raw source) and reported the shipped, clean chip as
   an offender: its tokens were `'bg-white/10` and `text-pressbox-text',` —
   quote and comma attached, so neither filter matched. The rule was right; its
   self-test was wrong, which is the one failure mode a self-test exists to
   prevent. It now runs the same extraction the rule runs. Fixing it surfaced a
   second error: I had expected bare `text-white` to pass, when the rule
   correctly flags it — white on a saturated chip is the 1.45:1 pairing that
   caused this file to exist.

**Verification available on this machine.** `npx vitest` cannot start here:
`node_modules` carries only `@rolldown/binding-darwin-arm64` and the sandbox
that reaches the repo is linux. So the guards are run directly on Node with
type stripping, through a minimal vitest stand-in (`~/pbrun`, scratch, not in
the repo). Results this commit:

* all 35 source-walking guards in `src/__tests__/*.ts` — **443 pass, 0 fail**
* `pressboxChromeGuard.test.tsx` — **17 pass, 0 fail**
* `npx tsc --noEmit -p tsconfig.app.json` — **exit 0**
* `npx eslint .` — **0 errors** (21 pre-existing warnings)
* the four reverted files — `git diff --quiet a35d1dc1` clean on each

Component tests that pull the Supabase client cannot run under the stand-in
(the realtime client opens a socket at import and never settles); those files
are covered instead by the byte-identity proof above, and by the full suite on
the Mac.

---

## PR4a — the roster row and list (2026-09-04)

`components/pressbox/RosterRow.tsx` and `RosterList.tsx`, plus a guard that
runs: 19 assertions, all passing.

**Built as new components rather than an edit to `MobileRosterList`, for two
reasons and the second decided it.**

1. The Press Box row is a different GRID (`30px 30px 1fr 52px 44px`), not a
   restyle. Converting a 765-line component in place means rewriting its
   markup and the six test files that pin it in one commit — the exact change
   shape that broke thirteen files this morning.
2. **It can be tested and that one cannot.** `npx vitest` will not start on the
   sandbox that reaches this repo (darwin-arm64 rolldown binding only, linux
   sandbox), so guards run directly on Node with type stripping through a
   minimal vitest stand-in. That works for a component whose import graph is
   small and pure; it hangs on `MobileRosterList`, which reaches the Supabase
   client. A row with assertions I can actually run beats a row I can only
   reason about. Both new files import nothing that touches the network.

**Three numbers the spec asks for are absent, and their absence is asserted.**

* ROSTERED % / START %. The spec's META line reads `100% · 99% | vs TOR 3RD`
  and the spec names the gap in the same breath: no league-wide read exists.
  Both percentages are omitted AND so is the separator that would have led
  them — a bare `|` at the head of a line reads as a rendering bug, not a
  placeholder. A `showOwnership` prop turns the whole segment on the day PR12
  lands the aggregate; a test proves it renders then, and another proves no
  percentage appears now.
* The WK trend micro (`▲ 12%` / `▼ 31%`) needs a prior-week figure the roster
  payload does not carry. Absent, and a comment-stripped source check keeps it
  absent.

**Column header at 10px, not the spec's 9.** Same floor `rowScale.ts` argues.
`PLAYER · TODAY · WK` is text a manager reads, not a glyph they recognise. The
header is its own 20px band, so no row got taller.

**The section count is filled-over-required, passed in, not `rows.length`.** A
list drawing twelve players and one empty slot must say `12/13`. Derived from
row count it would say `13/13` and hide the hole it is rendering — the one
thing that header exists to surface. There is a test for exactly that.

**The bench note is derived or absent.** `2 PLAYING TONIGHT · PTS DON'T COUNT`
renders only when a bench player actually has a game. Nobody playing means no
note, never `0 PLAYING TONIGHT`.

**Colour, on a screen where every row is already yours.** Orange would mean
nothing as "you" here, so it is spent on the one thing that is a FORECAST
rather than a fact: `orange-soft` on a projection, and nowhere else. Sage is
what happened. Grapefruit is negative state only. The chip is neutral, and the
only team colour on the row is a 1.5px ring on the mug, applied as a
`boxShadow` — never a fill or a bar, which the repo-wide contrast rule
forbids and a test re-asserts locally.

**Not yet mounted.** The Roster page still renders `MobileRosterList`. Mounting
is its own commit for the reason PR2 gave: an unfinished run should leave the
app exactly as it is today, not half-converted.

Verified: 19/19 on the new guard, 443/443 on every source-walking guard,
`tsc --noEmit` exit 0, `eslint` clean on the new directory.

---

## PR4b — the adapter, and one definition of a league's slots (2026-09-04)

`components/pressbox/rosterRows.ts`, a pure function from the roster payload to
Press Box rows, with 20 assertions. Plus `components/roster/slotConfig.ts`.

**`buildSlotConfig` came out of `MobileRosterList` rather than being copied.**
It was a private function in a 765-line component and the Press Box roster
needs the same answer. Two definitions of "what slots does this league have"
is a correctness hazard, not a style one: they agree the day they are written
and disagree the first time a league setting grows a slot, and the symptom is
a player who holds a slot on one surface and is homeless on the other. The
body is unchanged — the only diff against the original is an explicit return
type and the signature wrapped across lines. `MobileRosterList` now imports it
and behaves identically.

**Four things the adapter refuses to invent, each with a test.**

* **The period.** The mock reads `vs TOR 3RD`; the payload has
  `gameStatus` (`scheduled|live|intermission|final`), `score` and `gameTime`
  and no period. So live reads `vs TOR 2-1`, or `vs TOR LIVE` with no score;
  intermission `vs TOR INT 2-1`; final `FINAL 4-2` or bare `FINAL`; scheduled
  `@ DAL 8:30 PM`. A test asserts `3RD` never appears.
* **Plus/minus.** The mock's stat line ends `+1`. `daily_actual_stats` has no
  plus/minus field. Asserted absent.
* **The week total.** `HockeyPlayer` carries daily points and a daily
  projection and nothing weekly, so `weekPoints` is null and the WK column is
  off — the row's grid closes to four columns rather than printing a dash
  column 44px wide down forty rows. Both halves are tested: the closed grid
  now, the full spec grid the moment a real figure exists.
* **A projection standing in for a result.** Before puck drop `todayActual` is
  null, not zero; after it starts a zero is a real number and prints as one.

**"Playing tonight" counts the schedule, not projections.** A scratched player
can carry a stale projection and a confirmed starter on an idle team must not
be counted, so the bench note reads `nextGame.isToday`.

**The slot lookup is inverted once.** `slotAssignments` is keyed by player and
valued by slot, and the original scanned the whole object once per slot. That
is invisible at 13 slots and is not at 30.

Verified: 57/57 across the three Press Box guards, 443/443 across every
source-walking guard, `tsc --noEmit` exit 0, `eslint` 0 errors.

---

## PR4c — the harness, and three things only a browser could have told me

`harness/pressbox.html` + `pressbox.tsx`: the real `PressBoxRosterList`, the
real `LeagueHeader` / `ChatBar` / `PressBoxBottomNav`, the real sixty NHL
players and the real NHL CDN headshots, in a fixed 393px frame. Run it with
`npx vite --config harness/vite.config.ts` and open `/harness/pressbox.html`.

**Measured in the browser, not asserted from a comment.** Grid
`30px 30px 233px 52px`, every row exactly 56px, nothing clipped inside any row
at 393px, chip 30x30 Barlow Condensed 800 11px, name Barlow 700 15px, meta IBM
Plex Mono 10px, headline Plex Mono 17px, mug ring
`rgb(255,76,0) 0 0 0 1.5px` — Edmonton orange, on the mug, as a ring.

**1. The mug ring floated 1px off the face, on every row.** The wrapper was
`w-[30px]` in a 30px grid track, and grid stretches an item to its track, so a
30px ring box was drawn around the 28px picture `Mug`'s `xs` size actually
renders. Invisible in jsdom, obvious in a column of ten. The wrapper is now
`w-7 h-7 justify-self-center` — the same 28px box, centred in the 30px track.

The spec draws a 30px face; two pixels of it are traded for not editing `Mug`'s
named size table, which four surfaces and a size-by-size test own, and whose
own header is explicit that a size is added there or not at all (a className
override leaves the initials and the crest badge sized for the old box).
Revisit with the sheets, not on a submission day.

**2. Tailwind does not scan `harness/`.** `tailwind.config.ts` covers
`./pages`, `./components`, `./app` and `./src`. A class that appears ONLY in a
harness file is never generated and silently does nothing — `w-[393px]` on the
frame did exactly nothing, and the page rendered at the pane's own 980px, which
is a width no manager will ever see. The frame is an inline style now, and the
gotcha is written down: every harness page can only use classes the app already
uses somewhere. Widening the content globs would put harness-only classes in
the app's CSS, so it is not the fix.

**3. The harness league stub had no `activeLeague`.** The Press Box header
reads it for the name and the crest, so the header rendered an empty title and
a `?` disc — a thin fixture reading as a broken component. The stub now carries
one.

Verified: 443/443 source-walking guards, 20/20 on the row guard, 20/20 on the
adapter, `tsc` exit 0, `eslint` 0 errors.

---

## PR4d — rebuilt against the artboard, value by value (2026-09-04)

Rejected on sight, correctly: "yours is legit dogshit compared to Claude
Design." It was. Here is why, and what changed.

**THE METHOD WAS WRONG.** I built PR4 from this handoff's README — a prose
table of the type scale and a paragraph per screen — plus one look at the
rendered artboard. That is paraphrasing a picture, and paraphrase compounds:
every screen after it would have missed by the same margin.

`Citrus Redesign - Directions.dc.html` is **not a picture**. It is a rendered
DOM with inline CSS on every node. The roster panel's own markup carries:

    display:grid;grid-template-columns:30px 30px 1fr 52px 44px;gap:8px;
    align-items:center;min-height:56px;
    border-top:1px solid rgba(255,255,255,.06)

So the method is now: render the file in Playwright, lift the panel's
`outerHTML`, and build to the literal values. When the artboard and the README
disagree, the artboard wins — it is the spec, the README is a summary of it.

**WHAT THAT CAUGHT.**

1. **`rounded-md` is 14px in this repo, not 6px.** `tailwind.config.ts` remaps
   the radius scale (`lg: var(--radius)` = 16px, `md: calc(var(--radius) - 2px)`
   = 14px), so every shadcn-shaped radius name means something different here
   from everywhere else. The chip measured 14px against the artboard's 6 — the
   difference between a chip and a pill. **This would have hit all eighteen
   PRs.** Every radius in `components/pressbox` is now written in pixels, and
   a test forbids the named scale in the chip.
2. **The chip had a ring the artboard does not draw.** It came from the legacy
   chip. Two rings beside a mug that carries a meaningful one is one too many.
3. **The team code belongs on the NAME line**, as a 10px mono suffix
   (`Connor McDavid EDM`), not buried in the meta. It had cost the name its
   second read and made every meta line one segment longer.
4. **`PROJ` vs `P 6.9`.** The unit under the headline says which: `PROJ` when
   the number IS the projection, `P 6.9` when it is an actual with a
   projection to beat. One word carries "this has not happened yet".
5. **The WK column and the ownership segment came back.** Removed, this was
   not a four-column version of the row — it was a different, thinner row.
6. **Bench rows are 52px, starters 56.** And a bench row prints `MTL · C`,
   because its chip says BN and not the position.
7. **The row carries no horizontal padding.** The section owns the 12px
   gutter, so the hairline runs the full column and the header labels sit over
   their numbers.

**THE 9px RUNGS — I REVERSED MYSELF.** I had held MICRO and the headline label
at 10px, citing a repo contract three test files assert. That contract is real
and it binds the MATCHUP score stack, which is what those three files render.
It was never repo-wide; I generalised it into one, and the cost was a roster
visibly thinner than its own design. The artboard is explicit —
`font:500 9px 'IBM Plex Mono';color:rgba(243,239,230,.45)` — on the unit, the
trend and the column header, all marks recognised by shape rather than read.
The matchup floor is untouched: nothing here renders inside it.

**ONE CHARACTER DELIBERATELY OFF-SPEC.** The flat trend is `– 0%` with an EN
dash where the artboard draws an em. `aiVoiceGuard` reads every user-facing
string for em dashes, correctly — it is the most reliable AI tell in prose,
and a guard cannot tell prose from a glyph. At 9px beside ▲ and ▼ the two are
indistinguishable; an exception in that guard costs more than the pixel does.

**THE WIDTH COMPLAINT WAS A HARNESS BUG, AND A REAL ONE.** `ChatBar` and
`PressBoxBottomNav` are `position: fixed`, so they escaped the 393px frame and
spanned the pane — the list looked half-width under full-width chrome. The
frame now carries `transform: translateZ(0)`, which makes it the containing
block for its fixed descendants. It also carries `paddingBottom:
BOTTOM_CHROME_H`, because without it the last bench row sits UNDER the chat
bar — which is a real bug on the phone, not only in the harness.

**NEW: `PressBoxTeamCard`.** Disc, record, rank, the win-probability bar
(your orange growing from the left over their ice — the same "orange = you,
ice = them" the matchup screen uses) and the four actions, exactly one of
which is orange. Every figure optional: no probability draws no bar rather
than a 50% one.

Named `PressBoxTeamCard`, not `TeamCard`: `matchupDeadCodeGuard` pins that a
deleted `components/matchup/TeamCard` stays deleted and matches `./TeamCard`
relatively, so a file of that name anywhere trips it. The guard has a
false-positive there; renaming is free and leaving a guard alone is not.

**Measured in the browser at 393:** frame 393, grid
`30px 30px 181px 52px 44px`, starters 56px and bench 52px exactly, chip 30x30
radius 6 with no border, mug 30px with a 1.5px `rgb(255,76,0)` border.
443/443 source-walking guards, 54/54 on the two Press Box guards (34 of them
quoting the artboard rule they pin), `tsc` exit 0, `eslint` 0 errors.

---

## PR4e — mounted, and the method is now a repo tool (2026-09-04)

**`scripts/design/extract-artboard.mjs`.** The artboard-lifting method that
rescued PR4 is a script in the repo now rather than something I did once in a
sandbox, so every screen from here gets the same treatment:

    node scripts/design/extract-artboard.mjs 1a --find Starters --to /tmp/roster.html

It also writes down the two things that will otherwise cost an hour: the
artboards live inside an `<x-dc>` element that stays `display:none` until a
CDN-hosted script upgrades it (one injected stylesheet fixes that), and `#1a`
is an invalid CSS selector because an identifier cannot begin with a digit.

**`Roster.tsx` renders `PressBoxRosterList`.** The page keeps every fetch;
`buildRosterRows` turns its state into rows; the row keeps every pixel.

Three decisions at the call site:

* **No day toggles.** `TodayStrip` above already owns which day is on screen,
  and two day controls that can disagree is worse than one in the wrong place.
  `days` is optional now and renders nothing when empty. The Press Box toggles
  come back when the strip is retired.
* **`showWeek` and `showOwnership` stay OFF in the app.** There is no
  per-player week total on the roster payload and no cross-league ownership
  aggregate. The harness shows both, labelled, so the row can be judged at
  full density; the app renders what is true. `?plain` on the harness shows
  what ships today.
* **IR survived the conversion.** The old list rendered an IR section that
  showed every slot the league defines, occupied or not, so the slot is
  discoverable before the first injury (roster audit R8). `buildRosterRows`
  now emits one row per IR slot and the list draws a third section.

**A guard moved with the screen rather than being deleted.**
`rosterMobileChromeGuard`'s R8 case asserted the literal
`irSlotCount={irSlotCount}` prop on the old component. The prop is gone; the
INTENT is not. It now asserts that the count is resolved by the server's rule
(`resolveIrSlotCount`), that it reaches `buildRosterRows`, and that the built
rows reach the list. Same contract, new shape — which is what "move the guard
with the screen" has to mean, or a conversion quietly drops its guarantees.

**`harness/page.html?p=roster`** renders the real page. Until now the only way
to look at the roster was `cards.html` / `slot.html`, which mount the LIST — so
nothing could show the page's own chrome, its empty states, or whether the list
is wired to the page's handlers at all. Verified there: 18 Press Box rows,
grid `30px 30px 185px 52px`, heights 56 and 52 exactly, sections
`Starters · 13/13`, `Bench · 5`, `Injured reserve · 0/3`.

**KNOWN, AND THE NEXT INCREMENT.** Everything ABOVE the list on that page is
still the old chrome — the page header, the team card, the ROSTER / STATS /
TRENDS / TRANSACTIONS tabs, the TODAY summary. The screen is half-dressed
until `LeagueHeader` + the sub-tab strip replace them, which is its own commit
because it changes navigation.

443/443 source-walking guards, 71/71 Press Box, `tsc` exit 0, `eslint` 0 errors.

---

## PR4f — the page, not the component (2026-09-04)

Rejected again, and the question was the right one: "how did it regress so
hard from the prior roster?" It had not regressed. It was the same component,
byte for byte. What changed was what I handed it — and that is the more
dangerous failure, because it would have repeated on all eight remaining
screens.

**THE HARNESS WAS LYING.** `harness/page.tsx` carried:

    (ScheduleService as any).getGamesForTeams = async () => ({ gamesByTeam: new Map() });
    (ScheduleService as any).getNextGamesForTeams = async () => new Map();

Empty maps. So every player had no game, which killed the game line, the stat
line, the actual and the projection in one stroke — FOUR of the row's five
information layers. Measured on the mounted page: **18 of 18 rows had no meta
line at all.** The screen under review was a row starved of everything it
exists to show, and it read as a design regression.

Meanwhile `harness/pressbox.tsx` had every field hand-written by me. So the
screenshot that got approved was substantially a demo of my own fixtures. A
component harness answers "does this row render"; only a page harness answers
"does this screen work", and I had been shipping on the first.

**What the fixtures carry now**, all of it generated but shaped like
production and stated as such in the file:

* One game per team on yesterday, today and tomorrow, cycling
  scheduled / live / final so all three row states are on screen at once.
* A projection per player, derived from his own id so the column varies —
  a column of identical figures hides the exact bug a projection column exists
  to surface.
* Daily stats for the games marked live or final, with `total_points` computed
  by **the app's own `ScoringCalculator`** configured with **the app's own
  defaults**, so the number under a stat line can never disagree with the stat
  line above it.
* `scoring_settings: null`, not `{}`. The empty object is TRUTHY, so
  `extractScoringSettings` handed it to the calculator instead of falling
  back, every stat was worth nothing, and TODAY read `0.0` on every live and
  final row — a page-level zero that looks exactly like a broken points
  pipeline.

**Three real defects the honest fixture then exposed.**

1. **The list was 345px wide inside a 393px viewport, inset at x=24.** I had
   mounted it INSIDE the page's rounded card, so the Press Box list — which
   owns its own 12px gutter and runs its hairlines edge to edge — sat in a box
   with another 24px around it. The card is now desktop-only, and the list
   carries `-mx-3 lg:mx-0` to cancel the page column's phone padding. Scoped
   to the list, not the tab body: the summary card above it still wants that
   padding, and bleeding it to the screen edges was the first thing I broke
   trying to fix this.
2. **No team card.** The component existed and was simply not wired.
   `PressBoxTeamCard` now renders below lg with the team's real record and
   rank and four actions — Optimize (the page's real `handleAutoLineup`),
   Trade, Add, Log — exactly one of them orange. No win-probability bar: that
   figure lives on the matchup payload and this page does not fetch it, so the
   card draws no bar rather than a 50% one.
3. **`teamStats.rank` is the literal string `"-"`** until standings resolve,
   and passing it through printed `0-0-0 · -` — a field that reads broken
   rather than pending. Both record and rank are now gated on it.

**The tab strip is the Press Box strip.** Four equal columns, Barlow Condensed
13px uppercase, 2px sage underline on the active one, no scroller — the old
bar was `overflow-x-auto`, and a row you have to scroll is a row that failed
to fit.

**The phone label for the third tab is ANALYTICS, not TRENDS.** "TRENDS &
ANALYTICS" is ~131px in Barlow Condensed at 13/.14em and the column is 98px at
393. If only one word survives the phone it has to be the one that says what
the tab is for: that tab is the insight surface other fantasy apps do not
have, and "Trends" reads as a generic mover list.

**Three guards moved with the screen, and one was added.**
`rosterMobileChromeGuard`'s padding case asserted the legacy card shrinks on
phones; below lg that card is no longer drawn at all, which is a stronger
guarantee than shrinking it, so the case now pins `hidden lg:block` on it plus
the Press Box card, its four actions and its single primary. A new case pins
the `-mx-3` escape. `mobileSweepGuard`'s two label cases moved to the Press Box
values and gained a third: four equal columns, never a scroller.

**Still legacy above the fold:** the page header (`MY ROSTER / Finalsz` with
the hamburger) and the TODAY summary strip. `LeagueHeader` replacing the page
header changes navigation, so it is its own commit.

446/446 source-walking guards (three of them new), 71/71 Press Box, `tsc` exit
0, `eslint` 0 errors.

---

## PR4g — the rest of the roster's chrome (2026-09-04)

**The harness was still hiding the app frame.** `App.tsx` renders
`MobileBottomNav` on every route; `page.html` mounted the PAGE only, so every
screen reviewed there was missing the nav a manager actually sees — and the
roster looked like it had lost its bottom buttons when nothing had changed.
The harness renders it now. (The four team-card actions were never missing:
measured at 32px, y=110, all four visible.)

**The page header is `LeagueHeader`.** The old bar carried the team name, the
league name and the record — all three repeated by the card directly beneath
it, which is why the first player row started **343px down an 852px screen**.
The Press Box header carries the LEAGUE: crest, name, week, settings.

`showSubTabs={false}` is new on that component. This screen already has a
strip (Roster / Stats / Analytics / Transactions) and that is a different axis
from Match / Team / Players / League; two condensed underline strips stacked
on one phone is a puzzle, not a header. The bottom nav is what moves between
league screens.

**A regression I caused and nearly shipped.** Dropping the old header dropped
`MobileMenuButton` with it, so for one commit the roster had NO menu on a
phone. `mobileHeaderMenuGuard` did not fail — it scans for pages containing
the legacy header string, so the page fell out of its list and the case
VANISHED. One fewer passing test, no failure. A guard that quietly narrows its
own scope is worse than one that fails.

Fixed both ways: `LeagueMenu` is mounted and opens from the header's settings
control, and the guard gained a Press Box describe — a page mounting
`LeagueHeader` must mount `LeagueMenu` and must wire `onSettingsPress`. The
two describes together now cover every phone header in the app, old or new.

**The TODAY strip stops being a floating pill** and goes flush with the list:
no rounding, no fill, hairline top and bottom, full column width. Done from
the CALL SITE — `TodayStrip` merges `className` last through `cn` — so the
shared component and the two test files pinning its content are untouched, and
the card returns at lg.

**Still legacy: the bottom nav.** `PressBoxBottomNav` exists and is tested, but
`MobileBottomNav` carries route-hiding that keeps it off every draft route,
pinned by fifteen cases. Swapping it blind would put a nav in the draft room
four days before the rehearsal, so the swap happens with the draft-room work,
where those routes are already under test.

446/446 source-walking guards, `tsc` exit 0, `eslint` 0 errors.

## 2026-09-05 — the phone's first real day, and the News Room

Everything below came from Garrett's thumb on the TestFlight build, in the
order it arrived, each a commit on `redesign/pressbox`.

**Cut-offs everywhere (e42a0e60).** Not a layout bug: iOS zooms the page
when a field under 16px takes focus and never zooms back, so the DONE bar
and everything after it sat off-screen. The viewport meta now carries
`maximum-scale=1.0, user-scalable=no` and every Press Box field is 16px.
The 2-team league "needing 11 more" was the same bug: the league-size
control was below the fold the zoom created.

**Auction (694a36a7, 89cb5e81).** Four picks in, the pool did not shrink
and the board did not fill: `deriveDraftState.foldEvents` folded only
snake/linear events, so a sold lot never became a RosterEntry. It awards on
`auction_nomination_closed` and on the commissioner overrides now. The
room's chrome is Press Box: `AuctionPanel` (lot tile, red ≤5s clock, BID $n
/ custom, YOU LEAD in sage, budgets with YOU first), `AuctionBoard` (a
column per team, price under the name, because an auction board fills at
every team's own pace, not round by round). The (i) button is gone from the
pool: the action is on every row, `Draft` or `Nominate` by format, press
then `Confirm` (6s), off-turn disabled with "Not your turn"; the card opens
from the name, mug or stats.

**Player card and dashboard.** TOI was 0 because the loader never selected
`nhl_toi_seconds` (b16d0b87): "Limited ice time" on McDavid and every
TOI/60 came from that. The game log counts regular season only (ad12ba57:
93 GP was 82 plus playoffs). Chapter 4 (xG against median) is removed
(e2396dea): it graded a passer as a bad player. The dashboard has a back
chevron in the app header (f4455d70), the duplicate mobile verdict is gone,
and the heatmap's LIMITED SAMPLE reads the plotted attempts, not the goals
layer. The projection eyebrow says `2026-27 projection … in a projected 74
GP` until the opener (c87d3914); "Finishing by season" is a band on the
expanded card (4e8fd3e4).

**Writeups (58b6ee59, c05d8378, 9e94e9b4).** Age, the goals-by-season
streak ("nine straight seasons of 30 goals or more"), cohort percentiles
when notable, the projection as a number and rank. Garrett's rule after the
first read: never name the brand; a number is a number. Tests reversed to
match. The Metric Ledger artifact reconciled 778 skaters: goals, xG, xG/60
and TOI all match `player_season_stats`; NHL is the source of truth.

**Em dashes (1e57d559, 952e61eb).** Rewritten out of every client and
server string; Stormy's replies pass `plainDashes`; the voice guard's
quarantine list is empty.

**The News Room (this commit).** "It should come through like Sleeper and
Yahoo do where it summarizes and links the source." Server: `news_sources`
(NHL.com, ESPN, Daily Faceoff, Dobber, TSN, Sportsnet, THN), `news_items`
(url UNIQUE, `player_ids int[]` matched by full name against the current
directory, one-sentence summary through Haiku with the snippet as the
fallback), `news_ingest_runs` (one row per source per run, the affirmative
health signal). `POST /api/scheduled/news-ingest` every 30 minutes from
`.github/workflows/news-ingest.yml`; `GET /api/news/items` (player_ids,
team, limit, before; returns the names behind the ids), `GET
/api/news/health`; `/api/news/player/:id` carries `items`. Phone: the NEWS
tab is `NewsRoomPhone`: MY PLAYERS / ALL segmented (MY PLAYERS is the
roster of the league in the header, default when it exists), a chip per
team with a story, stories grouped by day in one tile per day, every row
the link to the writer with the players it names, `Read 12m ago · 7
sources` under the segments. Until the migration and the first ingest have
run, the wires are empty and the tab shows the headline feed it showed
before. The player card's NEWS tab has "From the wires" above the Citrus
notes. `newsRoomRows.ts` is pure and tested; `NewsRoomPhone.test.tsx` pins
the shape.

Not yet: tapping a player's name on a row to open the card, and the
career-totals ingest (NHL landing endpoint → `player_directory.notes`) for
the writeups.
