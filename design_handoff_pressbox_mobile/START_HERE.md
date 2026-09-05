# START HERE — how to get this built

Five steps. Do them in order.

## 1. Put the folder in the repo
Unzip so the folder sits at the root of your checkout:

```
citrus-league-storm-main/
  design_handoff_pressbox_mobile/     ← this folder
  apps/
  packages/
```

Commit it on a branch (`git checkout -b redesign/pressbox && git add design_handoff_pressbox_mobile && git commit -m "Add Press Box design handoff"`). The design files need to live in the repo so Claude Code can read them while it works.

## 2. Open the reference in a browser
Open these three files in tabs and leave them open — you'll compare every PR against them:

- `Citrus Redesign - Directions.dc.html` — **`#1a`** is the approved direction (9 core screens). **Turn 3** = `#3a`–`#3f` (Line Check, live momentum, goal takeover, daily recap, weekly recap, league awards). **Turn 4** = `#4a`–`#4b` (draft room). **Turn 5** = `#5a`–`#5b` (player dashboard + internal analyst card). **Ignore `#1b`** — rejected.
- `Citrus Motion - Loading and Micro-interactions.dc.html` — loading screen, skeletons, six micro-interactions.
- `Citrus Current State (mobile).dc.html` — the before-state, for "what am I replacing".

## 3. Start the other window
Open Claude Code (Opus) in the repo root and paste the contents of **`OPUS_PROMPT.md`**. That file is the entire kickoff — it points at the README, sets the ground rules, and fixes the PR order. Don't paraphrase it; paste it.

It will start with PR1 (tokens + fonts + type scale) and stop for your review.

## 4. Review each PR against the mock
For each PR, `PR_CHECKLIST.md` has the acceptance criteria. The short version, every time:

- Run the harness at 393×852 (`apps/web/harness/README.md`) and put the mock phone next to it.
- Check the four things that make or break this design: **no META line wraps**, **row heights identical down the list**, **every tap target routes somewhere**, **no coloured position chips or team-colour fills**.
- `npm run lint && npm run test` clean, including the guard tests.

If something's off, tell that window exactly which screen and which element — it has the mock and the README, so "the roster row's WK column is 12px, spec says 12px mono tabular" is enough.

## 5. Ship in this order
PRs 1–2 are the foundation (tokens + shared chrome) — nothing else works until they land. Then screens. Then the differentiators.

**Before the season opens, the priority is PR1, PR2, PR16 (draft room).** The draft room is the highest-stakes surface; everything else can follow.

---

## If you're handing this to a human dev instead
Same three reference files, same README. Point them at:
- **Design tokens** and **Colour restraint** for the system,
- **Shared chrome** for the four components to build once,
- **Screens** for the nine core layouts,
- the section for whichever surface they're on (draft room / player dashboard / recaps),
- **Linking**, **Headshots & crests**, and **Guardrails** for the details that get missed.

## What's NOT decided yet
Flagged honestly so nobody invents an answer:
- **rostered % / start %** — no league-wide read exists. Needs a nightly aggregate; the UI hides the fields until it returns.
- **24h adds/drops** — needs a transaction aggregate across leagues.
- **Playoff odds** — needs the sim wired to `MatchupSimulationService`.
- **CITRUS GRADE** composite — the weights need documenting in `DATA_INVENTORY.md` before the number ships anywhere.
- **manager_week_metrics** (leaderboards) — z-score, lineup efficiency, waiver hit rate, xG luck.
- **Goal-map zone shares, WOWY pairs, comparables** — new views on `shot_events` and TOI data.

Anything on that list: build the aggregate, or hide the field. Do not fill it with a plausible number.
