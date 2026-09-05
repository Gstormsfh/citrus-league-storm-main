# Handoff: Citrus "Press Box" mobile redesign

## Overview
Full-app mobile re-skin and information-density pass for Citrus Fantasy Sports, direction **1a · Press Box** from the design review. Goal: match or beat Sleeper's density on every league surface while keeping Citrus identity (dark forest, orange = you, sage = happened, Stormy). Nine screens are specified; the same chrome (header + sub-tab strip + chat bar + bottom nav) wraps every league page.

Target repo: `Gstormsfh/citrus-league-storm-main`, `apps/web` (React 18 + TS + Vite + Tailwind + shadcn). Implement inside that codebase using its existing patterns — see "Where it lands in the repo" below.

## About the design files
`Citrus Redesign - Directions.dc.html` is a **design reference built in HTML** — it shows intended look, density and copy. Do not ship it. Recreate each screen in React/Tailwind. Section `#1a` is the approved direction; `#1b` (Arcade Ledger) is NOT approved, ignore it. `Citrus Current State (mobile).dc.html` is the before-state for comparison.

## Fidelity
**High-fidelity.** Colours, type sizes, spacing, and row structures are final. Copy/data are mocked (league "Finalsz", 12 teams) — wire to real data. Headshots are striped placeholders in the mock; production uses real NHL headshots (see Assets).

## Design tokens

### Colour (add to `tailwind.config.ts` as `pressbox.*`; keep existing `pastel.*`)
| Token | Hex | Use |
|---|---|---|
| surface | `#0C1811` | page background |
| tile | `#16241B` | cards, rows containers, chips |
| tile-high | `#1f3327` | crest boxes, hover |
| hairline | `rgba(255,255,255,.08)` | card borders, row dividers (`.06` for inner dividers) |
| text | `#F3EFE6` | primary text |
| text-2 | `rgba(243,239,230,.55)` | meta |
| text-3 | `rgba(243,239,230,.45)` | column headers, units |
| orange | `#FF6B1A` | YOU: discs ring, your win-prob bar, primary CTA fill (text on it `#2a1000`) |
| orange-soft | `#FF9F66` | eyebrows, active nav icon, links, Stormy label, projections |
| sage | `#84A57D` | happened/live/positive: live game meta, scores that have happened, active sub-tab underline, toggles ON |
| sage-soft | `#C8DCC4` | LW chip, G chip text |
| ice | `#8DCDFF` | OPPONENT: their share of win-prob bars, their proj bars |
| grapefruit | `#FF6F80` (`#FF8A98` for text) | negative: drops, losses, DTD/IR, streak L |

Colour contract (enforce in `darkThemeContrastGuard`): identity ≠ standing. Orange never means "winning"; sage never means "you".

Position chips are **neutral** (colour restraint pass): `bg-white/10` + `#F3EFE6` text, 28–30px, radius 6px, Barlow Condensed 800 11px. The letter carries the position. `positionChip.ts`'s per-position colour maps are retired for phone surfaces — keep the file's geometry exports, replace the colour maps with one neutral pair.

### Type (replace Google import; retire Graduate / Montserrat / Calistoga / Inter on phone surfaces)
- `Barlow Condensed` 700/800 — page titles (22px uppercase, tracking .02em), section headers (15px uppercase, tracking .08em), sub-tabs (13px uppercase, tracking .14em), chips.
- `Barlow` 400–700 — body, names (NAME rung).
- `IBM Plex Mono` 500/600 — every number and label (`tabular-nums`).

Update `phoneRowScale.ts`:
| Rung | Value |
|---|---|
| ROW_NAME | Barlow 700 15px, truncate |
| ROW_HEADLINE | Plex Mono 600 17px, tabular, leading-none |
| ROW_HEADLINE_LABEL | Plex Mono 500 9px uppercase |
| ROW_META | Plex Mono 500 10px, `whitespace-nowrap overflow-hidden text-ellipsis` (mandatory — rows must not grow) |
| ROW_MICRO | Plex Mono 500 9px |
Big scores: Plex Mono 600 40px, tracking -.03em. Matchup card scores: 20px.

### Spacing / radius
Page gutter 12px. Card radius 12–14px, chip radius 6px, buttons 8–10px, pills 999px. Row min-height: roster/matchup 56–58px, players 64px, standings 44px. Bottom chrome: chat bar 40px + nav 76px (+ safe-area).

### Texture (the only "retro")
Header band: `background: repeating-linear-gradient(180deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px)`. Nothing else.

## Shared chrome (build once, mount everywhere)

### `LeagueHeader` (replaces per-page sticky headers)
Row 1 (30px crest, 22px condensed league name, right: week label `WK 1 · SEP 28–OCT 4` Plex Mono 10px, settings/sliders icon). Row 2: sub-tab strip **Match / Team / Players / League**, 4 equal columns, 13px condensed uppercase, inactive `text-3`, active `text` + 2px sage underline. Scanline texture on the band. Sticky. Routes: Match → `/matchup/:leagueId`, Team → `/roster?league=`, Players → `/free-agents?league=`, League → `/league/:leagueId`.

### `MobileBottomNav`
Five tabs: **Leagues** (`/`), **Scores** (`/scores`), **Players** (`/players`), **News** (`/news`), **Account** (`/profile`). 20px lucide icons (trophy, calendar-range, trending-up, bar-chart, user-circle), Plex Mono 600 10px labels uppercase tracking .06em. Active = orange-soft icon + label; no filled square. Replace the current five-tab league nav; league-level navigation moves to the sub-tab strip.

### `ChatBar` (persistent, sits above the nav on every league page)
40px, hairline top. Message-circle icon (orange-soft), `Chat · {author}: {last message}` truncated, unread badge (grapefruit, Plex Mono 9px). Tap → league chat. Variant `stormy`: Stormy avatar 22px + `Stormy · {nudge}` + right-aligned action (`SWAP`, `FIX →`). Data: last league chat message / latest Stormy suggestion. Replace the floating orange FAB with this.

### `LeagueMenu` (replaces `MobileMenuButton` sheet)
Top: close, league switcher pill (crest · name · `SWITCH ▾`). 2-col grid of tiles (tile bg, hairline, radius 14, padding 12, min-height 88): icon (orange-soft 18px) top-left, title Barlow 700 15px bottom, one-line live stat under it in text-2 11px. Tiles + stats + routes:
Standings (`2nd · 4–1 · 71% playoff odds` → `/standings`), Trades (`1 offer waiting · 2 pending` → `/trade-analyzer`), Waivers (`You're #7 · processes 2:00 AM MT` → `/waiver-wire`), Schedule (`Wk 2 vs Bench Bosses` → `/schedule-manager`), Commish note (latest note → league notes), Draft results (`Snake · 18 rds · grade B+` → draft results), Scoring & legend (scoring summary → league settings/scoring read-only), League history (champs → history), Managers & invites (`12/12 · co-owners · share link` → invite), League settings (commissioner only → settings). Footer: user card (disc, display name, `@handle · founder · N leagues`, `PROFILE ›`).

## Screens

### 1. Home / league picker (`/`, signed in)
- Header: favicon + "FANTASY" 24px condensed; right: search, `+ LEAGUE` orange pill (Plex Mono 12px, text `#2a1000`), bell with grapefruit badge.
- NHL ticker: 40px tile, orange `NHL` tab, scrolling `EDM 3 · TOR 2 3rd 4:12` items (period/time in sage, start times text-2). Source: `ScheduleService` live games.
- "MY LEAGUES" section (15px condensed, right `3 · WEEK 1`). League cards: 40px crest square, name 16px, `12-TEAM · H2H PTS · 2ND` meta. Live league card gets 3px orange left rail and an inline matchup: disc+name+`64% WIN` (orange-soft) | `118.4 – 96.1` 20px (leading score sage) + `PROJ 257.2 · 215.2` | opponent mirrored; 4px win-prob bar (orange gradient). Non-live cards: record + one status chip (`TRAILING 3 CATS` grapefruit, `6 PICKS DUE` orange-soft).
- "TONIGHT ON YOUR ROSTERS" 3-col tiles: `TEAM · PERIOD`, name 14px, points 15px (sage if happened, orange-soft if PROJ) + micro stat.
- Chat bar variant stormy; bottom nav (Leagues active).

### 2. League HQ (`/league/:id`, sub-tab League)
- "MATCHUPS" + `WEEK 1 ›`. Matchup cards (grid `1fr 64px 1fr`): 30px disc, name 13px, `64% · 118.4` (win% then score; happened score sage), 3px prob bar per side (own side orange, opp side ice, other matchups sage/ice); centre `VS` + `27 · 26 LEFT`. Your matchup gets orange border `rgba(255,107,26,.35)`. Show 3, then `+ 3 MORE MATCHUPS`.
- 2-col feature tiles (min-height 88): Standings, Transactions, Power rankings, Commish note, Draft results, League history — each with one live stat line (see mock copy). Data: `StandingsService`, `TradeService`/`WaiverService` counts, league notes, `DraftService`.

### 3. Matchup (`/matchup/:id`, sub-tab Match)
- Score block: discs 40px + names 14px + `4–1 · 2ND · YOU` meta; centre `THU · DAY 4/7`; scores 40px (own sage if leading, else `rgba(243,239,230,.85)`); under each: `PROJ 257.2 · 27 LEFT · 64% WIN` (win% orange-soft for you, ice for opp). 6px win-prob bar: orange fill on ice track, 1px white centre tick. Day strip: 7 tiles, `MON` + two daily totals (leader sage), today outlined sage, future days show game counts.
- Section tabs: **Lineups / Categories / Bench / Tonight · 9** (12px condensed, active orange underline).
- Lineup rows (grid `1fr 34px 1fr`, min 58px): 30px mug with 2px team-colour ring, name 14px + team code, META line (`vs TOR 3RD · 1G 2A 4S` sage when live, `FINAL 4–2 · 2A 3S +1` text-.7 when final, `@ DAL 8:30 · PP1` text-2 when upcoming, DTD line grapefruit + `NO WARMUPS`), 2px proj-progress bar (own sage / opp ice, width = pts/proj), right: pts 17px (sage happened / text-.6 dash) + `P 6.9` micro. Centre position chip. Opponent side mirrored (`flex-direction: row-reverse`, `direction: rtl` on the bar).
- Data: existing `MatchupComparison` props + `daily_projection`, `daily_actual_stats`, `nextGame`.

### 4. Roster (`/roster`, sub-tab Team)
- Team card: disc 40px orange, `Gstorms 4–1 · 2ND`, inline win-prob (`64% WIN` orange-soft, 3px bar, `118.4 · 96.1`). Action bar 4 × 32px: `⚡ OPTIMIZE` (orange fill), `⇄ TRADE`, `+ ADD`, `☰ LOG` (tile fill).
- "STARTERS · 13/13" + day toggles `THU FRI SAT WEEK` (Plex Mono 10px, active tile bg).
- Column header (9px text-3): `PLAYER · ROS% / START%` | `TODAY` | `WK`.
- Rows (grid `30px 30px 1fr 52px 44px`, gap 8, min 56px): position chip (stacked label + `⇄` glyph 8px), mug 30px team ring, name 15px + team code, META `100% · 99% | vs TOR 3RD · 1G 2A` (status segment sage when live), TODAY 17px (sage happened / orange-soft PROJ / dash) + `P 6.9`, WK 12px + trend micro (`▲ 12%` sage, `▼ 31%` grapefruit, `— 0%` text-3). DTD row: name badge `DTD` grapefruit, meta grapefruit, faint `rgba(255,111,128,.05)` row tint.
- "BENCH · 6" with right note `2 PLAYING TONIGHT · PTS DON'T COUNT` (orange-soft). Bench rows: `BN` neutral chip, points text-.5.
- Data gap: rostered% / start% — no league-wide read exists (`FreeAgentRow.tsx` comment). Add a nightly aggregate (`player_id → rostered_pct, started_pct` across all Citrus leagues) exposed via `players` API; until then hide the two percentages, keep the separator.

### 5. Players / Free Agents (`/free-agents`, sub-tab Players)
- Tool strip tile: 6 icon+label items `SEARCH · TREND · AVAILABLE · LEADERS · TRADE · WATCH` (9px Plex Mono, active sage).
- "TRENDING · 24H" + segmented `▲ ADDS` (sage fill) / `▼ DROPS`. Position pills `ALL C LW RW D G FA ONLY` (active cream fill/text surface).
- Column header `# | PLAYER · ROS% · WK PROJ | 24H ADDS`.
- Rows (min 64px): rank column (18px sage `+` / grapefruit `–` disc over rank), mug 40px team ring, name 15px (+ status chip), META 1 `G COL · vs LAK 8:00 · CONFIRMED START` (position chip inline 10px, game segment sage), META 2 `ROS 38% · START 31% · WK PROJ 22.4 · 3 GP`, right: `+41.2K` 15px (sage / grapefruit) + destination micro (`→ Puck Norris`, `FREE AGENT`, `ON YOUR TEAM` orange-soft), action 40px: `+` (orange tint, ring `rgba(255,107,26,.45)`), `W THU` (sage tint) for waiver claim, `⇄` (neutral) when roster full / own player.
- Data: adds/drops counts need a 24h transaction aggregate (`transactions` table by player, all leagues); destination = team that added in *this* league.

### 6. Player card (modal)
- Header on orange-tinted gradient `linear-gradient(180deg, rgba(255,75,0,.28), transparent 240px)` (use team primary colour at .28 instead of hard-coded orange). 84px square headshot radius 14 with team-colour border and 24px crest badge bottom-right; eyebrow `→ GSTORMS · C · #97`; name 30px condensed two lines; bio strip `AGE HT WT SHOOTS EXP` (9px labels, 14px mono values). Close ✕.
- Action bar: `⇄ TRADE`, `DROP` (grapefruit tint), star (watch), note.
- Tabs `Summary / Game log / Splits / xG / News · 3` (active orange underline).
- 4 stat tiles: `WK 1 PTS` (sage), `SZN PROJ`, `POS RANK`, `xG ± / 60` (orange-soft).
- Game-log table (grid `30px 42px 44px 1fr×6 34px`, 11px mono): `DT OPP FPTS G A SOG +/- PPP HIT TOI`, most recent row sage-tinted, AVG footer row.
- "UPCOMING" 3 tiles: `SAT 10/3`, `@ CGY`, `7.1 PROJ · B2B`.
- Stormy xG read card (30px avatar, `STORMY · xG READ`, 12px body).
- Data: `PlayerStatsModal` sources + `playerAdvancedMetrics.ts` for xG; game log from `player_game_logs`.

### 7. Standings (`/standings`, sub-tab League)
- Segmented `STANDINGS / POWER / PLAYOFF ODDS / MEDIAN` (active cream fill). Meta line `WEEK 5 OF 24 · TOP 6 MAKE PLAYOFFS` | `SORT: W–L ▾`.
- Table (grid `16px 1fr 34px 42px 42px 26px 44px`, gap 4, 11px mono): `# TEAM W–L PF PA STK LAST 5`. Team cell: 26px disc, name 13px Barlow 700, sub-line `@handle · 78% PO` (9px, nowrap). STK sage `W5` / grapefruit `L1`. LAST 5 = five 8px squares (sage/grapefruit). Your row: orange tint `rgba(255,107,26,.08)` + 3px inset orange left rail + `YOU` micro. Playoff line: dashed orange-soft border + `PLAYOFF LINE` label row after seed 6.
- Data: `StandingsService` + playoff-odds simulation (`MatchupSimulationService`).

### 8. League menu — see `LeagueMenu` above.

### 9. League settings (commissioner)
- Header: back, centred `LEAGUE SETTINGS` 20px condensed + `COMMISSIONER · FINALSZ` eyebrow, right `SAVED` (sage) status.
- Category pills scroll row `GENERAL ROSTER SCORING WAIVERS TRADES PLAYOFFS` (active cream).
- Grouped lists (section eyebrow 9px text-3; tile card with hairline dividers): row = label 14px + helper 11px text-2 | value in orange-soft mono + `›`, or 44×26 toggle (sage ON). Groups from mock: PROCESSING (type, initial order, process time, period), LIMITS (adds/week, adds/season, game lock), TRADES DURING GAMES (allow, review). Info banner (orange-soft tint) `Changes notify all 12 managers and take effect at the next waiver run`. Sticky footer: `DISCARD` (tile) + `SAVE & NOTIFY LEAGUE` (orange).
- Replace the single-dropdown-per-section shadcn form with this list pattern; keep `LeagueSettingsService` fields.

## Interactions
- Sub-tab strip: tap navigates within league; 200ms underline slide.
- Rows: tap name/mug → player card (instant open, per `playerCardInstantOpenGuard`); tap position chip → line-change sheet (existing `SlotPickerMenu`).
- Bars animate width 700ms ease-out on data change (existing convention).
- Chat bar tap → league chat; Stormy action tap executes the suggested swap via existing auto-lineup path with confirm.
- All META lines: `nowrap + ellipsis`, never wrap. Row heights are fixed by design.
- Loading: skeletons on tiles (`citrus2/Skeletons.tsx`), never the full-screen Stormy loader on Roster.

## Linking (every reference must resolve)
- Team names/discs → `/team/:teamId` (OtherTeam) except your own → `/roster`.
- Player names/mugs → player card modal; card header → `/players/:playerId` deep link.
- Trending destination (`→ Puck Norris`) → that team; `→ Sin Bin` etc.
- League crest/name in header → `/league/:id`; week label → week picker.
- Menu tiles → routes listed above; Commish note → league notes editor for commissioner, read-only otherwise.
- Standings row → team page; `PLAYOFF ODDS` tab → odds view; `POWER` → Stormy power rankings.
- Add `linkGraphIntegrity.test.ts` cases for every new route.

## Headshots & crests
- Headshots: NHL CDN `https://assets.nhle.com/mugs/nhl/{season}/{TEAM}/{playerId}.png` via existing `roster/headshot.ts` + `Mug.tsx` (fallback crest → initials already implemented). Sizes needed: 30 (matchup/roster), 40 (players), 84 (card).
- Team-colour ring/border: `utils/teamColors.ts` `getTeamInfo(abbrev).primaryColor`; use `teamColorContrast.ts` to lift dark colours (e.g. NJD, CBJ) to ≥3:1 against `#16241B`.
- Crest badge: `teamCrestUrl(abbr)` 14px bottom-right (existing).
- Manager discs: `profiles.avatar_url` via `TeamDisc.tsx`; fallback initial in Barlow Condensed.

## Motion (see `Citrus Motion - Loading and Micro-interactions.dc.html`)

### App loading screen (`2a`) — replaces `LoadingScreen.tsx` / `NativeBootSplash.tsx`
- Surface `#0C1811`; radial orange glow `radial-gradient(ellipse 70% 45% at 50% 38%, rgba(255,107,26,.16), transparent 70%)`; scanline texture; a 140px soft light band sweeping top→bottom, 3.2s linear, infinite.
- Puck: `CitrusLogo` 96px. Bob `translateY(0 → -10px) scale(1 → 1.04)`, 1.6s `cubic-bezier(.45,0,.55,1)` infinite; slow spin 6s linear; drop-shadow `0 12px 24px rgba(255,107,26,.35)`. Ground shadow ellipse 70×10 blurred 6px scales X 1→.7 in sync.
- Wordmark `CITRUS` Barlow Condensed 800 30px tracking .06em; eyebrow `FANTASY HOCKEY` Plex Mono 10px tracking .3em orange-soft.
- Progress bar 200×3, track hairline, fill `linear-gradient(90deg,#FF6B1A,#FF9F66)`. Drive it from real boot stages: auth 0→25%, league context →55%, roster/matchup preload →85%, first paint 100%. Never fake-complete; if a stage exceeds 4s, show the stage name under the bar.
- Rotating tips: three lines, 2.8s each, 250ms fade/translate 6px. Line 1 = live fact (`Pulling tonight's lines · 9 games · 27 of your players dressed`), 2 = a Stormy tip, 3 = a league fact (`Waivers run 2:00 AM MT · you're #7`). Source from `ScheduleService`, a tips array, `WaiverService`.
- Footer: Stormy 44px avatar with orange-soft ring, `LIVE xG SCORING` + three 3px dots pulsing (1.2s, 200ms stagger).
- Minimum display 600ms, maximum before showing content anyway 6s (existing `useMinimumLoadingTime` / `useLoadCeiling`).

### Page skeletons (`2b`) — replaces the full-screen Stormy "Loading your roster…"
- Skeleton mirrors the final layout exactly (same grid, same row heights) so nothing jumps. Position chips render in their real colour at 50% opacity; text blocks shimmer `linear-gradient(90deg,#16241B 25%,#1d2e23 50%,#16241B 75%)`, `background-size:200% 100%`, 1.6s ease-in-out, 100–150ms stagger per row. Extend `citrus2/Skeletons.tsx`.

### Micro-interactions (`2c`)
| # | Trigger | Motion |
|---|---|---|
| 01 | Live stat update | Row background flashes `rgba(132,165,125,.22)` 300ms then fades 700ms; points number rolls vertically (old out / new in) 700ms `cubic-bezier(.2,.7,.2,1)`; live dot pulses 1.6s (opacity 1→.45, scale 1→1.35) while game is live |
| 02 | Win-prob / proj change | Bar width transitions 700ms ease-out; never snaps |
| 03 | Line change (swap) | Two rows translate to each other's slot 320ms spring `cubic-bezier(.34,1.3,.5,1)`; eligible target chips pulse with a 2px sage ring until a pick is made |
| 04 | Sub-tab change | Underline slides to the new tab 200ms ease-out; content cross-fades 150ms |
| 05 | Goal / big event on your roster | Toast enters scale .6→1.05→1 over 250ms spring, holds 4s, fades 300ms; sage border; native haptic `impactMedium`. Content: `GOAL · EDM`, player + `+3.0`, new team total |
| 06 | Button press | 100ms `scale(.97)` + 8% darker fill; on success the button turns sage with `✓ ADDED` for 900ms then reverts; on error grapefruit shake 2×4px 200ms |
| — | Pull to refresh | Puck logo 24px spins in the header band while fetching; band tints sage on success 400ms |
| — | Card/modal open | Player card slides up 320ms spring with 60% scrim fade 200ms; header gradient uses the team's primary colour at .28 |
| — | Chat bar new message | Text slides in from the right 200ms; unread badge pops scale 0→1 spring |

Rules: durations 100 / 200 / 320 / 700 ms only (`citrus-fast/normal/entrance` exist in tailwind; add `citrus-data: 700ms`). Movement easing `cubic-bezier(.2,.7,.2,1)`; springs `cubic-bezier(.34,1.3,.5,1)`. Honour `prefers-reduced-motion`: keep colour changes, remove transforms and loops. Only the live dot and the loading puck loop indefinitely.

## Critical UX pieces that must ship with the re-skin
1. **Empty states** with a next action, never a blank card: no games today → "Next puck drop Tue 7:00 PM · 6 of your players", empty IR → "No one on IR · tap to place", no trades → "Propose a trade" CTA.
2. **Error/stale states**: stale-data badge (`StaleDataBadge.tsx`) on any tile whose data is >90s old during live games; offline banner (tile bg, grapefruit dot) that keeps the last snapshot visible.
3. **Locked players**: chip swaps to the lock glyph, row stays full contrast (existing rule), tap explains "Locked · game started 7:08 PM".
4. **Optimistic updates**: adds/drops/swaps apply instantly with the success animation; roll back with the grapefruit shake + toast on failure.
5. **Haptics (native shell)**: light on tab change, medium on goal toast, success on transaction confirm.
6. **Accessibility**: every colour state has a text twin (`LIVE`, `FINAL`, `PROJ`, `DTD`); contrast ≥4.5:1 on tile for all text-2 values (checked: `.55` cream on `#16241B` = 5.1:1); 44px minimum hit targets (rows are 56–64px, chips 30px but sit inside the row target).
7. **Deep links**: every screen has a URL (`/league/:id`, `/matchup/:id/:week`, `/roster?league=`, `/players/:id`, `/standings?league=&view=odds`); the player card is a route-backed modal so back closes it.
8. **Performance budget**: first league page interactive <1.5s on 4G; headshots lazy + `decoding=async`; skeleton within 100ms of navigation.

## Instructions for Opus (Claude Code) — paste this as the task
```
You are implementing the "Press Box" mobile redesign in Gstormsfh/citrus-league-storm-main (apps/web, React 18 + TS + Vite + Tailwind + shadcn).
Spec: design_handoff_pressbox_mobile/README.md. Visual reference: sections #1a (core screens), Turn 5 (#5a–#5b player dashboard), Turn 4 (#4a–#4b draft room) and Turn 3 (#3a–#3f, signature moments + recaps + awards) of "Citrus Redesign - Directions.dc.html", and all of "Citrus Motion - Loading and Micro-interactions.dc.html". Section #1b is rejected — ignore it. "Citrus Current State (mobile).dc.html" is the before-state; use it only to map existing components to their replacements.

Ground rules
1. Read README.md fully, then apps/web/src/components/citrus2/STYLEGUIDE.md, tailwind.config.ts, components/phoneRowScale.ts, components/roster/positionChip.ts, and the __tests__ guards listed under "Guardrails to update" BEFORE writing code.
2. Reuse existing services/hooks (LeagueContext, MatchupService, StandingsService, WaiverService, TradeService, ScheduleService, Mug/TeamDisc/headshot.ts, teamColors.ts). Do not invent parallel data paths.
3. Styling is Tailwind classes using the new pressbox.* tokens and font aliases. No hex literals in components; no inline styles except computed widths (bars).
4. Every META line gets `whitespace-nowrap overflow-hidden text-ellipsis`. Row heights are fixed by the spec.
5. Colour contract — see "Colour restraint", it is the difference between professional and noisy: orange = the viewer's team / primary action (one per region), positions are neutral bg-white/10 tags, team colour is a 1.5px mug ring only, sage/grapefruit are state, ice is the opponent side, percentiles use one opacity scale. Add a test that fails a coloured position chip or a team-colour fill.
6. Every clickable element listed under "Linking" must route. Add cases to __tests__/linkGraphIntegrity.test.ts for each new route before wiring it.
7. Headshots: use Mug.tsx with the NHL CDN URL from headshot.ts at sizes xs(30)/md(40)/lg(84); team ring colour from teamColors.ts lifted via teamColorContrast.ts.
8. Motion: implement the table in "Motion" with the four durations only; wrap loops in a prefers-reduced-motion check.
9. Where data does not exist yet (rostered%/start%, 24h adds/drops, playoff odds), create the aggregate (SQL view + API route + service method), follow the citrus-schema-review checklist (RLS, tests), and hide the UI field until the aggregate returns.
10. Truth rules from STYLEGUIDE.md apply: no wallet, no odds/spreads, no fake counts, W–L not W–L–T. Awards and leaderboards only render from real aggregates; skip an award rather than fake one; hide any leaderboard cut with <100 managers.
11. Headshots must be real in production: NHL CDN via Mug.tsx. Striped circles in the reference HTML are placeholders, never ship them.
12. Open the reference HTML in a browser at 100% zoom and match it pixel-for-pixel at 390×844; the screenshot diff is the acceptance test.

Work in this PR order, one PR each, and stop for review after each:
PR1 tokens + fonts + phoneRowScale + STYLEGUIDE update + guard tests updated to the new rungs
PR2 LeagueHeader (sub-tabs) + MobileBottomNav + ChatBar + LeagueMenu, mounted on every league page
PR3 LoadingScreen + skeletons (Motion 2a/2b)
PR4 Roster · PR5 Matchup · PR6 Players/Free Agents · PR7 Player card · PR8 Standings · PR9 League HQ · PR10 Home · PR11 League settings
PR12 data aggregates (rostered/start %, adds/drops, playoff odds)
PR13 micro-interactions + goal toast + haptics + empty/error states sweep
PR14 Signature moments: 3a Line Check · 3b Live momentum · 3c Goal takeover (see "Signature moments")
PR15 Recaps: 3d Daily · 3e Weekly deck · 3f League awards + You-vs-the-World leaderboards (manager_week_metrics aggregate, /leaderboards route) + trophy case in History
PR16 Draft room (#4a/#4b + My team tab) on DraftRoomV2 — the most important surface; ship before the season opens
PR17 Player dashboard #5a + internal analyst card #5b (CITRUS GRADE composite, percentiles, comparables, CSV/PNG/API export)
PR18 App Store pass: launch screen = Motion 2a static frame, icon from favicon.svg on #0C1811, screenshots of #1a Matchup/Roster/Players/3b/3f, privacy manifest, reduced-motion audit, 44px hit-target audit, VoiceOver labels on every row and bar

For every PR: run `npm run lint && npm run test`, run the harness at 393x852 (harness/README.md), screenshot each changed screen, and compare against the matching phone in the reference HTML. Report the diff and any spec ambiguity before moving on. Never mark a screen done while a META line wraps, a row height varies, a link is dead, or a headshot falls back to initials for an active NHL player.
```

## Draft room (Turn 4 · `#4a` `#4b`) — replaces DraftRoomV2 phone layout
Calm by design: **one accent**. Orange = you (your column, your pick cell, the draft button). Everything else is tile/hairline/cream. Position is a mono letter in the meta line, not a coloured chip. Team colour is a 1.5px ring on the mug only. The timer is the only element that changes colour, using the thresholds already in `DraftTimer.tsx` (>33% sage, >11% orange, else grapefruit).

### Shared chrome
- Header: back · `FINALSZ DRAFT` 22px condensed · `ROUND 3 · PICK 7 · 30 / 216` mono · presence `11/12 ●` (sage dot from `ManagerPresencePanel`).
- Tabs (orange underline): **Players / Queue · n / Board / My team**.
- **Sticky pick bar** (bottom, every tab): 3px timer track (colour per threshold), `YOUR PICK · 3.07` eyebrow, 34px mono countdown, one 52px orange button `DRAFT {QUEUE #1}` with `QUEUE #1 · D · 612` under it. When not on the clock the bar reads `NEXT PICK 4.06 · 11 PICKS AWAY · ~8 MIN` with `QUEUE` as the button. Wire to `OnClockActionBar` + `countdownTick.ts`; haptic + sound at 10s.

### 4a Players
- Search + `PROJ ▾` sort (the headline number follows the sort per `draftPoolHeadline.ts` — label under it changes to `fpts`, `g`, `sv%`…). Neutral position pills `ALL C LW RW D G` + `★ n` queued filter.
- Stormy need line (one sentence): `Need 2 D by round 6 · 4 of the top-8 D go before your next pick` from `draftDecision.ts`.
- Row (62px, grid `22px 1fr 54px 40px`): rank · mug + name (+ `★ Q2` if queued, orange-soft) · meta `D · COL · 90 PTS · 26:10 · BYE 9` · PROJ 17px with `TIER 2 · D1` micro (orange-soft only for the best available at a position you need) · ADP.
- Row tap → player card (draft variant: ADP trend, tier, positional rank, `DRAFT` + `QUEUE` buttons). Swipe right → queue. Long-press → compare with queue #1.

### 4b Board
- Grid `28px + 4 cols`, 54px cells, rounds down the side; swipe horizontally for all 12 teams, your column pinned second from left. Filled cell = name 12px + `POS · TEAM` 8px. Your picks carry a 1px orange inset ring; the live pick is a solid orange cell with the countdown; your future picks are dashed orange-soft; others dashed hairline.
- `LAST PICKS` list with ADP delta: `REACH 6` orange-soft / `VALUE 8` sage / `EVEN`. Run detection (`3 D IN A ROW`) surfaces in the Stormy line, not as a coloured badge.

### My team tab (spec only)
- Roster slots grouped C/LW/RW/D/G/UTIL/BN with filled/empty counts, projected season total vs league median, position-need bars (needed vs filled), and Stormy's grade so far.

### Motion
- New pick lands on the board: cell fades from orange → tile over 700ms; the pool row slides out 200ms. Timer ≤10s: number pulses once per second (scale 1→1.06), colour grapefruit, haptic each second. Your turn: sticky bar rises 320ms spring + `impactMedium`.

These are the differentiators. Sleeper cannot ship them; Citrus can because it has live xG, Stormy and a sim engine.

### 3a · Stormy Line Check (daily briefing, `/league/:id/line-check`)
- Pushed at 7:00 AM local on game days (and 1h before first lock). Opens as a full sheet from the notification or the Home Stormy bar.
- Header: Stormy 52px, `THU OCT 1 · 7:02 AM · LINE CHECK`, `GOOD MORNING, {TEAM}` 26px condensed, one-sentence status (lead/deficit in sage/grapefruit, games left).
- Up to 3 numbered action cards, ranked by projected point impact. Card types: **Lineup fix** (injury/scratch → best replacement with Δproj, `SWAP X IN` orange / `WAIT`), **Pickup** (confirmed starter / streamer with rostered %, competitor waiver position, `+ ADD · DROP Y`), **Trade offer** (send/get columns, Stormy's Δpts/wk verdict, `COUNTER` / `DECLINE`). Card border colour = urgency (grapefruit / hairline / hairline).
- Footer stats: TONIGHT (n of 13 play), PROJ TODAY, WIN CHANCE with Δ. Sticky cream button `DO ALL THREE · 1 TAP` executes every accepted action as one batch with a confirm sheet.
- Data: `autoLineup.ts` (best swap), `WaiverService` (competitor priority), `TradeService` + `MatchupSimulationService` (Δ win %), `StormyService` for copy. Log which cards were acted on — this is the retention metric.

### 3b · Live matchup momentum (Matchup → default view while any game is live)
- Score pair 40px + win % with Δ since yesterday. Panel: **win-probability line** across the week (SVG, orange 2.5px, 18% gradient fill, 50% dashed guide), goal markers (sage = yours, grapefruit = theirs), pulsing dot at now, `SIM 10K · CITRUS xG` label. Tap a point → the play that moved it.
- **Live feed** below, both teams merged, newest first: goal (sage border, `+3.0`), shot/xG event (`Kaprizov, slot, saved · xG 0.22`, opponent events in ice), hits/blocks (muted), Stormy commentary rows every ~15 min while live. Row = 32px mug w/ team ring, 10px condensed event label, 14px description, 17px mono delta.
- Data: `MatchupService` live events + `winProbability.ts` re-run per event; keep last 50 events client-side. Feed rows animate in per Motion 01.

### 3c · Goal takeover (full-screen, your roster only)
- Trigger: goal by a **starter you own** in the league currently open (or any league if app is backgrounded → rich push instead). Never for bench, never for opponent.
- Layout: team-colour vertical gradient at .35 through the middle, `GOAL` 96px condensed, event eyebrow `EDM · POWER PLAY · 3RD 4:12`, 150px headshot with team ring + 12px halo, player name 32px, `FROM DRAISAITL · xG 0.31 · 2ND OF THE NIGHT`, three tiles `FANTASY +3.0 / YOUR TOTAL / WIN % Δ`, cross-league note if the same player scores for you elsewhere, `CHIRP 💬` (drops a pre-filled message into league chat) + `BACK TO MATCHUP`. Auto-dismiss 6s, swipe-down to close.
- Motion: Motion 05 spring in, background gradient breathes once (opacity .35→.45→.35 over 1.2s), haptic `impactHeavy`. Respect reduced motion (static).
- Rate limit: max one takeover per 90s; queue extra goals into the toast.

### World-class decisions baked in (don't regress these)
- **Numbers are always mono + tabular**; names are never mono. Colour carries state, never identity, except orange = you.
- **Opponent is ice, everywhere** — bars, win %, feed rows. Two-tone matchups are readable at a glance.
- **Every row has one headline number** at 17px; nothing else on the row exceeds 15px.
- **Meta lines never wrap.** If content is too long, shorten the string, don't grow the row.
- **Every list is ranked and says why** (`→ Puck Norris`, `78% PO`, `+41.2K`) — the "why" column is what Sleeper skips.
- **Stormy speaks in numbers** (Δproj, xG, %) and hockey lingo from STYLEGUIDE.md; never "monitor the situation".
- **Team colour is a ring, not a fill** — keeps 32 NHL palettes from fighting the forest surface.
- **Nothing loops forever** except the live dot and the boot puck.

### 3d · Daily recap (pushed at ~11:45 PM local after the last final; also `/league/:id/recap/:date`)
- Sage-tinted header, verdict headline (`YOU TOOK THE NIGHT` / `ROUGH ONE` / `DEAD EVEN`), day score pair with both projections, tiles LEAD / WIN Δ / TONIGHT rank of 12.
- **Player of the night** card (52px mug, full stat line, xG, league-wide badge `TOP SKATER IN ALL 12 TEAMS TONIGHT`, 24px points).
- **How it went** list: every Line Check action graded (✓ sage with realised points, – grapefruit under-performer vs proj, i ice = bench points left). This closes the loop on 3a — the manager sees the advice paid off.
- Buttons: `SHARE CARD` (renders a 1080×1920 image of the header + player of the night) / `SET FRIDAY'S LINES →` (deep link to Roster on the next game day).

### 3e · Weekly recap (Monday 8 AM; 5-page swipe deck: Result · Awards · Standings move · Transactions · Next week)
- Orange-tinted header, `WEEK 1 / WIN` 40px condensed, final pair with records, `HIGH SCORE · WK 1` badge when applicable.
- Tiles RECORD / RANK Δ / PF RANK / PO ODDS. **Day-by-day bars** (you orange, them ice, best day labelled). **MVP / BEST MOVE / OUCH / BENCH** rows with team-ring mugs and points. Stormy preview of next opponent with sim %.
- Buttons `SHARE TO CHAT` / `LEAGUE AWARDS →`.

### 3f · League awards (recap page 2 — the fun)
- Butter (`#F4E5B8`) accent for hardware. Five computed superlatives, each with a Stormy one-liner in hockey voice (STYLEGUIDE lingo, never mean about real people — chirps target teams/decisions, not managers personally):
  - **TEAM OF THE WEEK** — highest PF.
  - **BENCH BOSS** — most points left on bench (`41.7 left on the bench`).
  - **THE TILT** — most waiver moves in 48h with net Δ.
  - **RUNNING HOT** — largest goals-over-xG (regression warning).
  - **HEARTBREAKER** — smallest losing margin, with the play that decided it.
  Rotating pool for later weeks: **GOALIE WHISPERER** (best G streaming), **STONE HANDS** (lowest SH% on ≥20 SOG), **THE DANGLER** (most trades accepted), **SNIPER** (most goals from one skater), **TENDY TAX** (worst G start). Only award when the stat is real; skip an award rather than fake one.
- **You vs the World** card (butter accent): the manager's weekly rank across every Citrus league, three cuts — WORLDWIDE (percentile + rank), COUNTRY (flag + rank of N), FAN BASE (their favourite NHL team's fans, rank of N with weekly Δ) — plus four data-based manager metrics: LINEUP EFFICIENCY (actual ÷ optimal lineup pts, percentile), WAIVER HIT RATE (% of adds that out-scored the dropped player over 2 wks), xG LUCK (goals over/under expected on their roster, percentile), and their CITY rank. Buttons `FULL LEADERBOARDS` (→ `/leaderboards` tabs World / Country / Fans / City / Friends) and `POST TO CHAT`.
- Cross-league comparability: score each manager's week as a **z-score vs their own league's weekly median** (leagues differ in scoring/roster size), then rank z-scores globally. Country/city from profile (opt-in, editable); fan base = the favourite team already collected at signup. Show a cut only when it has ≥100 managers; never show a leaderboard with under 100 (privacy + meaninglessness). Cache nightly; ranks are Monday-final.
- Tap any award card → pre-filled chat post (award + line, no emoji).
- Data: `StandingsService`, `WaiverService` counts, `playerAdvancedMetrics.ts` xG, `MatchupService` margins; new nightly `manager_week_metrics` aggregate (z-score, lineup efficiency, waiver hit rate, xG luck) keyed by user × week with country / city / fav_team from `profiles`. Store awards per week so History → Awards shows the trophy case.

### Recap notifications
- Daily: 1 push, title `Daily recap · +39.8`, body = verdict + player of the night. Weekly: 1 push Monday, `Week 1: WIN · you won TEAM OF THE WEEK`. Both respect per-league notification settings; never more than 2 recap pushes per day across all leagues.

## Colour restraint (applies to EVERY screen — this was the fix that made it look professional)
The palette is deliberately narrow. Do not reintroduce per-position or per-team colour fills.
- **Orange `#FF6B1A` is the only saturated colour**, and it means *you / your pick / the primary action*. One orange element per screen region.
- **Position tags are neutral**: `bg-white/10` + cream text, the letter carries the meaning. No sage/orange/ice position chips.
- **Team colour is a 1.5px ring on the mug only** — never a fill, never a 3px bar. On the draft board and roster rows, use `rgba(255,255,255,.16)` and let the team abbreviation carry identity.
- **Sage / grapefruit are state, used sparingly**: sage = happened/positive, grapefruit = negative/injury. Never decorative.
- **Ice `#8DCDFF`** only for the opposing side of a two-sided comparison (matchup bars, opponent scores).
- **Percentiles use one scale**: `rgba(132,165,125, .10–.34)` for above average, `rgba(255,111,128, .08–.20)` for below. Opacity carries magnitude — no hue shifts, no red/blue gradient grid.
- The timer is the only element allowed to change colour with state.

## Player dashboard (Turn 5 · `#5a` in-app, `#5b` internal analyst card)
The Citrus answer to a JFresh card, on Citrus's own model. `#5a` is `/players/:playerId`; `#5b` is the 820px internal/desktop card and the shareable PNG.

Sections in order (both):
1. **Identity** — headshot (76×88 rounded, hairline ring), name 30px condensed, `C · EDM · #97 · 29Y · 6'1" · L`, contract line `$12.5M × 6 · UFA 2032` + rostered-by, and **CITRUS GRADE** (0–100 composite, orange, 40–52px) with `1st OF 512 FORWARDS` and the model version/date.
2. **Headline four** — FPTS/GP, SZN PROJ, GAR/60, xG ±/60.
3. **Percentile rank** — 10-cell grid, 5 across: EV OFF, EV DEF, PP, PK, FINISH, G/60, A1/60, PENALTY, COMP (competition), MATES (teammates). One-scale fills + a 0–100 legend bar. `n=` and window (`3YR WEIGHTED`) always stated.
4. **Three-year trend** — GAR-percentile lines: offence (orange), finishing (cream 55%), defence (cream 30% dashed). Dot on the current season.
5. **Deployment** — TOI/GP, PP1 share, OZ start%, PK TOI/GP as value + percentile + bar (L20 games).
6. **Shot profile** — xG, actual G, over-xG, SH%, slot-shot%, xG/shot (Citrus xG model v4).
7. **Fantasy value** — positional rank, value over replacement (pts/szn), consistency + weekly floor, injury risk (games missed / 3 szn), rest-of-week schedule (GP · B2B · proj).
8. **Comparables** — three nearest-profile players with grade and distance.
9. **Stormy read** — 2–3 sentences that name the strength, the number behind it, and the one soft spot.
10. Actions: `COMPARE` · `EXPORT CSV` · `TRADE BLOCK` (in-app) / `EXPORT CSV · PNG · API` (internal).

### `#5b` internal analyst card (1240px · print/PNG/API)
A one-page scouting dossier, not a scaled-up phone card. Bordered panels, no rounded cards, everything on a 1px hairline grid — it should read like a terminal, and print at letter-landscape without reflowing.

- **Masthead** (4 zones on one row): headshot 78×94 · name 36px condensed + `C · L · #97` outlined tag, then a meta line (`EDM · 29.4 YRS · 6'1" 194 LB · $12.5M × 6 · UFA 2032 · ROSTERED · GSTORMS`) · **CITRUS GRADE** 48px orange with `1 / 512 F` · a four-row key-value block (GAR/WAR, FPTS/GP, SZN PROJ, projection confidence `±38`).
- **Column 1 — Percentile profile as bullet charts, not tinted boxes.** Each row: label · raw value (mono, right-aligned) · a track showing the league range with a shaded 25–75th band, a 1px median tick, and a 3px marker at the player (orange, grapefruit when below median) · percentile. Ten rows: EV offence, EV defence, PP offence, PK defence, finishing, G/60, A1/60, penalties, competition, teammates. Below it, **league distribution**: the actual GAR/60 density curve with the median dashed and the player marked in orange — this is what makes the percentile legible rather than asserted.
- **Column 2 — Goal heat map (`WHERE HE SCORES`).** The published-graphic convention: white ice, net at the top, red goal line / faceoff circles with hash marks / trapezoid, blue line across the bottom, black board outline with rounded corners. Each goal is plotted as its own soft radial hotspot (lime core → green → blue halo, `feGaussianBlur` 2.4) so overlapping goals merge into the dense worms a real goal map shows; a small pale core dot marks each individual event. Caption inside the frame: `40 GOALS · 2023–26`. No legend — the field is self-evident and the numbers live below it.
  Under the rink, two 4-up rows of Citrus data the reference graphics don't carry: **zone split** (in tight / slot / circles / point-outside, each as count, share, and the league share for that zone) and **context** (even strength / power play / shorthanded counts, plus median shot distance vs league). Then the three model figures: slot share with percentile, xG per shot with shot count, goals over expected. Then **rolling form**: 10-game FPTS line with an interquartile band and the position median dashed across it.
  Implementation: `citrus2/RinkHeatmap.tsx` renders the rink and the hotspot layer; feed it goal events (`x`, `y`, `strength`, `distance`) from `shot_events`. Zone shares and league baselines come from the same table aggregated by zone — compute server-side, cache nightly.
- **Column 3 — Deployment** (same bullet treatment: TOI/GP, PP1 share, OZ start, PK TOI, faceoffs taken) · **With / without**: linemate table with 5v5 TOI together and xGF% with vs without — the one table that separates a driver from a passenger · **Season history** (SZN, team, GP, G, A, FPTS, grade) · **Nearest profiles** with cosine similarity bars on 22 rate features.
- **Valuation strip** (6 cells across the full width): positional rank, value over replacement, weekly floor · ceiling, injury risk, cap efficiency (FPTS per $M), rest-of-week schedule.
- **Stormy read**: 4 sentences, each carrying a number, ending on the WOWY point.
- **Provenance footer**, always: `CITRUS xG MODEL v4 · GAR v2 · 3YR WEIGHTED (50/30/20) · n=512 FORWARDS · SCORING: FINALSZ` and `BUILT {ts} · EXPORT CSV · PNG · API`. Every figure on this card must be traceable to a model version and a sample size — run `citrus-verify-number` before any of it ships.

New data needed: GAR/WAR per player-season, zone-level shot rates (`shot_events` binned), WOWY pairs (5v5 TOI + xGF% with/without), `player_comparables` (cosine on 22 rate features), cap efficiency from `nhlContracts.ts`, projection confidence interval. Reuse `citrus2/RinkHeatmap.tsx`, `PercentileBullet.tsx`, `SparklineMicroChart.tsx` — they already exist; do not draw new chart primitives.

## Guardrails to update
`darkThemeContrastGuard`, `phoneRowTypeScaleGuard` (new rungs), `mobileHeaderMenuGuard` (menu now lives in `LeagueHeader`), `rosterMobileChromeGuard`, `matchupMobileRowsGuard`, `zLayerScaleGuard` (chat bar + nav rungs), `linkGraphIntegrity`.

## Suggested PR order
1. Tokens + fonts + `phoneRowScale.ts` + STYLEGUIDE
2. `LeagueHeader`, `MobileBottomNav`, `ChatBar`, `LeagueMenu`
3. Roster · 4. Matchup · 5. Players · 6. Player card · 7. Standings · 8. League HQ · 9. Home · 10. Settings
11. Data: rostered%/start% aggregate, 24h adds/drops aggregate, playoff odds

## Files in this bundle
- `START_HERE.md` — the five-step handoff procedure. Read this first.
- `OPUS_PROMPT.md` — paste this into Claude Code. It is the entire kickoff.
- `PR_CHECKLIST.md` — per-PR acceptance criteria.
- `Citrus Redesign - Directions.dc.html` — design reference: `#1a` core screens, `#3a`–`#3f` moments/recaps/awards, `#4a`–`#4b` draft room, `#5a`–`#5b` player dashboard. `#1b` is rejected.
- `Citrus Motion - Loading and Micro-interactions.dc.html` — loading screen (2a), skeleton (2b), micro-interaction board (2c)
- `Citrus Current State (mobile).dc.html` — before-state
- `assets/` — mascots, favicon (already in repo under `apps/web/public`)
