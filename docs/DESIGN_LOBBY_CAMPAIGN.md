# DESIGN — LOBBY CAMPAIGN
**Architect design note · 2026-08-11 22:2x MDT · PROPOSE ONLY — no UI code changed by this document**
**Audience: Garrett (decision) + terminal (execution, only after Garrett picks)**
**Scope: the surface THE TWELVE see before the draft engine ever fires.**

---

## 0. Why this exists

Every hour of the last three days went into the machine *behind* the draft — the event
log, the engine, the corridor, the timer, autopick. That machine is now certified.
The twelve will not see any of it. What they will see, in this order, is:

`join code → lobby → a button → the room`

Three of those four are UI I have never audited. This note audits them and proposes a
campaign. It changes nothing. Garrett picks line items; the terminal executes.

**Garrett's own field notes from the first walkthrough are the spine of this document:**
- *"Prepare Draft doesn't really make sense"*
- *"Join Draft should be the only option for a non-commissioner"*
- *"No charactures, or any visuals really at all"*

I have added two findings of my own that the walkthrough did not surface (L4, L5), one of
which I consider a **draft-night defect, not a design opinion**.

---

## 1. What the lobby is today (verified, `DraftLobby.tsx`, 1186 lines)

Rendered by `apps/web/src/pages/DraftRoom.tsx:4030`. Two-column on desktop, stacked on
mobile with an explicit order swap (sidebar first on mobile, `line 745`).

```
┌─ Draft Lobby ─────────────────────────────────────────────────────────┐
│  h1 "Draft Lobby"  + subcopy that differs by isCommissioner (288-294)  │
├──────────────────────────────┬────────────────────────────────────────┤
│ MAIN COLUMN (desktop left)   │ SIDEBAR (desktop right, mobile FIRST)  │
│                              │                                        │
│  Draft Settings      (299)   │  League Invite Code   (747) commish only│
│    rounds / clock / order    │    join code + copy + email invite      │
│    scoring format            │    Quick Actions row  (782)             │
│    Custom Order editor (395) │      · Add AI Teams                     │
│    Draft Summary      (483)  │      · Reset Draft                      │
│                              │      · Teams count                      │
│  Draft Order         (505)   │                                        │
│    the snake grid            │  Scheduled Time      (848) all members  │
│                              │                                        │
│  Team List           (579)   │  DRAFT CONTROL       (893)  ◄── the hot │
│    + up to 3 empty slots(652)│    commissioner: THREE buttons          │
│                              │      [Prepare Draft]                    │
│                              │      [Start Draft Now]                  │
│                              │      [Schedule Draft Time]              │
│                              │    manager: [Join Draft Room] (1026)    │
│                              │                                        │
│                              │  "Not in this league?" (1057)           │
│                              │  Draft Info           (1069)            │
└──────────────────────────────┴────────────────────────────────────────┘
```

The whole thing is **one component for two completely different jobs**: a commissioner's
control panel and eleven managers' waiting room. Every manager currently renders the
commissioner's settings, order editor, and team-management affordances as read-only
furniture, then scrolls past all of it to find one button.

---

## L1 — ONE-BUTTON IGNITION *(Garrett: "Prepare Draft doesn't really make sense")*

### The finding

Three buttons in Draft Control mean the commissioner must, at the most stressful moment of
the product's life, answer a question he was never asked: *which kind of starting is this?*

The three are not siblings. Reading the handlers:

| Button | Handler | What it truly does | Reachable state |
|---|---|---|---|
| **Prepare Draft** | `onPrepareDraft` | sets `draft_status='queued'` — a lobby-with-a-lock. Optional prop; **when the parent omits it, the button does not render at all** | `queued` |
| **Start Draft Now** | `onStartDraft` → `useStartDraftFull` | the real ignition: init + `start_draft_v2` + engine NOTIFY | `in_progress` |
| **Schedule Draft Time** | `onScheduleDraft` | writes a timestamp to settings. **Nothing on the server acts on it.** It is a note to humans | unchanged |

So of three equally-weighted buttons, exactly **one** starts a draft, one creates an
intermediate state whose only purpose was the old two-phase flow, and one writes a string.
`Start Draft Now` even renders as `variant="outline"` — visually *demoted* — whenever
`onPrepareDraft` is present. **The real button is the quiet one.** That is backwards.

### Proposal

Collapse to a single primary action with a disclosure for the rare paths.

```
BEFORE                              AFTER
┌────────────────────────┐          ┌────────────────────────────────┐
│  Draft Control         │          │  Draft Control                 │
│                        │          │                                │
│ [ Prepare Draft      ] │  ──►     │  12 of 12 managers in.         │
│ [ Start Draft Now    ] │          │  Clock 60s · 21 rounds · snake  │
│ [ Schedule Draft Time] │          │                                │
│                        │          │  ┌──────────────────────────┐  │
└────────────────────────┘          │  │   START THE DRAFT        │  │
                                     │  └──────────────────────────┘  │
   3 buttons, 1 works               │  Everyone in the lobby moves    │
                                     │  to the room together.          │
                                     │                                │
                                     │  Set a time instead ▾           │
                                     └────────────────────────────────┘
```

- **One primary**, full width, unambiguous label, always `variant="default"`.
- A one-line **readiness sentence above it** — `N of M managers in`, plus the three
  settings that matter. This is the pre-flight check the commissioner is actually
  performing when he hesitates, made explicit so he stops hunting for it in the settings
  card.
- **"Set a time instead"** as a text disclosure, not a button. It is a scheduling note,
  and should look like one until a server-side scheduler exists (see risk).
- **Retire `Prepare Draft` from the common path.** Keep the `queued` state and the handler
  — the engine's boot-scan and the fence both understand it — but stop offering it as a
  peer of ignition. If we want it at all, it belongs behind the same disclosure.

### Files touched

- `apps/web/src/components/draft/DraftLobby.tsx` — Draft Control block, ~`893–1005`
- `apps/web/src/pages/DraftRoom.tsx` — may stop passing `onPrepareDraft` (~`4030`)
- `apps/web/src/components/draft/__tests__/DraftLobby.doublePress.test.tsx` — **this test
  enumerates the Start-Draft-family buttons by name**; it will fail loudly if labels move.
  That is the point of it. Update deliberately, do not delete.

### Risk

**Medium-low.** The double-press guard (`isStartingDraft`, T7 Entry 7) must stay wired to
the surviving button — losing it would re-open double-ignition, which is the failure the
guard was built for. The `queued` status must remain *reachable* even if unadvertised,
because boot-scan resume and the v1 fence both branch on it. **Do not delete the handler,
only the button.** Net: one afternoon, most of it test updates.

---

## L2 — ROLE-AWARE LOBBY *(Garrett: "Join Draft should be the only option for a non-commissioner")*

### The finding

`isCommissioner` currently gates **one card** (the invite code) and **one ternary** (the
button block). Everything else renders identically for all twelve. A manager who joins by
code sees: a settings panel he cannot change, a Custom Order editor he cannot open, a team
list with delete affordances he cannot use, an "Add AI Teams" row, and a Reset Draft
button — before reaching the single control that concerns him.

On a phone this is worse than it sounds: the sidebar is ordered **first** on mobile, so a
manager's first screen is the commissioner's control panel.

### Proposal — two views from one component

```
COMMISSIONER                          MANAGER (the other eleven)
┌────────────────────────────┐        ┌────────────────────────────┐
│ Draft Lobby · you're the   │        │ Blizzard Cup · Draft Lobby │
│ commissioner               │        │                            │
│                            │        │  ┌──────────────────────┐  │
│ [ START THE DRAFT ]        │        │  │  JOIN DRAFT ROOM     │  │
│  12 of 12 in · 60s · 21rd  │        │  └──────────────────────┘  │
│                            │        │  Waiting for Garrett to    │
│ Invite code  ABCD12  [copy]│        │  start · you're pick #7    │
│                            │        │                            │
│ Settings ▸  Order ▸  Teams▸│        │  Draft order (read only)   │
│  (collapsed, expandable)   │        │  Teams in (read only)      │
│                            │        │  Clock 60s · 21 rounds     │
│ Add AI · Reset · Max teams │        │                            │
└────────────────────────────┘        │  (no settings, no reset,   │
                                       │   no delete, no AI teams)  │
                                       └────────────────────────────┘
```

Rules:

1. **Manager view leads with the button.** First thing on screen, both breakpoints.
2. **Manager sees his own draft position** — "you're pick #7". We already compute
   `effectiveOrder`; surfacing it is free and it is the single fact a drafter most wants
   while waiting.
3. **Manager sees state, not controls**: order, teams, clock, rounds — all read-only, all
   *below* the button.
4. **Commissioner's configuration collapses** into disclosures. He set it once at league
   creation; on draft night he needs the button and the invite code, not the form.
5. **Kill the mobile order-swap for managers.** The `order-first/order-last` dance at line
   745 exists to put controls on top; for a manager the control *is* the button, so
   natural order is correct.

### Files touched

- `apps/web/src/components/draft/DraftLobby.tsx` — structural; the clean version extracts
  `<CommissionerLobby>` and `<ManagerLobby>` from the shared data, ~200 lines moved
- possibly new: `apps/web/src/components/draft/ManagerLobby.tsx`
- `apps/web/src/components/draft/__tests__/DraftLobby.doublePress.test.tsx` — already has a
  non-commissioner branch (line ~138); extend it

### Risk

**Medium.** This is the largest item and the only one that touches structure rather than
copy. Mitigations: extract, don't rewrite — the manager view is a *subset* of what already
renders, so every element has proven markup; and `isCommissioner` is already threaded, so
no new prop plumbing. **This is the item to cut first if Aug 17 gets tight** — L1 alone
delivers most of the felt improvement.

---

## L3 — ART PASS *(Garrett: "No charactures, or any visuals really at all")*

### The finding

I read the instruction literally and I think it is right. `public/mascots/` holds sixteen
character and scene assets (`mascot-stormy`, `scene-draft`, …). **None belong in the
lobby.** A drafting adult in a twelve-man league does not want a cartoon; he wants to know
whether everyone is in and when the clock starts.

But "no visuals" cannot mean "no design". The lobby's problem is not too much art — it is
that nothing on the page has visual *rank*, so the eye finds the button last.

### Proposal — typography and hierarchy, zero illustration

| Slot | Today | Proposed | Asset needed |
|---|---|---|---|
| Page title | `<h1>Draft Lobby</h1>` | **the league's name**, large; "Draft Lobby" as small eyebrow above it | none |
| Readiness | absent | `12 of 12 managers in` — the largest number on the page after the title | none |
| Primary button | competes with two peers | full width, citrus accent, the only saturated colour in view | none |
| Team list | uniform rows | joined = full contrast; empty slot = dashed outline, muted | none |
| Draft order | grid | manager's own seat highlighted with the accent | none |
| Everything else | equal weight | one step down in size and contrast | none |
| Mascots / scenes | — | **none. Not one.** | — |

The "citrus2" identity shows up as *one accent colour used exactly once per screen*, plus
the existing type scale. That is a stronger brand statement than a fruit with a face, and
it costs zero new assets — which matters with nine days left.

**Where art still earns its place:** marketing and empty states elsewhere in the app —
`/` , `/create-league`, onboarding. Not the lobby, not the draft room. Those two screens
are utilities on their most important night.

### Files touched

- `apps/web/src/components/draft/DraftLobby.tsx` — class names and copy only
- `apps/web/src/index.css` / theme tokens — only if the accent needs a new token

### Risk

**Low.** Cosmetic, reversible, no logic. Can ship independently of L1 and L2 and can be
done last.

---

## L4 — MOBILE BOTTOM NAV *(architect finding — I am calling this a defect, not a design item)*

### The finding, with receipts

`apps/web/src/components/MobileBottomNav.tsx` is rendered **globally** at
`apps/web/src/App.tsx:251`. Its wrapper is:

```
fixed bottom-0 left-0 right-0 z-50 lg:hidden      (line ~127)
…inner row: h-16                                  (line ~141)
```

So on **every viewport under 1024px** — every phone, most tablets — an opaque 64px bar sits
over the bottom of whatever is rendered, at `z-50`.

Its route filter is:

```js
// Don't show on auth pages, draft room, or setup flows
const hideOnRoutes = ['/auth', '/profile-setup', '/verify-email', '/reset-password'];
```

**The comment says "draft room". The array does not contain it.** The v2 room is
`/draft-v2/:leagueId/:draftId?` (`App.tsx:202`); v1 is `/draft` and `/draft-room`
(`199–200`). None are in the list. `DraftRoomV2.tsx` has no compensating bottom padding —
its only `pb-` is a sticky *header* at line 434.

Second half of the finding: for a season-long fantasy league — which is exactly what THE
TWELVE is — `isPool` is false, so the nav falls through to the default branch:

```js
// Playoff-first mobile nav — season-long items accessible via direct URL.
[ Playoffs, Create, News, Profile ]
```

There is **no path to the user's own league** in the mobile nav. A manager mid-draft, on a
phone, has 64px of his screen occupied by a bar offering *Create a playoff pool*.

### Consequence on draft night

Twelve friends will overwhelmingly be on phones. Whatever the v2 room renders in its last
64px is covered on all of them. I have not yet confirmed what sits there at mobile width —
**verifying that is my next action after this note, in the browser at 390px** — but the
answer does not change the fix.

### Proposal — ship this, do not schedule it

```js
const hideOnRoutes = [
  '/auth', '/profile-setup', '/verify-email', '/reset-password',
  '/draft-v2', '/draft-room', '/draft',   // ← matches the comment above it
];
```

`startsWith` already handles the params. Three strings. Separately, and lower priority: the
default branch should include the user's active league when one exists, so a fantasy
manager has a route home. That is a design change; the hide list is a bug fix.

### Files touched

- `apps/web/src/components/MobileBottomNav.tsx` — one array
- new test: assert the nav returns null for all three draft paths

### Risk

**Very low, and it is one-directional** — the change can only *remove* an element from
screens where it was never intended. Ordering caution: `'/draft'` is a prefix of
`'/draft-v2'` and `'/draft-room'`, so `startsWith('/draft')` alone would cover all three;
all three are listed for grep-ability and intent, which costs nothing.

---

## L5 — "NOT IN THIS LEAGUE?" *(architect finding, small)*

`DraftLobby.tsx:1057` renders a card titled **"Not in this league?"** to users who are not
members. On draft night, in a room of twelve invited friends, this is the wrong sentence
for anyone who lands there — the likeliest reason a manager sees it is a **join that did not
complete**, not a wrong turn. Proposed copy shifts from dead-end to recovery: name the
league, show the join-by-code field inline, and state who to ask. **Copy only, ~10 lines,
negligible risk.** Bundle it with L3.

---

## 6. Sequencing, cost, and what I recommend

| # | Item | Effort | Risk | Ship by |
|---|---|---|---|---|
| **L4** | Bottom-nav hide list | 10 min | very low | **immediately — defect** |
| **L1** | One-button ignition | ½ day | med-low | Aug 14 |
| **L3+L5** | Type hierarchy + copy | ½ day | low | Aug 15 |
| **L2** | Role-aware split | 1–1½ days | medium | Aug 16, **cut first if tight** |

Everything lands inside the **Aug 17 freeze** with two days of margin, and none of it
touches the engine, the event log, the corridor, or projections. This is the entire reason
to do it now: the risky system is frozen and certified, so the safe system is the only
place left where an hour buys visible quality.

**Architect's recommendation: approve L4 tonight** (I will ship and verify it before you
wake), **L1 and L3+L5 as a pair**, and **hold L2 until Aug 14** so it is cut cleanly if the
prod-vs-staging decision (see `PROD_READINESS_GAP_ANALYSIS.md`) claims those days instead.

The lobby is the first ten seconds of the product for eleven people who have never used it.
Right now those ten seconds are spent looking for a button.

---

## 7. What this note deliberately does NOT propose

- No change to `start_draft_v2`, the corridor, the fence, or any engine behaviour.
- No change to projections, scoring, or `player_ros_projections` — **another session owns
  that lane and I have not touched it.**
- No new dependencies, no new routes, no schema.
- No production deploys. Per the gap analysis, THE TWELVE draft on staging; these changes
  reach them through the staging web deploy only.

---
*Propose-only. Nothing in this document has been implemented. Awaiting Garrett's line-item
selection. — Architect, 2026-08-11*

---

## L6 — THE ESTIMATE *(added 2026-08-12, after instrumenting the commissioner path — see inbox E134)*

### The finding

`DraftLobby.tsx:1075` renders:

```tsx
Estimated time: {Math.ceil((teams.length * settings.rounds * settings.pickTimeLimit) / 60)} minutes
```

That is **teams × rounds × the full clock** — the worst case in which *every single pick times out*. It is presented as an estimate.

For THE TWELVE's real shape — **12 teams × 21 rounds at a 60-second clock — the lobby will display "Estimated time: 252 minutes."** Four hours and twelve minutes. A commissioner reads that number and plans an evening around it.

**The real number is nowhere near it**, because people do not use their full clock. At a realistic ~20s average the same draft finishes in about **90 minutes**. The distance between what the lobby says and what will happen is two and a half hours.

### Why it matters beyond the number

The estimate is the only place in the product that helps a commissioner choose `pickTimeLimit`, and as written it makes the choice look far more consequential than it is *in the expected case* while hiding how consequential it is *in the tail*:

| clock | worst case (what the lobby shows) | plausible real pace |
|---|---|---|
| 30s | 2 h 06 m | ~1 h 20 m |
| 60s | **4 h 12 m** | ~1 h 30 m |
| 90s | 6 h 18 m | ~1 h 40 m |

**The worst case scales linearly with the clock; the realistic case barely moves.** That is the actual insight a commissioner needs, and the current single number buries it. A shorter clock costs almost nothing in real pace and removes hours from the disaster scenario — which is exactly what you want when one of twelve friends steps away from his phone.

### Proposal

Lead with an expected time, keep the worst case as the honest second line:

```
BEFORE                                  AFTER
Estimated time: 252 minutes             About 1 h 30 m
                                        Up to 4 h 12 m if every pick uses
                                        the full 60s clock
```

- **Expected** = `teams × rounds × min(pickTimeLimit, 20s)` — a deliberately crude model, and still an order of magnitude closer than the current one. If a better constant emerges from THE TWELVE's real pick times, it replaces the 20.
- **Worst case** stays visible and stays honest — it is a real bound, and naming the clock in the sentence is what turns the number into a decision.
- Format as hours and minutes past 90 minutes. "252 minutes" is a quantity; "4 h 12 m" is an evening.

### Files touched

- `apps/web/src/components/draft/DraftLobby.tsx` — the Draft Info card, ~`1069–1077`

### Risk

**Very low — one expression and some copy, no logic, no data.** The only judgement call is the 20-second constant, and it is wrong in a much less costly direction than the current model. **Bundle with L3/L5 (the copy and hierarchy pass); it is the same kind of change and the same file.**

**Measured evidence behind this item:** ignition→first pick on an *ownerless* seat is 2.4s, but on an **owned** seat it is the full clock — 60.9s measured on a 60s league. THE TWELVE will have twelve owned seats, so the clock, not the engine, sets the pace of draft night. Full numbers in inbox E134 and runbook §E8.

---

---

## L7 — CONFIRM BEFORE SEALING THE LEAGUE *(added 2026-08-12 — inbox E140)*

### The finding

`join_league_with_code` refuses every non-member the instant `draft_status` leaves `not_started`: **"Cannot join — the draft is currently in progress."** Permanently. **START is the most irreversible button in the product**, and the lobby treats it as the least.

The Start-Draft buttons are gated on `teams.length < 4` (`DraftLobby.tsx:956, 965`), and the only warning renders **below four** (line 993). **Between 4 and 12 there is no warning, no confirmation, and no visual difference.** At 11 of 12 the button is ordinary. The count is on screen — `Teams joined: 11/12`, line 903 — sitting quietly above three buttons of equal weight, which is L1's hierarchy problem doing real damage.

**The failure:** one friend is late; the commissioner presses START mid-conversation at 11 of 12; that friend is **permanently locked out of a league he was invited to**, and his seat — being ownerless — instant-autopicks a full roster at ~2.1 seconds a pick while twelve people watch. No undo. Recovery is abandoning the draft and rebuilding the league.

**This is the only defect in this document that ends someone's participation rather than degrading their experience.**

### Proposal

Put the friction exactly where the mistake happens, and nowhere else.

```
AT CAPACITY (the common path — unchanged, one press)
┌────────────────────────────────────────┐
│  12 of 12 managers in.                 │
│  ┌──────────────────────────────────┐  │
│  │        START THE DRAFT           │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘

BELOW CAPACITY (the button says so, and asks once)
┌────────────────────────────────────────┐
│  11 of 12 managers in — Ahmed hasn't   │
│  joined yet.                           │
│  ┌──────────────────────────────────┐  │
│  │   START THE DRAFT — 11 OF 12 IN  │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
            ↓ opens
┌──────────────────────────────────────────────┐
│  Start without Ahmed?                        │
│                                              │
│  Once the draft starts he can't join — not   │
│  with the code, not later. His seat will be  │
│  auto-drafted from the first pick.           │
│                                              │
│      [ Wait for him ]   [ Start anyway ]     │
└──────────────────────────────────────────────┘
```

- **At capacity, nothing changes.** The common path stays one press; adding a dialog there would train people to dismiss it, which is how confirmations stop working.
- **The button carries the count** below capacity, so the state is legible before the click, not only after.
- **The dialog names the person and the consequence.** "Are you sure?" is noise; *"he can't join — not with the code, not later"* is information. Name the missing manager if the league has their invite; otherwise "1 manager hasn't joined".
- **Default focus on "Wait for him."** The destructive option should require aim.

### Files touched

- `apps/web/src/components/draft/DraftLobby.tsx` — the Draft Control block (~`893–1005`) and one dialog, alongside the two that already exist in this file

### Risk

**Low.** No new state, no server change, no effect at capacity. The one judgement call is whether to name the absent manager, which depends on whether invitees are known before they join — if they aren't, "1 manager hasn't joined" carries the same weight.

**Sequencing: bundle with L1.** They are the same block of JSX and the same idea from two directions — **L1 makes the real button obvious; L7 makes the one irreversible thing it does explicit at the moment it matters.** Doing L1 without L7 produces a *more* prominent button with the same silent trap behind it.

---
