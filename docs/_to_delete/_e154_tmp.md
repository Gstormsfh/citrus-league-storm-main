
## Entry 154 — Audited `submit_pick_v2` at guard level, the way E152 audited `start_draft_v2`. **The human-vs-autopick race at clock expiry is defended at four layers and already has human-readable copy. This is a clean result.** One real addendum: the completion path's documented reason for leaving `draft_state` stale rests on a premise that has since become false.

**Why I looked.** `submit_pick_v2` runs **252 times** on Aug 20 and had never been read at guard level. The specific question: a manager clicks Draft at the same moment the engine fires autopick. Two writers, one pick number. Twelve people running a 60-second clock down will produce that collision.

---

### The race: four layers, all deliberate

| layer | mechanism |
|---|---|
| **1. Preflight** | `IF p_pick_number <> v_pick_count + 1 → pick_out_of_order`. The late caller's number is already stale. |
| **2. Row lock** | The `draft_event_counter` UPDATE takes the `leagues` row lock and **serializes both submits.** Carries an explicit F24/D3 *placement invariant* comment forbidding a refactor from moving the completion branch above it, with the race it would open spelled out. |
| **3. Unique constraint** | The projection trigger inserts into `draft_picks_v2`, whose `unique (league_id, pick_number)` enforces invariant **I3** — the loser's whole transaction rolls back. Combined with `idempotency_key` uniqueness (**I4**) on the log, at-most-once is guaranteed at the projection layer even if 1 and 2 were both bypassed. |
| **4. The loser gets sensible copy** | `pick_out_of_order` is deliberately translated to **`clock_expired`** in `submitPick.ts:147`, with a comment saying exactly why: *"the race case surfaces as pick_out_of_order because autopick…"*. Toasts already exist: *"Someone else picked just before you. Your pick was reverted."* / *"It's not your turn anymore"* / *"Someone already took that player."* |

**And the race is pre-empted on the way in**: `PlayerPool.tsx:42` and `OnClockActionBar.tsx:65` both carry double-submit guards whose comments name `pick_out_of_order` as the thing they exist to prevent. The engine classifies it too (`LobbyManager:2443`).

**So a manager who clicks Draft as the clock hits zero gets "Someone else picked just before you. Your pick was reverted." — not an error page, not a duplicate pick, not a corrupted board.** Somebody walked this exact scenario before I did.

**No experiment run.** A rig test could only confirm what four layers of source and the copy already state, and it would mean racing a live engine to build the evidence. Recording that as a deliberate stop, not an omission.

**Other guards worth noting**, because they show the same care: `not_on_clock` compares against the *structural* `draft_order` team array rather than a convenience field; `v_total_picks` is a **SUM over live `draft_order` rows** rather than `league_size`, with an architect D1 ruling saying never to trust the convenience field when structural truth is one SUM away; **Amendment 3** filters `deleted_at IS NULL` in *both* the on-clock read and the completion SUM so *"the draft cannot disagree with itself about its own shape"*; and a **D2 defence-in-depth** guard exists solely to stop a defect elsewhere from flipping pick #1 to completed.

**Verdict: `submit_pick_v2` is as well-defended as `start_draft_v2` (E152). The two RPCs that carry the entire night are the best code in this product.** After a week of cataloguing what the v2 rail never inherited, that deserves saying plainly.

---

### The addendum: a correct decision whose premise expired

At the completion branch, `submit_pick_v2` leaves `draft_state` untouched **on purpose**, and says why:

> *"`draft_state` is DELIBERATELY UNTOUCHED here (Amendment 2 evidence-closed 2026-08-05: architect prod query returned `ERROR: column "draft_state" does not exist` — column is v2-stack-only, **no v2 consumer reads `draft_state` post-completion**, deliberately not extending semantics here)."*

**The first inference is right.** The prod query failed because production has no v2 schema at all — independently confirmed. So `draft_state` *is* v2-stack-only.

**The second does not follow, and is now false.** "This column doesn't exist in production" does not establish "nothing reads it after completion." **E153 found three readers**: `snapshotService.buildSnapshot` (reads *only* `draft_state`, maps `'active' → 'in_progress'`), the `/api/drafts/:draftId/snapshot` endpoint, and the events endpoint's `immutable` cache gate.

**This is not carelessness — it is a documented decision that rotted.** It was defensible on 2026-08-05 and stopped being defensible when the snapshot service started reading the column. **That makes it a better-specified fix than §5 framed it**: not "someone forgot a column," but "Amendment 2's stated premise needs re-checking, and it no longer holds." Whoever picks up the migration should read that comment first — it tells them precisely what evidence to re-run.

**Filed as a strengthening of `DESIGN_DRAFT_STATUS_SPLIT.md` §5/§5a. Severity unchanged. Nothing here affects Aug 20.**

---

**This cycle was mostly a clean bill of health, and I am reporting it as one rather than inflating it.** The thing I went looking for — an unexercised race on the night's hottest path — turned out to be anticipated, defended four ways, and already written into the toast copy. **The only new material is one stale justification comment.**

**No code changed. Both databases read-only for this entry.**
