# Toronto Game Day: the page-design pass

For the terminal, with the page-design skills. **This is not an art brief.** No
image in this build needs regenerating. Every note below is about layout,
hierarchy and information design on thirteen pages.

Run the skills against `demo/index.html` and `demo/app.js`, rebuild with
`python3 build.py`, and keep the suites green (bottom of this file).

---

## The system that is already there

Honour it. It is the client's, not a default, and every page now uses it.
Do not introduce a second palette or a second typeface.

**Colour**

```
--navy    #00205B   the ground, Toronto's own blue
--deep    #00102E   header, score bug, anything that should sit behind
--surf    #001B4D   card
--surf2   #00286E   card, one step up
--line    #123A7A   hairline, 1px, everywhere
--ink     #FFFFFF   primary
--ink2    #C7DAF3   secondary
--ink3    #8FB3E0   muted, labels, captions
--citrus  #FF6B1A   the single accent. Live state, your side, the primary button.
```

The accent appears in about four places per screen and nowhere else. Semantic
green and red exist for win/loss and are not the accent.

**Type** One family: Archivo, 400 to 800. Hierarchy comes from weight, size and
colour, never from a second face. Scale in use: 33 / 25 / 21 / 15 / 13 / 11 /
10. Digits that line up in columns take `font-variant-numeric: tabular-nums`.

**The page pattern** applied to all thirteen:

```
GAME 03 · LIVE                  ← eyebrow, 11px, uppercase, muted
Who Goes Off                    ← 33px, 800, tight
Six head to heads. Pick a side, lock the slate, watch it settle.   ← ONE line
[6 head to heads] [No numbers to read] [Settles at the buzzer]     ← chips
────────────────────────────────────────────────
the game
────────────────────────────────────────────────
[ 4 of 6  picked, then lock ] [payout ladder]        [ Lock the slate ]
▸ How this works                ← the pitch argument, folded away
```

---

## What was wrong before this pass, so you do not put it back

Every page opened with a three-line paragraph explaining the game and closed
with a 300-to-740 character essay arguing why the game was good. Sleeper,
Underdog, DraftKings and ESPN never explain themselves on the screen. Their
contest header is a name, one line, and a row of chips carrying format and
payout, because a fan wants to know what it costs and what it pays, not the
reasoning. The essays are worth keeping for the room, so they are now inside
`<details class="how">`, closed. **Do not unfold them and do not restore prose
ledes.** If a page needs more than one line to explain, the page is wrong.

Also removed and not to be restored: 300px illustrated banners on every page,
a mascot portrait in front of every title, and a thumbnail filmstrip for
navigation.

---

## The filter to apply, page by page

Judge each screen by the five things those apps do that this build does
unevenly:

1. **State before prose.** The first thing below the title is a number, a
   chip or a row, never a sentence.
2. **Density.** Six to ten facts per row in about 60px. The player rows manage
   this; check every other list against them.
3. **Colour encodes.** Position chip, live dot, win/loss, your-side-versus-his.
   Colour is never decoration.
4. **One primary action per screen**, in a bar, with the count next to it.
5. **Nothing is a wall of one component.** Summary, then list, then action.

### The thirteen

| Page | State after this pass | What to look at |
|---|---|---|
| **Locker room** | Dense list, LIVE badges, club mark per row | Does the list earn a whole screen, or should the six live games separate from the four that are not? |
| **Ultimate Leaf** | Citrus Carlton, six kit rows beside him | Answered: rows. See CARLTON-BRIEF.md. The page is a paper doll now, the figure is the picker, and the tiles are a single column of rows next to it. |
| **Beat Stormy** | header → both lineups → the pool → action bar → matchup (hidden until five are iced) | The two lineup cards are still the tallest thing above the fold. Can the matchup live in the same card as the lineups? |
| **Who Goes Off** | Six cards, two columns, action bar | Closest to right of anything here. Use it as the reference. |
| **Guess the Leaf** | Two columns: clue board / answer, with a round record | The seven clue tiles wrap 3-3-1. Should be a single column of seven rows. |
| **Heat Check** | Six over/under rows, action bar | The four-column row breaks to two rows under 720px. Check the break. |
| **Rank 'Em** | Four rows standing in the live order, each with a race bar | Done, and the density number was pointing at it for the wrong reason. See below. |
| **Pick'em** | Ten fixture rows | Long. Consider grouping by month. |
| **Beat the Buzzer** | Clock is the hero: 104px countdown, drain bar, live stat line | Rebuilt. Density .83 to .92. |
| **Immaculate Grid** | 3x3 board, search, all-time strip | The board is good. The all-time strip below it competes with it. |
| **Call It** | Pick three Leafs, drop three pins on the ice, closest wins | The map game. Picking a man on a phone scrolls the ice back into view; check that on a real device. |
| **Player pages** | Four sections behind a segmented control | Rebuilt. 2988px to 1424px, roster and player header pinned above the tabs. |
| **Leaderboard** | Four tabs, rows | Fine. |

Measured density (ink over panel height, higher is denser): home .96, call .94,
dash .94, fx .93, ult .92, stormy .92, hl .92, bz .92, grid .92, luck .90,
guess .89, lb .88, rank .87. Nothing has a vertical gap over 90px any more.

**A warning about that column, from working the page it named.** Rank 'Em sat
at .86 and was called the page to fix. The number was pointing at the right
page for the wrong reason, and reading it as "this page needs more facts"
would have made it worse. What was actually wrong:

1. `rkRow` called `prow` without `frac`, so the one component in this build
   that draws a bar drew none. On a 2,000px row that is roughly 1,100px of
   nothing between a man's name and his number. Every other list passes
   `frac`; this was the only page that did not, and it is the only page where
   `prow` runs at full width instead of inside a 500px sheet.
2. The page was giving away the answer. See the rule below.

Fixing both took it from 641px to 570px and from .86 to .87. Barely a move on
the metric, because the page was never short of ink; it was short of a bar and
it was broken. **Do not chase this column with chips and summary strips.** A
density number can tell you where to look and nothing else.

---

## Two structural jobs worth doing that I did not

Both of these are now done. What is left is smaller and listed in the table:
Rank 'Em is still a four-item list and nothing else, Guess the Leaf wraps its
seven clue tiles 3-3-1 where a single column of seven would read better, and
Pick'em is ten fixture rows that could group by month.

---

## Rules that hold

- One file, no network, opens at a rink with the wifi off. Every asset is
  base64 inlined. The build is 3.49 MB and 0.57 MB of dead art has already
  been cut; do not add weight without removing some.
- Real data only. Nothing simulated. Where the database does not cover
  something the interface says so out loud rather than filling it in.
- No em dashes anywhere in copy. They were all removed on purpose.
- Sticky bars with `bottom:` float over content until the reader scrolls past
  the anchor. That bug shipped twice here (the Ultimate Leaf summary, then the
  slate action bar on phones, where it covered row two). Action bars stay in
  flow.
- Class names collide in this file. Nine have already shipped and been fixed
  (`.tag`, `.mark`, `.foot`, `.h2h`, `.sk`, `.grow`, `.clside`, a `<header>`
  inside a panel inheriting the site header, and `.cp`, which was the header's
  Citrus-points chip and a Carlton kit piece at the same time, running the
  chip at 50% opacity on all thirteen pages). **Run `node classcheck.mjs`
  before you finish** and scope any new selector. It now walks the whole
  document rather than panel subtrees, because that is how `.cp` hid.
- Two horizontal strips scrolled with the scrollbar hidden and no other sign
  that they moved: the thirteen game tabs, and the fixture chips on Game 01.
  Eight of ten games and two of four chips were behind an invisible gesture.
  The tabs now carry an edge fade at whichever end still has something parked
  there, plus a chevron on pointer devices. The chip strip was cut to two
  chips and wraps. **If you add another sideways strip, give it an
  affordance.**
- A test that measures an empty page measures nothing. `mobsweep.mjs` passed a
  Game 01 that ran 117px past the right edge of a phone as soon as a slot was
  filled, because the live strip does not exist until somebody is in the slot.
  It fills the kit and runs the clock now. **Play the page, then measure.**
- **A live game must never show a fan something the buzzer has not decided.**
  Rank 'Em sorted its four rows by the final box score the instant the fan
  locked, numbered them 1 to 4, and did it with fifty minutes still to play.
  Lock at 5:00 of the first period and the game was over on screen. Proved
  against the feed: Nylander sat second on a live 0 while Matthews sat third
  on a live 1, an order only the final answer explains. The rows now stand in
  the LIVE order off the same events the fan can see, with their own call
  pinned to each row so they can watch it drift, and only the buzzer resolves
  it. `leak.mjs` locks all three slates a third of the way through and fails
  on anything matching the final answer early; Who Goes Off and Heat Check
  were checked and are clean.
- Points were not live anywhere, although the feed has always computed them.
  `CLOCK.live()` returns `p` as `g + a` off the shot events; `KIT_LIVE` simply
  did not list `p`, so a points line sat on "settles at the buzzer" for sixty
  minutes while the two numbers that make it moved on the page above it. One
  missing key, three games affected: Rank 'Em, Heat Check and Who Goes Off all
  take points as a category.

## Keep these green

```
python3 build.py
node realsite.mjs      # HTTP, 5 device profiles, must print ALL REAL-SITE CHECKS PASSED
node verify.mjs        # all 10 games played end to end, must print CONSOLE ERRORS: none
node audit_hub.mjs     # contrast; no fail= lines
SKIN=bc node audit_hub.mjs
node mobsweep.mjs      # no horizontal overflow at 390px
node offline.mjs       # external requests: NONE
node classcheck.mjs    # class-name collisions
node shots_all.mjs     # per-panel density and gap report
node proof.mjs         # 13 panels x 2 viewports: overflow, clipped text, and
                       # any sideways strip with no scroll affordance
node leak.mjs          # locks every live slate a third of the way through and
                       # fails on anything that shows the final answer early
```
