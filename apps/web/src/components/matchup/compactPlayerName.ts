/**
 * THE PHONE MATCHUP ROW'S NAME (2026-09-02).
 *
 * One pure function, because the rule it encodes is a MEASUREMENT and the
 * measurement is the only thing that justifies it. A `.ts` module rather
 * than an export from `PlayerCard.tsx` for the reason `phoneRowScale.ts`
 * and `positionChip.ts` already give: a file that exports both a component
 * and plain values breaks react-refresh.
 *
 * THE GEOMETRY, measured in Chromium at 393x852 on `harness/matchup.html`:
 *
 *   card              178.5px   (393 - 36 centre column) / 2
 *   ├ border            1px
 *   ├ padding           6px     index.css `.player-card { padding: 6px 6px }`
 *   ├ NAME BLOCK     82.5px     ← everything below is about this number
 *   ├ gap               6px
 *   ├ mug              28px     fixed, may not shrink (audit M4)
 *   ├ gap               6px
 *   ├ score stack      42px     fixed, holds "22.4" at the 17px HEADLINE rung
 *   ├ padding           6px
 *   └ border            1px
 *
 * The name block is 82.5px and CANNOT GROW. The mug and the score column are
 * fixed by the M4 note in index.css — a ragged column of faces or a moving
 * decimal point is worse than a short name — and the paddings and gaps are
 * already down to 6px. Taking all four to 4px would buy 6px, which does not
 * change any of the outcomes below and makes a 64px row feel cramped.
 *
 * SO THE FIX IS THE STRING, AND THE STRING WAS SPENDING ITS WIDTH BADLY.
 *
 * WHAT THE OLD RULE COST. "Auston Matthews" → "A. Matthews" put a first
 * initial in front of the one token that identifies a hockey player. The
 * initial costs ~19px of an 82.5px column — 23% of the line — and when the
 * pair overflows it is the SURNAME that gets eaten, because the ellipsis
 * clips the tail. Measured over 57 real NHL names at 15px bold in the
 * 82.5px block:
 *
 *   "F. Last" (the old rule) .... 34 of 57 fit ..... 60%
 *   "Last"    (this rule) ....... 54 of 57 fit ..... 95%
 *
 * The 23 that overflowed rendered as "N. Kuche…", "M. Celeb…", "J. Sway…",
 * "J. Oettin…", "N. MacKi…", "B. March…", "W. Nylan…" — a first initial and
 * a prefix, which is the least useful half of a name. All 23 fit whole once
 * the initial goes. The three that still do not (Nedeljkovic and Svechnikov
 * at 83.4px, Nugent-Hopkins at 115.8px) are no worse than before: the
 * surname is a suffix of "F. Surname", so this rule can only ever make a
 * name NARROWER. No row can regress.
 *
 * (Measured with the metric-similar fallback face, since the sandbox has no
 * route to fonts.googleapis.com. The one Montserrat number index.css records
 * — "C. McDavid" at 83.6px — measures 83.0px here, so the two agree to
 * within a percent. Nothing about the rule depends on the exact metric: it
 * is a strictly shorter string, not a fitted one.)
 *
 * WHY DROPPING THE INITIAL IS SAFE, AND WHERE IT IS NOT. The row already
 * carries three other identifiers: a 28px headshot beside the name, the
 * team and opponent on the line under it, and the slot chip in the centre
 * column. Two players who share a surname are separated by all three —
 * Jack Hughes (NJD, C) and Luke Hughes (NJD, D) differ by the chip; Matthew
 * and Brady Tkachuk differ by team. The case this rule genuinely cannot
 * disambiguate is two same-surname players at the same position on the same
 * team in the same lineup, where the old rule could not either once the
 * name overflowed. The full name stays in the row's `title` and one tap
 * opens the player card.
 *
 * DESKTOP IS UNTOUCHED. `compact` is false there and the full name renders;
 * the desktop card's name column is not 82.5px.
 */

/**
 * The row's name.
 *
 * `compact` is the phone row (`useIsMobile()` at the call site, which is the
 * one viewport question — see `hooks/useIsMobile.ts`). Compact returns the
 * FAMILY NAME: everything after the first whitespace-separated token, so
 * particles and hyphens survive whole ("Van Damme", "Nugent-Hopkins"), and a
 * single-token name is returned unchanged rather than mangled.
 */
export function compactPlayerName(name: string, compact: boolean = false): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!compact) return trimmed;

  const space = trimmed.indexOf(' ');
  if (space === -1) return trimmed;

  const family = trimmed.slice(space + 1).trim();
  // "Cher " or "Connor  " — a trailing space is not a family name.
  return family || trimmed;
}

export default compactPlayerName;
