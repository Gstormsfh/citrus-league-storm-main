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
- (SUPERSEDED 2026-08-09 — see ARCHITECT OBSERVED-STYLE ADDENDUM below; the set is low-poly 3D render, NOT hand-painted) character-forward compositions
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

**T12 (Entry 13) added 2026-08-09.** LeagueTimelineCard empty-state slot needs a bespoke composition — currently falls back to `mascot-stormy.webp` inline.

### scene-league-quiet — target page: LeagueDashboard.tsx (inline via LeagueTimelineCard)

- **Filename:** `scene-league-quiet.webp`
- **Dimensions:** 512x512px (empty-state slot renders at ~80x80 within a card, but generate 512² for retina + reuse)
- **Target page + component:** `apps/web/src/components/dashboard/LeagueTimelineCard.tsx` (empty-state branch, currently rendering `/mascots/mascot-stormy.webp` with `data-timeline-empty-slot="scene-league-quiet"` marker for the swap)
- **Nano-banana prompt (style-anchored, use MASTER PROMPT TEMPLATE):**
  ```
  Stylized low-poly 3D character render of Stormy the narwhal sitting quietly on
  a wooden hockey bench in a dimly lit rink, wooden hockey stick tusk resting
  across his lap, waiting patiently with a serene expression, soft faceted
  geometry with smooth shading, Pixar-warm personality, wearing sage-green
  hockey jersey with cream trim and an orange-slice crest, warm key light with
  glowing peach rim light, deep forest-green studio background with soft
  vignette and gentle ground shadow, big expressive green eyes, playful and
  confident but calm, square 1:1 aspect, no text, no watermark
  ```
- **Consistency notes:** Must visually rhyme with existing `mascot-stormy.webp`. Attach that file as REFERENCE IMAGE per addendum's identity-locking rule ("same character as reference, sitting quietly on a hockey bench"). Sub-line copy in card: "Quiet on the ice. New moments will appear here as the league gets going." — art should embody that calm-anticipation mood, not sadness or emptiness.

---

**U2 (Entry 25) added 2026-08-09.** Two candidate slots surfaced during the empty-states-to-moments deep sweep. Both permanent-surface preseason states that will render for every user of a new league — high visibility, worth bespoke art rather than reusing an existing scene.

### scene-standings-preseason — target page: Standings.tsx

- **Filename:** `scene-standings-preseason.webp`
- **Dimensions:** 512x512px (renders at ~96x96 inside a table-empty cell; generate 512² for retina + reuse potential)
- **Target page + component:** `apps/web/src/pages/Standings.tsx` empty-tbody branch (currently text-only via `sortedTeams.length === 0`). Slot lives in the `<td colSpan>` cell — add `<img src="/mascots/scene-standings-preseason.webp" className="w-24 h-24 mx-auto opacity-90" alt="" />` above the kicker copy when this asset lands.
- **Nano-banana prompt (style-anchored, use MASTER PROMPT TEMPLATE):**
  ```
  Stylized low-poly 3D character render of Kiwi standing at center-ice with a
  clipboard, looking down the empty leaderboard column with a patient, confident
  half-smile, wooden hockey stick planted next to skates, soft faceted geometry
  with smooth shading, Pixar-warm personality, wearing sage-green hockey jersey
  with cream trim and orange-slice crest and cream number 44, warm key light
  with glowing peach rim light, deep forest-green studio background with soft
  vignette and gentle ground shadow, big expressive eyes behind round glasses,
  playful and confident, square 1:1 aspect, no text, no watermark
  ```
- **Consistency notes:** Reference-image lock to `mascot-kiwi.webp` per addendum. Mood is confident-anticipation ("we're ready — puck hasn't dropped yet"), NOT sadness/emptiness. Clipboard suggests scorekeeper; the standings will populate.

### scene-roster-clean-slate — target page: Roster.tsx (Transaction History tab)

- **Filename:** `scene-roster-clean-slate.webp`
- **Dimensions:** 512x512px (renders at ~80x80 inside the dashed-border empty box)
- **Target page + component:** `apps/web/src/pages/Roster.tsx` `historyRows.length === 0` branch (currently uses lucide `ArrowUpRight` icon). Swap `<ArrowUpRight … />` for `<img src="/mascots/scene-roster-clean-slate.webp" className="w-20 h-20 mx-auto mb-3" alt="" />` when this asset lands.
- **Nano-banana prompt (style-anchored, use MASTER PROMPT TEMPLATE):**
  ```
  Stylized low-poly 3D character render of Lemon at a pristine equipment locker,
  neatly arranging a stack of fresh jerseys and a brand-new stick, morning
  light streaming in, calm confident expression looking at the viewer, soft
  faceted geometry with smooth shading, Pixar-warm personality, wearing sage-
  green hockey jersey with cream trim and orange-slice crest and cream number 9,
  warm key light with glowing peach rim light, deep forest-green studio
  background with soft vignette and gentle ground shadow, leaf-stem cap, big
  expressive eyes, playful and confident, square 1:1 aspect, no text, no
  watermark
  ```
- **Consistency notes:** Reference-image lock to `mascot-lemon.webp` per addendum. Mood is "fresh start" / "ready to work" — sage-green quiet, warm anticipation. Not a celebration; that comes in scene-cup. This is preseason readiness.

---

**Empty as of 2026-08-08 second-shift T10 audit — superseded by U2 above.** No OTHER pages on regular-season or offseason surfaces are missing art slots — the existing 16-asset set covers all remaining identified needs.

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

---

# ARCHITECT OBSERVED-STYLE ADDENDUM (2026-08-09 01:40Z — supersedes the text-derived style profile above)

I viewed the actual files (mascot-stormy, mascot-kiwi, scene-draft). The profile above is WRONG in two load-bearing ways: the set is NOT "warm hand-painted texture" — it is **stylized low-poly 3D character renders** (soft faceted geometry, smooth studio lighting); and the cast is not all fruit (Stormy is a NARWHAL whose tusk is a wooden hockey stick, orange-slice badge on the flank). Prompts derived from the old profile would generate off-style art. Use the corrected profile below for ALL generation.

## Corrected style profile (from direct observation)
- Medium: stylized LOW-POLY 3D render — visible soft facets on organic surfaces, clean smooth shading, no painterly brushwork, no outlines.
- Lighting: single warm key + strong glowing peach/cream RIM LIGHT tracing each character's silhouette; soft ground shadow beneath.
- Background: deep forest green (#0F1F15 family) studio void with gentle radial vignette — characters float in warm darkness. No environments unless the brief says scene.
- Wardrobe system: sage-green hockey jersey with cream trim, ORANGE-SLICE crest, cream jersey numbers (Kiwi=44, Lemon=9 — keep numbers consistent per character forever).
- Props: warm wood hockey sticks (tape wraps), dark gray skates. UI elements in scenes render as floating glassy cards with team abbreviations.
- Faces: big expressive eyes (green for Stormy), tiny confident smiles or game-face scowls; personality first — playful, confident, warm, never corporate.
- Character anchors: Kiwi = kiwi-slice face + round glasses + brown fuzzy limbs; Lemon = fiery commissioner energy, leaf-stem cap; Stormy = gray-blue narwhal, hockey-stick tusk, cream belly.

## MASTER PROMPT TEMPLATE (nano-banana)
"Stylized low-poly 3D character render of [CHARACTER + ACTION], soft faceted geometry with smooth shading, Pixar-warm personality, wearing sage-green hockey jersey with cream trim and an orange-slice crest [+ jersey number if established], warm key light with glowing peach rim light, deep forest-green studio background with soft vignette and gentle ground shadow, big expressive eyes, playful and confident, [ASPECT], no text, no watermark"

## CRITICAL WORKFLOW RULE — identity locking
For ANY brief featuring an EXISTING character (Kiwi, Lemon, Pineapple, Stormy): attach the character's existing .webp from apps/web/public/mascots/ as the REFERENCE IMAGE in nano-banana and prompt "same character as reference, [new action/pose/scene]". Never regenerate a known character from text alone — reference-image conditioning is what keeps the cast consistent. New characters: generate from the master template, then that first accepted render becomes the character's permanent reference.

Apply this addendum to every brief listed above; where a brief's embedded prompt conflicts with this profile, THIS profile wins.

---

## ARCHITECT PLACEMENT MAP + TONIGHT'S SESSION SCRIPT (D5, 2026-08-09 22:10Z)

**Charter (Garrett, from the field): "ensure we use the caricatures we created and ONLY them. Create new ones for pages customized."** This section is both the map of what exists and the ready-to-run script for tonight's nano-banana session. Identity-locking rule applies to EVERY generation below: attach the named reference .webp as a nano-banana reference image; the prompt describes the scene, the reference carries the character.

### A. Existing placements (shipped 16 — verified by repo grep, all in use)

| Asset | Placed on | Verdict |
|---|---|---|
| scene-draft | Homepage, Features | ✓ correct |
| scene-cup | Homepage, Features, DraftRoomV2 + CompletionMomentBanner (guard area — placed, leave), NHLPlayoffBracket | ✓ correct |
| scene-squad | Homepage, About, Features, Pricing | ✓ |
| scene-livescoring / scene-xg-model / scene-stormy-ai | Homepage (+Features/Pricing) | ✓ marketing set |
| scene-pickem / scene-survivor / scene-confidence | Homepage, Features + their pool page | ✓ one scene per pool — good pattern |
| scene-standings | Standings | ✓ |
| scene-stormy-welcome | MascotScene component | ✓ |
| mascot-stormy | StormyLoading (now on 6 routes post M-2), avatars | ✓ the workhorse |
| mascot-kiwi / mascot-lemon / mascot-pineapple | MascotAvatar system | ✓ |
| **mascot-kiwi-faab.jpg** | WaiverWire.tsx | ⚠ ONLY .jpg in the set, "faab" legacy name — VERIFY it matches the low-poly style; if it's pre-low-poly era, regenerate as `scene-waiver-kiwi.webp` (brief below as OPTIONAL #7) |

### B. Gap table (pages with zero art, by twelve/beta impact)

Auth/signup (THE TWELVE'S ENTRY PATH — highest), NotFound/404 (delight + shareable), GMOffice (Pineapple is the only mascot without a starring scene), Matchup bye/preseason state, LeagueDashboard timeline empty (covered by queued scene-league-quiet), Roster history (queued scene-roster-clean-slate), Standings preseason (queued scene-standings-preseason). Deliberately NO art: FreeAgents (dense tables — copy carries the empty state, art would fight density), News (copy carries), Admin (utility).

### C. New briefs (4) — all use MASTER PROMPT TEMPLATE + reference-image lock

### 1. scene-auth-welcome — target: Auth.tsx (THE TWELVE'S FRONT DOOR)

- **Filename:** `scene-auth-welcome.webp` · 1024x1024 (hero slot, retina)
- **Reference images:** mascot-stormy.webp + mascot-kiwi.webp + mascot-lemon.webp + mascot-pineapple.webp (all four — group shot)
- **Prompt:**
  ```
  Stylized low-poly 3D group scene: four fruit-and-narwhal hockey mascots standing
  together at the open door of a warm arena tunnel, waving the viewer in, ice
  glowing beyond the tunnel mouth, soft faceted geometry with smooth shading,
  Pixar-warm personality, all wearing sage-green hockey jerseys with cream trim
  and orange-slice crest, warm key light with glowing peach rim light, deep
  forest-green studio background with soft vignette and gentle ground shadow,
  big expressive eyes, playful and confident, square 1:1 aspect, no text, no watermark
  ```
- **Mood note:** "your league is waiting for you" — invitation, not sales. This is the first pixel twelve real humans see on Aug 20.
- **Integration:** Auth.tsx hero panel (desktop side panel / mobile top). Terminal wires post-landing.

### 2. mascot-stormy-404 — target: NotFound.tsx

- **Filename:** `mascot-stormy-404.webp` · 512x512
- **Reference image:** mascot-stormy.webp
- **Prompt:**
  ```
  Stylized low-poly 3D character render of a gray-blue narwhal hockey mascot
  peering into an empty hockey net with a puzzled tilt, wooden hockey-stick tusk,
  holding a folded rink map upside down, soft faceted geometry with smooth
  shading, Pixar-warm personality, sage-green hockey jersey with cream trim and
  orange-slice crest, warm key light with glowing peach rim light, deep
  forest-green studio background with soft vignette and gentle ground shadow,
  big expressive eyes, playful and confused, square 1:1 aspect, no text, no watermark
  ```
- **Mood note:** lost but charming — the 404 people screenshot. Copy pairs: "✦ Offsides / This page skated out of bounds."
- **Integration:** NotFound.tsx center slot.

### 3. scene-gm-office — target: GMOffice.tsx (Pineapple's star turn)

- **Filename:** `scene-gm-office.webp` · 512x512
- **Reference image:** mascot-pineapple.webp (number per reference — do not invent)
- **Prompt:**
  ```
  Stylized low-poly 3D character render of a pineapple hockey mascot seated at a
  general manager's desk reviewing a lineup card, tiny reading glasses, stack of
  contracts and a vintage rotary phone, team whiteboard with magnetic pucks behind,
  soft faceted geometry with smooth shading, Pixar-warm personality, sage-green
  hockey jersey with cream trim and orange-slice crest, warm key light with glowing
  peach rim light, deep forest-green studio background with soft vignette and gentle
  ground shadow, big expressive eyes, shrewd and warm, square 1:1 aspect, no text, no watermark
  ```
- **Mood note:** the deal-maker. GMOffice header slot; also future trade-flow art.

### 4. scene-matchup-preseason — target: Matchup.tsx (bye-week / no-matchup state)

- **Filename:** `scene-matchup-preseason.webp` · 512x512
- **Reference images:** mascot-kiwi.webp + mascot-lemon.webp
- **Prompt:**
  ```
  Stylized low-poly 3D scene: kiwi and lemon hockey mascots crouched at center-ice
  faceoff circle waiting for a puck drop that hasn't come yet, sticks ready, friendly
  rivalry grins, empty stands softly lit behind, soft faceted geometry with smooth
  shading, Pixar-warm personality, both wearing sage-green hockey jerseys with cream
  trim and orange-slice crest, cream numbers 44 and 9, warm key light with glowing
  peach rim light, deep forest-green studio background with soft vignette and gentle
  ground shadow, big expressive eyes, playful and confident, square 1:1 aspect, no text, no watermark
  ```
- **Mood note:** anticipation — "the matchup is coming." Bye-week + preseason empty slot.

### D. TONIGHT'S SESSION SCRIPT (order = impact; ~10 min total)

1. scene-auth-welcome (4 refs) — the twelve's front door
2. mascot-stormy-404 (1 ref) — the shareable one
3. scene-standings-preseason (ref: mascot-kiwi) — brief above, U2 section
4. scene-roster-clean-slate (ref: mascot-lemon) — brief above, U2 section
5. scene-gm-office (ref: mascot-pineapple) — Pineapple's star turn
6. scene-matchup-preseason (refs: kiwi+lemon)
7. OPTIONAL scene-league-quiet (ref per its brief, night addendum) + verify mascot-kiwi-faab.jpg style-conformance (regenerate as scene-waiver-kiwi.webp only if it's pre-low-poly era)

Save each output to `apps/web/public/mascots/<filename>` — the terminal wires integration slots after files land (all slots specified above; Auth wiring is a normal surface, no guard).
