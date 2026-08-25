# Toronto Game Day

A single-file, offline-proof demo of ten fantasy and trivia games running on
real Leafs data, built for the MLSE conversation. **Nothing here is wired into
`apps/web`.** It is deliberately self-contained so it can be opened at a rink
with the wifi off.

## Open it

```
demo/Toronto_GameDay_Citrus.html
```

Double-click it. No server, no build step, no network. Every asset is
base64-inlined and the offline harness asserts zero external requests.

## What it is

Six of the ten games settle against a real game: **Anaheim at Toronto,
12 March 2026**, Toronto down 1-3 in the second and winning 6-4. All 106 shot
events are rows out of `nhl_shots` with the shipped model's expected-goals
value attached. A score bug runs across every page and the games settle
against the official box score.

| # | Game | Settles on |
|---|---|---|
| 01 | Create the Ultimate Leaf | live, six pieces of kit on Carlton |
| 02 | Beat Stormy | the box score at the buzzer |
| 03 | Who Goes Off | the box score at the buzzer |
| 04 | Guess the Leaf | five trivia rounds |
| 05 | Heat Check | the box score at the buzzer |
| 06 | Rank 'Em | live standing, resolved at the buzzer |
| 07 | Opening Night Pick'em | the 2026-27 season |
| 08 | Beat the Buzzer | sixty seconds |
| 09 | Immaculate Grid | nine guesses |
| 10 | Call It | goal coordinates, closest pin wins |

## Game 01 is a paper doll now

Citrus Carlton stands in the middle of the page in nothing but the sweater,
and six pieces of kit arrive as you fill the slots. Tap a piece on him or a
row beside him, either opens that slot. Every piece is hollow and half-lit
until a Leaf is behind it, then it fills in, and once the puck drops it
carries a pip with what that man has actually done tonight.

Carlton is MLSE's mascot and MLSE's trademark, down to the 60 he wears for 60
Carlton Street. This is a Citrus rendering of somebody else's character shown
back to the people who own him, which is normal pitch practice and is worth
saying out loud in the room. The one thing that is ours is the crest: where
the club's mark sits on his chest, this Carlton wears a citrus slice.

The figure in the build is drawn in SVG. `docs/CARLTON-BRIEF.md` specifies the
upgrade: seven transparent layers on one canvas, all seven or none.

## Rebuild it

```
cd demo/src
python3 bake_art.py && python3 build.py
```

`bake_art.py` inlines the art as base64; `build.py` joins `index.html` and
`app.js` into the single file. **There is no copy step any more.** The baker
looks in `demo/src/art/`, then in `apps/web/public/mascots/`, and tries a
`-tor` suffix, which is how the renders are actually named.

It also refuses to shrink. A bake can only ever add: if a run would drop a key
that is already inlined it writes nothing and tells you where it looked. That
guard exists because without it, running this one command from the wrong
directory deleted 1.56 MB of inlined art from `app.js` in silence and printed
`0 of 41 keys baked` as though that were fine. Pass `--allow-shrink` when a
removal is genuinely what you mean.

## Verify it

All of these have to stay green.

```
node realsite.mjs   # real HTTP, 5 device profiles
node mobplay.mjs    # every game played on a phone with real taps only
node verify.mjs     # every game played end to end
node proof.mjs      # every panel, desktop and phone: overflow, clipped text,
                    # and any sideways strip with no scroll affordance
node leak.mjs       # locks every live slate a third of the way through the
                    # game and fails on anything that shows the final answer
node audit_hub.mjs  # contrast, both skins (SKIN=bc for the second)
node mobsweep.mjs   # no horizontal overflow at 390px, kit filled first
node offline.mjs    # zero external requests
node classcheck.mjs # class-name collisions, whole document
node shots_all.mjs  # per-panel density
```

## Still outstanding

Four jobs, all documented, all needing a terminal with network:

- **`docs/CARLTON-BRIEF.md`** seven transparent layers of Citrus Carlton on one
  canvas, plus one piece of key art. A vector job, not a render job; the file
  says which is which. The drawn Carlton ships until they land.
- **`docs/ALLTIME-LEAFS.md`** every Leaf since 1917 for the Immaculate Grid.
  Two API calls; the fetch script is at `demo/src/scripts/`. The build is
  already wired for it and says so on the grid page until the file lands.
- **`docs/TERMINAL-BRIEF-LIVE.md`** the real club crest as a file, and the 23
  NHL headshots whose URLs are already in the database. Both slots are wired.
- **`docs/PAGE-DESIGN-BRIEF.md`** the remaining page-design work, with the
  token system and the per-page state.

## Known limits, stated plainly

- It replays **one** game. Opening night needs a live feed adapter, which does
  not exist yet.
- The multi-fan room is same-machine only: BroadcastChannel, no server.
- The club crest is a drawn placeholder until the real asset is dropped in.
- Game 01 picks from the **sixteen skaters who dressed for this game** and
  shows each man's season rate per game, because the page settles against this
  game. The Citrus Projections 2.0 roster is built for 29 September against
  Montreal and the two overlap by ten men; a projection for a September game
  cannot be shown against a March one. The projection still headlines Pick'em
  and the player pages, where it belongs.
