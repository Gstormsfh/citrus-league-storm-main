# App Store Connect — metadata draft (2026-08-15)

Fill-ins marked ⟨⟩. Everything else is submission-ready copy.

## App information
- **Name:** CitrusSports — Fantasy Hockey
- **Subtitle** (30 chars max): `Fresh-squeezed fantasy hockey` (29 ✓)
- **Category:** Sports  ·  Secondary: none
- **Bundle ID:** com.citrussports.app

## Promotional text (170 max, editable without review)
> Season-long NHL fantasy with live snake drafts, real-time scoring, and an
> xG-powered projection model. Draft night just got serious. (139 ✓)

## Description
CitrusSports is season-long NHL fantasy hockey built around the best part of
fantasy: draft night.

LIVE DRAFT ROOM — Real-time snake drafts with a synced pick clock, a draft
queue that autopicks for you if life pulls you away, and a board that never
loses your place, even if your connection drops mid-round.

SMARTER RANKINGS — Player projections built on expected-goals (xG) data, not
just last year's box scores.

SET YOUR LINEUP — Drag-and-drop lineups, auto-lineup from projections, weekly
matchups, live scoring.

RUN YOUR LEAGUE — Commissioner tools, custom scoring, dynamic roster sizes and
draft settings.

Free to play. No entry fees, no prizes, no gambling. ⟨CONFIRM before submission
— if ANY league supports real-money entry, this line and the review notes must
change, and guideline 5.3 applies.⟩

## Keywords (100 chars max, comma-separated)
`fantasy hockey,NHL,draft,fantasy sports,hockey stats,snake draft,fantasy league,xG,hockey pool` (97 ✓)

## URLs
- Support: ⟨https://citrussports.app/support — must exist before review⟩
- Marketing: ⟨optional⟩
- Privacy policy: ⟨host docs/apple/PRIVACY_POLICY_DRAFT.md at a public URL —
  required field, checked by review⟩

## Age rating questionnaire — expected answers
- Gambling (simulated or real): **No** ⟨assumes free-to-play confirmed⟩
- Contests: **Yes, infrequent/mild** (fantasy contests, no cash)
- Everything else: No → lands at **4+** (12+ if you answer Contests
  conservatively; either passes)

## Privacy nutrition labels (App Privacy section)
| Data | Collected? | Linked to identity | Tracking |
|---|---|---|---|
| Email address | Yes (account) | Yes | No |
| Name / display name | Yes | Yes | No |
| User ID | Yes | Yes | No |
| Gameplay content (rosters, picks) | Yes | Yes | No |
| Coarse location / precise location | No | — | — |
| Advertising data | No | — | — |

**Ads correction (2026-08-15 sweep):** the WEBSITE loads Google AdSense
(apps/web/index.html). The NATIVE build strips it automatically
(`scripts/build-native.mjs` asserts the strip), so the app itself ships ad-free
and "Data Not Used to Track You" stands for the App Store labels. Do not
answer the advertising questions based on the website.
⟨Verify Firebase Analytics: services/AnalyticsService.ts uses firebase v12 —
if enabled in the shell, declare Usage Data accordingly or gate it native-off.⟩

## Review notes (draft)
> CitrusSports is a free season-long fantasy hockey app. No real money: no
> entry fees, no prizes, no wagering of any kind. Demo account:
> ⟨reviewer@citrussports.app / password — CREATE THIS, place it in a league
> with an active roster so every screen has data⟩. The draft room can be
> explored via ⟨seed a completed demo draft so review sees a populated board⟩.

## Screenshots (required sets)
6.9" (iPhone 16 Pro Max) and 6.5" — capture AFTER the Sunday test build:
1. Draft room, mid-draft, clock running
2. Roster with the dark tile view
3. Player pool with queue stars
4. Matchup / scoring screen
5. League standings
