# PR checklist

Tick every box before merging. The four **bold** items are the ones that actually break this design — check them on every PR regardless of what it touched.

## Every PR
- [ ] `npm run lint` clean
- [ ] `npm run test` clean, including the guard tests
- [ ] Harness screenshot at 393×852 compared side-by-side with the matching phone in `Citrus Redesign - Directions.dc.html`
- [ ] **No META line wraps** — every secondary line is `whitespace-nowrap overflow-hidden text-ellipsis`
- [ ] **Row heights identical** down every list (roster 56 · matchup 58 · players 64 · standings 44)
- [ ] **Every tap target routes** — new routes have `linkGraphIntegrity` cases
- [ ] **No coloured position chips, no team-colour fills** — positions neutral `bg-white/10`, team colour is a 1.5px mug ring
- [ ] One orange element per screen region; sage/grapefruit only for state; ice only for the opponent side
- [ ] Numbers in `IBM Plex Mono` + `tabular-nums`; names never mono
- [ ] Every model figure states its window and sample (`3YR`, `n=512`)
- [ ] 44px minimum hit targets
- [ ] `prefers-reduced-motion` honoured on anything animated

## PR1 — tokens, fonts, type scale
- [ ] `pressbox.*` colours in `tailwind.config.ts`; existing `pastel.*` untouched
- [ ] Google font import swapped to Barlow + Barlow Condensed + IBM Plex Mono; `font-cond` / `font-mono` aliases added
- [ ] `phoneRowScale.ts` rungs updated (NAME 15 Barlow 700 · HEADLINE 17 mono 600 · META 10 mono nowrap · MICRO 9)
- [ ] `citrus-fast/normal/entrance` + new `citrus-data: 700ms` present
- [ ] `positionChip.ts` colour maps replaced with one neutral pair; geometry exports kept
- [ ] `STYLEGUIDE.md` rewritten: type stack, colour contract, colour restraint rules
- [ ] `phoneRowTypeScaleGuard` and `darkThemeContrastGuard` updated and passing

## PR2 — shared chrome
- [ ] `LeagueHeader` with Match / Team / Players / League strip, orange underline, sticky, scanline band
- [ ] Mounted on Matchup, Roster, FreeAgents, LeagueDashboard, Standings
- [ ] `MobileBottomNav` → Leagues / Scores / Players / News / Account
- [ ] `ChatBar` above the nav on every league page; `stormy` variant works; orange FAB removed
- [ ] `LeagueMenu` feature grid with live one-line stats and correct routes
- [ ] `mobileHeaderMenuGuard` updated (menu now lives in `LeagueHeader`)
- [ ] `zLayerScaleGuard` covers the chat bar and nav rungs

## PR3 — loading + skeletons
- [x] Loading screen matches Motion `2a`: bobbing/spinning puck, real boot-stage progress, rotating tips, Stormy footer (`NativeBootSplash`, `harness/boot.html`)
- [x] Progress is driven by real stages — never fake-completes; stage name appears after 4s (`lib/bootStages.ts`: auth 25 → leagues 55 → first paint 100)
- [x] Min display 600ms, ceiling 6s — the splash has both; every page's hold is `PB_LOADING_MIN_MS = 600`; `useLoadCeiling` stays on Matchup, the page that shipped the infinite spinner (the other pages' ceilings are a behaviour change for after the test drafts)
- [x] Skeletons mirror final layout exactly; position chips at 50% opacity; 100–150ms row stagger (`pressbox/Skeleton.tsx`, 120ms; `harness/skeleton.html?route=/roster`)
- [x] Full-screen Stormy loader removed from Roster — and from Standings, Matchup, League HQ, Playoffs and Players below `lg` (`PressBoxPageLoading`); the desktop keeps Stormy
- [x] Route fallback (`LoadingScreen`) is the URL's skeleton under the nav below `lg`, not a fixed sheet over it
- [x] No `animate-pulse` on a phone component (`pressboxLoadingGuard`)

## PR4–PR11 — screens
- [ ] Every element on the screen is either in the spec or from a source file you read — nothing from memory
- [ ] Column headers, meta lines and micro labels match the reference strings
- [ ] Empty states carry a next action; stale-data badge on tiles >90s old during live games
- [ ] Locked players: chip shows the lock, row stays full contrast, tap explains why
- [ ] Optimistic updates on adds/drops/swaps with rollback + grapefruit shake on failure

## PR12 — aggregates
- [ ] `citrus-schema-review` run on every new table/view/policy
- [ ] RLS policies + tests for each
- [ ] UI fields stay hidden until the aggregate returns a value
- [ ] Nightly cache job documented in `DATA_INVENTORY.md`

## PR13 — motion
- [ ] Only the four durations used
- [ ] Score tick rolls; row flashes sage then fades; live dot pulses only while live
- [ ] Bars transition width 700ms, never snap
- [ ] Goal toast: spring in, hold 4s, `impactMedium`, rate-limited to one per 90s
- [ ] Button press 100ms scale + success sage `✓` for 900ms

## PR14–PR15 — moments and recaps
- [ ] Line Check cards ranked by projected point impact; `DO ALL 3` batches with a confirm sheet
- [ ] Which Line Check cards were acted on is logged (retention metric)
- [ ] Daily recap grades every Line Check action (✓ / – / bench-left-on-table)
- [ ] Awards computed from real stats only; an award with no real stat is skipped, not faked
- [ ] Leaderboard cuts hidden under 100 managers; country/city opt-in from profile
- [ ] Max 2 recap pushes per day across all leagues

## PR16 — draft room
- [ ] Sticky pick bar on every tab; timer colour follows the shipped 33% / 11% thresholds
- [ ] Not-on-clock state reads `NEXT PICK 4.06 · 11 PICKS AWAY · ~8 MIN`
- [ ] Pool headline number follows the sort (`draftPoolHeadline.ts`) with the matching unit label
- [ ] Board: your column ringed, live pick the only solid orange cell, future picks dashed orange-soft
- [ ] Last-picks list shows ADP delta (reach / value / even)
- [ ] Haptic + sound at 10s; new pick fades orange → tile over 700ms
- [ ] `draftRoomMobileGuard`, `draftDecisionSupportGuard`, `draftRoomExitGuard` passing

## PR17 — player dashboard
- [ ] Goal heat map: white ice, net at top, red goal line / circles with hash marks / trapezoid, blue line bottom, per-goal radial hotspots
- [ ] Zone split and context rows show the league baseline alongside the player's share
- [ ] Percentile bullets show the league range, 25–75th band, median tick
- [ ] WOWY table shows TOI together plus xGF% with vs without
- [ ] CITRUS GRADE weights documented in `DATA_INVENTORY.md`; `citrus-verify-number` run
- [ ] Provenance footer on the card: model version, weighting, sample, build timestamp
- [ ] Analyst card prints letter-landscape without reflowing

## PR18 — App Store
- [x] Launch screen = static frame of Motion `2a` — `Splash.imageset` regenerated: `#0C1811` ground, the glow, the puck at the overlay's exact spot, the empty track. The wordmark is NOT in the image (no Barlow in the launch image; it lands with the web view). Storyboard ground `#0C1811`, was white; capacitor `backgroundColor`, `html`, `body`, `#root` and the native hold in `Index.tsx` are the same colour, so the cold start is one ground (`capacitorShellGuard`)
- [x] Icon: `favicon.svg` mark on `#0C1811`, 1024 universal (Xcode 14+ derives the sizes)
- [ ] Store screenshots: Matchup, Roster, Players, `3b` live momentum, `3f` awards — Garrett, from the simulator
- [x] Privacy manifest complete (audited 2026-08-15; nothing new touches a required-reason API)
- [x] Status bar: `UIStatusBarStyle` light content + `UIUserInterfaceStyle` Dark in Info.plist — Capacitor defaulted to `.default`, i.e. black time/battery over the header on every light-appearance phone
- [x] Fonts: the three Press Box faces (Barlow Condensed 700/800, Barlow 400–700, IBM Plex Mono 500/600) are bundled from `@fontsource` (`src/pressboxFonts.ts`, latin woff2, hashed assets) — no round trip, no swap on the splash, works on a plane. The marketing site's other faces come from a non-blocking Google `<link>` in `index.html`, no longer an `@import` at the top of `index.css` that held the first paint
- [x] Reduced-motion audit: the global rule at `index.css` `@media (prefers-reduced-motion: reduce)` zeroes every animation and transition; the boot splash and the shimmer have their own static states on top
- [x] VoiceOver labels on every row, bar and chip — audited in the harness 2026-09-05 across Roster, Standings, Matchup, Players, League HQ, Scores, News, the Players tab, Account and Waivers: zero controls without an accessible name. A device pass with VoiceOver on is still worth an hour
- [x] 44pt tap targets: `pb-hit` / `pb-hit-y` grow every chip, segment, tab and roster slot chip to 44px under the finger without moving the artboard's visual; the sideways chip strips are padded so they no longer clip it (`appStoreShellGuard`)
- [ ] First league page interactive under 1.5s on 4G — measure on device after the fonts are self-hosted
