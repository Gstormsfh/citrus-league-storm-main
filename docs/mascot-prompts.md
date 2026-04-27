# Citrus Squad — Mascot Generation Reference

Source-of-truth prompts for generating new poses, expressions, or variants of the four Citrus mascots while keeping style consistent.

All prompts are tuned for **Nano Banana 2** (Gemini 3.1 Flash Image) at `2K` resolution, `1:1` aspect, `thinking: high`. Save outputs to `apps/web/public/mascots/` as JPEG quality 82, 900×900 max.

## Shared style DNA (use across all characters)

> "3D rendered mascot character in soft Pixar/DreamWorks animation style. Big expressive shiny black eyes. Soft studio three-point lighting, gentle drop shadow below. Background: solid pastel sage-cream gradient (#E8EED9 to #FFF8F0), not transparent. Style: high-end 3D character render, Pixar-grade, cute and approachable, NOT scary, NOT realistic. Square crop, character centered, lots of breathing room around the character. NO text, NO real hockey team marks."

## Stormy — Assistant GM (AI)

**Identity**
- Pastel sage-grey baby narwhal body with cream belly
- Big green/black eyes, friendly intelligent smile, pink rosy cheeks
- Long horn that's stylized as a wooden hockey stick blade with wood-grain texture
- Tiny pastel orange Citrus circle emblem on side fin
- Floats playfully in 3D space at 3/4 view

**Generation prompt template**
> "STORMY THE NARWHAL — friendly cute baby narwhal, pastel sage-grey body, cream belly, big shiny green/black eyes, soft smile, pink rosy cheeks. Long horn stylized as wooden hockey stick with wood-grain texture. Tiny pastel orange Citrus circle emblem on side fin. [POSE: e.g. 'floating in 3D space at 3/4 view, gesturing with one fin like she's making a point']. NO helmet, NO mask. Soft studio lighting, pastel sage-cream gradient background. Pixar-grade 3D character render."

**Pose ideas to generate**
- Idle/neutral (current primary asset)
- Thinking pose (one fin to chin) — for AI loading states
- Celebrating goal (both fins up) — for win states
- Pointing at clipboard — for "advice" sections

## Lemon — Center · #9

**Identity**
- Bright pastel yellow lemon body, small green leaf sprout on top
- Big shiny eyes, confident smile (one tooth visible)
- Tiny black hockey skates, small wooden stick
- Pastel sage-green jersey with #9 + tiny orange Citrus emblem
- Mid-stride forward skating pose

**Generation prompt template**
> "LEMON THE CENTER — anthropomorphic lemon, bright pastel yellow body, green leaf sprout on top, big shiny eyes, confident smile with one tooth. Tiny black hockey skates, holding small wooden hockey stick. Pastel sage-green jersey with white '9' on it and small pastel orange Citrus circle accent. [POSE: e.g. 'mid-stride skating pose at 3/4 view facing right, stick across body like he just received a pass']. Pastel sage-cream gradient background. Pixar-grade 3D character render."

**Pose ideas**
- Idle skating (current)
- Wrist-shot follow-through
- Goal celebration (stick raised, mouth open)
- Faceoff crouch

## Kiwi — Defenceman · #44

**Identity**
- Fuzzy brown kiwi fruit exterior, halved to reveal pastel green interior as the face
- Black seeds positioned as eye accents, friendly thoughtful smile
- Round reading glasses (the analyst signature)
- Tiny black skates, hockey stick angled defensively
- Pastel sage-green jersey with #44 + orange Citrus emblem

**Generation prompt template**
> "KIWI THE DEFENCEMAN — anthropomorphic kiwi fruit, fuzzy brown exterior with halved face revealing bright pastel green interior. Big shiny eyes (kiwi seeds as accents), small thoughtful smile. Round reading glasses on face. Tiny black hockey skates, hockey stick angled across body in defensive stance. Pastel sage-green jersey with white '44' and small pastel orange Citrus circle accent. [POSE: e.g. 'defensive stance at 3/4 view facing left, blocking shot pose']. Pastel sage-cream gradient background. Pixar-grade 3D character render."

**Pose ideas**
- Idle defensive stance (current)
- Shot block (skate slide)
- Pointing at clipboard with chart on it
- Adjusting glasses, smug smile

## Pineapple — Goaltender

**Identity**
- Tall pastel golden-yellow textured pineapple body
- Pastel sage-green leaf crown on top
- White goalie mask (often pushed up on forehead) with friendly fierce smile
- Chunky pastel sage-green goalie pads, white skates
- Wide goalie stick + large blocker glove
- Small orange Citrus emblem on chest pad

**Generation prompt template**
> "PINEAPPLE THE GOALTENDER — anthropomorphic pineapple, pastel golden-yellow textured body, pastel sage-green spiky leaf crown on top. Big shiny eyes, friendly fierce smile, white goalie mask pushed up on forehead. Chunky pastel sage-green goalie pads, white skates. Holding wide goalie stick (curved blade) + large blocker glove. Small pastel orange Citrus circle emblem on chest pad. [POSE: e.g. 'goalie stance facing camera, slightly hunched, ready for the shot']. Pastel sage-cream gradient background. Pixar-grade 3D character render."

**Pose ideas**
- Goalie stance facing camera (current)
- Glove save (catching puck mid-air)
- Stick save (paddle-down)
- Celebrating shutout (mask up, fist pump)

## Style guardrails

- **Always pastel-vibrant.** Never neon, never dark/saturated, never photoreal-realistic.
- **Always 3D Pixar-grade.** Never flat 2D illustration, never sketch.
- **No real team logos or NHL marks.** Citrus is unlicensed — keep all hockey gear generic.
- **Sage cream background.** All four characters must share the same backdrop so they read as a set when shown side-by-side.
- **Same scale.** Generate at 2K, downsample to 900×900. Characters should fill ~60% of the frame so they sit consistently in cards.
- **Hockey gear must be authentic.** Real skates, real sticks, real pads. The fruit/animal is the cute layer; the gear is the credibility layer.
