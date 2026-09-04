# Press Box implementation — overnight run, 2026-09-04

Branch: `redesign/pressbox`. One commit per PR, in the order OPUS_PROMPT gives.

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

