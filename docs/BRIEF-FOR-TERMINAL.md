# Toronto Game Day — take it over

Paste this whole file into the terminal session. It has Nano Banana and the
skills; this brief has the context it is missing.

---

## The job

Citrus Fantasy Sports is pitching **MLSE on Friday**. `Toronto_GameDay_Citrus.html`
is a single-file demo of nine fantasy/trivia games running on real Leafs data.
It works. Nine games play end to end, zero console errors, zero network
requests, contrast clean. **The engineering is fine. It looks like AI slop and
the founder has said so eleven times.**

You have an image model and an iteration loop. The previous session did not.
That is the whole reason this is being handed to you.

**You have permission to throw out the visual design entirely.** Do not
preserve it out of politeness. The games, the data, the copy and the
verification harness are worth keeping. The look is not.

## Where everything is

```
demo/Toronto_GameDay_Citrus.html     the built demo — open it, click through it
demo/                                 index.html + app.js are the source; build.py joins them
apps/web/public/mascots/              every render delivered so far
docs/NANO-BANANA-*.txt                the three prompt packs already run
```

`bake_art.py` inlines anything in `art/` into the build as base64, so the file
stays offline-proof. Keys already wired and waiting: `hero_*` (ten single
composites), `crest`, `eq_*`, `band_*`, `badge_*`, `tex_*`, `state_*`.
Drop files in, run `python3 bake_art.py && python3 build.py`.

## What is already rendered

Six kit props, ten wide arena plates, five medals, three textures, three empty
states, four characters in navy Toronto sweaters plus eight win/loss poses,
and all twelve of those knocked out to transparent cut-outs. **The asset
library is not the bottleneck.**

## What the last session got wrong — do not repeat these

Read this list before you design anything. Every item is a real mistake that
shipped and had to be pulled back out.

1. **Mascot-led direction.** Cartoon fruit characters as the primary visual
   identity, chosen early, defended too long. Held next to Sleeper it reads as
   a children's app. The characters are genuinely good art — the mistake was
   making them the product's face instead of its garnish.
2. **Two typefaces.** A rounded cartoon display face (Lilita One) over a
   grotesk. Sleeper uses one family and gets hierarchy from weight, size and
   colour. That single decision was most of the "kids' app" read.
3. **All-caps letterspaced micro-labels.** Nine on one screen: PUCK DROP,
   OPPONENT, SLOTS FILLED, CEILING TONIGHT, SCORE, WORTH NOW, CATEGORY, CLOCK,
   PAYOUT LADDER. Sleeper writes "98% Rostered" in sentence case, muted, normal
   weight. Tracked-out caps everywhere is a machine-design tell.
4. **Full-chroma colour blocks as card bodies.** Eight tiles in candy yellow,
   teal, orange and lime. Colour belongs in a 40px chip or a 5px bar.
5. **Over-correcting to grey.** The fix attempt went to near-black with an
   orange accent — which is every dark SaaS dashboard and has nothing Toronto
   about it. **Toronto is deep blue #00205B, white, and the leaf.** The blue
   should be the ground, not a tint.
6. **Two-layer compositing.** An arena plate plus a knocked-out character,
   generated separately, never lit together. No CSS shadow fixes two images
   that do not share a light source, a camera height or a horizon. This is what
   the `hero_*` slots exist to replace.
7. **A thumbnail filmstrip for navigation.** Twelve tiny image tiles in a
   scrolling strip, clipped at the right edge. That is a bookmark bar.
8. **Pages that were a quarter content and three quarters empty navy.** Guess
   the Leaf had one clue tile, two buttons, an input, then 500px of void.

## The bar

Sleeper and Underdog. Open them. What they do that this does not:

- Every row carries six to ten facts in about 60px. Not three facts in 400px.
- One typeface. Hierarchy from weight, size, colour.
- Colour encodes meaning — position, matchup difficulty, injury status,
  trend direction. It is never decoration.
- Near-black or deep-brand ground, hairline borders, small radii.
- Identity is visual and instant: headshots, team marks, position chips.
- Social proof on every object: % rostered, % started, who added them.
- Time and opponent context always present: "Sun 11:00 AM @ PIT (6th)".

## What to actually do

**Work in a loop. This is the part the last session could not do.**

1. Open the built demo. Screenshot every page at 1440px and at 390px.
2. Pick the worst page. Redesign it in `index.html` / `app.js`.
3. Rebuild, screenshot, **look at it**, and be honest about whether it improved.
4. Only when the layout is right, generate art for it.
5. Repeat.

Do not generate a batch of images and hope. Generate one, put it in the page,
render, look, regenerate. The founder's complaint every single time has been
about the composite result on screen, never about an asset in isolation.

**For the ten hero bands**, `docs/NANO-BANANA-HEROES.txt` has the method:
reference the existing `-tor` render as the source image so the character stays
on-model, and demand one continuous render where he stands on the scene's
floor, lit by its lights, casting its shadow. The QA test is the only one that
matters: **cover the character with your thumb — does the floor where he stood
still make sense?** Clean unlit floor means it pasted him in and you have the
same problem in a new file.

**The crest.** The founder wants the actual Toronto Maple Leafs mark, and he is
pitching MLSE, so showing their mark back to them is normal pitch practice.
Do not draw it and do not generate it — a diffusion model smears crisp vector
marks and a hand-drawn approximation of a crest everyone in that room has known
since childhood is worse than none. Get the real asset as a file, save it as
`art/crest.png`, and `bake_art.py` puts it everywhere the placeholder leaf is.

**Use the design skill** to settle direction with the founder before building
it out. He has rejected roughly six of these now; a canvas he can push around
himself will converge faster than another round of you guessing.

## Constraints that still hold

- One file, no network. Every asset base64-inlined. It has to open at a rink
  with the wifi off.
- Real data only. Nothing simulated, nothing invented. If the database does not
  cover something, it does not ship — the grid deliberately has no birth-year
  squares because coverage is 1,045 of 2,179 players.
- Both skins currently pass contrast at 26 panels. Keep the audit green:
  `node audit_hub.mjs` and `SKIN=bc node audit_hub.mjs`.
- `node demo.mjs` must still print `BROKEN STEPS: none` when you are done.

## Known bugs still open

- Five baked assets are wired to nothing: `tex_ice`, `tex_board`, `tex_weave`,
  `state_locked`, `state_done`. Surface them or strip them.
- The roster data has duplicate jersey numbers — 22, 28, 36 and 53 each sit on
  two skaters. The sweater badge shows a leaf instead of a number partly
  because of this. Worth fixing at source.
- The demo has never been opened in a real browser on the founder's machine.
  Everything has been headless Chromium. Do that first.

---

**One sentence for the founder to add:** *"Redesign it. Don't preserve anything
you don't think is good."*
