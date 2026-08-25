# Citrus Carlton: the paper doll on Game 01

**Read this before you generate anything.** The prompt that produced the
current figure is `CARLTON-PROMPT.txt`. This file is what happens to the
render after it lands, and what a replacement has to satisfy.

Game 01 is no longer six cards on a grid. It is a paper doll: the club's own
bear standing in the middle of the page in nothing but the sweater, and six
pieces of kit that arrive as you fill the slots. Every piece is hollow and
half-lit until a Leaf is behind it, then it fills in, and once the puck drops
it carries what that man has actually done tonight.

**It already works.** The rendered Carlton is in the build, cut into seven
layers, and every suite is green. A drawn vector Carlton is still in the file
as the fallback and still holds up at every width from 360 to 1440, so a
missing or broken layer costs the picture and nothing else.

---

## The thing to say out loud in the room

Carlton is MLSE's mascot and MLSE's trademark, down to the 60 he wears for 60
Carlton Street. This is a Citrus rendering of somebody else's character, shown
back to the people who own him. That is normal pitch practice, it is the right
instinct, and it is much better said than left for a screenshot to say.

The one thing that is ours rather than theirs is the crest: where the club's
own mark sits on his chest, this Carlton wears a citrus slice. That is the
whole joke, it takes one second to read, and it is the only place on the
figure where the orange is the subject rather than a state.

---

## Job 1: seven layers. Not a drawing job any more -- a cutting job.

The figure is a paper doll, so the art has to be a paper doll: **one canvas,
seven transparent layers that stack pixel for pixel.** The build turns each
kit layer on and off, dims it, and lights it.

This used to be a brief for a vector artist. It is not any more. The render
came back as one image of a dressed bear, and `carve.py` separates it:

```
python3 carve.py          # cuts art/carlton-figure.png into the seven
python3 bake_art.py       # inlines them
python3 build.py
```

```
art/carlton-base.webp     the bear, sweater, pants, head. Kit removed.
art/carlton-g.webp        the stick, butt to blade
art/carlton-a.webp        both gloves
art/carlton-sog.webp      the puck
art/carlton-hit.webp      both shoulder caps
art/carlton-blk.webp      both leg pads
art/carlton-tk.webp       both skates
```

`carve.py` writes the seven **and** writes their placement into `app.js`.
Do not hand-edit either. The crops are trimmed to their own alpha, so a
change to one mask rule moves the offsets by a pixel, and a number copied
across by hand goes stale silently -- the figure just quietly softens at
every seam.

### Why it is cut by material and not by rectangle

The first attempt put six rectangles over the flat render and dimmed those.
It is worth knowing why that failed, because it looks reasonable on paper
and it is obviously broken on screen: **a dim rectangle that crosses the
sweater draws a hard-edged block across the yoke and the jaw.** A region
only disappears where it covers transparent background, and four of the six
pieces are attached to the bear. So each piece has to be its own silhouette
or the ghost state is unusable.

`carve.py` finds each piece by the thing that is actually unique about it:

| piece | what makes it findable |
|---|---|
| stick | the only warm wood in the frame |
| puck  | its own island, and the only one |
| skates | below the pads there is nothing else |
| leg pads | the only light material between the pants and the boots |
| gloves | each one is its own silhouette until it reaches the legs |
| shoulder caps | the only light panel between the jaw and the sleeve |

Then it checks itself, and both checks have caught a real bug:

- **overlapping masks** -- a pixel in two pieces dims twice and reads as a
  bright patch.
- **stranded inside a piece** -- base that survives well inside a piece's
  outline. A cool bluish facet of the left leg pad failed a neutral-grey
  rule, stayed in the base, and sat at full brightness inside the ghost.
  Invisible in a mask preview, obvious on the page.

Seams are cut hard on the base and soft on the piece, overlapping by a
pixel. Feathering both sides leaves a hole at the seam -- the base gives
half, the ghost gives a quarter of a half, and the page shows through as a
dark navy outline around every piece.

**All seven or none.** The build only switches to the render when the base
and all six pieces are present. A photoreal bear wearing one drawn shin pad
is worse than the drawn vector, so the check is deliberate and it will not
be relaxed. `CARL_ART()` in `app.js` is where it lives.

### What a new figure has to satisfy

`carve.py` reads the render, so the pose constraints in `CARLTON-PROMPT.txt`
are load-bearing, not stylistic. If a new Carlton lands:

- every piece **fully visible and not overlapping another piece**, or two
  masks fight over the same pixels
- transparent background, no baked shadow -- the page draws the shadow
- the same square-on stance, or the mask windows in `carve.py` need moving
- run `carve.py` and read what it prints. `overlapping masks: none` and
  `stranded inside a piece: none` are the two lines that matter
- then `node figcheck.mjs`, which probes sixteen named points on the figure
  and five that must own nothing

Two adjacencies in the current render are unavoidable and both are
harmless: the shoulder caps meet the jaw, and the stick's butt sits against
the right glove. The caps take about ten units of fur with them, which is
fur beside fur; the butt gets a region of its own so it does not stay bright
while the shaft below it is dim.

---

## Job 2: the render itself. This one IS for Nano Banana.

A diffusion model will not give you seven registered transparent layers.
It does not have to any more -- it gives you one dressed bear and `carve.py`
does the registering, which is exact by construction because every layer
comes out of the same pixels.

**The prompt that produced the current figure is in `CARLTON-PROMPT.txt`,
not here.** What follows is the first prompt, kept because it is the clearest
statement of what went wrong: it optimised for the page (flat, one outline,
Toronto navy) when the mascot family is 3D low-poly renders with no outlines
at all. Carlton v1 came back a flat sticker and did not belong to the family.

**Prompt:**

> A friendly cartoon polar bear mascot standing square to camera in a full ice
> hockey kit, drawn as a flat vector sticker illustration. Thick uniform dark
> navy outline (#00102E) on every shape, completely flat fills, no gradients,
> no shading, no texture, no highlights.
>
> The bear's fur is pale ice blue (#C7DAF3) with a white muzzle and white
> inner detail; small round ears; large friendly black eyes; a round black
> nose and a simple curved smile. Chunky, rounded, toy-like proportions with a
> big head and short limbs.
>
> He wears a deep blue hockey sweater (#00286E) with a white shoulder yoke and
> two white stripes across the hem, plus dark navy hockey pants. His kit is
> pale ice blue with white straps and white skate blades: shoulder caps over
> the sweater, gloves, shin pads, skates. He holds a hockey stick in one hand
> with the blade on the ice.
>
> ON HIS CHEST, where a team crest would go: a citrus fruit cross-section, a
> bright orange slice (#FF6B1A) with white segment lines, on a white circle.
> This is the focal point of the illustration.
>
> Full body, standing straight, symmetrical, centred, on a plain deep navy
> background (#00205B). Tall portrait format, roughly 4:5.
>
> ABSOLUTELY NO TEXT, NO LETTERING, NO NUMBERS, NO LOGOS, NO WORDMARKS other
> than the orange citrus slice described above. No maple leaf. No photoreal
> rendering, no 3D, no plush texture, no fur detail.

Save as `art/carlton-key.png`. **It is reference, not a build asset.** The
baker does not read it and it is not wired to anything, on purpose.

### That prompt is superseded. Here is what it got wrong.

`art/carlton-key.png` came back clean against its own reject list -- no text,
no maple leaf, one hard navy outline, flat fills, the citrus slice as the
focal point. It was still the wrong picture, because the reject list was
checking the wrong thing.

Put the four Citrus mascots next to it and the gap is the whole story.
Stormy, Pineapple, Kiwi and Lemon are 3D renders: low-poly faceted surfaces,
soft matte shading, a key light up and to the left, gentle occlusion in the
creases. **Not one of them has an outline.** Their palette is muted and
earthy. Their kit is real -- tan wooden sticks, dark textured gloves, ribbed
pads, proper skates with blades. Carlton v1 was a flat sticker with a hard
navy keyline and a blank smile, and no amount of palette matching fixes that.

`CARLTON-PROMPT.txt` is the rewrite, and v2 is what it produced. Use it.

---

## What the build does with him, so you know what you are drawing for

| State | What happens on the figure |
|---|---|
| No slots filled | Bear in the sweater. All six pieces ghosted at 26%. |
| Hover a piece | Both halves of a pair light together. |
| Tap a piece | Opens that slot's picker. The list and the figure are the same control. |
| Slot filled | That piece goes to 100% and fills in. |
| Puck drops | A white pip appears on the piece with the live number on it. |
| The number moves | The pip's ring goes citrus. |
| Final buzzer | Every pip carries its final number. Caption reads "Dressed, and final." |

Six pieces map to six categories: **the stick** goals, **the hands** assists,
**the release** shots, **the shoulders** hits, **the shin pads** blocks, **the
skates** takeaways.

There is no seventh piece and there is no helmet. Six slots, six categories,
six pieces, and the count is load-bearing in three other places.

---

## Keep these green

```
python3 carve.py && python3 bake_art.py && python3 build.py
node realsite.mjs      # 5 device profiles, must print ALL REAL-SITE CHECKS PASSED
node verify.mjs        # every game end to end, must print CONSOLE ERRORS: none
node mobplay.mjs       # every game played on a phone by real taps
node audit_hub.mjs     # contrast, no fail= lines
SKIN=bc node audit_hub.mjs
node mobsweep.mjs      # no horizontal overflow at 390px, kit filled first
node offline.mjs       # external requests: NONE
node classcheck.mjs    # class-name collisions, nine have shipped already
node figcheck.mjs      # every piece owns its own region and nothing else does
node shots_all.mjs     # density and gap report
```
