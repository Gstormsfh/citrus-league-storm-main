/**
 * THE PRESS BOX ROW LADDER (2026-09-04, direction 1a).
 *
 * The Press Box re-skin of `src/components/phoneRowScale.ts`. It lives HERE,
 * beside the screens that consume it, and the legacy module is untouched.
 *
 * WHY TWO MODULES RATHER THAN ONE EDITED IN PLACE. The first attempt at this
 * PR edited `phoneRowScale.ts` directly, on the reasoning that a type scale
 * should have one definition. That reasoning is right and the execution was
 * wrong: those rungs are consumed TODAY by `PlayerCard`, `MobileRosterList`,
 * `FreeAgentRow`, `ScoreboardStrip` and `CenterColumn` — five shipping
 * surfaces with thirteen test files pinning their exact output — and no Press
 * Box screen consumed them at all. Editing them changed every live phone row
 * to a half-converted state (Press Box families on the old layout) and broke
 * twenty-six assertions, in exchange for nothing rendering differently.
 *
 * So the ladder forks for exactly as long as the conversion takes. A screen
 * PR mounts the Press Box chrome and switches that screen's rows from
 * `phoneRowScale` to this module IN THE SAME COMMIT, and moves that screen's
 * guard over with it. When the last consumer of `phoneRowScale.ts` is gone
 * the file is deleted and this one keeps the name. Until then, every commit
 * leaves the app in a state that is entirely old or entirely new per screen,
 * never both — which is also what makes it safe to stop the run at any PR.
 *
 * WHAT CHANGES FROM THE LEGACY LADDER, and what does not:
 *
 *   1. FAMILY. Names move to Barlow; every number and label moves to IBM Plex
 *      Mono. JetBrains Mono is not retired — the draft room and the desktop
 *      surfaces still wear it; the Press Box phone rows simply stop using it.
 *
 *   2. THE QUIET RUNG GETS QUIETER. META 12 -> 10. That reads backwards until
 *      you look at what it buys: the spec's row heights (roster/matchup 56-58,
 *      players 64, standings 44) are FIXED, and the density pass adds a line
 *      to most rows. The gap between NAME and META widens from 3px to 5px, so
 *      the hierarchy the original audit asked for gets STRONGER while the row
 *      gets shorter. The two rungs a manager actually reads are unchanged.
 *
 *   3. META TRUNCATES BY CONTRACT. `whitespace-nowrap overflow-hidden
 *      text-ellipsis` is part of the rung rather than something each call site
 *      remembers. The spec's rule is "if content is too long, shorten the
 *      string, never grow the row" — a wrapping META line is the single most
 *      common way a fixed-height list turns ragged, and the only place to make
 *      that impossible is here.
 *
 * THE 10px FLOOR IS NOT NEGOTIABLE, and the first attempt broke it. The
 * Press Box spec's density pass wanted 9px for unit labels and status marks;
 * this repo has carried "every label is >= 10px" as an explicit contract
 * since the mobile score work (`PlayerCard.mobileScore.test.tsx`, K-series),
 * and three test files assert it by name. A design system does not get to
 * overrule an accessibility floor because the mock looked tighter — 9px Plex
 * Mono at 500 on #0C1811 is a smudge for anyone who does not already know
 * what the label says. MICRO and the headline label stay at 10px. The density
 * the spec wanted comes from META 12 -> 10 and from `leading-none`, both of
 * which are above the floor, and the measured row heights still land inside
 * the spec's band.
 *
 * SIZE, WEIGHT AND FAMILY ONLY — NO COLOUR, for the reason the legacy module
 * gives: this is a `.ts` and `darkThemeContrastGuard` only walks `.tsx`, so a
 * colour parked here would be a colour no guard reads. Colour stays at the
 * call site, where the guard can see it and where the row's state decides it.
 */

/**
 * The player's name. First read. 15px is the smallest size at which a
 * two-word name reads as a NAME rather than a label at a glance, and it is
 * what the mobile matchup card can pay for: (393 - 36) / 2 = 178px a side,
 * less 40.8px for a four-figure score at 17px Plex Mono, leaves the name 85px.
 *
 * `truncate` is part of the rung, not an add-on.
 */
export const PB_ROW_NAME = 'font-barlow font-bold text-[15px] truncate leading-tight';

/**
 * The number the row exists to show — tonight's points, the week's total, the
 * projection. Second read, and the only coloured number on the row.
 *
 * `tabular-nums` is the whole point: figures of one width keep the decimal in
 * the same place down a column of forty rows, so the eye compares numbers
 * instead of re-finding them. `leading-none` so the label under it sits tight
 * and the pair reads as one block.
 */
export const PB_ROW_HEADLINE = 'font-plex font-semibold text-[17px] tabular-nums leading-none';

/**
 * The unit under a headline number — "proj", "week", "live", "final".
 *
 * 10px, not 9: see the floor note in the header. Deliberately not tracked
 * wide either — at `tracking-[0.22em]` the four letters of "WEEK" were as wide
 * as the four figures above them, which is how a unit label ends up with the
 * same optical weight as the thing it is a unit of.
 */
export const PB_ROW_HEADLINE_LABEL =
  'font-plex font-medium text-[10px] uppercase tracking-[0.1em] leading-none';

/**
 * Team, opponent, game time, the live stat line — everything that qualifies
 * the name but is not the name. Truncates by contract; never wraps.
 */
export const PB_ROW_META =
  'font-plex font-medium text-[10px] leading-none whitespace-nowrap overflow-hidden text-ellipsis';

/**
 * Status chips, the scouting note, and anything else that is a mark rather
 * than a sentence. 10px is the floor: below it a label on this page is a
 * smudge, not small text.
 */
export const PB_ROW_MICRO = 'font-plex font-medium text-[10px] leading-tight';
