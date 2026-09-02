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
