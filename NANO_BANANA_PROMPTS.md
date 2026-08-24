# Nano Banana Prompt Sheet — Citrus Art Pass

Run these in your Nano Banana / Gemini image setup. Drop outputs into `apps/web/public/art/` with the exact filenames given, tell me, and I wire each into the app the same day. Every prompt locks to the existing brand: deep forest greens, citrus orange, cream, and the chunky 3D mascot style you already use (Stormy the narwhal, Lemon, the pineapple goalie).

**Global style suffix — append to EVERY prompt:**
> …in the style of a playful 3D-rendered sports mascot illustration, chunky rounded forms, soft studio lighting, deep forest green background (#0F1F15), citrus orange (#FF6B1A) and cream (#FFF8F0) accents, subtle rim light, no text, no watermark, centered composition.

**Global negative:** photorealistic humans, real NHL logos or jerseys, text, letters, watermarks, harsh shadows.

---

## Batch 1 — Empty states (highest impact; the gray boxes are the flattest thing in the app)

1. `empty-slot-skater.png` — 512×512, transparent background if supported, else #0F1F15:
   "A tiny cute 3D orange slice character wearing a hockey helmet, sitting on an empty hockey bench, looking hopeful, minimal props"
2. `empty-slot-goalie.png` — 512×512:
   "A small 3D lime character wearing oversized goalie pads standing in an empty hockey net, slightly lost, endearing"
3. `empty-bench.png` — 800×450:
   "A long empty locker-room bench with one tiny 3D citrus character holding a clipboard, waiting, moody green ambience"
4. `empty-queue.png` — 512×512:
   "A neat stack of hockey pucks with a small 3D star fruit character sitting on top holding a wishlist scroll"
5. `empty-activity.png` — 512×512:
   "A sleeping 3D grapefruit character in a referee shirt, whistle resting on chest, zzz made of tiny citrus slices"

## Batch 2 — Player-card hero texture (the Sleeper-card feel)

6. `card-hero-skater.png` — 1200×400, must keep left third clear for the headshot:
   "Abstract arena backdrop: blurred rink glass and crowd bokeh in deep forest green with warm orange arena lights, cinematic depth"
7. `card-hero-goalie.png` — 1200×400 same rules:
   "Abstract hockey net and blue-paint crease viewed from ice level, dark green ambience, single warm spotlight from above"

## Batch 3 — Milestone moments

8. `draft-complete.png` — 1000×600:
   "A team of five different 3D citrus-fruit characters raising hockey sticks in celebration under falling confetti"
9. `week-won.png` — 800×600:
   "A proud 3D orange character holding a tiny golden trophy over its head on a podium, spotlight beam"
10. `trade-accepted.png` — 800×600:
    "Two 3D citrus characters shaking hands across a table with a contract scroll and a puck resting on it"
11. `waiver-won.png` — 800×600:
    "A 3D lemon character catching a falling star in a hockey glove, delighted"

## Batch 4 — Season-gated (generate now, ship at season start)

12. `game-live.png` — 512×512: "A tiny 3D citrus character glued to an old TV showing a glowing green scoreboard"
13. `playoffs-incoming.png` — 1200×500: "A dramatic frozen mountain path leading to a glowing arena, citrus-colored banners, epic but cute"

**Specs recap:** PNG, sRGB, the exact filenames above (lowercase, hyphens). If a generation nails style but is off-brand on color, regenerate with "deep forest green #0F1F15 dominant, citrus orange #FF6B1A accents only". Cohesion tip: generate Batch 1 in ONE session/thread so the character style stays consistent, using your best existing mascot render as the style reference image if your setup supports it.
