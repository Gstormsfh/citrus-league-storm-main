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
 * THE 9px RUNGS, AND THE ARGUMENT I LOST. The first version of this module
 * held MICRO and the headline label at 10px, on the grounds that this repo
 * carries ">= 10px" as a contract three test files assert by name
 * (`PlayerCard.mobileScore.test.tsx`, K-series). That contract is real and it
 * still binds — but it binds the MATCHUP score stack, which is what those
 * three files render. It was never a repo-wide floor; I generalised it into
 * one, and the cost was a roster row visibly thinner than the design it was
 * supposed to be.
 *
 * The reference is explicit, and it is not a table in a README — it is
 * inline CSS on the artboard itself:
 *
 *     font:500 9px 'IBM Plex Mono',monospace;color:rgba(243,239,230,.45)
 *
 * on the unit under a headline number, on the week trend, and on the column
 * header. Three places, all of them marks a manager recognises by shape
 * (`P 6.9`, `PROJ`, `▲ 12%`) rather than sentences anyone reads. The matchup
 * stack's floor is untouched: nothing here renders inside it.
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
export const PB_ROW_HEADLINE_LABEL = 'font-plex font-medium text-[9px] leading-none';

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
export const PB_ROW_MICRO = 'font-plex font-medium text-[9px] leading-none';

/**
 * THE ARTBOARD'S TYPE, RESTORED — leading AND face.
 *
 * Every rule in the design file is written with the `font:` shorthand — and
 * the shorthand RESETS `line-height` to `normal` whether or not the author
 * meant it to. So the reference is `normal` everywhere: a 13px Barlow name
 * occupies 15px, a 9px mono sub-line occupies 10px, an 8px column header
 * occupies 9.
 *
 * Both halves live in the `.pb-type` rule in index.css rather than in this
 * string: `cn()` is tailwind-merge, and tailwind-merge DROPS a `leading-*`
 * class when a `text-{size}` class follows it, because `text-sm` and friends
 * set both. The segmented control lost its leading exactly that way.
 *
 * This app's base leading is 1.5. Inherited into a Press Box row that is two
 * lines of text beside a 26px disc, 1.5 turns 25px of stack into 33 and the
 * row from 43px to 50 — seven pixels per row, nine rows, half a screen of
 * standings gone. It is also the whole of what "it still looks way too spread
 * out" was pointing at: nothing was wrong with any single value, the leading
 * was wrong under all of them.
 *
 * THE SECOND HALF IS THE FACE. `index.css` carries
 * `body, p, span, .font-body { font-family: Montserrat; font-weight: 500 }`
 * as an ELEMENT rule, which beats inheritance: a <span> inside a row marked
 * `font-plex` renders in Montserrat anyway, because `span` matches the span
 * and the utility only matches its parent. Headings are worse — `h1, h2`
 * pull the Graduate varsity face at weight 900, uppercase. So the numbers in
 * the standings table were Montserrat 500 while every figure on artboard 1a
 * is IBM Plex Mono. `pb-type` (see index.css) turns inheritance back on for
 * the subtree, and still loses to a `font-*` utility written on the element
 * itself.
 *
 * Put this on the outermost node of a Press Box surface. Everything inside
 * inherits it, exactly as it does on the artboard, and any block that wants
 * real leading or a different face asks for it explicitly.
 */
export const PB_TYPE = 'pb-type';
