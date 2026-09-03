// RENAMED 2026-09-03 from `freeAgentRow.ts`.
//
// That name differed from the component `FreeAgentRow.tsx` only in the case of
// one letter. macOS and the CI runner disagree about whether those are two
// files: on a case-insensitive filesystem Rollup resolved BOTH import
// specifiers to this module and the build died with
//   "FreeAgentRow" is not exported by "src/components/freeagents/freeAgentRow.ts"
// after an unrelated edit invalidated its resolver cache. Vite's default
// extension order puts `.ts` ahead of `.tsx`, so the collision always favoured
// this file. Two modules whose names differ only by case is a latent build
// break; the "kit" suffix removes it. Do not rename this back.

/**
 * Pure helpers and class geometry behind `FreeAgentRow` — kept out of the
 * .tsx because a module that exports a component AND plain values breaks
 * react-refresh (the same reason `positionChip.ts` and `slotLabel.ts` stand
 * alone), and because the row's decisions — which verb the button carries,
 * what the game line says, how the list is ordered — are worth testing
 * without rendering anything.
 *
 * WHY THIS ROW EXISTS (2026-09-02, phone audit of Free Agents at 393x852).
 *
 * Free Agents is where a manager decides who to pick up, and on a phone it
 * was our weakest screen against Sleeper. Measured on the harness:
 *
 *   * a ~250px marketing hero ("✦ Scouting Room" / "Scout the pool." / a
 *     subtitle / the search box) burned the whole first screen — the first
 *     player appeared at y≈900, one and a half thumb-swipes down;
 *   * the Trending rows carried a name, a position, a team and an add
 *     count. No rank, no game, no projection — nothing you could pick a
 *     player WITH;
 *   * search and "See All" dropped the user into a 600px-wide table on a
 *     393px screen, so the decision column (the projection) was off the
 *     right edge and reachable only by a sideways drag.
 *
 * The fix is one row, used by every phone list on the page, whose headline
 * number is the thing the decision turns on: the league-scored projection.
 */
import type { NHLGame } from '@/services/ScheduleService';
import { ScheduleService } from '@/services/ScheduleService';
// The phone row type scale. This row's 15px name and 17px projection were
// tuned by eye here first; they were lifted into `phoneRowScale.ts` on
// 2026-09-02 so the roster list and the matchup rows could climb the same
// ladder instead of inventing a third and a fourth. Composing from it —
// rather than restating the sizes — is what keeps the three surfaces from
// drifting apart the next time one of them is edited.
import { ROW_HEADLINE, ROW_MICRO, ROW_NAME } from '@/components/phoneRowScale';

/**
 * What the row's right-hand button does. Three states, because a pickup is
 * three different transactions and a single "+" lied about two of them:
 *
 *   add   — the player is free, the roster has room. One tap, done.
 *   claim — the player is on waivers. The tap files a claim that processes
 *           later, so the button says WHEN ("W · clears Thu"). Sleeper and
 *           Yahoo both surface the clear time on the row; we surfaced it
 *           nowhere, and an add that silently became a claim read as a bug.
 *   swap  — the roster is full. The tap opens the drop picker. Saying so
 *           BEFORE the tap is the whole point: the old flow let a manager
 *           press "+" and get a modal they did not ask for.
 */
export type FreeAgentAction = 'add' | 'claim' | 'swap';

/** The glyph each action wears. `W` is the waiver-wire convention. */
export const ACTION_GLYPH: Record<FreeAgentAction, string> = {
  add: '+',
  claim: 'W',
  swap: '⇄',
};

/**
 * Which transaction a tap on this row would be.
 *
 * Waivers win over a full roster: a claim is filed against the waiver
 * queue, and the drop is chosen when the claim processes, not now.
 */
export function freeAgentAction(
  player: { is_on_waivers?: boolean },
  rosterFull = false,
): FreeAgentAction {
  if (player.is_on_waivers) return 'claim';
  return rosterFull ? 'swap' : 'add';
}

/**
 * "clears Thu" for a clear time inside the next week, "clears Sep 4"
 * beyond it. Short on purpose: this sits in a ~90px button on a phone, and
 * a day name is what a manager actually reasons about ("do I need him
 * before Thursday?").
 *
 * Returns null for a missing or unparseable timestamp rather than printing
 * "Invalid Date" — the button then reads just "W", which is still true.
 */
export function waiverClearsLabel(
  clearsAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!clearsAt) return null;
  const d = new Date(clearsAt);
  if (Number.isNaN(d.getTime())) return null;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) {
    return `clears ${d.toLocaleDateString('en-US', { weekday: 'short' })}`;
  }
  return `clears ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** What the row prints on its game line, or null for "no game". */
export interface FreeAgentGameLine {
  /** "vs BOS" / "@ NYR" — the prefix comes from which side of the fixture. */
  opponent: string;
  /** "7:00 PM" in the manager's timezone, while the puck has yet to drop. */
  time?: string;
}

/**
 * The NEXT game this player's team plays, from the week of schedule rows
 * the page already fetched. Today counts as next.
 *
 * `ScheduleService.getGameInfo` does the vs/@ decision and the timezone
 * conversion — the same call the roster row's game line goes through
 * (`gameDay.ts`), so the two surfaces cannot disagree about who a team is
 * playing. It also returns undefined when the team is not in the fixture,
 * which is how a stale schedule row gets dropped instead of printing
 * "vs undefined".
 */
export function nextGameLine(
  games: readonly NHLGame[] | undefined,
  team: string | null | undefined,
  todayStr: string,
  timezone = 'America/Denver',
): FreeAgentGameLine | null {
  if (!games?.length || !team) return null;
  const upcoming = games
    .filter((g) => g && g.game_date && g.status !== 'postponed')
    .filter((g) => g.game_date.split('T')[0] >= todayStr)
    .sort((a, b) => a.game_date.localeCompare(b.game_date));
  for (const game of upcoming) {
    const info = ScheduleService.getGameInfo(game, team, timezone);
    if (info?.opponent) return { opponent: info.opponent, time: info.time };
  }
  return null;
}

/**
 * DEFAULT ORDER IS THE PROJECTION (FPTS), descending.
 *
 * The phone list used to arrive in whatever order the free-agent fetch
 * produced — season points for skaters, then wins for goalies, appended.
 * That ordering answers "who was good last year", which is not the question
 * anyone opens this page with. The question is "who scores the most for me
 * this week", and the answer is the league-scored projection, so that is
 * what the list leads with and what the row's headline number shows.
 *
 * Ties break on name so the list is stable between renders — an unstable
 * order under a live projection refresh looks like the page is glitching.
 */
export function sortByProjection<T extends { full_name: string; weeklyProjection?: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const d = (b.weeklyProjection ?? 0) - (a.weeklyProjection ?? 0);
    return d !== 0 ? d : a.full_name.localeCompare(b.full_name);
  });
}

/**
 * The injury/availability chip that sits beside the name.
 *
 * MOVED (2026-09-02) to `@/components/player/statusChip`, unchanged, so the
 * draft pool can use it: this module imports `ScheduleService` for its game
 * line, which reaches the Supabase client and throws at module scope under
 * vitest, and importing the chip from here took three `PlayerPool` suites
 * down before an assertion ran. Re-exported under both names so every Free
 * Agents call site and test keeps working against the name it already uses.
 */
export { PLAYER_STATUS_CHIP as FA_STATUS_CHIP, statusChipFor } from '@/components/player/statusChip';

// ─── Geometry ────────────────────────────────────────────────────────
//
// Class strings live here, not inline in the .tsx, so the tests can hold
// the layout to a contract that jsdom cannot measure (it has no layout
// engine — see harness/README.md).

/**
 * ONE ROW, ONE LINE EACH (2026-09-02).
 *
 * 64px minimum: a 44px mug plus 10px of vertical padding, which is also
 * comfortably over the 44px iOS touch target for the whole row. `min-h`
 * rather than `h` so a two-line name on a narrow phone grows the row
 * instead of clipping.
 */
export const FA_ROW =
  'flex items-center gap-2.5 px-3 py-2 min-h-[64px] border-b border-pastel-sage/10 transition-colors active:bg-white/5';

/**
 * Rank: tabular so the column edge stays straight from 1 to 100.
 *
 * 11px -> the scale's MICRO rung (2026-09-02). It was the only size on this
 * row that belonged to no rung, and a list index is the least of the six
 * things the row says — it should sit UNDER the 12px game line, not between
 * it and the name. 10px also keeps "100" (18px in JetBrains Mono) inside
 * the 20px `w-5` column, which 12px would not.
 */
export const FA_RANK = `w-5 shrink-0 text-right font-jbmono ${ROW_MICRO} leading-none tabular-nums text-white/55`;

/** The name — the scale's NAME rung. */
export const FA_NAME = `${ROW_NAME} text-pastel-cream`;

/**
 * The headline number — the scale's HEADLINE rung. Right-aligned and
 * tabular: it is the biggest thing on the row on purpose, because it is the
 * thing the decision turns on, and tabular figures keep the column's
 * decimal point in one place.
 */
export const FA_PROJ = `${ROW_HEADLINE} text-pastel-sage-soft`;

/** Whatever sits under the projection — rostered %, games, adds. MICRO. */
export const FA_SUB = `font-jbmono ${ROW_MICRO} leading-none tabular-nums text-white/55 mt-1`;

/**
 * The game line's tint. Sage is the app's "live / good" colour and marks
 * the half of the second line that is about TONIGHT rather than about the
 * player's résumé, so the eye can skip to it.
 */
export const FA_GAME = 'text-pastel-sage font-semibold';

/** No game left in the week. Muted, and never a placeholder word. */
export const FA_NO_GAME = 'text-white/55';

/**
 * ONE CHIP ROW, NEVER TWO (2026-09-02).
 *
 * The position filters were `flex flex-wrap gap-2`. At 393px the seven
 * chips wrapped onto three lines — 96px of chrome above the first player,
 * on the screen whose entire job is showing players. They scroll sideways
 * instead: `flex-nowrap` so a chip can never wrap, `overflow-x-auto` +
 * `scrollbar-hide` + `ios-scroll` (momentum, `-webkit-overflow-scrolling:
 * touch`) for the gesture, `snap-x` so a flick lands on a chip edge.
 *
 * `overscroll-x-contain` matters more than it looks: without it a flick
 * past the last chip hands the gesture to the page and triggers the
 * browser's back-swipe on iOS.
 *
 * Discoverability, which is the failure mode a hidden scrollbar invites
 * (see the 2026-08-19 note on ArmchairGM's tab row, where two whole
 * features sat offscreen behind exactly this pattern): the chips overflow
 * by well over one chip width at every phone size we support, so the next
 * chip is always partly visible at the right edge, and `pr-6` guarantees
 * the last one is never flush against the clip. Nothing is hidden — the
 * row simply says "there is more this way".
 *
 * At `lg` the desktop layout has room for all of them, so it goes back to
 * wrapping and stops being a scroller at all.
 */
export const FA_CHIP_ROW =
  'flex flex-nowrap gap-2 overflow-x-auto scrollbar-hide ios-scroll snap-x overscroll-x-contain pr-6 lg:flex-wrap lg:overflow-visible lg:pr-0';

/** Every chip is atomic: it never shrinks and it never breaks mid-label. */
export const FA_CHIP = 'shrink-0 whitespace-nowrap snap-start';

/**
 * WHERE THE ROW LIST STOPS AND THE TABLE STARTS (2026-09-02, tablet pass).
 *
 * These two strings are one decision, so they are one pair of constants
 * rather than a class typed at six call sites. The decision is NOT "is this
 * a phone" — that question has exactly one answer in this codebase
 * (`hooks/useIsMobile.ts`, `MOBILE_BREAKPOINT = 1024`, Tailwind's `lg`) and
 * nothing here adds a second one. The question is narrower and belongs to
 * this page: DOES THE TABLE FIT?
 *
 * MEASURED, in Chromium on the real stylesheet, with the pool table's own
 * markup (11 skater columns + the 100px action column):
 *
 *   the table's minimum content width .......... 722px
 *   container below `lg` ....................... viewport - 18px
 *                                                (`px-2` on the content
 *                                                 column + the 1px card
 *                                                 border on each side)
 *
 *   viewport   container   table fits?
 *   393        375         no    → the row list, and this is why it exists
 *   744        726         yes, by 4px — too thin to build on
 *   768        750         yes, by 28px      ← Tailwind `md`
 *   820        802         yes, by 80px      (iPad Air portrait)
 *   1023       1005        yes, by 283px
 *
 * So the pool table fits from `md` up, and everything from 768 to 1023 was
 * being handed a 64px row with ~700px of empty space beside it and no
 * sortable columns at all — the row list's order is fixed by projection.
 *
 * WHY IT WAS `lg`. The 2026-09-02 phone pass moved every list/table switch
 * on this page to `lg` in one sweep, on the reasoning that "both cards
 * previously split at `md`, which left a 768-1023px tablet on the desktop
 * table". That is the right instinct for a PHONE and the wrong breakpoint
 * for the table: 768-1023 is precisely the band where it fits.
 *
 * A NOTE FOR WHOEVER LOOKS AT THE DESKTOP NEXT (2026-09-02, kept as
 * history; the desktop half shipped on 2026-09-03, see FA_PAGE_GRID below).
 * At `lg` and up the page turned into `grid-cols-[200px_1fr_260px]` with
 * `lg:px-4` and `lg:gap-4`, so the content column was `viewport - 524px`,
 * 500px at 1024. The table needs 722. The widest container this table ever
 * got below ~1250px was a TABLET, and the desktop rails were what made it
 * scroll sideways there. (The 500 was the grid column; the card inside it
 * was 50px narrower still, because the column carried `lg:px-6` and the
 * card a 1px border. The full arithmetic is under FA_PAGE_GRID.)
 */
export const FA_ROWS_ONLY = 'md:hidden';

/** The other half of the pair above. Never one without the other. */
export const FA_TABLE_ONLY = 'hidden md:block';

/**
 * THE DESKTOP GRID, AND WHY THE RIGHT RAIL WAITS FOR 1400px (2026-09-03).
 *
 * The pair above decides where the row list gives way to the table: `md`,
 * because from 768 the table fits. What it could not decide was whether the
 * table STILL fit once the desktop rails arrived at `lg`, and it did not.
 * The page grid was `lg:grid-cols-[200px_1fr_260px]` with `lg:px-4` and
 * `lg:gap-4`, then `xl:grid-cols-[220px_1fr_280px]` with `xl:px-6` and
 * `xl:gap-6`; the content column carried `lg:px-6` and the pool card a 1px
 * border on each side. So the card was:
 *
 *   `lg` (1024-1279)   viewport - 32 - 200 - 260 - 2x16 - 48 - 2 = viewport - 574
 *   `xl` (1280 and up) viewport - 48 - 220 - 280 - 2x24 - 48 - 2 = viewport - 646
 *
 * against a table whose minimum content width is 722px (measured above):
 *
 *   viewport   card    table fits?   (HISTORY: the 2026-09-02 grid)
 *   1023       1005    yes, by 283px   the last tablet width
 *   1024        450    no, short 272   the `lg` floor
 *   1279        705    no, short 17    the top of the `lg` band
 *   1280        634    no, short 88    `xl`, and the rails grew with it
 *   1366        720    no, short 2
 *   1368        722    exactly         the first desktop width that fit
 *   1440        794    yes, by 72px    the repo's other Chromium width
 *                                      (stickyScrollContainerGuard)
 *
 * Every laptop narrower than 1368 was scrolling the decision column off
 * the right edge, and a 1023px tablet had 555px more room for this table
 * than a 1024px laptop did. Sleeper, Yahoo and ESPN all keep the
 * projection column on screen on a tablet; this page was hiding it on a
 * laptop, behind a notifications feed that the Navbar bell already opens
 * as a slide-over on every viewport (Navbar.tsx).
 *
 * THE FIX IS THE RAIL, NOT THE TABLE. The notifications rail is the
 * column the page can do without (its content is one click away), and
 * the codebase already has the two-column shape for pages that render no
 * rail (`lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr]` on Matchup,
 * Standings, GMOffice and PlayoffBracket). So:
 *
 *   * `lg` and `xl` use that two-column grid, and the content column's
 *     desktop padding starts at `lg:px-4` (Matchup's rung) and grows to
 *     `xl:px-6` where there is room;
 *   * the rail, and the third grid column that holds it, arrive together
 *     at `min-[1400px]`. Both strings spell the number out in full because
 *     Tailwind's scanner only generates a class it can read verbatim from
 *     the source; a template-built class name produces no CSS. The test
 *     pins that the two literals and FA_RAIL_MIN_VIEWPORT agree.
 *
 * MEASURED, by the same arithmetic (Tailwind's default screens, none of
 * which tailwind.config.ts overrides; `px-2`/`px-4`/`px-6` = 8/16/24px a
 * side, `gap-4`/`gap-6` = 16/24px, `border` = 1px). The card is:
 *
 *   below `lg`            viewport - 16 - 2                          = viewport - 18
 *   `lg` (1024-1279)      viewport - 32 - 200 - 16 - 32 - 2          = viewport - 282
 *   `xl` (1280-1399)      viewport - 48 - 220 - 24 - 48 - 2          = viewport - 342
 *   1400 up, with rail    viewport - 48 - 220 - 280 - 2x24 - 48 - 2  = viewport - 646
 *   1400 up, no rail      viewport - 342 (a guest, or no active league)
 *
 *   viewport   card    table fits?
 *   768        750     yes, by 28px    Tailwind `md`, unchanged
 *   1023       1005    yes, by 283px   unchanged
 *   1024       742     yes, by 20px    the `lg` floor; was 450
 *   1279       997     yes, by 275px
 *   1280       938     yes, by 216px   `xl`; was 634
 *   1366       1024    yes, by 302px   was 720
 *   1399       1057    yes, by 335px   the last width without the rail
 *   1400       754     yes, by 32px    the rail returns; was 754 too
 *   1440       794     yes, by 72px    unchanged
 *   1536       890     yes, by 168px   Tailwind `2xl`, unchanged
 *
 * WHY 1400 AND NOT 1368 OR `2xl`. 1368 is where the three-column grid
 * fits by 0px; 1400 gives it the same order of slack `md` has (32 vs 28)
 * and is a width the design already thinks in (tailwind.config.ts sets
 * the `.container` cap there). `2xl` is 1536, which would take the rail
 * off every laptop between 1440 and 1535 wide for no reason. The widths
 * between 1368 and 1399 are given up knowingly: 32px of viewports.
 *
 * `FreeAgents.desktopRail.test.tsx` computes this table from the class
 * strings below and fails if any breakpoint where FA_TABLE_ONLY shows the
 * table hands it fewer than FA_TABLE_MIN_WIDTH pixels. The numbers above
 * are the numbers it asserts; change one, and you change the other.
 *
 * Caveats the arithmetic does not cover: `lg:w-screen` is 100vw, which on
 * a browser with a classic (non-overlay) scrollbar is wider than the
 * layout viewport by the scrollbar; and the 722 was measured with the
 * eleven skater columns, so a pool that shows the three goalie columns
 * beside them (position filter ALL, goalies present) is wider than 722
 * and is measured nowhere yet.
 */
export const FA_TABLE_MIN_WIDTH = 722;

/** The viewport width, in px, from which the three-column grid holds the table. */
export const FA_RAIL_MIN_VIEWPORT = 1400;

/**
 * The page grid without the notifications rail: a flex column on a phone,
 * two columns from `lg`. The `w-screen`/`left-1/2`/`-translate-x-1/2` trio
 * is what every three-rail page in the app does to escape its container.
 */
export const FA_PAGE_GRID =
  'flex flex-col lg:grid lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2';

/**
 * Added to FA_PAGE_GRID only when the notifications rail renders, so a
 * guest never gets an empty 280px column. One breakpoint, spelled out.
 */
export const FA_PAGE_GRID_WITH_RAIL = 'min-[1400px]:grid-cols-[220px_1fr_280px]';

/** The content column. `lg:px-4` is what buys the 20px at 1024. */
export const FA_CONTENT_COLUMN = 'min-w-0 px-2 lg:px-4 xl:px-6 order-1 lg:order-2';

/** The notifications rail. Same breakpoint as FA_PAGE_GRID_WITH_RAIL, always. */
export const FA_NOTIFICATIONS_RAIL = 'hidden min-[1400px]:block order-3';

/** The pool card. Its `border` is the 2px in every line of the table above. */
export const FA_POOL_CARD = 'border rounded-lg overflow-hidden';
