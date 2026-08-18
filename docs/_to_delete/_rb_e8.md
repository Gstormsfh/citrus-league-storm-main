
## E8 — **How long the draft actually takes, and the clock decision that sets it** *(added 2026-08-12 after instrumenting the commissioner path)*

Every cadence number in this runbook and in the ledger — 2.10s per pick, ±16ms, zero drift — was measured on **ownerless** seats, where instant-autopick arms at 2 seconds. **THE TWELVE will have twelve OWNED seats, and that path is completely different.**

**An owned seat that does not pick waits out the ENTIRE pick clock before autopick.** Measured on staging: a 60-second clock produced `ignition → first pick = 60.9s`, against ~2.4s for the same league shape with the seat ownerless. This is correct and must not be changed — you do not autopick a human two seconds into their turn. But it means **the engine does not set the pace of draft night. The clock and twelve humans do.**

**Pick the clock deliberately, before invites go out.** The lobby's estimate (`DraftLobby.tsx:1075`) is `teams × rounds × pickTimeLimit`, i.e. **the worst case where every pick times out**:

| clock | 12 × 21 = 252 picks, worst case (what the lobby will display) | plausible real pace (~20s/pick) |
|---|---|---|
| 30s | 2 h 06 m | ~1 h 20 m |
| **60s** | **4 h 12 m — the lobby will read "Estimated time: 252 minutes"** | ~1 h 30 m |
| 90s | 6 h 18 m | ~1 h 40 m |

The worst case scales linearly with the clock; the realistic case barely moves, because people do not use their full clock. **A shorter clock costs almost nothing in real pace and removes hours from the worst case.** If anyone goes quiet — steps away, loses signal, falls asleep — the difference between a 30s and a 90s clock is the difference between the room absorbing it and the room stalling on it.

**Two operational notes that follow:**

1. **Do not be alarmed by the lobby's estimate.** "252 minutes" is arithmetic, not a forecast. Say so to the twelve if anyone asks.
2. **Fewer rounds is the other lever.** 21 rounds at 12 teams is 252 picks. If the roster does not need 21, every round removed is 12 picks and, at a 60s clock, up to 12 minutes of worst case.

**Pre-flight addition (goes with E5):** confirm `pickTimeLimit` in the lobby before inviting anyone, and say the number out loud to the room at the start. It is the single setting that determines what kind of evening it is.

---
