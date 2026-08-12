# V2 PORT GAP REGISTER — everything v1's draft room does that v2's does not
**Architect · compiled 2026-08-12 · one place for a class of defect that has been surfacing one at a time**

---

## Why this document exists

Three separate defects found on the night of Aug 11/12 turned out to be **the same defect wearing different clothes**: a v2 call site that under-supplies a component v1 wired fully. The board's denominator (E129), the missing player statistics (E131), and the completion panel's roster link (E133) were each found by accident, in sequence, by different routes.

So I stopped finding them by accident. **This register is the systematic version**: every prop, import, tab and component that differs between `DraftRoom.tsx` (v1) and `DraftRoomV2.tsx` (v2), assessed for draft-night impact. It is complete as of tonight. **Nothing below is speculative — each row was read in both files.**

**THE TWELVE draft on the v2 room.** Every gap here is something twelve people will or will not have on Aug 20.

---

## The register, ranked by what it costs on draft night

| # | Gap | Impact | Effort | Status |
|---|---|---|---|---|
| **1** | **No player statistics anywhere in the pool** | **severe** | ~1 h | diagnosed + specified (E131 / E132) — **awaiting Garrett's routing** |
| **2** | Board denominator hardcoded to 16 rounds | high | done | **FIXED** (E129) |
| **3** | No "Roster" tab / no `RosterDepthChart` | high | ~2 h | **open — not started** |
| **4** | Completion panel's roster link ignored the drafting league | moderate | done | **FIXED** (E133) |
| **5** | `scoringSettings` never passed → ranking ignores league scoring | moderate | 1 line* | open |
| **6** | `projectedFptsMap` never passed → Proj ROS / Proj‑GP render `-` | moderate | 1 line* | open |
| **7** | Watchlist absent entirely (v1: 16 references, v2: **0**) | moderate | ~1 h | open |
| **8** | Pool's "add to queue" affordance absent | low | 1 line* | open |
| **9** | Draft room never claims the active league | low–moderate | ~30 m | proposed (E133) |
| **10** | `DraftSnapshotView` (past-draft dialog) absent | negligible | — | not needed for Aug 20 |
| **11** | `DraftControls` (pause/resume) hidden | none | — | **deliberate** — the v2 routes don't exist; documented at `DraftRoomV2.tsx:13` |

\* *one line at the call site — but blocked behind #1, because the data those props rank and display does not currently reach the room.*

---

## The three that matter, in detail

### 1 — No statistics. The pool renders 2,035 players with zeros.

Full diagnosis in inbox **E131**, fix specified in **E132**. Short version: `usePreloadedPlayers` selects eight identity columns from `player_directory` and never asks for stats; v1 fed its pool from `PlayerService`, which joins `player_season_stats` server-side. Verified live — **150 rendered rows, zero players with a non-zero games-played value.** Every stat column is 0, so the fantasy-points calculation ties all 2,035 players, the rank sort does nothing, and the list falls back to `player_id ASC`, which is chronological by NHL debut. That is why Jagr, Cullen and Chara lead the board and McDavid is nine hundred rows down.

**Two traps documented in E132 for whoever implements it:** there is **no foreign key** between the two tables (so it cannot be a single embedded query), and `player_season_stats` carries two parallel stat families whose values **disagree for 738 of 1,066 rows** — the server reads the `nhl_*` set. Picking the other one ships wrong numbers to two-thirds of the league, which is worse than zeros because it is invisible.

### 3 — No Roster tab. The "what do I still need?" view does not exist in v2.

**v1 has four tabs — Players · Board · History · Roster. v2 has three.** v1's Roster tab holds a team selector and `RosterDepthChart`, which takes `draftPicks`, `currentRound`, `totalRounds`, `rosterSlots` and `positionType` and renders **filled vs. remaining slots per position.**

In a 21-round draft this is the most useful thing on the screen after the player list. Without it, a manager in round 15 has to count his own picks to work out that he has four centres and no goalie. v2 does render `TeamRosters` (a flat list of every team's picks) beneath the tabs, but that answers *"what did everyone take?"*, not *"what do I still need?"*.

**This is the one gap on the list that is a feature rather than a fix**, and it is the one I would put in front of Garrett after #1. `RosterDepthChart` already exists, already takes exactly the props v2 can supply (`derived.currentRoundNumber`, the `totalRounds` now threaded by E129, `league.roster_slots` — which is populated: `{"C":2,"D":4,"G":2,"LW":2,"RW":2}`), and needs a tab to live in.

### 7 — The watchlist does not exist in v2.

`grep -c watchlist`: **v1 = 16, v2 = 0.** The star affordance in the player pool, the `watchlist` prop, the load-on-mount effect — none of it was ported. Not a defect in the strict sense (nothing is broken), but it is a feature twelve people will look for, because every fantasy product has it.

---

## The pattern, and the guard against it

Every row here has the same shape: **a component that was ported, but not everything that fed it.** The v2 page's own header comment describes the approach — *"mounts the proven v1 draft components … via thin adapter functions … Zero-touch to v1 component internals"* — and that decision was right. The cost was that a *component* was treated as the unit of porting, when the real unit is **component + everything it consumes.**

Two guards, cheap enough to be worth it:

1. **Make the defaults loud.** `DraftBoard`'s `totalRounds = 16` silently produced "252 of 192 picks made" for three days. A default that is *plausible* is more dangerous than one that is absent — a required prop would have failed at the type level the moment the port omitted it. Where a default must stay, the tests should pin it with a comment saying it is being pinned, not endorsed (as `DraftBoard.totalRounds.test.tsx` now does).
2. **Diff the call sites, not the components.** The entire register above came from mechanically extracting every prop passed to each shared component in both files and comparing the sets. That is a ten-minute check and it found four real defects. **It should be run once more after the E132 stats work lands**, because that change is the one that unblocks rows 5, 6 and 8.

---

## Recommended order

1. **#1 (statistics)** — everything else in the pool is cosmetic until this lands, and rows 5/6/8 are blocked behind it.
2. **#5, #6, #8** — one line each, immediately after #1, in the same commit.
3. **#3 (Roster tab)** — the largest genuine improvement to the room, ~2 hours, and it needs Garrett's yes because it is a feature.
4. **#9 (active league)** — 30 minutes, low risk, do it whenever the context layer is next touched.
5. **#7 (watchlist)** — after THE TWELVE. Nobody will miss it on one draft night; everybody will by beta.

**#2 and #4 are already fixed and ride the pending web deploy.**

---
*Compiled by reading both files end to end. Inbox entries E129, E131, E132, E133 carry the individual receipts. — Architect, 2026-08-12*
