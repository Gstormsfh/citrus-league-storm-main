
## Entry 178 — **Executed the corrected E142 roster-sync body against real v2 picks. It works: correct rows, correct types, correct teams, idempotent on re-run.** Item #1 on Garrett's list moves from *written and reviewed* to *its SQL has been run and produces the right answer*.

**Why.** E167 found the original compared `text = integer` and would have applied cleanly then failed on first real call. It verified the **corrected predicate** returns 252 — but never ran the **INSERT**, so the `integer → text` assignment into `roster_assignments.player_id` was still unproven. **On the most important fix on the board, that gap was not acceptable to leave overnight.**

**Within the standing rules:** no `CREATE FUNCTION`, no migration, no `apply_migration`. I ran the function's **statement bodies** directly against a retired disposable rig — an ordinary INSERT on my own test data.

---

### The test bed

The three probe rigs from E176/E177 each reproduce the E142 symptom in miniature: **2 picks in `draft_picks_v2`, 0 rows in `roster_assignments`.** A completed draft with no roster, at two-team scale.

### Initial-sync branch — verbatim from the corrected proposal

```sql
INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
SELECT dp.league_id, dp.team_id, dp.player_id::text, COALESCE(dp.picked_at, NOW())
FROM public.draft_picks_v2 dp
WHERE dp.league_id = '…'
ON CONFLICT (league_id, player_id) DO UPDATE SET …;
```

**Result: 2 rows written.** And the rows are right in every dimension I could check:

| stored `player_id` | type | source | source type | match | team | player |
|---|---|---|---|---|---|---|
| `8477492` | **text** | `8477492` | **integer** | ✅ | Probe A1 | Nathan MacKinnon |
| `8478402` | **text** | `8478402` | **integer** | ✅ | Probe A2 | Connor McDavid |

**The `integer → text` coercion works**, the values survive it intact, **team attribution follows pick order**, and the rows join cleanly back to `player_directory` — so the names come out, which is what `/roster` needs.

### Gap-fill branch — the one that used to error

This is the branch E167 caught: `ra.player_id = dp.player_id` with a text column against an integer one, which raised `operator does not exist: text = integer`. Re-run with the `::text` fix, against a league whose roster is now populated:

**Result: runs clean, inserts 0.** It correctly recognises both players are already assigned.

**Final state: 2 roster rows, 2 distinct players.** No duplicates, no double-insert. **The function is idempotent, which is what its own comment claims and what the backfill depends on.**

---

### What this proves, and precisely what it does not

**Proven by execution:** the SQL logic of both branches — the `::text` cast, the `ON CONFLICT` target, the `NOT EXISTS` predicate, team and timestamp mapping, and idempotency on re-run. **The thing E167 found broken is now demonstrably fixed rather than fixed-and-hoped.**

**Not proven, and I am not going to pretend otherwise:**

- **The plpgsql wrapper** — `DECLARE`/`BEGIN`, the `GET DIAGNOSTICS` row counts, the returned `jsonb` shape, the `RAISE WARNING` mismatch path and the exception handler. Those need the function to exist, which needs the migration, which is Garrett's.
- **Scale** — two picks, not 144 or 252. The logic is scale-independent, but I ran it small.
- **The backfill `DO` block** — still only dry-run reviewed.

**So the honest upgrade is: the body is executed-verified; the wrapper and the backfill are still read-verified.** That is a real improvement on the most consequential item on the board, and it is not the same as "the migration is proven."

**E155's post-apply check still matters and is still not sufficient on its own** — it confirms the function body reads `draft_picks_v2`, which E167 showed can be true of a function that then fails at runtime. **The count query is the proof: `roster_assignments` must equal `league_size × draft_rounds`.**

---

### Recorded in the file

`PROPOSED_roster_sync_v2.sql`'s TYPE NOTE now says the corrected statements were **executed** against real v2 picks, with the result — so whoever applies it can see that the specific defect E167 found has been re-tested rather than merely edited.

**No function created. No migration applied. No DDL. Writes confined to a disposable rig I made. Prod untouched. `ada00015` untouched — `in_progress`, 0 picks, 1 event.**
