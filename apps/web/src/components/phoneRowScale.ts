/**
 * THE PHONE ROW TYPE SCALE (2026-09-02).
 *
 * Four rungs, one vocabulary, for every list row a manager reads on a phone:
 * the roster list, both sides of the matchup comparison, the Free Agents
 * pool, and (since 2026-09-03) the rich notification card, which is a player
 * row that arrives at the top of the screen. Anything else that is a row a
 * manager reads at arm's length composes from these rungs; nothing restates
 * them.
 *
 * WHY IT EXISTS — the audit finding, measured in the harness at 393x852:
 *
 *   "Roster / Matchup rows: type scale 10-13px vs Sleeper 15-20px; headline
 *    numbers not dominant."
 *
 * The roster row carried nine distinct sizes between 8px and 15px:
 * `text-[8px]`, `text-[9px]` x3, `text-[10px]` x3, `text-[11px]` x2,
 * `text-[13px]`, `text-[15px]`, `text-xs` x5 and `text-sm`. A name at 13px
 * and its points at 15px are two pixels apart — at arm's length that is not
 * a hierarchy, it is one grey band, and the eye has to READ the row to find
 * the number instead of landing on it. The matchup card was worse: name
 * 14px, score 15px, one pixel.
 *
 * The problem was never that the row was small. It was that the row was
 * FLAT. So this is a ladder, not a bump: the two things a manager looks for
 * go up, everything else is pushed down onto one quiet rung so the gap
 * between levels is visible. Raising all nine values by 2px would have
 * produced the identical flat row, bigger.
 *
 * THE LADDER, and what each rung is for:
 *
 *   NAME      15px  bold, cream ...... who this is. First read.
 *   HEADLINE  17px  bold, mono ....... the number the row exists to show.
 *                                      Second read, and the only coloured
 *                                      number on the row.
 *   META      12px  muted ............ team, opponent, game time, stat line.
 *   MICRO     10px  muted, tracked ... unit labels, status chips, the note.
 *
 * The values are the ones `FreeAgentRow` shipped and tuned by eye a day
 * earlier (`freeagents/freeAgentRowKit.ts`); this module lifts them out so the
 * other two surfaces wear the same ladder instead of inventing a third and a
 * fourth. 17px rather than the 20px top of the audit's band is a fit
 * decision, not a taste one: the mobile matchup card gives each side
 * (393 - 36) / 2 = 178px, and a four-character score at 18px JetBrains Mono
 * (0.6em advance = 43.2px) does not leave "C. McDavid" its 84px at 15px.
 * 17px costs 40.8px and the name column survives at 85px.
 *
 * SIZE, WEIGHT AND FAMILY ONLY — NO COLOUR. Deliberate: this is a `.ts`,
 * and `darkThemeContrastGuard` only walks `.tsx`, so a colour parked here
 * would be a colour no guard reads. Colour stays at the call site, where
 * the guard can see it and where the row's state (live / projected / bench)
 * actually decides it.
 *
 * A pure module rather than exports from a component file, for the reason
 * `positionChip.ts` and `slotLabel.ts` give: a module that exports both a
 * component and plain values breaks react-refresh, so editing the row
 * during dev would force a full reload instead of a hot swap.
 */

/**
 * The player's name. 15px is the smallest size at which a two-word name
 * still reads as a NAME rather than as a label at a glance, and it is the
 * width the mobile matchup card can actually pay for (see above).
 *
 * `truncate` is part of the rung, not an add-on: at 15px an untruncated
 * name in an 85px column overflows its card and lands on top of the number
 * beside it — measured on the matchup harness before this change, where
 * "Wennberg-Nylander" printed straight through the opponent's score.
 */
export const ROW_NAME = 'font-display font-bold text-[15px] truncate leading-tight';

/**
 * The number the row exists to show — tonight's points, the week's total,
 * the projection.
 *
 * `font-jbmono` + `tabular-nums` is the whole point of the rung: figures of
 * one width keep the decimal point in the same place down a column of forty
 * rows, so the eye compares numbers instead of re-finding them. It also
 * takes the number OUT of `font-varsity`, which matters more than it looks
 * — `index.css` carries `h1, h2, .font-varsity:not(button) { @apply
 * text-pastel-cream }` at specificity (0,1,1), which silently beat the
 * `text-pastel-orange` / `text-emerald-700` utilities the roster row set on
 * its points. Every headline number on the phone roster was rendering
 * cream: projections and final scores were the same colour, and the row's
 * one piece of state colour was not on the page at all.
 *
 * `leading-none` so the label under it sits tight and the pair reads as one
 * block.
 */
export const ROW_HEADLINE = 'font-jbmono font-bold text-[17px] tabular-nums leading-none';

/**
 * The unit under a headline number — "proj", "week", "live", "final".
 *
 * Deliberately on the MICRO rung and deliberately not tracked wide: at
 * `tracking-[0.22em]` the four letters of "WEEK" were as wide as the four
 * figures of the number above them, which is how a unit label ends up with
 * the same optical weight as the thing it is a unit of.
 */
export const ROW_HEADLINE_LABEL =
  'font-jbmono text-[10px] uppercase tracking-[0.1em] leading-none';

/**
 * Team, opponent, game time, the live stat line — everything that qualifies
 * the name but is not the name.
 *
 * `leading-none` is a density decision with a number behind it: the roster
 * row's three-line variant measured 63.5px at 11px/`leading-tight`. Moving
 * the line up to 12px and leaving `leading-tight` alone would have made it
 * 67px, which is fewer players per screen — the one thing this change is
 * not allowed to cost. At `leading-none` the same row is 62px: bigger type,
 * shorter row.
 */
export const ROW_META = 'text-[12px] leading-none';

/**
 * Status chips, the scouting note, and anything else that is a mark rather
 * than a sentence. 10px is the floor: below it a label on this page is a
 * smudge, not small text.
 */
export const ROW_MICRO = 'text-[10px] leading-tight';
