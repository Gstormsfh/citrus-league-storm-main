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
