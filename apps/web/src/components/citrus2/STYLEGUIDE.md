# Citrus 2.0 — Design System

The dark-forest, hockey-first, Citrus-warm design language used by the new homepage and rolling out site-wide. All components live in `apps/web/src/components/citrus2/` and import from `@/components/citrus2`.

## When to use this system

**Use citrus2:** any new page, any page being redesigned, the homepage, marketing surfaces, public product surfaces (NHL playoff bracket, news, etc.), and logged-in product surfaces as they migrate.

**Don't use citrus2:** existing pages that haven't been migrated yet — they keep using the legacy `Navbar` / `Footer` / pastel layout. We migrate one zone at a time. The two systems coexist via separate component namespaces (`@/components/Navbar` vs `@/components/citrus2/HockeyNav`).

## Tokens

| Token | Value | Use |
|---|---|---|
| Base surface | `#0F1F15` | Page background |
| Card surface | `#1A2A20` | Tiles, cards, nav |
| Border | `border-white/10` | Card borders |
| Text primary | `pastel-cream` (#FFF8F0) | Headlines, labels |
| Text secondary | `white/65` | Body copy |
| Text dim | `white/45` | Captions, eyebrows |
| Accent · vibrant | `pastel-orange` (#FF6B1A) | CTAs, live indicators, focal headlines |
| Accent · soft | `pastel-orange-soft` (#FF9F66) | Eyebrow text, secondary highlights |
| Accent · sage | `pastel-sage` (#84A57D) | Trust strip, success states, secondary chip |
| Accent · butter | `#F4E5B8` | Secondary chip / mascot accent |
| Accent · peach | `pastel-peach` (#FFE0CC) | Secondary chip / mascot accent |
| NHL team color | `getTeamInfo(abbrev).primaryColor` | Real team chips, bracket bars |

## Type stack

| Token | Family | Use |
|---|---|---|
| `font-sans font-black` | Inter 900 | Hero headlines |
| `font-sans font-bold` | Inter 700 | Section headings |
| `font-calistoga` | Calistoga | Wordmark only |
| `font-jbmono` | JetBrains Mono | Eyebrows, badges, stats, captions |

## Voice and lingo

This is a hockey product. The copy reads like hockey people wrote it.

**Use:** drop the puck, on the ice, behind the bench, sin bin, in the crease, hat trick, slate, apple (assist), sniper, tendy, biscuit, chirp, dangler, faceoff, shift, line, PP1, PK, xGF%, Corsi, TOI, rip a wrister, top line, blueliner, assistant GM.

**Don't use:** "monitor the situation", "wrap up the win", "bring the heat" (corporate sports), Vegas terms (no spreads, no odds — we don't do them), "users" (say "managers"), "fans" (say "hockey heads").

**Mascot positions:** Center, Defenceman (Canadian spelling), Goaltender, Assistant GM. Never Forward / Defender / Goalie / Coach.

## Truth rules

We don't lie about features:
- ❌ No paid leagues (yet)
- ❌ No Vegas-style odds in Pickem
- ❌ No Yahoo/ESPN league import
- ❌ No iOS/Android apps (web only)
- ❌ No fake testimonials, fake star ratings, fake user counts
- ❌ No ties in fantasy league standings (use W-L not W-L-T)
- ✅ NHL team records use W-L-OTL (real NHL format)
- ✅ Free during launch · founders pricing locked in for early users (real plan to monetize later)

## Component cookbook

### Primitives

| Component | Use |
|---|---|
| `<TeamChip abbrev="EDM" />` | Round monogram in real NHL team color |
| `<MascotAvatar id="stormy" />` | Round mascot portrait |
| `<LivePulse />` | Pulsing orange dot for "live" indicators |
| `<Eyebrow>` | Caps eyebrow chip with optional pulse |

### Page chrome

| Component | Use |
|---|---|
| `<DarkLayout>` | Page wrapper — dark forest bg + atmospheric glows |
| `<HockeyNav>` | Sticky dark nav with promo banner above |
| `<HockeyFooter>` | Multi-column dark footer |

### Hero

| Component | Use |
|---|---|
| `<RotatingHero>` | Auto-cycling 5-slide carousel |
| `<LiveGameTile>`, `<StandingsTile>`, `<PickemTile>`, `<SurvivorTile>`, `<BracketTile>`, `<StormyChatTile>` | Reusable hero visuals (also useful in product pages) |

### Sections

| Component | Use |
|---|---|
| `<SectionHeader eyebrow title sub />` | Section heading pattern |
| `<GameModeCard>` | Horizontal carousel card for game modes |
| `<OnboardingCard>` | "Three Ways In" card |
| `<FeatureCard>` | "What You Get" feature card |
| `<MascotCard>` | Squad lineup card |
| `<FaqItem>` / `<Faq>` | Accordion FAQ |
| `<CtaBanner>` | Big closing CTA panel |

## Mascot usage

The Citrus Squad has four mascots. Always pull from `@/constants/mascots`:

```tsx
import { MASCOTS } from '@/constants/mascots';
// Stormy specifically
<MascotAvatar id="stormy" size="md" />
// Or all four
{MASCOT_LIST.map(m => ...)}
```

**Where to use mascots:**
- Stormy: chat bubble avatars (always), AI loading states, assistant GM moments
- Lemon: forward stat callouts, scoring leaders, draft hype
- Kiwi: defender stats, advanced metrics, analyst content
- Pineapple: goalie stats, save% leaders, "in the crease" moments

**Where NOT to use mascots:**
- League standings (use TeamChip with real NHL team colors)
- Settings, profile, admin (too playful)
- Error states (use lucide icons)

## Migration playbook (for new pages)

1. Wrap in `<DarkLayout>` instead of the legacy bg
2. Replace `Navbar` with `<HockeyNav>`
3. Replace `Footer` with `<HockeyFooter>`
4. Use `<SectionHeader>` for any "eyebrow + title + sub" pattern
5. Use `<TeamChip>` everywhere a team abbreviation appears
6. Audit copy for voice/lingo — pass through the hockey filter
7. Audit claims for truth — no fake counts, no missing features, no unsupported claims
8. Check `apps/web/src/constants/mascots.ts` for character data; never hardcode mascot paths

## Adding new components

New components in citrus2/ should:
- Be **dark-themed by default** (use the tokens above)
- Be **small and composable** — each one does one thing
- Take **explicit props** — no implicit globals
- Not touch global state — pages compose them with their own data
- Live in their own file with a default export
- Be added to `index.ts` barrel for ergonomic imports

When in doubt, look at how the homepage composes these to compose your own page.
