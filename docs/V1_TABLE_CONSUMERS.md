# V1 `draft_picks` CONSUMER REGISTER
**Every consumer of the v1 `draft_picks` table, classified against the v2 rail.**
Compiled 2026-08-12 (inbox E151), after the v1/v2 table split broke a fourth thing (E150).
Staging `jjgspcpvqaiitloglxbb`. Read-only — no code changed, no migration applied.

---

## The two numbers that are the whole story

On staging, across **112 snake leagues**:

| table | rows |
|---|---|
| `draft_picks` (v1) | **12** |
| `draft_picks_v2` | **1,716** |

**18 database functions read `draft_picks`. Not one reads `draft_picks_v2`.**

---

## THE ONE THING THAT MATTERS MOST

**None of this is data loss. All of it is projection loss.**

`draft_events` is append-only and complete — 1,716 pick events across 115 drafts, every one carrying
`pick_number`, `round`, `team_id`, `player_id`, `picked_at` and `picked_by_actor`. Every gap in this
register can be repaired retroactively, from the log, at any date. **Nothing expires. Nothing is
lost by waiting until after Aug 20.**

That single fact is what makes the rest of this document a backlog rather than an emergency.

---

## ⚠️ NEW: the "Reset Draft" button lies — but the damage is contained by design

**`Profile.tsx` → `handleResetLeagueDraft` → `hardDeleteDraft` → `POST /api/draft/league/:id/reset`
→ `nuclear_reset_draft`.** Commissioner-reachable, today, from the settings page. There is one of
these per commissioned league.

The confirm dialog promises:

> *"This will permanently delete all draft data (picks and draft order) and reset the league to
> 'not started' status. This action cannot be undone."*

On a v2 league, what it **actually** does:

| statement | v2 effect |
|---|---|
| `DELETE FROM public.draft_picks WHERE league_id = …` | **0 rows** |
| `DELETE FROM public.draft_order …` | deletes the v1 order |
| `DELETE FROM public.team_lineups …` | deletes lineups |
| `DELETE FROM public.roster_assignments …` | deletes assignments (already empty on v2) |
| `SET draft_status = 'not_started'` | **flips the status** |
| `draft_state` | **not touched — stays `active`** |
| `draft_picks_v2` | **untouched — every pick survives** |
| `draft_events` | **untouched — the entire log survives** |

Then the UI reports:

> *"Draft reset successful — you can now start a fresh draft."*

**You cannot.** The league is left in a state `start_draft_v2` refuses, by name — and this is the
part I got wrong on the first pass and corrected an hour later (inbox **E152**):

```sql
IF v_draft_status IN ('not_started','queued')
   AND v_draft_state IS DISTINCT FROM 'not_started' THEN
  RAISE EXCEPTION 'draft_state_not_startable: league % draft_status=% but draft_state=% (illegal combo)'
```

On staging, **111 of 112 completed leagues carry `draft_state = 'active'`** — completion never
winds it back — so a reset produces exactly `not_started` + `active`, which is exactly what that
guard was written for. **A second independent guard catches it anyway**: the reset deletes
`draft_order`, so `draft_not_configured: league … has no round-1 draft_order` fires too.

**So the event log is never polluted and no second `draft_started` is ever appended.** My original
claim — that pressing START would append one — was wrong, and was flagged as unverified when
written. **The failure is loud, named, and contained.**

**What remains true:** the dialog is false, the button is commissioner-reachable today, and the
league it is pressed on becomes **unstartable with no in-product way back**.

**Mitigations, in order of cheapness:**

1. **Aug 20: do not press it.** Runbook **§E11**. There is no reset button *inside* the v2 draft
   room — this one lives on the Profile/settings page, which is exactly where someone goes looking
   after a botched start. If it gets pressed anyway: **nothing is lost**, the draft is whole in
   `draft_events`; move the twelve to a new league and recover the old one afterwards.
2. **Cheap real fix (post-Aug 20):** make `nuclear_reset_draft` delete the league's `draft_events`
   (`draft_picks_v2.source_event_id → draft_events.id ON DELETE CASCADE`, so the projection goes
   with it) **and reset `draft_state` alongside `draft_status`.**

---

## Register — database functions (18)

### 🚨 Consequential on the v2 rail

| function | what it does with `draft_picks` | reachable? | v2 impact |
|---|---|---|---|
| `nuclear_reset_draft` | `DELETE FROM draft_picks` + flips status (not `draft_state`) | **Profile.tsx button, `/reset` route** | **False success; the league becomes unstartable.** Log and projection survive intact — `start_draft_v2` refuses the resulting state by name. ⚠️ not 🚨 (above) |
| `sync_roster_assignments_for_league` | builds `roster_assignments` **from** `draft_picks` | `rosters.ts:296`, `DraftService.ts:453` | **No rosters.** E142 |
| `complete_draft_and_sync` | completion sync reads `draft_picks` | `DraftService.ts:281` | **No rosters.** E142 |
| `process_roster_move` | free-agent add/drop; maintains a `draft_picks` ledger alongside | `FreeAgents.tsx`, `LeagueService.ts:1288`, `WaiverService.ts:803/823` | see below — **the interesting one** |

### `process_roster_move` — better and worse than expected

Reading it properly changed my answer. **Every piece of truth in this function reads
`roster_assignments`, not `draft_picks`:**

```
:34  drop validation      → roster_assignments
:57  roster-size count    → roster_assignments   (v_current_roster_size)
:78  goalie-limit count   → roster_assignments
:89  the add itself       → INSERT INTO roster_assignments
:121 returned roster_size → roster_assignments
```

The `draft_picks` touches (`:52`, `:106`, `:110`, `:112`, `:114`) are a **secondary ownership
ledger**, maintained alongside the real one.

**So the good news is real: this function is not built on the broken table.** The moment the E142
roster sync lands and `roster_assignments` is populated, free agency works correctly. No rewrite
needed.

**The bad news is a consequence of E142, not an independent bug — but it is sharp.** On a v2 league
today, `roster_assignments` is empty, therefore:

- `v_current_roster_size` = **0** → the roster-full check never fires → **unlimited adds**
- the goalie count = **0** → **the goalie cap never fires**
- any drop raises `'Player % is not on your roster'` → **you cannot drop anybody**

**Free agency on a v2 league today is: add without limit, drop nothing.** Not a threat before
Sept 29, and it is fixed by the same one change as E142.

### ⚠️ Privacy / compliance — real, low urgency

| function | v2 impact |
|---|---|
| `export_user_data` | Aggregates `draft_picks` into the export as `'draft_picks'`. **A v2 user's data export contains none of their picks.** |
| `delete_user_account` | `DELETE FROM draft_picks` misses `draft_picks_v2` — **but this one is mostly fine**, see below |

**`delete_user_account` — my hypothesis was wrong, and the truth is narrower.** I expected the
deletion to either fail on a foreign key or orphan the v2 picks. Neither happens: every FK on
`draft_picks_v2` is `ON DELETE CASCADE` (`league_id → leagues`, `team_id → teams`,
`source_event_id → draft_events`), so `DELETE FROM teams WHERE owner_id = …` and `DELETE FROM
leagues …` sweep the v2 picks away correctly. **Account deletion works.**

**The residue is one table.** `draft_events` has FKs only to `leagues` and to itself — none to
`teams` or `profiles`. So when a user deletes their account while a league they merely *played in*
survives, **their `pick` events remain in `draft_events`, each carrying their user UUID in
`picked_by_actor->>'id'`, indefinitely.** That is a genuine erasure gap. It is also a
five-line fix inside `delete_user_account` and belongs on the compliance backlog, not the
freeze list.

### ℹ️ Dormant ops tooling — no caller, no trigger

Verified twice over: **no app code calls these, and none is attached to any trigger.**

| function | if someone ran it on a v2 league |
|---|---|
| `check_data_integrity` | reports every v2 league as corrupt — *"Phantom player in daily rosters, not in draft_picks"*, `team_lineups: 21, draft_picks: 0` |
| `auto_fix_integrity_issues` | *"Fix missing players (restore from draft_picks)"* — would mis-repair from an empty table |
| `smart_restore_team_lineups` | rebuilds lineups `FROM draft_picks dp` — silent no-op |
| `detect_security_anomalies` | blind to v2 picks |
| `detect_and_recover_data_loss` | **dead code.** It is written as a trigger function (`RAISE WARNING '[AUTO_RECOVERY] Attempting automatic recovery from draft_picks…'`, references `OLD.team_id`) but **is not attached to any trigger.** It cannot fire. |

**One line for the ops runbook: do not run the integrity tools against a v2 league.** They are
correct code pointed at the wrong table and their output would be confidently, comprehensively
wrong.

### ✅ Irrelevant on the v2 rail — the v1 draft mechanics

`make_draft_pick`, `confirm_draft_pick`, `reserve_draft_pick`,
`cleanup_expired_draft_reservations`, `autopick_next_player`.

The v2 engine calls `submit_pick_v2` directly and never touches these. They read `draft_picks`
because they *are* v1. **Nothing to do.** Stating that plainly rather than padding the register.

### 🔑 The two that explain everything: auction v2 kept the ledger

| function | writes |
|---|---|
| `submit_pick_v2` (snake v2) | `draft_events` **only** |
| `close_nomination_v2` (auction v2) | `draft_events` **and `draft_picks` (v1)** |
| `auction_commissioner_override_v2` | `draft_events` **and `draft_picks` (v1)** |

`close_nomination_v2` says so in its own comment:

> *"compatibility with the existing `draft_picks` shape. UI"*

**This is not a v1-versus-v2 split. It is a split inside v2 itself.** The author of the auction
path kept writing the v1 ownership ledger on purpose, so every downstream v1 consumer would keep
working. The author of the snake path did not. Everything in this register follows from that one
divergence.

*(Auction is not in play for THE TWELVE — 112 of 114 staging leagues are snake, and auction has
never run. This matters as evidence about intent, not as a live data path.)*

---

## Register — application layer (6 files)

| file | what it does | v2 impact |
|---|---|---|
| `server/src/services/DraftService.ts` (~15 sites) | the entire v1 draft service — `getDraftPicks`, `undoLastPick`, `resetDraft`, `hardDeleteDraft`, `deleteAllDraftData` | **every method silently no-ops or returns `[]`** on a v2 league. `resetDraft`/`hardDeleteDraft` covered above; `undoLastPick` is E150 |
| `apps/web/src/services/DraftService.getDraftPicks` → **`Roster.tsx:1602`, `Standings.tsx:245`, `OtherTeam.tsx:326`** | post-draft stats & standings, computed from the pick list | **returns `[]` → every team shows record `0-0-0`, rank `-`, 0 points, 0 avg.** ⚠️ **NEW — see below** |
| `server/src/services/WaiverService.ts:564` | the AI-team waiver path, which deliberately *bypasses* `process_roster_move` | reads v1 picks, finds nothing. Season-time, not Aug 20 |
| `server/src/services/AuctionService.ts:92,186` | reads and inserts `draft_picks` | consistent with the auction-v2 convention above. Not in play |
| `apps/web/src/services/DemoLeagueService.ts` (6 sites) | the demo league, seeded and read entirely on v1 | **internally consistent — correct as written** ✅ |
| `apps/web/src/services/DraftService.ts:478,493` | Realtime `postgres_changes` on `draft_picks` | **correct as-is** ✅ — importers are all v1 surfaces; `DraftRoomV2` does not import this service |

### ⚠️ NEW: the roster sync alone does not fix the post-draft pages

This is the one finding that amends an existing recommendation, so it is worth being exact.

`PROPOSED_roster_sync_v2.sql` (E142) reads `draft_picks_v2` and writes `roster_assignments`. That
fixes **the roster list**. It does **not** fix these three pages, which take a different route to
the same question:

```
Roster.tsx / Standings.tsx / OtherTeam.tsx
  → DraftService.getDraftPicks()          (apps/web)
  → draftApi.getDraftPicks()              (HTTP)
  → server DraftService.getDraftPicks()
  → .from('draft_picks')                  ← v1. Returns [] on a v2 league.
```

`Roster.tsx:1604` then early-returns defaults on an empty list, and `Standings.tsx` feeds the empty
array to `calculateTeamStandings`.

**Honest severity: zero before Sept 29.** Pre-season, every team genuinely *is* 0-0-0 with rank `-`,
so the wrong answer and the right answer coincide. It becomes visible on opening night, when the
standings never move. **It does not affect Aug 20 and it does not affect the Sept 8 beta.**

But it does mean *"write the roster sync"* is one step of a fix, not the whole fix. The morning
brief has been amended to say so.

---

## The choke point, and why not to use it yet

Every v2 pick already flows through **one** place: `tg_draft_events_project_pick`, an
`AFTER INSERT` trigger on `draft_events`, firing synchronously in the same transaction as the
event. It is what fills `draft_picks_v2` today.

**Teaching that one trigger to also write `draft_picks` would repair most of this register at
once** — the roster sync, the completion sync, undo, reset, the standings pages, `process_roster_move`'s
ledger, the export, the integrity tools — with no change to the engine, the API, or the client.
And it would not be a hack: **it is precisely what `close_nomination_v2` already does inline.**

**Do not deploy it before Aug 20.** It is a change to the hot path of the one thing that must not
break, five days from freeze, in service of problems that do not bite on the night. And because
`draft_events` is complete, **the same repair is available on any later date, with a backfill, at
no cost for having waited.** That is the whole argument for patience here.

---

## Correction owed on E150 (undo): the remaining work is smaller than I said

E150 stated the undo fix needs *"an RPC that appends a `pick_undone` event **and** removes the
projection row atomically."* **The atomic half already exists.** Reading
`tg_draft_events_project_pick` in full:

```sql
ELSIF NEW.event_type = 'pick_undone' THEN
  -- Reserved for v2.1. The pick_undone event identifies the target
  -- pick by its source draft_events.id; remove that projection row.
  -- Spec §6.2: undo is rejected if any subsequent pick exists; the
  -- RPC enforces that. Here we just reflect the deletion.
  DELETE FROM public.draft_picks_v2
   WHERE source_event_id = (NEW.payload ->> 'target_event_id')::bigint;
```

The projection cleanup is **built, and atomic by construction** — same transaction as the event
insert. The trigger even names the spec section that governs the missing RPC.

**So the remaining work is: an RPC that appends the event with `target_event_id` and enforces
"no subsequent pick", then a route, then the button.** The engine replay was already done (E150);
the projection is already done (this entry). **Two of the three hard parts of undo are finished
and were finished before I looked.**

**None of this changes the Aug 20 answer** — there is still no undo on the night, and §E10 stands
unchanged. It changes the size of the job afterwards, and E150 overstated it.

---

## What this sweep did *not* find

Stating this deliberately, because the point of a sweep is the negative space:

- **No live trigger** fires any v1-reading function. The one that looked most dangerous
  (`detect_and_recover_data_loss`, an auto-recovery routine that restores from `draft_picks`) is
  **not attached to anything**.
- **No foreign-key hazard.** `draft_picks_v2` cascades correctly from leagues, teams and events.
- **Account deletion works.** So does the demo league, and so does the v1 Realtime subscription.
- **The v1 draft mechanics are simply irrelevant**, not broken — five functions I expected to
  matter, that do not.
- **The ignition path is over-defended, not under-defended.** `start_draft_v2` has an idempotency
  short-circuit under an advisory lock (a double-tap on START emits nothing), a `FOR UPDATE` row
  lock citing the E100 ignition race, and a five-step ordered guard taxonomy that catches the exact
  broken state the reset button produces. **The failure mode I invented had already been
  anticipated and named by whoever wrote it.** After four entries about capabilities v2 never
  inherited, the one irreversible action of the night turns out to be the most carefully guarded
  code in the product.

**This was the last big systematic sweep available.** It found one new commissioner-reachable
hazard (reset — ⚠️ after correction, not 🚨), one amendment to an existing plan (the post-draft
pages), two compliance items, one dead trigger, and a correction that makes previously-scoped work
smaller. **One of its own claims was wrong and was corrected within the hour — see E152.**

---

## ⚠️ Sequencing warning added 2026-08-12 (inbox E169)

The ops tooling above is listed as **dormant — no caller, no trigger**, and that is why it has been harmless. **Three unapplied migrations would change that:**

- `20260805200000_sl1_auto_fix_uuid_cast`
- `20260806100000_sl1b_auto_fix_unwrap_agg`
- `20260806200000_reenable_auto_fix_after_sl1b_v2` ← **this one re-enables the cron job**

They are a coherent repair-and-reactivate stream and none of them addresses the v1/v2 split. **Applying the third would schedule `auto_fix_integrity_issues` to run unattended against 112 v2 leagues, conclude every one is corrupt (because `check_data_integrity` reads `draft_picks`), and attempt to "restore from draft_picks" — a table holding 12 rows.**

**Make these two functions v2-aware BEFORE applying the reactivation.** An automated repair loop pointed at the wrong table is worse than no repair loop.
