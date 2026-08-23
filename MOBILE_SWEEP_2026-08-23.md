# Citrus Mobile Sweep — 390×844, every route (Aug 23 2026)

Method: true 390px viewport (iframe harness — media queries AND the JS `isMobile` checks both see phone width), overflow metrics per route plus eyes on each screen. Ran against the **deployed Round 2+3 code** (your push landed mid-sweep — bundle rotated off `index-Bt_MElX1.js`).

## Verdict: the mobile experience is real and solid

All 12 routes lay out properly at phone width with **zero true horizontal overflow anywhere**: League HQ, Matchup, Roster, Free Agents, Standings, Waiver Wire, GM Office, Trade Center, Create League, Draft Room, Pick'em Pool, plus the bottom-tab navigation shell. Highlights seen with my own eyes at 390px:

- Dedicated mobile patterns everywhere: stacked stat cards on HQ, the tap-to-swap roster list, side-by-side matchup comparison, bottom tab bar on every league page.
- **Round 2+3 fixes verified live on mobile**: Matchup header now reads "Week 1/29" with Sep 28 dates (the "WEEK 1/1 · Aug 23-29" bug is gone); GM Office banner no longer claims the matchup "starts in 1 day"; Create League shows **Auction AND Offline/Manual both gated "Coming soon"** on phone.
- Standings table and the draft-room player pool scroll horizontally inside their own containers (correct mobile table pattern).
- Pick'em renders its between-slates empty state cleanly.

## Fixed tonight (in your folder, ships with the next push)

**1. Standings toolbar was clipped on phones** (`Standings.tsx`) — the Season/Refresh/Export row is ~470px wide inside a clipping card: the Season select was half cut off the left edge and **Export was completely unreachable**. Now wraps to a second row on small screens.

**2. Stormy's floating button sat on top of tap targets** (`StormyChatBubble.tsx`) — on mobile it floated at the RIGHT edge, exactly where the Free Agents "+" add buttons and Trade Center info buttons live; taps meant for those hit Stormy instead. Moved to the bottom-LEFT on mobile (matching desktop), where it only overlaps avatars/names — the least destructive collision.

Verification: lint clean, build clean, full web suite 1,924 tests passed.

## Logged, not blocking

- Matchup header says "Week 1/29" while Roster says "1/27" — calendar math counts 29 candidate weeks, schedule generation trimmed to 27 playable ones. Cosmetic; aligning the matchup selector to actual matchup rows (the roster page's approach) is the eventual fix.
- Draft-room pool rows: the per-row Draft button sits at the far right of the 900px-wide stats table, so it needs a horizontal swipe on phones. Mitigated today — tapping a player opens the card, and the on-clock action bar has a big DRAFT button — but a sticky action column would be the polish.
- The floating Stormy button still overlaps *some* content at its new position (any floating button does); left-side collisions are benign.

## The "freezes" — resolved, and good news

During the sweep two automation browser tabs hard-locked (earlier tonight one did too, on trade-analyzer). Ran it down: a same-origin tab stayed responsive the whole time, and every "freezing" page — GM Office, Trade Center, League HQ — loads instantly in a fresh tab, including with the goalie-heavy roster. The locks were **corrupted automation-tab renderer processes** (heavy CDP instrumentation + many navigations), not app code. No user-facing bug; noted here so the earlier "unexplained page hang" watch item can be closed with a cause. Worth one eye during webview testing, nothing more.

*Deploy note: your Paste A landed during this sweep — server + web Round 2+3 are live on prod. The engine rebuild (Paste C) is still the remaining step for the autopick roster fixes.*
