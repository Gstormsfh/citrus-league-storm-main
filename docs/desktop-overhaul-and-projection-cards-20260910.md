# Desktop overhaul and projection cards

Written overnight 2026-09-10, after the Play submission went to review. Two
references from Garrett: a Sleeper draft board (desktop) and an
@ocelotanalytics fantasy projection card. This is the architecture read, not
a design. Visuals are Claude Design's job.

Nothing in here has been implemented. No files were changed by this document.

## 1. What the desktop actually looks like today, measured

Responsive-class density per page, counting `lg:` occurrences against file
length:

| Page | Lines | `lg:` | `xl:` | One breakpoint per |
|---|---|---|---|---|
| Standings | 1,239 | 43 | 4 | 29 lines |
| Roster | 4,826 | 101 | 5 | 48 lines |
| Matchup | 6,136 | 35 | 4 | 175 lines |
| **DraftRoomV2** | **2,968** | **16** | **0** | **186 lines** |

The draft room is the least adapted surface in the app and the only core page
with zero `xl:` handling. That matches the instinct: it is a phone layout
being stretched, not a desktop layout.

`components/draft/DraftBoard.tsx` (322 lines) states its own intent in the
header comment: "The grid scrolls sideways with the round rail pinned, four
teams to a phone width." On a 1440px monitor that is still four teams and a
horizontal scrollbar. The Sleeper reference shows all 14 teams and six rounds
at once, which is the entire point of a draft board: you read the shape of the
draft, not one column of it.

One thing the existing board gets right and should keep: the header comment
notes "this codebase carries no ADP, so that column is omitted rather than
invented." Sleeper's board leans on ADP for its REACH / VALUE colouring. We
do not have ADP. Do not invent it to match the reference.

## 2. Desktop draft board

The change is a layout mode, not a rewrite. `DraftBoard.tsx` already computes
pick numbers, snake order, your-column highlighting and on-the-clock state.
What it lacks is a desktop presentation of the same model.

Target at `lg:` and above:

- All teams visible without horizontal scroll. At 14 teams on 1440px that is
  roughly 96px per column, which fits a name and `pos · team` at the current
  type scale. Below that width, keep the phone rail.
- Vertical scroll through rounds with the team header row pinned, rather than
  horizontal scroll with the round rail pinned. Rounds are the long axis on
  desktop.
- The three cell states carry over unchanged: your column outlined, on the
  clock solid orange, future picks dashed with `4.06` style numbering.
- Sleeper puts the player pool below the board and the queue/roster/chat in a
  right rail. We have all four surfaces already as tabs (PLAYERS, QUEUE,
  BOARD, MY TEAM, HISTORY). On desktop they should be simultaneous panels,
  not tabs. That is the single biggest felt difference between the two
  references.

What we have that Sleeper does not, and should show on the board: projected
points and the xG percentile already render in our pool rows (`948.6 PROJ`,
`xG 96th`). Those belong in the desktop pool panel, not hidden behind a tab.

## 3. Desktop roster

`Roster.tsx` is 4,826 lines with 101 breakpoints, so it is not unadapted, it
is adapted narrowly. The desktop problem is proportion rather than absence:
a phone-width column of rows centred in a 1440px viewport.

The overhaul is the same move as the draft board: use the width for
simultaneity. Lineup, bench and the day/week strip side by side instead of
stacked behind tab switches.

Defer specifics until Claude Design lands. Do not spend engineering time
guessing at a layout that is about to be drawn.

## 4. The projection card, and what we can honestly build

This is the part that needs care, because the reference card is built on
something we do not have.

### Verified in the database tonight

`player_projected_stats`, season 2026 (the 2026-27 season):

- 81,312 rows, covering 2026-09-29 through 2027-04-10
- 84 game rows per skater, full schedule
- Per-category per-game projections populated: goals, assists, SOG, blocks,
  hits, PIM, PPP, SHP, plus goalie categories
- `projection_std_dev` populated on all 81,312 rows
- `projection_skewness`, `likely_low`, `likely_high`: **0 of 81,312 populated**
  for season 2026. They exist only for 2025 (19,353 of 72,060 rows).
- `calculation_method` = `v2_rates_age_home_b2b`
- Per player, `count(distinct projection_std_dev) = 1` and
  `count(distinct total_projected_points) = 4`

That last line is the important one. The standard deviation is a single
number per player repeated across all 84 games, and there are only four
distinct per-game point values per player, which is what you would expect
from a rates model varying by home/away and back-to-back. It is not a
per-game modelled variance.

### What this means for the card

**Buildable today, from stored data:**

- The Projected Totals block: season sums per category. Verified present.
- The rank columns (`#166 All`, `#44 LW`, `#160 Fwd`): a window function over
  the same table. Verified computable.
- A points floor/ceiling band from `projection_ci_lower` / `projection_ci_upper`.

**Not buildable today:**

- The milestone probability bars (`70+ Games 73%`, `20+ G 31%`, `250+ HIT
  79%`). Those come from 2,000 simulated seasons in the reference card. We
  store no simulations, no per-category dispersion, and no games-played
  distribution. A constant per-player points standard deviation cannot
  produce P(20+ goals) or P(150+ SOG) without inventing the variance
  structure underneath it.
- The Games Played histogram (`<30`, `30-39`, ... `80-84`). Same reason: it
  requires an availability model we do not have.
- The "Hits, the full spread" density plot. Same reason.

### The gap, stated plainly

The bars Garrett liked are a season simulator, not a chart. The work is in
the pipeline, not the front end:

1. Per-category dispersion. We have per-game category means. We need a
   variance model per category, which for counting stats is closer to a
   negative binomial than to the single points sigma we store now.
2. A games-played model. The reference card's `49-84` range and its 60%
   mass in the 80-84 bucket is an availability distribution. We would need
   injury history and a durability prior.
3. A Monte Carlo pass over the 84-game schedule producing season totals per
   draw, then milestone probabilities as the share of draws clearing each
   line.

Only after that does the chart become a rendering job. If this becomes a
priority, it is a Phase 0-style pipeline arc with its own verification, not a
draft-kit feature that can be bolted on before the season opener.

### The intermediate move

There is an honest version of this card that ships without a simulator:
projected totals, positional ranks, the xG percentile we already compute, and
the points confidence band. It communicates most of what the reference
communicates. It just does not claim probabilities we cannot compute.

Recommend shipping that, and treating the milestone bars as a separate,
later, properly-modelled piece of work.

## 5. Open question flagged, not answered

The player card in the Sep 5 simulator screenshot renders the string
"Citrus xG v3". The database carries `xg_v5_cells`, `xg_v5_en`,
`xg_v5_parent` and `xg_v5_shape` tables. Those two facts disagree about the
model version, and per the numbers rule neither should be repeated in a deck
or a store listing until it is resolved against the model artifacts. Worth a
bead.

## 6. Suggested order

1. Desktop draft board layout mode. Highest felt gap, self-contained, and the
   underlying model already exists.
2. The honest projection card. No new modelling, real product value, feeds
   the draft-kit and YouTube content plan.
3. Desktop roster, once Claude Design lands the artboards.
4. Season simulator, if and when the milestone bars are worth a pipeline arc.
