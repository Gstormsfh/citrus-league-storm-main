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
| 01 | Create the Ultimate Leaf | live, six kit slots |
| 02 | Beat Stormy | the box score at the buzzer |
| 03 | Who Goes Off | the box score at the buzzer |
| 04 | Guess the Leaf | five trivia rounds |
| 05 | Heat Check | the box score at the buzzer |
| 06 | Rank 'Em | the box score at the buzzer |
| 07 | Opening Night Pick'em | the 2026-27 season |
| 08 | Beat the Buzzer | sixty seconds |
| 09 | Immaculate Grid | nine guesses |
| 10 | Call It | goal coordinates, closest pin wins |

## Rebuild it

```
cd demo/src
python3 bake_art.py && python3 build.py
```

`bake_art.py` inlines anything in `art/` as base64; `build.py` joins
`index.html` and `app.js` into the single file. Art lives in
`apps/web/public/mascots/` and is copied into `demo/src/art/` before baking.

## Verify it

All of these have to stay green.

```
node realsite.mjs   # real HTTP, 5 device profiles
node mobplay.mjs    # every game played on a phone with real taps only
node verify.mjs     # every game played end to end
node audit_hub.mjs  # contrast, both skins (SKIN=bc for the second)
node mobsweep.mjs   # no horizontal overflow at 390px
node offline.mjs    # zero external requests
node classcheck.mjs # class-name collisions
node shots_all.mjs  # per-panel density
```

## Still outstanding

Three jobs, all documented and all needing a terminal with network:

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
