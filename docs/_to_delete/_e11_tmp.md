
## E11 — **Do not press "Reset Draft" on Profile. It reports success and resets nothing.** *(added 2026-08-12 — inbox E151)*

There is **no reset control inside the v2 draft room.** There *is* one on the **Profile / settings page** — one button per league you commission — and that is exactly where you would go looking if the first attempt at THE TWELVE went sideways.

**It does not work on a v2 league.** Its dialog promises to *"permanently delete all draft data and reset the league to 'not started'"*. What actually happens:

| it deletes | result |
|---|---|
| `draft_picks` (v1) | **0 rows** — v2 picks are in `draft_picks_v2` |
| `draft_order`, `team_lineups`, `roster_assignments` | deleted |
| `draft_status` | **flipped to `not_started`** |
| `draft_picks_v2` | **untouched — every pick survives** |
| `draft_events` (the log) | **untouched — the whole draft survives** |

Then it tells you: *"Draft reset successful — you can now start a fresh draft."*

**It has not reset the draft; it has desynchronised it.** The league claims `not_started` while the log still holds a completed draft. **Pressing START after that appends a second `draft_started` onto a log that already contains every pick** — the engine replays from that log at boot.

### What to do on the night

**If a draft needs restarting, do not use that button. Stop and make a new league instead.**

Creating a fresh league and re-sending the join code costs about five minutes with twelve people already on a call. Attempting the reset costs the evening, because the resulting state is one nothing in the product knows how to display and nothing in the product knows how to undo.

**Same rule for `/api/draft/league/:id/reset` by hand.** It is the same function.

**Related, same cause:** do not run the ops integrity tools (`check_data_integrity`, `auto_fix_integrity_issues`) against a v2 league. They read the v1 table, will report a healthy league as corrupt, and `auto_fix` would "repair" it from an empty source.

*(The real fix is one line — have `nuclear_reset_draft` also delete the league's `draft_events`, which cascades to `draft_picks_v2` — and it belongs after Aug 20. Full detail: `docs/V1_TABLE_CONSUMERS.md`.)*

---
