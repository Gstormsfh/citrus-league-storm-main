# Desktop draft room: the board stops being a tab

Written overnight 2026-09-10 against
`docs/desktop-overhaul-and-projection-cards-20260910.md` section 2.

## Status: NOT COMMITTED

Two files changed, nothing committed, pushed, branched or opened as a PR.

    apps/web/src/components/draft/DraftBoard.tsx    +44 -3
    apps/web/src/pages/DraftRoomV2.tsx             +155 -85

The working tree is on `fix/apns-pem-separator-count`, already merged as
#451. Move the edits to a fresh branch first:

    git fetch origin
    git checkout -b feat/desktop-draft-board origin/master

They carry across cleanly; both files are identical on the two refs.

## Change 1: the board fits the screen it is on

`DraftBoard` rendered four teams to a screen at every width. On a 1440px
monitor that was four columns and a horizontal scrollbar: a phone layout
being stretched. `min-w-max` was the single class forcing the grid wider
than its scroller.

At `lg` and up it is now `min-w-max lg:min-w-0`, with the column tracks
falling from `minmax(80px, 1fr)` to `minmax(56px, 1fr)` through a second
CSS custom property and an `lg:` arbitrary-property variant. The
"SWIPE FOR ALL N TEAMS" hint is `lg:hidden`, because on desktop it is now
false.

The scroller itself is untouched at every width. `overflow-x` stays `auto`
rather than becoming `visible` on desktop, for two reasons and the second
is the important one:

1. A league wide enough to defeat the 56px floor still scrolls instead of
   overflowing its container. `minmax(0, 1fr)` would have squeezed a
   20-team board into unreadable slivers.
2. `overflow-x` on this element decides whether it is a scroll container at
   all, and every `position: sticky` inside it resolves against that box.
   `overflow-x: auto` also computes `overflow-y` out of `visible` per spec.
   That is exactly the trap `stickyScrollContainerGuard.test.ts` documents,
   where sixty-plus sticky elements went inert in production. Changing it
   needs a browser, not a guess.

## Change 2: the board is not a tab on desktop

This is the one the spec calls "the single biggest felt difference"
against the Sleeper reference.

The room shipped five phone tabs and reused three of them at every width,
so a 1440px monitor showed one pane at a time and the board only when you
asked for it. Sleeper keeps the board on screen permanently with the pool
beneath it and the queue and rosters in a right rail. Reading the shape of
the draft while you shop is the entire reason a board exists.

The board pane is now defined once as `const boardPane` inside `MainTabs`
and placed in exactly one of two positions:

- desktop: a `<section data-testid="draft-board-desktop">` above the tab
  strip, always mounted
- phone: inside `<TabsContent value="board">`, unchanged

Never both. `DraftBoard` owns a scroll effect keyed to the live pick, and
two mounted copies would fight over it. The desktop trigger row drops from
`Players | Board | History` to `Players | History`; `tab` already defaults
to `'players'`, so nothing can strand on a trigger that no longer renders.
The phone strip is untouched.

## Verification: what is actually known

**Passing, run on the device VM:**

- `npx tsc --noEmit -p tsconfig.app.json` exit 0
- `npx eslint src/pages/DraftRoomV2.tsx src/components/draft/DraftBoard.tsx` exit 0

**Five source-text guards read these two files. Each one's assertions were
extracted and executed by hand against the changed source, since vitest
cannot run here. All pass:**

- `draftRoomMobileGuard` : the on-clock bar's `fixed inset-x-0 bottom-0
  z-page-header lg:sticky`, `lg:top-16 lg:z-sticky-raised`, `pb-40 lg:pb-4`,
  `<PlayerStatsModal`, no `sticky top-24 z-20`, no `PlayerCardDialog`, both
  exit chunks brand orange, `StickyHeader` owns the exit
- `draftRoomExitGuard` : exit links >= 2, League HQ targets >= 2, the
  `Link, useParams` import, `MobileBottomNav` still hides `/draft-v2`
- `draftDecisionSupportGuard` : `scarcity={scarcity}`, `scarcityStrip(`
- `frontDoorGuard` : the `DraftLobbyV2` block carries no `font-jbmono`,
  `font-sans` or `text-pastel-cream`, keeps `draft-lobby-v2-start` and its
  `bg-pressbox-orange text-pressbox-orange-ink`
- `zLayerScaleGuard` : the guard's `layerTokens` walker reimplemented and
  run on both files. Tokens found are `z-sticky-base`, `z-page-header`,
  `z-section-header`, `z-sticky-raised`. Nothing off the scale, no raw
  numbers, no arbitrary values.

`aiVoiceGuard` bans em dashes in user-facing strings. The only two em
dashes in the diff are inside block comments that moved with the extracted
pane; both predate the change and comments are exempt.

**The four `DraftRoomV2` page suites were read rather than run.** All four
mock `DraftBoard` as `<div data-testid="mock-draft-board" />`, and that
testid is never asserted on anywhere in the repo. The single count
assertion in the suites is `getAllByTestId('mock-draft-queue')
.toHaveLength(1)`, which this change does not touch. `board-pre-draft-copy`
is the only testid inside `boardPane` and it is never asserted. The
pre-draft copy string is never queried by text. `AuctionBoard` is not
referenced by any of the suites, no fixture sets `format: 'auction'`, and
its imports are pure.

Worth knowing: `test-setup.ts` does not stub `matchMedia`, so
`useIsMobile` falls back to `window.innerWidth < 1024` and jsdom's default
1024 makes `isMobile` false. The suites therefore exercise the DESKTOP
branch, which is the branch this change alters.

**What is NOT verified:**

- The full vitest suite has not run. The device VM is linux-arm64 and the
  repo's native bindings are darwin-arm64: vitest dies on
  `Cannot find module './rolldown-binding.wasi.cjs'` and `vite build` on
  `Cannot find module '@rollup/rollup-linux-arm64-gnu'`. The npm registry
  is blocked from that VM (403 from the egress policy), so the Linux
  bindings cannot be fetched, and writing binaries into the Mac's
  `node_modules` unattended is not a trade worth making.
- **Nobody has looked at this rendered.** Every number below is arithmetic.

## The gap that remains, measured

The spec's target was "roughly 96px per column" for 14 teams at 1440px.
That assumed the board gets the full width. It does not: `MainTabs` renders
inside `lg:col-span-3` of a `lg:grid-cols-4`, so with a 1400px container the
main column is near 1000px and 14 teams land near 65px per cell. That still
holds a surname at 12px Barlow, and it is a large improvement on four
columns plus a scrollbar, but it is not the reference.

Closing it properly means lifting the board out of `MainTabs` and into
`DraftRoomBody` above the grid, so it spans all four columns with the rail
beside the pool rather than beside the board. That means threading
`derived`, `snapshot`, `auctionDerived`, `v1Teams`, `draftHistory`,
`keeperSlotNames`, `playersById`, `myTeamId` and `setCardPlayer` up a
level. It is a real refactor and it should be done with a test runner
attached, not blind.

## Morning runbook

There is NO root vitest config in this repo. `npx vitest run` from
`~/dev/citrus` runs with vitest's defaults: no `@` alias, no jsdom, no
`setupFiles`. Every DOM test and every `@/...` import fails, and it looks
like catastrophe. Run the workspaces the way CI does (ci.yml lines
533-628):

    cd ~/dev/citrus && npm run test --workspace=apps/web

    cd ~/dev/citrus && npm run test --workspace=server

    cd ~/dev/citrus && npm run test --workspace=packages/shared

    cd ~/dev/citrus && npm run test:scripts

Full suite per workspace, no path filter. A subset run proves nothing on a
repo with source-text guards; that mistake already cost a round of CI
failures this week.

Then open a draft room on a wide window and check five things:

1. The board is visible without clicking anything, above the Players strip
2. All teams fit with no horizontal scrollbar at 1440px
3. Surnames are readable at your real team count
4. The tab strip reads `Players | History`, with no dead Board trigger
5. At 393px nothing has changed: five tabs, board behind its own tab, the
   round rail still pinned when you swipe sideways

If the cells read too tight, the knob is the `56px` floor in `columnsWide`
in `DraftBoard.tsx`. Raising it trades cell width for the scrollbar
returning at high team counts.

## Desktop adaptation across the app, measured

The spec ranked pages by breakpoint density: lines of source per `lg:`/`xl:`
occurrence, higher meaning less adapted. Reproduced across every page over
300 lines, that puts `CreateLeague` (589), `DraftRoomV2` (187),
`FreeAgents` (168) and `Matchup` (157) at the top.

**That metric is confounded, and the confound is worth knowing before
anyone acts on the ranking.** Most pages in this app do not adapt with
responsive modifiers at all: they fork into two trees, a `hidden lg:block`
desktop branch beside an `lg:hidden` phone branch, or they branch in JS on
`useIsMobile()`. A forked page needs very few `lg:` modifiers precisely
because its desktop tree IS the desktop layout. Counting breakpoints there
measures the authoring style, not the quality of the result.

Counting the fork markers alongside the breakpoints:

| Page | Lines | lg: | xl: | fork markers | isMobile branches |
|---|---|---|---|---|---|
| Matchup | 6,136 | 35 | 4 | 10 | 4 |
| Roster | 4,829 | 101 | 5 | 15 | 6 |
| FreeAgents | 3,033 | 18 | 0 | 7 | 1 |
| DraftRoomV2 | 3,000 | 16 | 0 | **1** | 6 |
| LeagueDashboard | 2,584 | 27 | 7 | 6 | 4 |
| CreateLeague | 2,356 | 4 | 0 | 2 | 3 |
| Standings | 1,239 | 43 | 4 | 7 | 0 |

`FreeAgents` scored 168 on the naive metric but carries seven fork markers,
a two-column `lg:grid-cols-2` body, and a `lg:sticky lg:top-24` aside. It
has a real desktop layout. So does `Matchup`, with ten. Rewriting either on
the strength of the ratio alone would have been work spent on a page that
was already adapted.

`CreateLeague` tops the naive ranking and is also a false positive for a
different reason: it is a wizard in a `container mx-auto max-w-4xl`, and an
896px centred form is the right answer for a form. It needs few
breakpoints because it is one column by design.

**`DraftRoomV2` is the one page where the ranking and the fork count
agree.** One fork marker across 3,000 lines, sixteen `lg:`, zero `xl:`:
it genuinely was a phone layout reused at every width, which is why it was
the right place to spend the night and why the spec put it first.

On the evidence available, the honest next candidates are not
`FreeAgents` or `Matchup` but the pages with both a thin desktop tree and
real data density. That list cannot be finished from source alone. Ranking
what is left needs somebody looking at the rendered pages at 1440px, which
is the one thing this session could not do.
