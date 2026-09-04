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
- [ ] Loading screen matches Motion `2a`: bobbing/spinning puck, real boot-stage progress, rotating tips, Stormy footer
- [ ] Progress is driven by real stages — never fake-completes; stage name appears after 4s
- [ ] Min display 600ms, ceiling 6s (`useMinimumLoadingTime` / `useLoadCeiling`)
- [ ] Skeletons mirror final layout exactly; position chips at 50% opacity; 100–150ms row stagger
- [ ] Full-screen Stormy loader removed from Roster

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
- [ ] Launch screen = static frame of Motion `2a`
- [ ] Icon: `favicon.svg` mark on `#0C1811`, all required sizes
- [ ] Store screenshots: Matchup, Roster, Players, `3b` live momentum, `3f` awards
- [ ] Privacy manifest complete
- [ ] Reduced-motion audit: no transforms or loops when the setting is on
- [ ] VoiceOver labels on every row, bar and chip
- [ ] First league page interactive under 1.5s on 4G
