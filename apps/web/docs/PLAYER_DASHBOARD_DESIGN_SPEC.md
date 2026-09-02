# Player Dashboard — Design Spec

**Locked:** 2026-05-04 by Garrett
**Web Summit launch:** 2026-05-11
**Signature direction:** Spatial Hero (Concept 3)

This is the design contract for the Citrus public NHL Player Dashboards
product. Every component spec, layout decision, and visual treatment
referenced in Phase 4 implementation must trace back to this document.
If a build decision deviates, document the deviation in this file with
a dated note — don't drift silently.

Source materials behind this spec:
- Phase 0a data audit (`generated_imgs/` and Phase 0b design research)
- Phase A reading of `ui-ux-pro-max` skill bundle (canvas-design-system,
  design-system, ui-styling, brand, design CIP)
- Phase B reference synthesis (Stripe, Linear, Vercel, Tremor, Apple
  Health, Apple Fitness+, Whoop, GitHub, plus design-knowledge for
  Strava / JFresh / The Athletic / Spotify Wrapped)
- Phase C Nano Banana mockups: 3 final candidates rendered for review
- Garrett's lock decision: 2026-05-04

---

## 1. The selected signature: Spatial Hero

### What it is

The player profile is structured around a single non-negotiable visual
anchor: a full-bleed offensive-zone hockey rink, rendered in pure
outline form (no decoration, no center-red-line cliché), with the
player's shot density encoded as color-graded dots. The player's
identity (name, jersey, eyebrow meta) is composed AT the rink — not
above it, not in a card next to it. The rink IS the hero.

The supporting layers downstream of the hero pull from the existing
Citrus 2.0 vocabulary (Modern Tech precision in the data zone,
Geometric Silence in the chrome) but the rink composition is what the
product will be screenshotted for.

### Why this direction

Three reasons drove the lock:

1. **Differentiation.** Every other hockey analytics product treats
   the rink as a tab or an afterthought. JFresh leads with flat
   percentile bars, HockeyViz leads with shot heatmaps but congests
   them with multiple modes stacked, EvolvingHockey leads with GAR
   tables, The Athletic leads with prose. Citrus leads with a clean
   spatial story showing WHERE a player generates value. Nothing in
   hockey looks like this when executed well.

2. **Hockey-native signal.** A flat percentile bar tells you a player
   ranks in the 91st percentile for offense. The Spatial Hero tells
   you that 73% of his offense comes from the high slot at a 1-in-4
   conversion rate. Same player, much higher information density,
   and the fan brain processes the spatial story instantly because
   it matches how hockey is actually watched.

3. **Subtle reference integration done right.** The rink is a hockey
   element used as functional canvas, not as a literal cliché. No
   pucks as bullets, no ice cracks as dividers, no sticks framing.
   The single hockey element earns its keep by being the data
   substrate itself — that's the "jazz musician quoting another
   song" pattern from canvas-design-system: sophisticated, never
   literal.

### What this signature is NOT

- NOT the rink rendered with red center line + decorative blue lines
  in their literal NHL-style colors (that's a clip-art rink, not a
  data canvas)
- NOT the rink with multiple shot modes stacked simultaneously
  (HockeyViz's anti-pattern; modes switch via segmented control)
- NOT a half-rink + a heatmap card next to it (the rink fills the
  hero — no companion card)
- NOT a 3D or perspective-rendered rink (top-down outline only)

---

## 2. Zone-mapped application

The product is a single page with four declared zones. Every
component lives in exactly one zone, and that zone declares which
design movement governs its treatment.

### 2.1 HERO ZONE — Spatial composition

**Movement:** Concrete Poetry (monumental scale, sculptural typography,
brutalist spatial divisions, jersey numbers as architectural elements,
ONE glowing element per screen).

**Composition:**
- Full-bleed rink as the visual anchor (~900px tall on desktop, ratio
  preserved on mobile via landscape rotation or vertical-rink variant)
- Rink rendered in outline form only — thin clean lines, no
  decoration. Outline opacity ~30% white over `pastel-surface`.
- Shot density encoded as 60–80 small dots arranged in realistic
  pattern (heavy slot concentration, fewer at points and boards).
  Color encoding: surgical orange (high xG) → butter (medium) →
  sage (low). Larger dots = more attempts at that location.
- ONE orange dot in the densest zone has a subtle radial pulse —
  the "hottest spot" — and is the only animated element on the
  hero (respects `prefers-reduced-motion`).
- BOTTOM-LEFT corner: jersey number watermark in Inter Black at
  280px font-size, 8% white opacity, layered behind the player
  identity. The watermark is the "97" (or any jersey #) and is the
  ONE major hockey reference in the typography.
- ON TOP of the watermark: caps eyebrow `C · ROYAL BLUES · 28YR` in
  JetBrains Mono 11px (12px on mobile per iteration note 8.2),
  letter-spacing 0.22em, text white/45.
- Below the eyebrow: player name in Inter Black 88px, two stacked
  lines, tracking -0.04em, color pastel-cream `#FFF8F0`.
- TOP-RIGHT corner of the rink: floating Stormy verdict tile, surface
  `pastel-surface-tile` with hairline ring 1px white/10, ~320×140 size.
  Italic verdict in Inter 16px pastel-orange-soft `#FF9F66`.
- BOTTOM-RIGHT corner of the rink: segmented control showing
  `5V5 / PP / xG / G−xG`, JetBrains Mono caps 10px, the active
  option highlighted with the SINGLE ambient orange glow (the only
  glow on the page).

**Rules:**
- Exactly ONE ambient glow on the entire page. Lives behind the
  active segmented control option.
- Exactly ONE pulsing element. Lives on the hottest shot dot.
- Player name is the ONE impact-typography moment. Inter Black at
  display scale; nothing else in the hero competes.
- Jersey watermark is the ONE allowed hockey-typography element.

### 2.2 DATA ZONE — Asymmetric Bento

**Movement:** Modern Tech precision (tabular numerics in JetBrains
Mono, hairline 1px white/10 dividers, no decoration, surface tints
for hierarchy, asymmetric tile sizes — NOT 3-column uniform grid).

**Composition (1392 wide, ~700px tall, 24px page padding):**

- WIDE TOP TILE (1392×180): SparklineMicroChart. Caption "LAST 30
  DAYS · xG/60" in JBMono caps eyebrow. Sage line with confidence
  band fill at 12% opacity. ONE surgical orange dot at the
  most-recent value. NO axis labels (no 0/25/50/75/100 axis text).
  Right-side label "3.42" in JBMono bold tabular-nums.

- LEFT MIDDLE TILE (480×520): Shot Breakdown by zone. 5 horizontal
  bullet rows: SLOT / LOW SLOT / HIGH SLOT / POINT / BOARDS. Each
  row uses the new bullet treatment from Concept 3 — caps eyebrow
  LEFT (10px JBMono), thin meter middle, tabular value RIGHT
  (Inter Black 24px). Hairline 1px white/10 dividers between rows.
  These are intentionally micro and component-scale, never the hero.

- MIDDLE TILE (480×520): PercentileRingCluster at 200px diameter
  composition. Three nested concentric rings — sage 84% (offense),
  butter 62% (defense), surgical orange 91% (special teams).
  Caption "OFF · DEF · ST GAR PERCENTILES" in JBMono caps below.
  Rings appear here at COMPONENT scale only — they are NOT the hero.
  No ambient glow on these (the page-wide glow lives on the active
  segmented control in the hero).

- RIGHT TILE (360×520): VerdictTile. Italic editorial paragraph in
  Inter 16px pastel-orange-soft, dropcap "T" effect on first letter
  (Inter Black 48px treatment). Long-form Stormy verdict, 3-4 lines.
  Below paragraph: tiny caps "STORMY · ASSISTANT GM" in JBMono 9px
  white/45 letter-spacing 0.22em.

**Rules:**
- ALL tiles share `bg-pastel-surface-tile` (#1A2A20). Hairline
  dividers only — NO visible borders.
- Surface stack discipline: page #0F1F15 / tile #1A2A20 / hover-up
  #243429 (used for interactive elements only).
- NO color-as-decoration. Surgical orange in this zone appears only
  on: the dot at most-recent sparkline point (encodes recency), the
  inner ring of the cluster (encodes highest percentile), the
  dropcap on the verdict (encodes editorial voice).

### 2.3 CHROME ZONE — Geometric Silence

**Movement:** Geometric Silence (intentional dramatic negative space,
no decoration, structure communicates not words, Swiss formalism +
Brutalist material honesty).

**Composition:**
- Sticky top nav (~64px tall): wordmark "CITRUS" in Inter Black 18px
  pastel-cream left-aligned (32px from edge). Thin search input
  centered with placeholder "Search 906 players" in JetBrains Mono
  12px white/45. 28px circular avatar right.
- Hairline 1px rgba(255,255,255,0.10) divider below the chrome.
- Bottom footer (~80px): minimal, hairline above, single centered
  caps line "CITRUS · DATA AS OF [date]" in JetBrains Mono 10px
  white/45.

**Rules:**
- Chrome stays out of the way. No drop shadows, no gradients, no
  decorative borders.
- Mobile: search bar collapses to icon-only; wordmark stays.

### 2.4 SHARE ZONE — Wrapped Chapters

**Movement:** Wrapped-style storytelling (one massive number per
chapter, screenshot-shareable per chapter, vertical scroll = chapter
advance).

**Composition (variable, one chapter at a time below the data zone):**

For Concept 3, the canonical first chapter is "POSITION VS LEAGUE":
- Hairline divider above with centered caps eyebrow "CHAPTER 1 ·
  POSITION VS LEAGUE" in JBMono 10px letter-spacing 0.22em.
- A KERNEL DENSITY DISTRIBUTION CURVE at full width — bell-shaped
  curve in sage at 20% opacity, with a vertical surgical orange line
  marking where the player sits (e.g., 99th percentile, far right
  tail). Caption below curve: "OFFENSIVE GAR · ALL CENTERS · 906
  PLAYERS" in JBMono caps.
- Right side of the chapter: massive callout — value `+4.21` in
  Inter Black 96px (per iteration note 8.3, bump from 48px) cream
  tabular-nums. Caption above the value: tiny eyebrow caps
  "DELTA VS POS MEDIAN".

**Rules:**
- Each chapter is one screen tall on mobile (full-bleed vertical
  scroll model).
- Each chapter is OG-image-ready — when shared, the OG image
  captures THAT chapter at 1200×630.
- Chapters are additive — Web Summit ships with one chapter
  ("Position vs League"). Future chapters: "Where He Shoots Live",
  "Career Arc" (post multi-season backfill), "vs Last Season",
  "Comparison" (post comparison drawer build).

---

## 3. Six signature techniques → zone mapping

The 6 signature techniques distilled in Phase B Reference Synthesis,
mapped to where each appears in the locked design:

| # | Signature | Source | Zone(s) used |
|---|---|---|---|
| 1 | The Concentric Stack (Apple Health × Whoop) | Ring composition for multi-axis decomposition | DATA zone, component scale (NOT hero) |
| 2 | Asymmetric Bento (Stripe × Linear) | Variable-size tiles, complexity drives container | DATA zone — primary layout system |
| 3 | Surface Tint Stacking (Tremor × Linear) | Hairline + tint layers for hierarchy, no borders | DATA + CHROME — used universally |
| 4 | Floating Real-time Overlay (Apple Fitness+ × Vercel) | Translucent overlay strip when player on ice | HERO zone — overlay variant when live |
| 5 | Wrapped-style Chapters (Spotify Wrapped) | One massive number per chapter, screenshot-shareable | SHARE zone — primary structure |
| 6 | Trend + Verdict Pair (GitHub × The Athletic) | Editorial verdict next to every analytic chart | DATA zone (VerdictTile), HERO zone (floating Stormy verdict) |

The Spatial Hero anchor itself is the seventh signature, owned
exclusively by Citrus and not yet in any reference: rink-as-canvas
for player identity composition.

---

## 4. Anti-pattern checklist (REJECT)

Every component PR must verify zero violations of these patterns:

1. **Flat horizontal percentile bars stacked vertically.** The
   JFresh trap. Bullet treatments must be vertical or use bullet
   meterstrips with median ticks; never stacks of full-width
   horizontal fills.
2. **3-column card grid as default layout.** Asymmetric bento is
   the data-zone law.
3. **Decorative chart axes** (full 0/25/50/75/100 labels under
   every chart). Charts get ONE midline hairline maximum, no
   numeric axis labels.
4. **Pill chips for everything.** Pills are reserved for
   meaningful state (LIVE, FINAL); never decorative.
5. **Centered card layouts.** Reads marketing-brochure. Asymmetric
   composition is required.
6. **Tab strips for player view navigation.** Use segmented
   controls (the 5V5/PP/xG/G−xG control in the hero is a
   segmented control, not a tab strip).
7. **Color-as-decoration without meaning.** Every color must encode
   meaning (orange = focal/highest/active, sage = defense/success,
   butter = neutral data, cream = primary text).
8. **Hero-number-with-caps-label-below.** When you NEED this
   pattern (rare), the number must be at monumental scale (96px+)
   so the eye reads number-first; otherwise label must go ABOVE.
9. **Skeleton loaders that mirror the final layout in gray.** Use
   shimmer that doesn't reveal layout.
10. **Hockey clichés.** Jersey numbers as architectural elements is
    the MAXIMUM literal hockey reference allowed. NO pucks as
    bullets, NO ice cracks as dividers, NO sticks framing, NO
    skate icons.

---

## 5. Component inventory (parameterized by Concept 3)

### Existing components

| Component | Status | Treatment under Spatial Hero |
|---|---|---|
| `PlayerMonogram` | Built (Day 1) | KEEP. Used in nav avatar, list rows, and small contexts. NOT the hero — the hero is rink composition. May add small amber accent if highlighted variant feels too quiet. |
| `PercentileBullet` | Built (Day 1) | KEEP, REFINE. Iterate to match Concept 3's bullet treatment in the Shot Breakdown tile (caps eyebrow LEFT, thin meter MIDDLE, tabular value RIGHT, hairline dividers between rows). Drop the median tick (Concept 3 doesn't use it). Drop the floor scale 0/25/50/75/100 (anti-pattern #3). |
| `StaleDataBadge` | Built (Day 1) | KEEP. No changes needed. Works across all zones. |

### New components (Concept-3 specific)

| Component | Purpose | Zone | Notes |
|---|---|---|---|
| `RinkHeatmap` | The hero. Full-bleed offensive-zone rink + shot density dots + segmented mode control + hottest-spot pulse. | HERO | Hand-built SVG. Highest-priority new build. Must support 5V5/PP/xG/G−xG modes via segmented control. Must respect prefers-reduced-motion (no pulse animation). Mobile: rotate to landscape OR collapse to vertical-rink variant. |
| `PercentileRingCluster` | Three nested concentric rings at component scale (200px) for OFF/DEF/ST GAR. | DATA | Adapts 21st.dev Vercel Gauge as ring primitive. Uses each gauge as one of three concentric rings. NO ambient glow (page-wide glow lives in hero only). |
| `SparklineMicroChart` | Minimal line chart with confidence band, NO axis labels, single accent dot at most-recent point, value-at-right pattern. | DATA + CHROME (potentially in player-card hover preview later) | Hand-built SVG. ~30 second build with d3-shape line generator + path animation. |
| `VerdictTile` | Italic editorial Stormy verdict, dropcap variant for long-form, plain variant for one-liners. | DATA + HERO | The "trend + verdict pair" signature. Long-form variant: dropcap T effect on first letter (Inter Black 48px), Inter 16px italic body, "STORMY · ASSISTANT GM" caps below. Floating variant for HERO: surface-tile + hairline ring, no dropcap. |
| `WrappedChapter` | Full-bleed chapter container. Variable inner content (KDE distribution for "Position vs League", future support for other chapter types). | SHARE | Each chapter is one screen tall on mobile. OG-image-ready. Includes hairline divider with chapter eyebrow at top. |
| `FloatingLiveStrip` | Translucent overlay (signature #4) for when player is on ice tonight — score, period, last shift, live stats. | HERO (overlay variant) | Floats above the rink hero when active. Hidden when not live. Single LivePulse on the live indicator. Shipped post-Web-Summit if data wiring isn't ready. |

---

## 6. 21st.dev components mapped to use

| 21st.dev component | Use here | Notes |
|---|---|---|
| **Vercel `Gauge`** (similarity 1.209) | `PercentileRingCluster` primitive base | Threshold-based color shifts, equal arc-priority, primary/secondary stroke control, animated transitions. Use 3 stacked instances at varying diameters for the concentric stack. |
| **`SegmentedProgress`** (Magic UI 20-segment dot row) | Consider for Shot Breakdown bullets if standard meterstrip feels too flat. | Hover falloff, spring scale, full ARIA. Optional polish, not required for v1. |
| **Magic UI `BorderBeam`** (animated rotating border accent) | Reserve for the SINGLE focal element on the page. In Concept 3 that's the active segmented-control option in the hero. NOT used elsewhere. | Cap to ONE instance per page. Strict discipline. |
| **Aceternity `TracingBeam`** (scroll-triggered SVG draw) | Reserve for chapter scroll dividers in the SHARE zone if/when we add multiple chapters. | Not needed for Web Summit launch (one chapter only). Defer. |
| **`ProfileCard` (avatar+tags variant)** | Pattern reference only — NOT used as primitive. | The eyebrow → name → verdict composition pattern informs the hero composition layout but we hand-build to integrate with the rink. |

### Components we hand-build (no 21st.dev coverage)

- `RinkHeatmap` (the hero — pure custom SVG)
- `SparklineMicroChart` (custom; could lean on Recharts but signature is so minimal that hand-built is faster)
- `VerdictTile` (pure layout + typography)
- `WrappedChapter` (pure layout)
- `FloatingLiveStrip` (post-Web-Summit; hand-built when data wiring lands)

---

## 7. Implementation order (Phase 4)

Build dependencies dictate the order. The rink is hardest; build it
first so we know what surfaces it sits against.

1. **`RinkHeatmap`** — the wow, the highest-risk build. Get the
   SVG rink right first. Mock data for shot dots until real
   `raw_shots` query lands.
2. **`PercentileRingCluster`** — using 21st.dev Gauge as primitive
   base. Adapt the threshold colors to sage/butter/orange. Verify
   stacked-concentric rendering works at component scale (200px).
3. **`SparklineMicroChart`** — minimal, fast build, useful
   immediately for the wide trend tile.
4. **`VerdictTile`** — pure layout + typography. Build the
   long-form (dropcap) and floating (no dropcap) variants together.
5. **`WrappedChapter`** — full-bleed container with chapter eyebrow
   + content slot. KDE distribution as the first chapter type.
6. **`PlayerHeroPage` composition** — the assembly. Wire to live
   Supabase queries (raw_shots, player_season_stats,
   player_talent_metrics, player_gar_components). OG image
   generation pipeline. SEO meta. Sitemap.
7. **Refine existing `PercentileBullet`** to match Concept 3's
   Shot Breakdown bullet treatment (drop median tick, drop floor
   scale, tighten anatomy).
8. **`FloatingLiveStrip`** — post-Web-Summit. Wire when live-game
   data path is verified end-to-end.

Each component lands with: empty state, loading state, low-sample
state where applicable, mobile responsive treatment, accessibility
audit (WCAG AA contrast, screen reader summary, keyboard navigation),
storybook-grade variants in `/preview-dashboard-primitives`.

---

## 8. Mockup asset paths (canonical references)

The Nano Banana renders from Phase C are now committed to the repo
under stable paths. Component builds in Phase 4 reference these by
filename, not by transient `generated_imgs/` IDs.

| File | Use |
|---|---|
| `apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg` | **THE LOCKED REFERENCE.** Every Phase 4 component must visually match the relevant section of this mockup. |
| `apps/web/docs/dashboard-mockups/concept-2-editorial-monument.jpg` | Rejected concept — kept for context only. Useful for "what NOT to do" reference (e.g., when chrome wordmark renders on cream surface — that's the rejected pattern). |
| `apps/web/docs/dashboard-mockups/concept-1-ring-hero.jpg` | Rejected concept — kept for context only. Rings as hero is the rejected treatment; rings only appear at COMPONENT scale in the locked design. |

When Phase 4 component builds need to verify "matches the mockup,"
they reference `concept-3-spatial-hero.jpg` exclusively.

---

## 9. ⚠️ META-RULE: Resource consultation is mandatory, not optional

**Day 1 failure pattern:** Built generic dark-mode components, claimed
to use ui-ux-pro-max but never opened the references, produced "AI
slop" per Garrett's review. We are NOT repeating this. Every Phase 4
component build executes the 4-step protocol below. Skipping
resources = generated, not designed. **Verify by output, not by
claim.**

### The 4-Step Protocol (every component, no exceptions)

#### STEP 1 — Resource consultation, surfaced BEFORE code

For each component X, surface three artifacts in the chat
**BEFORE writing any code**:

**(a) 21st.dev primitive base.** Run `mcp__21st-magic__21st_magic_component_inspiration`
with a query that targets the component. Output the actual returned
component code in the chat. If no 21st primitive matches, state
explicitly: "Hand-built — no 21st.dev primitive matched because
[reason]." Don't skip; either use a primitive or justify hand-building.

**(b) Design reference principle.** Open the specific reference file
that informs this component (one of: `canvas-design-system.md`,
`component-specs.md`, `states-and-variants.md`, `visual-identity.md`,
or `cip-style-guide.md` from the `ui-ux-pro-max` skill bundle at
`C:\Users\garre\.claude\plugins\cache\ui-ux-pro-max-skill\ui-ux-pro-max\2.5.0\.claude\skills\`).
Quote the specific principle (one sentence verbatim) that informs the
component's treatment.

**(c) Mockup section.** Reference the canonical Concept 3 mockup at
`apps/web/docs/dashboard-mockups/concept-3-spatial-hero.jpg`. Describe
which specific visual section of that mockup the component embodies.
If the mockup doesn't show the component clearly, generate a focused
Nano Banana mockup of just this component before writing code.

If any of (a), (b), (c) is skipped or surfaced as a vague claim
("uses ui-ux-pro-max" without a quote), the build is incomplete.

#### STEP 2 — Implementation against the mockup

Build the component matching the mockup section. Pixel-near, not
"inspired by." The mockup is the spec. When the implementation has
to deviate (e.g., a Nano Banana glow doesn't translate to CSS in
the same way), document the deviation inline as a comment in the
component file.

#### STEP 3 — Visual diff against the mockup

After implementing, render the component in isolation on the
preview page (`apps/web/src/pages/PreviewDashboardPrimitives.tsx`).
Take a screenshot. Place it side-by-side with the mockup section.
If they don't match closely, iterate before declaring done.

For Web Summit timeline pragmatism: if the visual diff differs in
ways that can be patched in <30 min, fix immediately. If the diff
is structural (e.g., the component fundamentally reads as a
different composition), STOP and surface to Garrett before
continuing — don't ship structural drift.

#### STEP 4 — Resource attestation, surfaced AT END

For each shipped component, append a one-line attestation in the
component file's header doc-comment AND in the chat:

```
ATTESTATION (per META-RULE protocol):
- 21st.dev primitive: [name] (or: hand-built — [reason])
- Design principle referenced: "[quote]" — from [file]
- Matched mockup section: [description] in concept-3-spatial-hero.jpg
```

If the attestation is missing or vague, the component is **not done
— it's generated**. Re-execute the protocol.

### Why this rule is non-negotiable

The whole reason Spatial Hero won is that we eventually opened the
design references and used Nano Banana / 21st.dev / canvas-design-system
the way they were meant to be used. That happened in Phase A-C.
Phase 4 must hold that bar component-by-component or we regress to
Day 1 output. The protocol exists to make discipline external, not
internal — surfaced in chat, attested in code, verified by the
output, not by Claude's claim.

---

## 10. Iteration notes from the Phase C mockup review

These are explicit fixes Garrett flagged during the Concept 3
selection. Apply during Phase 4 implementation; don't rebuild without
incorporating.

### 8.1 Strip "60px" margin annotation artifacts
The Nano Banana mockup rendered `60px` margin labels on the rink
corners. These were prompt artifacts (dimension specs that leaked
into the visible UI). The actual `RinkHeatmap` component must render
ZERO dimension annotations.

### 8.2 `C · ROYAL BLUES · 28YR` meta line bigger
On mobile the eyebrow line is too small to read at 11px. Bump to
12px on mobile, keep 11px on desktop. Letter-spacing stays 0.22em.

### 8.3 KDE chapter at the bottom needs more presence
The "POSITION VS LEAGUE" chapter feels under-weighted vs the rink
hero. Elevate via:
- Chapter title typography: bump "CHAPTER 1 · POSITION VS LEAGUE"
  eyebrow from 10px to 12px.
- Numerical callout: the `+4.21` value should be Inter Black 96px
  (was 48px in mockup). This is the chapter's monumental moment.
- Optional: add a second supporting metric below the +4.21 (e.g.,
  "Top 1% of all centers · 9 of 906" in JBMono caps) to give the
  chapter weight without changing typography.

---

## Acceptance gate before Phase 4 starts

Garrett reviews this document. If anything in zone allocation,
component inventory, implementation order, or iteration notes feels
off, edit before code begins. The build that follows is parameterized
by what's locked here.

After Garrett's review:
- Open Phase 4 implementation tasks (TaskCreate)
- Update KNOWN_GAPS with the design-spec-locked status
- Build order per Section 7

---

## Post-Web-Summit todos

Captured during Component 6 staging walkthrough on 2026-05-05.
Web Summit ships the locked 7-component scope; these are explicit
follow-ups for the next planning cycle.

### PWS-1: PlayerCard (condensed, embedded surface)

A compact glanceable player card component for embedded use
throughout the app — distinct from the full `PlayerProfile` page
in job-to-be-done:

| Surface | Job | Time-to-read | Where it lives |
|---|---|---|---|
| `PlayerProfile` (full page) | Standalone deep-dive, SEO-indexable, share-zone chapters | 5+ min | `/players/[slug]-[playerId]` |
| `PlayerCard` (condensed) | Glanceable in lists/tables/drawers, decision-support | 5-10 sec | embedded in PlayerPool, draft board, waiver wire, roster, comparison drawer |

**Specs:**
- ~280-320px wide × ~180-240px tall
- **Identity strip (top):** `PlayerMonogram size="sm"` + name + caps eyebrow `POS · TEAM · AGE` + jersey number
- **Metric stack:** 6-8 PercentileBullets in compact rows — `xG/60`,
  `Goals/60`, `Finishing` (G−xG), `A1/60`, `xGA/60` on-ice,
  `xGF%` on-ice, `PP1 xGF/60`, total GAR. Use `PercentileBullet
  size="sm"` (existing primitive — no new vocabulary)
- **Verdict line (bottom):** one-line Stormy verdict in italic
  pastel-orange-soft, abbreviated (~80-100 chars max). No dropcap,
  no signature in this surface
- **Click-through:** card is a link to `/players/[slug]-[playerId]`
- **Hover/tap reveal (optional v1.1):** expanded variant exposing
  12+ metrics + sparkline thumbnail without leaving the embedding context
- **Used in:** PlayerPool table modal, draft board cards, waiver
  wire list rows, roster grid, comparison drawer

**Reference baseline:** JFresh's static cards as the density target,
but with Citrus 2.0 design vocabulary (PercentileBullet primitives,
dark forest surfaces, JBMono numerics, hairline rings).

#### Implementation note — 2026-09-02 (shipped)

Built as `apps/web/src/components/player/PlayerAdvancedCard.tsx`, with the
numbers in `player/playerAdvancedMetrics.ts` and the cohort/percentile maths
in `utils/playerPercentiles.ts`. Wired into `components/PlayerStatsModal.tsx`
(the Detailed tab), which is the single player card Roster, Free Agents,
Matchup, Trade Analyzer, Other Team, Pool Playoff Roster, Team Intel Hub,
DraftRoom and DraftRoomV2 all open — ten call sites from one integration.
Data comes from the existing `/api/players/dashboard-index` via a new shared
once-per-session hook, `hooks/usePlayerDashboardIndex.ts`. Review surface:
`/harness/advanced.html`.

Five deviations from the spec above, each forced by something measured:

1. **The stated envelope cannot hold the stated content.** PWS-1 asks for
   ~180–240px tall AND 6–8 `PercentileBullet size="sm"` rows. A `sm` bullet
   measures ~27px plus an 8px gap, so eight rows are ~272px before the
   identity strip, the verdict or anything else. Measured in the harness at
   393×852: the card is **353 × 407px with four metric rows** (`compact`) and
   **353 × 587px with seven plus the projection** (`expanded`). The height
   number in this spec is the one that has to move; the content list is what
   makes the card worth having.
2. **Two variants, not one.** `compact` is the embedded card (four rows);
   `expanded` adds the rest of the GAR decomposition and the rest-of-season
   projection, for hosts with the height. The modal uses `expanded`.
3. **The eyebrow reads `POS · TEAM · #JERSEY`, not `POS · TEAM · AGE`.**
   There is no birth date on `DashboardIndexEntry` and `player_directory`
   is not joined for one. Jersey takes the slot rather than an invented age.
4. **The click-through is a labelled link, not the whole card.** PWS-1 says
   "card is a link to `/players/[slug]-[playerId]`". That route does not
   exist — `App.tsx` registers `/players`, and `Players.tsx` reads a
   `?player=` param — so the href is `/players?player=<id>`. And the card's
   biggest host is a modal that opens inside a LIVE DRAFT: making the whole
   surface a navigation target would let a manager tap a percentile bar and
   leave the draft room. One "Full dashboard →" link instead.
5. **No `SparklineMicroChart` and no `StaleDataBadge` on this card.** Both
   were in scope and both were cut for the same reason: the payload cannot
   support them honestly. The sparkline needs a series and the endpoint
   reads `getCurrentSeason()` only (`player_xg_season` holds 2017–2025 in
   the database — a real career arc, and the obvious next win); the badge
   needs an `asOf` and there is no timestamp on the payload, so it would
   render a permanent "Very outdated · Update timestamp unavailable" chip,
   which is itself a false claim. Both become available with a server
   change; neither was made on a UI branch.

Also noted as follow-up, not done here: **GSAx is missing from the goalie
card**. `goalie_gsax_primary` carries `raw_gsax` / `regressed_gsax` for 98
goalies in 2025 and it is the best goalie metric Citrus owns, but
`PlayerDashboardService` does not join that table. The goalie card therefore
runs on save rate, GAA, wins and shutouts. Adding the join makes a GSAx
bullet a ten-line change to `playerAdvancedMetrics.ts`.

### PWS-2: Profile-page consolidation — condensed card at top of full profile

Garrett's observation post-iter #2 walkthrough: the full
`PlayerProfile` composition feels long. Open question for the next
planning cycle:

**Option 1 (recommended):** When someone lands on
`/players/[slug]-[playerId]`, render the condensed `PlayerCard`
inline at the top of the full profile, then the deep-dive below
(hero rink + chapters + share zone). Gives shareable + scannable
in a single URL — strongest of both worlds.

**Option 2:** Keep `PlayerCard` and `PlayerProfile` as fully
separate surfaces. Don't double-up.

**Recommendation: Option 1.** The condensed card serves the
"what's the verdict in 5 seconds?" job that the deep-dive can't
serve quickly, even for users who landed via direct link. It
also doubles as a "skip to chapters" anchor and an OG-image-ready
glance summary. Decide formally during Phase 5 planning; for
Web Summit demo the current composition stays as-is.

#### Implementation note — 2026-09-02 (Component 6.5, shipped)

Option 1 built. `apps/web/src/pages/PlayerDashboard.tsx` renders
`PlayerAdvancedCard` (`variant="compact"`, `showLink={false}` — the link
points at this page) inline above the hero, capped at 380px and LEFT-anchored
rather than centred, because §4 #5 makes asymmetric composition the law and a
centred card reads as a brochure. The deep-dive follows: hero → career arc →
breakdown → Wrapped chapter.

The page is routed at `/players/:playerId` **outside** `App.tsx`'s
`import.meta.env.DEV` gate, which is the whole point of the component: the
composition existed at `/preview-player-profile` inside that gate, the gate is
statically false in a production build, and Rollup dropped the route and its
chunk. Nobody had ever seen this screen. `PreviewPlayerProfile.tsx` is deleted
— its `MOCK_*` constants and `jitter()` helper with it.

Deliberately NOT behind `ProtectedRoute`, unlike `/players`: this is the
shareable deep link, and a shared link that bounces a signed-out visitor to
`/auth` is a dead link. `/api/players/:playerId/dashboard` still 401s (it is
behind `authMiddleware`), and the page renders that as its own sign-in state.

Deviations taken, each forced by something measured:

1. **SIX shot zones, not the five in §2.2.** The spec lists SLOT / LOW SLOT /
   HIGH SLOT / POINT / BOARDS. With only those five, every attempt outside the
   |y| ≤ 15 ft slot lane falls into BOARDS — including faceoff-circle shots at
   |y| ≈ 20 ft, which are most of a power-play forward's volume. Measured in
   the harness: the page said "33% of his attempts come from the boards" about
   a player shooting from the circles. `CIRCLES` (15–28 ft off centre) is now
   its own row and `BOARDS` means beyond 28 ft.
2. **The Shot Breakdown rows are NOT `PercentileBullet`.** §2.2 asks for that
   bullet treatment and this keeps its anatomy exactly — caps eyebrow left,
   thin meter middle, tabular value right, hairline dividers — but the meter
   encodes SHARE OF THIS PLAYER'S OWN ATTEMPTS, not a rank. The endpoint
   returns one player's shots, not the league's, so there is no zone-share
   distribution to rank against; feeding a share into `PercentileBullet` would
   have printed "38th" for a number that is not a percentile.
3. **The rink hero's floating verdict moves BELOW the rink under `lg`.** The
   tile is `max-w-[320px]` at the rink's top-right and the rink is
   `aspect-[100/55]`; at 393px that is a 361 × 199px box, so the tile covered
   280 of 361px and sat on the slot cluster. The identity block, the jersey
   watermark and the segmented control stay composed AT the rink at every
   width — that composition is the signature (§1) and it survives 361px.
4. **A goalie gets a Concrete Poetry hero without a rink.** He has no map of
   his own attempts and an empty rink outline is not a coherent claim about a
   goaltender. Same movement — jersey watermark, monumental figure, floating
   verdict — with GSAx from `goalie_gsax_primary` as the monumental number.
   The same fallback hero carries the "no shots on record", "the shot read
   failed" and "the coordinates failed their own distance check" states, each
   with its own sentence.
5. **The season/game-type control is the URL, not a second segmented control.**
   `?season=&gameType=` are read off the query string and passed to the
   endpoint. §4 #6 allows one segmented control per view and the rink already
   owns it; a second one beside it would be a tab strip with rounded corners.

Two honesty notes that a reviewer should check:

* **Expected goals exist in two pipelines and this page shows both.** The
  condensed card reads `player_season_stats.x_goals` (via
  `/api/players/dashboard-index`); the career-arc tile reads
  `player_xg_season.xg`, summed over the scored shot events. They differ. The
  page says so, in words, and only when the gap is actually visible.
* **The shot map refuses to draw itself when it cannot verify its own
  geometry.** `distance` is frame-independent, so `hypot(89 − x, y)` against
  the stored distance is an independent check on every placement; a shot that
  fails it by more than 6 ft is dropped, and a player with fewer than half his
  attempts placed gets the labelled fallback instead of a thin map.

### PWS-3: WrappedChapter library extension

Web Summit ships one chapter (POSITION VS LEAGUE). Future
chapters per §2.4: "Where He Shoots Live", "Career Arc"
(post multi-season backfill), "vs Last Season", "Comparison"
(post comparison drawer build). Each is a new visualization slot;
the WrappedChapter chrome is already universal.

### PWS-4: G−xG mode true differential color encoding

Component 6 iter #2 implemented `g-xg` mode as a goals-only
filter with current xG-color encoding (pragmatic shortcut). The
spec'd intent is a true differential color encoding (cream/orange
for over-performance, sage for under-performance). Add a
`colorMode` prop to `RinkHeatmap` and a `g_minus_xg` value on
`ShotEvent` when this lands.

---

## Document maintenance

When implementation surfaces design questions not covered here,
update this document. When a deviation is taken, document it inline
with a dated note. Don't let the spec drift from reality.

| Date | Change | Author |
|---|---|---|
| 2026-05-04 | Initial spec — Concept 3 (Spatial Hero) locked | Garrett + Claude |
| 2026-05-04 | Added Section 8 (canonical mockup paths) + Section 9 (META-RULE: 4-step resource consultation protocol). Section 10 was previously Section 8. | Garrett + Claude |
| 2026-05-05 | Added Post-Web-Summit todos section: PWS-1 PlayerCard (condensed), PWS-2 profile-page consolidation, PWS-3 WrappedChapter library extension, PWS-4 G−xG true differential color encoding | Garrett + Claude |
| 2026-09-02 | **COMPONENT 6.5 — the dashboard SHIPS.** `pages/PlayerDashboard.tsx` routed at `/players/:playerId` OUTSIDE the `import.meta.env.DEV` gate that had hidden the composition since it was built, wired to a new `GET /api/players/:playerId/dashboard` (shots + `player_xg_season` career arc + `goalie_gsax_primary` + `player_talent_metrics` + a real `as_of`). `PreviewPlayerProfile.tsx` deleted with its mock data. PWS-2 Option 1 implemented. Five deviations recorded under PWS-2: a sixth `CIRCLES` shot zone (five zones called circle shots "boards"), share-meters instead of `PercentileBullet` in the Shot Breakdown (a share is not a rank), the hero verdict moving below the rink under `lg` (measured 280 of 361px of cover at 393), a rink-free Concrete Poetry hero for goalies and for every no-map state, and season/game-type on the URL instead of a second segmented control. | Claude |
| 2026-09-02 | PWS-1 BUILT and shipped into `PlayerStatsModal`. Added an implementation note under PWS-1 recording five measured deviations: the 180–240px envelope cannot hold 6–8 bullets (measured 407px compact / 587px expanded at 353px wide), a compact/expanded variant split, `#JERSEY` in place of `AGE` (no birth date on the payload), a labelled click-through to `/players?player=<id>` in place of a whole-card link to a route that does not exist, and Sparkline/StaleDataBadge cut because the payload carries neither a series nor a timestamp. GSAx logged as the top server-side follow-up. | Claude |
