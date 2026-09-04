Paste everything below this line into Claude Code (Opus), running in the root of `citrus-league-storm-main`.

---

You are implementing the **"Press Box" redesign** across Citrus Fantasy Sports, in this repo (`apps/web` — React 18 + TS + Vite + Tailwind + shadcn).

**Spec:** `design_handoff_pressbox_mobile/README.md` — read it in full before writing any code.

**Visual reference** (open these; they are design references built in HTML, not code to ship):
- `design_handoff_pressbox_mobile/Citrus Redesign - Directions.dc.html`
  - `#1a` — the approved direction, 9 core screens (Home, League HQ, Matchup, Roster, Players, Player card, Standings, Menu, Settings)
  - `#3a`–`#3f` — Stormy Line Check, live matchup momentum, goal takeover, daily recap, weekly recap, league awards + leaderboards
  - `#4a`–`#4b` — draft room (pool, board)
  - `#5a`–`#5b` — player dashboard, internal analyst card
  - `#1b` — **rejected, ignore it**
- `design_handoff_pressbox_mobile/Citrus Motion - Loading and Micro-interactions.dc.html` — loading screen (`2a`), skeletons (`2b`), micro-interactions (`2c`)
- `design_handoff_pressbox_mobile/Citrus Current State (mobile).dc.html` — the before-state; use it only to map existing components to their replacements

## Ground rules

1. Read `README.md` fully, then `apps/web/src/components/citrus2/STYLEGUIDE.md`, `tailwind.config.ts`, `src/index.css`, `components/phoneRowScale.ts`, `components/roster/positionChip.ts`, and every test named under "Guardrails to update" — **before** writing code.
2. Reuse existing services and hooks (`LeagueContext`, `MatchupService`, `StandingsService`, `WaiverService`, `TradeService`, `ScheduleService`, `Mug`/`TeamDisc`/`headshot.ts`, `teamColors.ts`, `playerAdvancedMetrics.ts`, `playerPercentiles.ts`, `citrus2/RinkHeatmap.tsx`, `PercentileBullet.tsx`, `SparklineMicroChart.tsx`). Do not invent parallel data paths or new chart primitives.
3. Styling is Tailwind classes on the new `pressbox.*` tokens and font aliases. No hex literals in components; no inline styles except computed widths (bars).
4. Every META line gets `whitespace-nowrap overflow-hidden text-ellipsis`. Row heights are fixed by the spec — if content is too long, shorten the string, never grow the row.
5. **Colour contract** (see "Colour restraint" in the README — it is the difference between professional and noisy): orange `#FF6B1A` is the only saturated colour and means *you / your pick / primary action*, one per screen region. Position tags are neutral `bg-white/10` + cream text. Team colour is a 1.5px ring on the mug only — never a fill, never a bar. Sage/grapefruit are state, used sparingly. Ice `#8DCDFF` is the opponent side of a two-sided comparison. Percentiles use one opacity scale, never a hue ramp. Add a test that fails a coloured position chip or a team-colour fill.
6. Every clickable element under "Linking" must route. Add cases to `src/__tests__/linkGraphIntegrity.test.ts` for each new route **before** wiring it.
7. Headshots must be real in production: `Mug.tsx` + the NHL CDN URL from `roster/headshot.ts`, sizes xs(30) / md(40) / lg(84). Team ring colour from `teamColors.ts`, lifted via `teamColorContrast.ts` for dark palettes. The striped circles in the reference HTML are placeholders — never ship them.
8. Motion: implement the table in the README's "Motion" section using only the four durations (100 / 200 / 320 / 700ms). Movement easing `cubic-bezier(.2,.7,.2,1)`; springs `cubic-bezier(.34,1.3,.5,1)`. Wrap every loop in a `prefers-reduced-motion` check. Only the live dot and the boot puck loop indefinitely.
9. Where data does not exist yet (rostered %/start %, 24h adds/drops, playoff odds, CITRUS GRADE, `manager_week_metrics`, goal-map zone shares, WOWY pairs, comparables): create the aggregate (SQL view + API route + service method), follow the `citrus-schema-review` checklist (RLS, tests), and **hide the UI field until the aggregate returns**. Never fill it with a plausible number.
10. Truth rules from `STYLEGUIDE.md` apply: no wallet, no odds/spreads, no fake counts, W–L not W–L–T. Awards and leaderboards render only from real aggregates — skip an award rather than fake one; hide any leaderboard cut with under 100 managers. Run `citrus-verify-number` before stating any model figure in the UI.
11. Match the reference pixel-for-pixel at 390×844 (mobile) and 1200px (analyst card). The screenshot diff is the acceptance test.

## PR order — one PR each, stop for review after every one

- **PR1** — tokens + fonts + `phoneRowScale.ts` + `STYLEGUIDE.md` update + guard tests updated to the new rungs
- **PR2** — shared chrome: `LeagueHeader` (sub-tab strip), `MobileBottomNav`, `ChatBar`, `LeagueMenu` — mounted on every league page
- **PR3** — loading screen + skeletons (Motion `2a` / `2b`)
- **PR4** — Roster · **PR5** — Matchup · **PR6** — Players / Free Agents · **PR7** — Player card · **PR8** — Standings · **PR9** — League HQ · **PR10** — Home · **PR11** — League settings
- **PR12** — data aggregates: rostered/start %, 24h adds/drops, playoff odds
- **PR13** — micro-interactions + goal toast + haptics + empty/error state sweep
- **PR14** — signature moments: `3a` Line Check, `3b` live momentum, `3c` goal takeover
- **PR15** — recaps: `3d` daily, `3e` weekly deck, `3f` league awards + You-vs-the-World leaderboards + trophy case in History
- **PR16** — **draft room** (`#4a` / `#4b` + My team tab) on `DraftRoomV2` — highest-stakes surface, ship before the season opens
- **PR17** — player dashboard `#5a` + internal analyst card `#5b` (CITRUS GRADE, percentile bullets, goal heat map, WOWY, comparables, CSV/PNG/API export)
- **PR18** — App Store pass: launch screen from Motion `2a`, icon from `favicon.svg` on `#0C1811`, store screenshots, privacy manifest, reduced-motion audit, 44px hit-target audit, VoiceOver labels on every row and bar

**If timelines force a choice: PR1, PR2, PR16 first.**

## Per-PR definition of done

Run `npm run lint && npm run test`. Run the harness at 393×852 (`apps/web/harness/README.md`), screenshot each changed screen, and compare against the matching phone in the reference HTML. Report the diff and any spec ambiguity before moving on.

**Never mark a screen done while:** a META line wraps · row heights vary down a list · a link is dead · a headshot falls back to initials for an active NHL player · a position chip or team-colour fill is coloured · a number is shown without its window and sample.

Start with PR1. Read first, then show me your plan for PR1 before you write code.
