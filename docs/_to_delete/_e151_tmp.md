
## Entry 151 — **THE V1 TABLE SWEEP.** All 18 database functions and 6 app files that read `draft_picks`, classified against the v2 rail. **One new commissioner-reachable hazard: the "Reset Draft" button reports success and resets nothing.** Plus: the roster sync alone won't fix the standings pages, undo is a smaller job than E150 said, and the split turns out to be *inside v2*, not between v1 and v2.

**Why I did this.** E150 was the **fourth** thing to break on one root cause — a v1-era capability reading `draft_picks` while v2 writes `draft_picks_v2`. Four instances of one pattern is not a coincidence, it is an unenumerated class. So I enumerated it instead of waiting for the fifth to surface on Aug 20. **Full register: `docs/V1_TABLE_CONSUMERS.md`.**

**The two numbers.** Across 112 snake leagues on staging: `draft_picks` holds **12** rows, `draft_picks_v2` holds **1,716**. **18 functions read the first. None reads the second.**

---

### The thing to act on: the Reset Draft button lies

**`Profile.tsx → handleResetLeagueDraft → hardDeleteDraft → POST /api/draft/league/:id/reset → nuclear_reset_draft`.** Commissioner-reachable right now, one button per commissioned league, on the settings page.

Its confirm dialog promises *"permanently delete all draft data … reset the league to 'not started'."* On a v2 league it deletes **0** picks, leaves `draft_picks_v2` and the **entire event log** intact, flips `draft_status` to `not_started`, and reports:

> *"Draft reset successful — you can now start a fresh draft."*

**It does not reset the draft. It desynchronises it.** The league claims `not_started` while the log holds a finished draft. Pressing START from there appends a second `draft_started` onto a log that already contains 252 picks.

**There is no reset button inside the v2 draft room — this one is on Profile**, which is exactly where someone goes looking after a botched start. **Runbook §E11 added: don't press it.** The real fix is cheap and post-freeze: have `nuclear_reset_draft` delete the league's `draft_events` too — `draft_picks_v2.source_event_id` cascades, so that one delete clears both.

*(Exact post-START behaviour is reasoned from source, not tested. What is certain is that the dialog's promise is false.)*

---

### The amendment: the roster sync doesn't fix the standings pages

`Roster.tsx:1602`, `Standings.tsx:245` and `OtherTeam.tsx:326` don't read `roster_assignments` for their stats — they call `DraftService.getDraftPicks()` → HTTP → the **v1** server service → `.from('draft_picks')` → **`[]`**. Every team then renders record `0-0-0`, rank `-`, 0 points.

**Severity before Sept 29: zero.** Pre-season every team really is 0-0-0, so the wrong answer and the right answer coincide. It becomes visible on opening night when the standings never move. **No effect on Aug 20 or the Sept 8 beta.**

But it means *"write the roster sync"* is one step, not the whole fix. **Morning brief amended** so that item isn't carried as finished when it lands.

---

### The good news, which is most of the register

- **`process_roster_move` is not built on the broken table.** Every piece of truth in it — drop validation, roster-size cap, goalie cap, the add itself, the returned count — reads `roster_assignments`. The `draft_picks` writes are a secondary ledger. **The moment the E142 sync lands, free agency works.** No rewrite. *(Today, with `roster_assignments` empty on v2, free agency is: **add without limit, drop nothing** — the caps count zero and every drop raises "not on your roster." That's a consequence of E142, fixed by the same change.)*
- **Account deletion works.** I expected an FK failure or orphaned picks; neither. Every FK on `draft_picks_v2` is `ON DELETE CASCADE`, so deleting teams and leagues sweeps the v2 picks correctly. **One residue:** `draft_events` has no FK to teams or profiles, so a user who deletes their account while a league they *played in* survives leaves their `pick` events behind, each carrying their UUID in `picked_by_actor->>'id'`. Real erasure gap, five-line fix, compliance backlog — not the freeze list.
- **No live trigger fires any of this.** The scariest-looking function — `detect_and_recover_data_loss`, an auto-recovery routine that "restores from draft_picks" — **is not attached to any trigger.** It cannot fire. Dead code.
- **Five functions I expected to matter don't.** `make_draft_pick`, `confirm_draft_pick`, `reserve_draft_pick`, `cleanup_expired_draft_reservations`, `autopick_next_player` are v1 draft mechanics the v2 engine never calls. **Irrelevant, not broken.** Saying so plainly rather than padding the register.
- **The demo league and the v1 Realtime subscription are correct as written.**
- Ops tooling (`check_data_integrity`, `auto_fix_integrity_issues`, `smart_restore_team_lineups`, `detect_security_anomalies`) has **no caller and no trigger** — but would be confidently, comprehensively wrong if run. One line for the ops runbook: **don't point them at a v2 league.**

---

### The finding that reframes all four earlier ones

| function | writes |
|---|---|
| `submit_pick_v2` (snake v2) | `draft_events` **only** |
| `close_nomination_v2` (auction v2) | `draft_events` **and `draft_picks` (v1)** |
| `auction_commissioner_override_v2` | `draft_events` **and `draft_picks` (v1)** |

With `close_nomination_v2` explaining itself in a comment: *"compatibility with the existing `draft_picks` shape. UI"*.

**This is not a v1-versus-v2 split. It is a split inside v2.** The auction author kept writing the v1 ownership ledger deliberately, so downstream consumers would keep working. The snake author didn't. **E142, the completion sync, the manual `/sync` route, E150's undo, and everything in this register all descend from that single divergence.**

**And it points at the fix.** Every v2 pick already flows through one place: `tg_draft_events_project_pick`, an AFTER INSERT trigger on `draft_events`, synchronous, same transaction. Teaching that one trigger to also write `draft_picks` repairs most of this register at once, with no change to the engine, the API or the client — and it is exactly what `close_nomination_v2` already does inline.

**Do not deploy it before Aug 20.** It touches the hot path of the one thing that must not break, five days from freeze, for problems that don't bite on the night. **`draft_events` is complete, so the same repair is available at any later date with a backfill and costs nothing for having waited.** That is the whole argument for patience — and the single most important sentence in the register: **none of this is data loss, all of it is projection loss.**

---

### Correction owed on E150

E150 said undo needs *"an RPC that appends a `pick_undone` event **and** removes the projection row atomically."* **The atomic half already exists.** `tg_draft_events_project_pick` handles `pick_undone` — `DELETE FROM draft_picks_v2 WHERE source_event_id = (NEW.payload->>'target_event_id')::bigint` — in the same transaction as the event insert, and its comment cites *"Spec §6.2: undo is rejected if any subsequent pick exists; the RPC enforces that."*

So the engine replay was already built (E150), **the projection cleanup was already built too**, and the spec for the missing RPC already exists. **Remaining: the RPC, a route, a button.** Two of the three hard parts were finished before I looked. **Nothing changes for Aug 20 — there is still no undo, §E10 stands — but the job afterwards is smaller than I described.**

---

**This was the last big systematic sweep available**, and I said in E149 I'd rather report a quiet cycle than manufacture motion. It wasn't quiet: one new reachable hazard, one amended plan, two compliance items, one dead trigger, one correction that shrinks scoped work — and a fair amount of "this is fine," which is the other half of what a sweep is for.

**No code changed. Runbook §E11 added, morning brief amended. Both databases read-only for this entry.**
