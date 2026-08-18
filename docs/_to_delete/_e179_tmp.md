
## Entry 179 — **Exercised the roster-sync function's plpgsql wrapper too, via a `DO` block — no `CREATE FUNCTION` needed.** Both branches fire correctly, `GET DIAGNOSTICS` counts are right, the return shape is right, the exception handler is never hit. **E178's "that needs Garrett's apply" was another false constraint.**

**Why.** E178 verified the SQL statements but listed the wrapper — `DECLARE`/`BEGIN`, branch selection, `GET DIAGNOSTICS`, the returned jsonb, the mismatch warning, the exception handler — as unproven *"because those need the function to exist, which is Garrett's."*

**That was wrong for the third time tonight.** A `DO $$ … $$` block is an anonymous code block: **not DDL, not a migration, not `CREATE FUNCTION`.** The standing rules forbid all three; they do not forbid running the body. **The E176 lesson has now paid out four times — E176, E177, E178 and here — and each time the false constraint felt identical to a real one.**

---

### Run 1 — initial-sync branch

Rig `ada00025-…-01`: 2 picks, 0 roster rows. Full function body transcribed into a `DO` block.

**Result: 2 roster rows created.** Which means, in one pass:

- `v_total_picks = 2` → the zero-picks early return correctly **not** taken
- `v_existing_count = 0` → **initial-sync branch selected**
- the `ON CONFLICT … DO UPDATE` insert succeeded
- `v_inserted_count = v_total_picks`, so the **mismatch `RAISE WARNING` did not fire**
- **the exception handler was never reached** — it would have caught and swallowed, leaving zero rows

### Run 2 — gap-fill branch, with the counts surfaced

Same block, second run. Because the gap-fill branch legitimately writes **zero** rows, I could raise its computed values to read them without losing anything:

```
PROBE_RESULT mode=gap_fill players_synced=0 existing_count=2 total_picks=2
```

**Every field is correct.** Branch selection flipped on `v_existing_count > 0`; `GET DIAGNOSTICS` reported **0** because everything was already assigned; both counts match reality. **These are the exact values that populate the returned jsonb**, so its shape and contents are verified without the function existing.

**Final state: 2 rows, 2 distinct players, 2 picks.** Idempotent across both branches and two runs.

---

### One thing this clarified about the mismatch warning

`IF v_inserted_count <> v_total_picks THEN RAISE WARNING 'V2 SYNC MISMATCH…'` looked like defensive boilerplate. **It isn't — and E162 explains why.**

`draft_picks_v2`'s primary key is `(league_id, pick_number)`. **`(league_id, player_id)` is only an index, not unique** (E162), so the projection *can* hold the same player twice. If that ever happened, `ON CONFLICT (league_id, player_id) DO UPDATE` would collapse the duplicates and `ROW_COUNT` would come back **less than** the pick count — **and this warning is the only thing anywhere that would surface it.**

**So the warning is the detector for the exact gap E162 recommended closing with a unique constraint.** Worth keeping even after that constraint lands; worth knowing about before it does.

---

### What is still not proven — a genuinely short list now

- **The `CREATE OR REPLACE FUNCTION` statement itself**, and with it `SECURITY DEFINER` and `SET search_path = public`. That is DDL and it is Garrett's. **A `DO` block runs as the caller, so the definer semantics are untested.**
- **The backfill `DO` block**, still dry-run reviewed only.
- **Scale** — 2 picks, not 144.

**Everything else in the file has now been executed:** the predicate (E167), both INSERT statements against real v2 picks (E178), and the full control flow with its counts and return shape (this entry).

**Item #1 has gone from "written and reviewed" to "everything but the DDL has been run."** That is as far as I can take it without crossing a rule that exists for good reason.

---

### The pattern I should have caught sooner

**Four times tonight I wrote "only Garrett can verify this," and four times I could verify most of it.** E176 found the RPCs were runnable; E177 found the engine's reaction was observable without gcloud; E178 found the INSERTs were runnable without the function; this entry found the wrapper was runnable without `CREATE FUNCTION`.

**The failure mode is inheriting the shape of a constraint instead of its boundary.** "Don't apply the migration" is a real rule with a narrow edge, and I kept treating it as "don't touch anything migration-shaped." **Each time, the check took under five minutes and the answer was yes.**

**No function created. No migration applied. No DDL. Writes confined to disposable rigs. Prod untouched. `ada00015` untouched.**
