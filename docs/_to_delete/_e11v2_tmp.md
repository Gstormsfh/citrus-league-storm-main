
## E11 — **Don't press "Reset Draft" on Profile. It doesn't reset a v2 draft — it makes the league unstartable.** *(added 2026-08-12 — inbox E151, corrected E152)*

There is **no reset control inside the v2 draft room.** There *is* one on the **Profile / settings page** — one button per league you commission — and that is exactly where you'd go looking if the first attempt at THE TWELVE went sideways.

**It does not work on a v2 league.** Its dialog promises to *"permanently delete all draft data and reset the league to 'not started'."* What actually happens:

| it deletes | result |
|---|---|
| `draft_picks` (v1) | **0 rows** — v2 picks live in `draft_picks_v2` |
| `draft_order` | **deleted** |
| `team_lineups`, `roster_assignments` | deleted |
| `draft_status` | **flipped to `not_started`** |
| `draft_state` | **not touched — stays `active`** |
| `draft_picks_v2` | **untouched — every pick survives** |
| `draft_events` (the log) | **untouched — the whole draft survives** |

Then it tells you: *"Draft reset successful — you can now start a fresh draft."*

**You cannot.** The league is now in a state `start_draft_v2` explicitly refuses, by name:

> `draft_state_not_startable: league … draft_status=not_started but draft_state=active (illegal combo)`

**The good news is that this is a designed refusal, not an accident.** Two independent guards catch it: the illegal-combo check above, and — because the reset deleted `draft_order` — `draft_not_configured: league … has no round-1 draft_order`. **The event log is never polluted and no second `draft_started` is ever appended.** The failure is loud, named, and contained.

### What to do on the night

**If a draft needs restarting, make a new league. Don't press that button.**

Creating a fresh league and re-sending the join code costs about five minutes with twelve people on a call. Pressing reset costs you that league permanently — it will report success, then refuse to start, and there is no in-product way back.

**Same rule for `POST /api/draft/league/:id/reset` by hand.** It is the same function.

**If you press it by accident:** nothing is lost and nothing is corrupt — the draft is still whole in `draft_events` and `draft_picks_v2`. Move the twelve to a new league and keep going. Recovery of the old one is a database job for afterwards, not for the night.

**Related, same cause:** don't run the ops integrity tools (`check_data_integrity`, `auto_fix_integrity_issues`) against a v2 league. They read the v1 table, will report a healthy league as corrupt, and `auto_fix` would "repair" it from an empty source.

*(Real fix, post-Aug-20 and one line: have `nuclear_reset_draft` also delete the league's `draft_events` — `draft_picks_v2.source_event_id` cascades — and reset `draft_state` alongside `draft_status`. Full detail: `docs/V1_TABLE_CONSUMERS.md`.)*

---
