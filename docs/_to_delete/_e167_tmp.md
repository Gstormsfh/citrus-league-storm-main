
## Entry 167 — **The fix for E142 was broken, by the same disease as E142.** `PROPOSED_roster_sync_v2.sql` compared `text = integer` and would have errored the first time Garrett ran it. Found by executing it against the live schema instead of trusting it. **Corrected and verified: the fixed predicate returns exactly 252 on the soak league.**

**Why I looked here.** E164–E166 found nine defects across the deploy sheet and runbook, every one in SQL that was **written but never executed**. `PROPOSED_roster_sync_v2.sql` is the same class of artifact — hand-written SQL, never run — and it is **item #1 on Garrett's list**, the thing every other fix waits on. Auditing everything except the highest-stakes file would have been a strange place to stop.

---

### The defect

```sql
-- gap-fill branch, as written:
AND NOT EXISTS (
  SELECT 1 FROM public.roster_assignments ra
  WHERE ra.league_id = dp.league_id
    AND ra.player_id = dp.player_id      -- ← text = integer
)
```

Executed against staging, verbatim:

```
ERROR: 42883: operator does not exist: text = integer
HINT:  No operator matches the given name and argument types.
```

**Not reasoned about — run.**

### Why it exists, which is the part worth keeping

The three `player_id` columns do not agree:

| column | type |
|---|---|
| `draft_picks.player_id` (v1) | **text** |
| `draft_picks_v2.player_id` (v2) | **integer** |
| `roster_assignments.player_id` | **text** |

The v1 function this file mirrors does `ra.player_id = dp.player_id` — **text = text, entirely correct there.** This file copied that line unchanged. Its own header comment says so proudly:

> *"Everything else — gap-fill vs initial-sync, the ON CONFLICT, the mismatch warning, the JSONB result shape, the exception wrapper — is preserved **verbatim** so callers and logs are interchangeable between the two."*

**The verbatim preservation is what introduced the bug.** This is precisely the disease E142 documents — a v1 assumption carried into v2 unchanged — reproduced inside the patch for E142. I wrote that patch, and I wrote the sentence praising the copying.

### Why nothing would have caught it before it mattered

**`CREATE OR REPLACE FUNCTION` would have succeeded.** plpgsql does not plan the statements in a function body at creation time — it plans them on first execution. So:

1. The migration applies cleanly. ✅
2. The function exists in `pg_proc` and reads correctly. ✅
3. **It fails the first time it is called on a real league**, on the gap-fill branch.

**This defeats E155's post-apply check as I wrote it** — "confirm the live function body reads `draft_picks_v2`" would have passed. The body *does* read `draft_picks_v2`. The verification I added a few hours ago was necessary and not sufficient, and I have said so in the file.

### The fix, verified

`dp.player_id::text` in the comparison, and made explicit in both `INSERT ... SELECT` lists rather than relying on Postgres's I/O assignment coercion. Then executed the corrected predicate against the 252-pick soak league:

```
would_insert: 252
```

**Exactly right** — 12 teams × 21 rounds, no rows already present, nothing double-counted.

A prominent **TYPE NOTE** now sits at the top of the file with the three column types, the live error text, why it wouldn't fail at migration time, and the note that the fix was verified rather than assumed.

---

### What else I checked in the file, and what is sound

- **`ON CONFLICT (league_id, player_id)`** — valid; `unique_player_per_league UNIQUE (league_id, player_id)` exists. Both branches are safe.
- **`acquired_at`, `created_at`, `updated_at`** all default to `now()`, so omitting them is fine.
- **The backfill's dry-run and `DO` block** compare `uuid = uuid` only — no type hazard. Their scoping (`draft_status = 'completed'` AND has v2 picks AND has no roster rows) selects exactly what it claims.
- **`current_rosters` is a view over `roster_assignments`** — confirmed earlier via `relkind`; writing the table is the whole job.
- **The sibling-not-edit decision stands.** Production's v1 function is untouched, and given that this file had a live type error in it, not editing the function that protects production's 46 drafted teams looks better now than when I chose it.

---

### The lesson, which is not a new one

E152: *never claim what a function does without reading that function.* **E167 extends it: never ship SQL you have not executed.** Reading is not enough — I read this file when I wrote it, re-read it when I added the verification block, and cited it in six entries and two documents. **It took running one predicate to find the error.**

Every defect in this arc — nine in the documents, one here — was invisible to reading and obvious to execution. **The staging database was available the entire time.**

**No migration applied. No DDL. The corrected file remains a proposal — Garrett's review, Garrett's deploy. Both databases read-only for this entry.**
