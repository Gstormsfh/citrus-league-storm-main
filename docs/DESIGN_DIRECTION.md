# CITRUS 2.0 — DESIGN DIRECTION (v2, code-canonical — reconciled D2 2026-08-09 19:12Z)

**Provenance (INS-16):** two harvests, zero invention. Art: the 16 shipped low-poly renders in `apps/web/public/mascots`, viewed directly. Code: `tailwind.config.ts` pastel-* tokens + shipped citrus2 components (`Skeletons.tsx`, `StormyLoading.tsx`), read 19:08Z. **v1 of this file rendered art-observed colors; v2 is code-canonical — code won, as the rule required.** The visual board (chat + desktop artifact `citrus-design-direction`) is updated to match.

## Tokens (canonical, from tailwind.config.ts)

| Token | Hex | Role |
|---|---|---|
| *(unnamed — docketed)* | #0F1F15 | page bg — ships as `bg-[#0F1F15]` |
| *(unnamed — docketed)* | #1A2A20 | card/skeleton surface — ships as `bg-[#1A2A20]` + `ring-white/5` |
| pastel-cream | #FFF8F0 | primary text on dark |
| pastel-sage | #84A57D | live / success / our-team |
| pastel-sage-soft | #C8DCC4 | chips, borders, secondary emphasis |
| pastel-orange | #FF6B1A | **the laser** — one CTA per screen, the clock |
| pastel-orange-soft | #FF9F66 | kickers, warm secondary accent |
| pastel-peach / peach-deep | #FFE0CC / #FFB591 | soft accent + light: glows, rings, celebration |
| borders | white/5 … white/15 | `ring-white/5` shipped standard |

Motion: shipped `animate-citrus-shimmer` **1.6s** ease-in-out (white/5→white/10 gradient, backgroundPosition −200%→200%) · `float-slow` 7s (Stormy bob) · `live-pulse`/`ping` 1.6s · board's 150/200/300ms interaction tiers stand as guidance. **Reduced-motion: global kill-switch in `index.css` (~:1773) forces all animation/transition to 0.01ms — per-component handling not required.** Radii shipped: rounded-md blocks (6px), rounded-xl tiles (12px), rounded-2xl cards (16px). Fonts: Inter (body), Montserrat (display), JetBrains Mono (`font-jbmono`) for letterspaced kickers, Graduate for varsity moments.

## The ten rules (v2 deltas marked)

1. **Confident numbers:** weight 800, tracking −0.03em, `tabular-nums` everywhere a numeral lives. Scale: 72 hero (draft clock) / 44 stat / 28 card / 17 inline. Labels 10–11px caps, letterspaced, cream-45 or orange-soft.
2. **One accent per cluster.** Sage = live/success; orange = action.
3. **One #FF6B1A verb per screen.** Secondary = sage-soft outline; tertiary = ghost. Targets ≥44px.
4. **Focus ring:** peach family, 2px offset 2, never suppressed.
5. **Skeletons match the furniture** *(v2: use the shipped primitives — `SkeletonBlock/Card/Row/StatTile` from `citrus2/Skeletons.tsx`; white-alpha shimmer on #1A2A20; `role="status"` + `aria-label` + `sr-only` "Loading…" built in)*. Spinners never appear inside a page; `Loader2` survives only as inline button spinners.
6. **The loader is a character** *(v2: it is `StormyLoading` — circular Stormy + orange glow + ping ring + "STORMY IS ON IT" jbmono kicker + message prop. Name RATIFIED to stay `StormyLoading`; "CitrusLoader" is retired vocabulary. Rotating quips: docketed post-twelve.)*
7. **Empty states are moments:** scene art + one warm line + one #FF6B1A verb. "No data" is banned.
8. **Timeline is the heartbeat:** mascot-dotted cards, number anchored right, hover lift 1px.
9. **Voice:** name the actor, say what happened, point at what's next. Errors take the blame themselves.
10. **Peach is light, not paint.**

## Mobile (360px floor)

Clock = hero top-right (#FF6B1A, tabular). "You pick in N" always visible. QUEUE is the off-clock verb; DRAFT (full orange bar, thumb zone) only when you're up. Bottom tabs Players/Queue/Board/Rosters. Rows ≥44px. **HARD GUARD unchanged** — draft-surface logic untouchable; className/copy/aria/empty-state only.

## Dockets opened by this reconciliation (tokens-only, low-risk)

1. **Name the two surface tokens** (#0F1F15 page, #1A2A20 card) in tailwind.config — additive config entry only; do NOT sweep the 72+ arbitrary-hex usages now (that migration is post-twelve; index.css dark-mode overrides section documents the debt).
2. **Stale comments:** pastel/premium token blocks still say "for /preview-redesign only" while live citrus2 components consume pastel-* — comment-only truth fix.
3. **StormyLoading quips** — proposed evolution, post-twelve.

## Sleeper mechanics served

Confident hierarchy → rules 1–4 · League-as-group-chat → rule 8 · Living draft board → mobile + completion banner · Cheap identity → rule 6 + every mascot dot · Zero-friction rituals → rules 5, 7, 9.

---

## v2.1 AMENDMENTS (D7 2026-08-09 — rulings made after v2 that belong in the north star)

- **On-orange text is `#581E00`** (the repo's own prescribed on-primary; 4.63:1 on the laser) — exactly ONE dark-on-orange value exists; `text-white` on `bg-pastel-orange` is banned (2.87:1). [U9, gated]
- **Hover brightens, never darkens:** `hover:bg-pastel-orange-soft` (#FF9F66; 6.5:1 with #581E00). On the dark forest, the laser GLOWS on hover. [U9b ruling, gated]
- **Winner-based score coloring is the pattern** (leader `text-pastel-sage`, trailer `text-white/70`, tie both) — ScoreCard, MatchupTotalBar; team-based color-coding retired. H/A signal rides letters + position. [Entry 32 ruling]
- **Idiom taxonomy:** solid laser = CTA or active-state marker; alpha wash (`/10–/20`) = ambient accent; tab `data-[state=active]` = state marker, not a laser violation. [Entry 31]
- **Focus for bespoke elements:** `.focus-citrus` utility (index.css) — `:focus-visible` only, double box-shadow bg/#FFB591. [U5]
- **Voice:** `docs/COPY_VOICE.md` is law; empty-state = ✦ kicker / primary ≤8 words / context / one laser verb. [D6]
