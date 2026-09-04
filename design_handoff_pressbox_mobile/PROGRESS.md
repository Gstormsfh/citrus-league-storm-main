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

