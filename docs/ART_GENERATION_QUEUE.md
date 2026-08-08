# ART_GENERATION_QUEUE

**Purpose.** Per Entry 5 ART SYSTEM RULES (2026-08-08): pages needing NEW customized art MUST have (a) a code slot at target dimensions with the existing filename convention, AND (b) a generation brief in this file. Garrett batch-generates via nano-banana; the code is pre-wired to receive.

**Style anchor.** Existing caricature set in `apps/web/public/mascots/`:

Mascots (5 characters):
- `mascot-kiwi.webp` — Kiwi character (base pose)
- `mascot-kiwi-faab.jpg` — Kiwi in FAAB-bidding pose (jpg, not webp — file-format outlier; docket for consistency)
- `mascot-lemon.webp` — Lemon character
- `mascot-pineapple.webp` — Pineapple character
- `mascot-stormy.webp` — Stormy (Assistant GM) character

Scenes (11 compositions):
- `scene-confidence.webp` — Pool Confidence Pool
- `scene-cup.webp` — Championship / trophy scene
- `scene-draft.webp` — Draft scene
- `scene-livescoring.webp` — Live scoring / matchup
- `scene-pickem.webp` — Pool Pickem
- `scene-squad.webp` — Squad / roster scene
- `scene-standings.webp` — Standings scene
- `scene-stormy-ai.webp` — Stormy AI (assistant chat)
- `scene-stormy-welcome.webp` — Stormy welcome / onboarding
- `scene-survivor.webp` — Pool Survivor
- `scene-xg-model.webp` — xG model / projections

**Style profile (derived from existing files):**
- Warm hand-painted texture, character-forward compositions
- Citrus-family fruit characters personified as hockey players/officials
- Palette: cream / peach / sage-green / orange (Citrus 2.0 tokens per `apps/web/src/components/citrus2/tokens.ts`)
- Dark forest backgrounds `#0F1F15` (matches C2.bg token) or warm cream backgrounds
- Personality: playful, confident, warm — not slick, not corporate
- Aspect ratios: scenes ~16:9 or ~4:3; mascots typically portrait 3:4 or 1:1

**Filename convention:**
- `mascot-<name>.webp` for character portraits
- `mascot-<name>-<action>.jpg|webp` for character in action (e.g., `mascot-kiwi-faab.jpg`)
- `scene-<theme>.webp` for multi-character compositions
- **All new art SHOULD be .webp** (mascot-kiwi-faab.jpg is a legacy outlier)

---

## Generation queue

**Empty as of 2026-08-08 second-shift T10 audit.** No pages on regular-season or offseason surfaces are missing art slots — the existing 16-asset set covers all identified needs.

If NEW art becomes needed (post-Garrett-review), add entries below in this format:

```
### <slot-name> — target page: <page.tsx>

- **Filename:** `<mascot-|scene->_<name>.webp`
- **Dimensions:** <width>x<height>px (e.g., 1024x1024)
- **Target page + component:** file:line where slot is code-wired
- **Nano-banana prompt (style-anchored):** <verbatim prompt matching the existing caricature style profile above>
- **Consistency notes:** which existing asset it should visually rhyme with
```

---

## Consistency audit notes (T10 companion)

Reviewed all regular-season + offseason pages for non-caricature imagery. Findings:

- **Non-caricature imagery FOUND ONLY in Preview* pages** (`PreviewAlmanac`, `PreviewMockups`, `PreviewPress`, `PreviewPulse`, `PreviewRedesign`, `PreviewSquad`, `PreviewStadium`, `PreviewSunlight`) — scratchpad territory, NOT on regular-season/offseason routes.
- **Regular-season + offseason production pages: ZERO non-caricature images detected** via grep of `mockups/`, `/loading-citrus`, `/placeholder.svg`, `/og-image` in `apps/web/src/pages/` + `apps/web/src/components/`.
- **`/loading-citrus.png` in `public/`** is a load screen (not a page image); appears to be citrus-branded but is a photo, not a caricature. Docket for possible replacement with a caricature-style loader.
- **`/og-image.png` in `public/`** — Open Graph social-share image. Not user-facing UI; leave as-is (marketing/SEO artifact).
- **`/placeholder.svg` in `public/`** — shadcn/vite scaffold artifact. Unused in production pages per grep. Leave as-is (dep).

**Consistency treatment for regular-season/offseason:** existing pages use the `MascotAvatar` / `MascotCard` / `MascotScene` / `MascotPeek` components from `apps/web/src/components/citrus2/` — those wrap the same `public/mascots/` files with consistent sizing/framing. **Uniform treatment already in place.** No consistency divergence detected.

**Non-caricature-image tracking (for follow-up):**
- `apps/web/public/loading-citrus.png` — load screen. Consider caricature-style replacement (docket).
- `apps/web/public/mockups/*.jpg` (11 files) — Preview* scratchpad usage. Consider removal if Preview* pages are retired.
