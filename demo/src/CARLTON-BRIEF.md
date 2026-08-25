# Citrus Carlton: the paper doll on Game 01

**Read this before you generate anything. The first half of this file is a
vector job, not a render job, and a diffusion model cannot do it.**

Game 01 is no longer six cards on a grid. It is a paper doll: the club's own
bear standing in the middle of the page in nothing but the sweater, and six
pieces of kit that arrive as you fill the slots. Every piece is hollow and
half-lit until a Leaf is behind it, then it fills in, and once the puck drops
it carries what that man has actually done tonight.

**It already works.** There is a drawn vector Carlton in the build right now,
it holds up at every width from 360 to 1440, and every suite is green. Nothing
below is needed for the demo to run. This is the upgrade path, and it is worth
doing, but do not let it block anything.

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

## Job 1: seven layers. A vector job. Do not generate it.

The figure is a paper doll, so the art has to be a paper doll: **one canvas,
seven transparent PNGs that stack pixel for pixel.** The build turns each kit
layer on and off, dims it, and lights it. A single flat image of a dressed
bear cannot do any of that, which is why one flat image is not the ask.

```
art/carlton-base.png        the bear, sweater, pants, arms, head. NO kit.
art/carlton-stick.png       the stick only
art/carlton-gloves.png      both gloves only
art/carlton-puck.png        the puck only
art/carlton-shoulders.png   both shoulder caps only
art/carlton-shins.png       both shin pads only
art/carlton-skates.png      both skates only
```

**Canvas: 1140 x 1410, transparent, on all seven.** That is exactly three
times the vector's own 380 x 470 coordinate space, so if you build over the
vector as a template every piece lands where the build already expects it.
Export the SVG out of the running build and trace on top of it; that is
faster than measuring and it cannot drift.

`python3 bake_art.py && python3 build.py` and the figure swaps whole.

**All seven or none.** The baker will inline whatever is on disk, but the
build only switches to the render when every one of the seven is present. A
photoreal bear wearing six drawn shin pads is worse than the drawn bear, so
the check is deliberate and it will not be relaxed.

### Rules on the seven files

- **Flat vector, hard outline.** One `#00102E` outline, roughly 15px at this
  canvas size. No gradients, no texture, no soft shadow, no rim light. The
  ground shadow is drawn by the page; do not bake one in.
- **The kit layers carry no bear.** A shin pad layer is a shin pad and a lot
  of alpha. If the knee shows through in your file, the piece will look
  painted on when it is dim.
- **The kit is `#C7DAF3` with `#FFFFFF` straps, cuffs, blades and tape.**
  The build recolours nothing; it dims to 50% and brightens to 100%. So draw
  the LIT state and let the page do the rest.
- **The puck is `#00102E` with a `#FFFFFF` rim,** drawn face on as a disc,
  not in perspective. A number gets printed on it at runtime.
- **The base carries the sweater and the crest.** Sweater `#00286E`, white
  shoulder yoke and two white hem stripes, `#00102E` outline. Crest: a citrus
  slice, `#FF6B1A` with white pith, on a white roundel, centred on the chest.
- **60 on the sweater** if you can place it legibly. The vector dropped it
  because 17px of type across a 30px sleeve clipped to "6U". At this canvas
  size there is room. White, on the sleeve or the back of the shoulder.
- **No other text anywhere.** Every other label in this build is live HTML so
  it stays correct when the data changes.

### Palette, exactly

```
outline      #00102E
fur          #C7DAF3      muzzle and highlights #FFFFFF
inner ear    #8FB3E0
sweater      #00286E      yoke and stripes #FFFFFF
pants        #001B4D
kit          #C7DAF3      straps, cuffs, blades, tape #FFFFFF
puck         #00102E      rim #FFFFFF
crest        #FF6B1A      pith and roundel #FFFFFF
```

Nothing else. The page is Toronto blue and one orange, and the figure is the
largest object on it; a seventh colour on Carlton is a seventh colour on the
whole build.

---

## Job 2: one render. This one IS for Nano Banana.

A diffusion model will not give you seven registered transparent layers, and
asking it to is how a week disappears. What it is genuinely good for is **key
art**: one image of Citrus Carlton fully dressed, to hand to whoever draws the
seven layers, and to put on a title slide.

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

### The key art is in. Read this before you trace it.

`art/carlton-key.png` landed and it is good. It clears every item on the
reject list: no text, no numbers, no maple leaf, one hard navy outline, flat
fills, the citrus slice is the focal point, and the palette is navy, white and
the one orange.

**Do not trace it straight into the seven layers, because two of the six
pieces are not in it.** It shows the stick, the gloves, the shin pads and the
skates. It has no shoulder caps (the white on the shoulders is the sweater's
yoke, which belongs to the base layer) and no puck. Trace it for the
character, the proportions and the line weight, then add those two from the
vector in the build, which has all six.

Two smaller divergences, both fine to keep or drop, but decide on purpose
rather than by accident:

- it carries a **white keyline** around the whole silhouette. The build sits
  the figure directly on navy with no halo, so the vector has none. If you
  keep the halo, keep it on every layer or the kit will look cut out.
- the sweater blue reads brighter than `#00286E`. Against the page it is fine;
  match the token if you want the figure and the rest of the build to agree.

**Reject and regenerate if:** any text appears, the outline goes soft or
variable, it renders as 3D or plush, the crest is a maple leaf instead of a
citrus slice, or a colour outside the palette shows up.

---

## What the build does with him, so you know what you are drawing for

| State | What happens on the figure |
|---|---|
| No slots filled | Bear in the sweater. All six pieces at 50%, hollow. |
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
python3 bake_art.py && python3 build.py
node realsite.mjs      # 5 device profiles, must print ALL REAL-SITE CHECKS PASSED
node verify.mjs        # every game end to end, must print CONSOLE ERRORS: none
node mobplay.mjs       # every game played on a phone by real taps
node audit_hub.mjs     # contrast, no fail= lines
SKIN=bc node audit_hub.mjs
node mobsweep.mjs      # no horizontal overflow at 390px, kit filled first
node offline.mjs       # external requests: NONE
node classcheck.mjs    # class-name collisions, nine have shipped already
node shots_all.mjs     # density and gap report
```
