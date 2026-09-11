# Work order — server-rendered player writeups

**Author:** Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett Storms, 2026-09-11
**Executor:** Claude Code, in the terminal, with the test suite running.
**Why now:** making writeups dynamic is itself build-gated. Build 18 has not been
archived, and Apple's edits require a rebuild anyway. This is the last cheap
moment to stop shipping prose inside the binary.

---

## 1. Objective

Every word a player card shows must be changeable with a server deploy, never an
App Store round trip. Today `apps/web/src/utils/playerWriteup.ts` runs in the
app: `PlayerStatsModal.tsx:743` calls `generatePlayerWriteup(player, extras)` and
renders `headline`, `summary`, `analysis` and `tags` from its return value.

After this change the server renders that object and the client displays it.

## 2. The one non-negotiable

**The local engine stays in the bundle for build 18, as a fallback.**

```ts
const writeup = data?.writeup ?? generatePlayerWriteup(player, writeupExtras);
```

If the endpoint 500s, times out, or omits the field, the card renders exactly as
it does today. This build goes to an expedited Apple review and then into the
first real drafts on Sept 15; a render path that can go blank under load is not
acceptable, and a reviewer who opens a player card must never see an empty
summary. The fallback comes out in a later build, once the server path has run
through a real draft.

This is not optional. Ship the port with the fallback or do not ship the port.

## 3. What moves, and where

### 3.1 The engine → `@citrus/shared`

`apps/web/src/utils/playerWriteup.ts` is 814 lines and has exactly **one** import:

```ts
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
```

It is `import type`, deliberately (see the comment at line 54). There are no
React, DOM, `window`, `document` or storage references anywhere in the file. It
is pure and moves as-is.

- Move the file to `packages/shared/src/playerWriteup/index.ts`.
- Replace the `HockeyPlayer` import with a **structural** `WriteupPlayer` type
  declared in shared, carrying only the fields the engine reads. Do not drag a
  React component's type into the shared package. Assert at the call site that
  `HockeyPlayer` satisfies `WriteupPlayer`.
- Leave `apps/web/src/utils/playerWriteup.ts` as a re-export
  (`export * from '@citrus/shared/playerWriteup'`) so the three existing call
  sites and `apps/web/src/utils/__tests__/playerWriteup.test.ts` do not move.

`@citrus/shared` is already consumed by both sides — `server/src/middleware/*`
and `apps/web/src/types/leagueTypes.ts` both import it — so no new wiring.

### 3.2 The extras → server-side assembly

`PlayerStatsModal.tsx:713-742` builds `WriteupExtras` from six client sources.
Every one has a database origin the server already reads:

| extra | source | server has it |
|---|---|---|
| `age` | `player_directory.birthdate` | yes |
| `goalsBySeason` | `player_xg_season`, regular season | yes |
| `career` | `player_directory.career` | yes — `players.ts:284` already selects it |
| `xgPercentile`, `garPercentile`, `cohortNoun`, `cohortSize` | cohort over the dashboard index | yes — `PlayerDashboardService.getDashboardIndex()` |
| `projFp`, `projGp`, `posRank` | `player_ros_projections` + the league's scoring | yes |
| `projectionLabel` | season framing (before/after the opener) | yes — `get_current_season()` / `get_projection_target_season()` |

Only the percentile block needs new server code. Extract the cohort selection and
the two percentiles from `apps/web/src/components/player/playerAdvancedMetrics.ts`
(788 lines) — **the writeup needs `xgPercentile`, `garPercentile`, `cohortNoun`
and `cohortSize` and nothing else.** Do not port the sparklines, the bullet
categories or the rest of the advanced card; leave those on the client.

### 3.3 Cohort correctness — an intentional behaviour change

The client computes percentiles against the index it happens to have loaded. The
server computes them against the full qualified universe. **The server answer is
the correct one, and some writeups will read differently after this ships.** That
is an improvement, not a regression — record it in the PR body so a changed
sentence is not later mistaken for a bug.

## 4. Endpoint contract

Fold the writeup into the per-player payload the modal **already** fetches. Do
not add a second round trip, and do not add a loading state — a writeup that
arrives after the card has painted is worse than one baked in.

```
GET /api/players/:playerId/dashboard?leagueId=<uuid>
```

gains:

```ts
writeup?: {
  headline: string;
  summary: string;
  analysis: string;
  tags: Array<{ label: string; tone: 'positive' | 'neutral' | 'caution' }>;
  hasEnoughData: boolean;
  cardNote: string;
  cardTone: 'positive' | 'neutral' | 'caution';
}
```

`leagueId` is required for `projFp`: the projection line is scored with **that
league's** `league_scoring_rules`, which is SQL source of truth and already
server-side. With no `leagueId`, omit the projection sentence rather than
defaulting to league-neutral scoring — a wrong number is worse than a missing
sentence, and there are 16 distinct scoring shapes across 68 leagues.

Reads must go through `readAllPaged` / `pagedSelect` where a cohort is fetched.
PostgREST's `db-max-rows` is 1000 and silently truncates — a cohort clipped to
1000 would produce wrong percentiles with no error. This is the same defect class
as the draft board's 500-row cap.

## 5. Client change

Three call sites exist. Only one is a copy surface:

| file | uses | change |
|---|---|---|
| `PlayerStatsModal.tsx:743` | `headline`, `summary`, `analysis`, `tags` | **yes** — prefer the server object, fall back to the local engine |
| `HockeyPlayerCard.tsx:354` | `cardNote`, `cardTone` only | none |
| `MobileRosterList.tsx:176` | `cardNote`, `cardTone` only | none |

The two roster components render the IR / game-time-decision status chip, not
prose. Leave them computing locally: they render in lists, and making them wait
on a payload would cost a round trip per row for a five-word chip.

## 6. Tests

1. **Golden equality.** The proof that a port did not change behaviour: run the
   shared engine and the server endpoint over the same fixture set and assert the
   returned objects are deep-equal. Cover at minimum a skater with a long career,
   a goalie, a rookie with no NHL history, a player on IR, and one with
   `hasEnoughData: false`.
2. `playerWriteup.test.ts` moves with the engine and must pass unchanged. It is
   the regression net for the 814 lines.
3. **Fallback test.** Mock the payload without `writeup` and assert the modal
   still renders the locally generated one. Mock a 500 and assert the same.
4. **League scoping.** Two leagues with different `league_scoring_rules` must
   produce different `projFp` in the projection sentence for the same player.
5. Server route test in the style of `rosterSyncRoute.test.ts`.

## 7. Order of operations

1. This port, merged, CI green.
2. Apple's review edits, merged.
3. **One** `npm run ios:sync` from `apps/web` covering both, and confirm the
   banner reads `VITE_APP_VERSION=1.1.0+18`, backend PRODUCTION, api origin
   `https://citrusfantasysports.com`, supabase `iezwazccqqrhrjupxzvf`.
4. Archive and submit.

`CURRENT_PROJECT_VERSION` is already 18 in both configs (committed in
`ea132497`, PR #457). Do not bump it again — the build has not been archived.

## 8. Out of scope

- Externalising the *phrasing templates* so copy can be edited without any
  deploy. That is a second refactor. After this port, changing wording is a
  Cloud Run deploy, which is the requirement.
- The paid Draft Kit's `draft_kit_blurbs` (0 rows). Separate surface, separate
  entitlement.
- Removing the client fallback. A later build, after a real draft.

---

# Addendum — everything else that must not be frozen in the binary

Added 2026-09-11 after the first pass. Sections 1-8 above stand; this extends
scope to the rest of what a build lock costs us.

## 9. The principle

**Ship a renderer, not content.** A string the app *composes* is frozen at build
time. A string the app *receives and displays* is free forever. Apple's
guideline 2.5.2 draws the outer limit: serving data, strings, config and content
is fine and universal; downloading executable code is a rejection. So the app
may never learn a new *rule* from the server — but it can learn any new *value*,
including a finished sentence.

Everything below is an application of that one line.

## 10. Card chip strings (build-locked today)

`HockeyPlayerCard.tsx:547` and `MobileRosterList.tsx:349` render
`writeup.cardNote` / `cardTone`, produced by the IR / GTD / SUSP branches at the
end of `generatePlayerWriteup`. The *decision* is data-driven — it follows
`player.status` — but the three strings are in the binary:

```
"On injured reserve"  /  "Game-time decision"  /  "Suspended, unavailable"
```

Section 5 deliberately left these alone to avoid a fetch per list row. That
reasoning holds for a *dedicated* fetch; it does not hold for a field on a
payload the list already receives.

**Do:** add `card_note` / `card_tone` to the roster and player-list payloads
those two components already consume, and render
`player.card_note ?? writeup.cardNote`. No new request, same fallback shape as
section 2. Then the injury vocabulary is editable from the database — which
matters, because "Out", "Day-to-day", "LTIR" and "Suspension" are feed values we
do not control and whose display wording will want tuning in-season.

## 11. Remote config — the general escape hatch

One table, one fetch on launch, one helper with a baked default:

```ts
copy('player.card.ir', 'On injured reserve')
flag('draft.showRookieBadge', true)
num('projection.cohortMinGp', 20)
```

Any key present in the server's map wins; anything absent falls back to the
literal passed at the call site, so a failed fetch renders today's app exactly.
Cache the response, refresh on foreground, never block first paint on it.

Route the strings most likely to need changing in-season: player-facing copy,
injury and status vocabulary, empty states, and any numeric threshold in the
projection or draft UI. Do **not** attempt to route every string in the app —
that is a month of work and most of them will never change.

This is the difference between "we can fix that tonight" and "that's in the next
release." Ship it in 18.

## 12. Status and injuries — the part that is not a code problem

`fetch_injury_status.py` reads **ESPN's public injuries feed**. Its own docstring
is blunt about what that is: undocumented, no SLA, every status treated as OPEN,
and "licensing a proper feed (SportsDataIO, Rotowire) is the durable answer;
this is the bridge."

That is also the honest answer to how the established platforms do this. The
architecture is the same one described above — licensed feed, normalized to
stable player ids, rendered server-side, displayed by a thin client with remote
config. The part that is not architecture is that **they pay for the data**: a
commercial feed with an SLA, push rather than poll, and game-day scratch and
starting-goalie confirmations that no public feed carries. (Which vendor each of
them uses is not something this document can verify; the pattern is standard,
the vendor list is not.)

Two separate actions follow, and only the first is urgent:

1. **Enable the cadence.** The cron in `injury-status-sync.yml` is commented out,
   and the header says why: it was waiting on
   `player_talent_metrics.roster_status_source` from migration `20260827030000`.
   **That column exists in production as of 2026-09-11** — verified against
   `information_schema` — so the stated blocker is gone. Uncomment
   `0 */6 * * *`. Without it, `is_ir_eligible` stays false for all 940 rows and
   `Roster.tsx` refuses every IR assignment in every league.
2. **Licensing.** A procurement decision, not an engineering one, and the right
   conversation for after launch. Note what the bridge feed cannot do: game-day
   scratches and starting-goalie confirmations land 1-2 hours before puck drop
   and are not in it. Tightening the cron will not catch them.

## 13. What must be in build 18, and what must not

In the binary, because they are readers and cannot be added later without a
release:

- the server-writeup preference with local fallback (sections 1-8)
- `card_note` / `card_tone` preference with local fallback (section 10)
- the remote-config fetch and helper (section 11)

Not in the binary — data and ops, changeable any time:

- the injury cron, the feed, and every value it writes
- every string later served through remote config
- every writeup the server renders

Keep that split honest. Anything that ends up on the wrong side of it becomes an
App Store round trip the next time it needs to change.

## 14. The news pipeline — the architecture is right, the linking is not

Measured on production 2026-09-11 22:07 UTC, read-only. `news-ingest.yml` runs
every 30 minutes and is live; `citrus-news-generate.yml` every 6 hours and is
live. Neither needs enabling. Two things are broken inside them.

### 14.1 Three of seven sources return nothing

```
source            seen  inserted  matched  error
NHL.com             25         2        2
Sportsnet           51         4        1
Daily Faceoff       25         2        0
DobberHockey        10         0        0
The Hockey News      0         0        0   upstream 404
TSN                  0         0        0   upstream 404
ESPN                 0         0        0   upstream 403
```

TSN and The Hockey News 404 — feed URLs have moved. ESPN 403 — blocked.
`fetch_injury_status.py` already reaches ESPN through `CITRUS_PROXY_USERNAME` /
`CITRUS_PROXY_PASSWORD` / `CITRUS_PROXY_API_URL`; route `NewsRoomService`'s
fetcher through the same proxy rather than inventing a second mechanism.

A source failing every 30 minutes with `errors: 1` and nobody noticing is the
same failure class this repo has already paid for twice tonight. `news_sources`
should carry a consecutive-failure count, and `data-freshness-check.yml` (hourly,
live) should fail when any enabled source has produced zero rows for N runs.

### 14.2 Matching is the actual product

Across the two most recent runs: **~111 stories seen, 11 inserted, 3 matched to
a player.** A story reaches a player card only when it resolves to that player,
so the Latest News block is empty for nearly everyone.

This is the whole job. The established platforms' value on player news is not
that they fetch RSS — it is name-to-player resolution at high recall: nicknames,
accents and diacritics, "J.T. Miller" vs "JT Miller", last-name-only in a
headline, two active players sharing a surname disambiguated by team, and
players named in the body rather than the title.

`nhl_player_identity` and `player_directory` are the resolution targets and both
are populated. Treat recall as the metric, measure it against a hand-labelled
sample of recent stories, and do not ship a matcher change without that number
moving. Precision matters too — a story attached to the wrong player is worse
than one attached to none.

Neither 14.1 nor 14.2 requires an app release. Both are server and data work.
