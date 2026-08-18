
## Entry 180 — Ran the E142 backfill's dry run, which the file itself asks for and nobody had done. **109 leagues, 1,718 roster rows, and zero real user leagues.** The DO block's predicate matches the dry run exactly — the classic backfill defect is absent.

**Why.** `PROPOSED_roster_sync_v2.sql` says, in bold, *"REVIEW THE DRY RUN FIRST. Do not run the DO block until the counts look right."* **It was written on Aug 12 and never executed.** It is a read-only `SELECT`. This is the last unexecuted piece of item #1.

---

### The blast radius, measured

```
leagues selected:            109
roster rows it would create: 1,718
smallest league:               2 picks
largest league:              252 picks
```

**The range is the useful part.** The backfill spans everything from a 2-pick probe rig to the 252-pick soak, so it exercises real scale rather than a uniform population.

### The predicate check — the defect that wasn't there

The classic way a backfill goes wrong is the dry run and the apply selecting **different sets** — you review one population and mutate another. Compared line for line:

```sql
-- dry run                                    -- DO block
WHERE l.draft_status = 'completed'            WHERE l.draft_status = 'completed'
  AND EXISTS (… draft_picks_v2 p …)             AND EXISTS (… draft_picks_v2 p …)
  AND NOT EXISTS (… roster_assignments r …)     AND NOT EXISTS (… roster_assignments ra …)
```

**Identical apart from an alias.** Whoever wrote it kept them in sync. Worth confirming rather than assuming, because it is exactly the mistake that turns a reviewed backfill into an unreviewed one.

### Whose data is it — and a correction to my own first answer

My first classification said **104 rig leagues, 5 non-rig**, which would have meant the backfill touched five real leagues. **Opening those five shows all of them are rigs too:**

| league | what it is |
|---|---|
| `ada00014` | *"RESIDENT boot-scan-resume proof league"* |
| `ada00013` | *"S2d RESIDENT IN-PROGRESS DRAFT (boot-scan resume)"* |
| `ada00012` | *"S2c RESTART-MID-DRAFT (5-min kill window)"* |
| `ada00011` | *"S2b RESTART-MID-DRAFT (long clock, engine kill)"* |
| `993c9219…` | *"Staging League"* — the April 29 fixture |

**My rig-detection regex matched on `ARCHITECT|RIG|LOAD|…` and missed `S2b`/`S2c`/`S2d`/`RESIDENT`/`Staging League`.** So the honest number is **109 leagues, all of them test data, zero real user leagues.**

**That is the third time tonight a rig-detection heuristic has undercounted** (E157's `teamsCount`, E169's migration-timestamp matching, now this). The reliable move is to *look at the rows*, not to trust a pattern — and the pattern erred in the direction that would have alarmed Garrett rather than reassured him, which is at least the safer direction.

**Practical consequence: on staging the backfill is risk-free** — it cannot touch a real user's league because there are none in the selected set. **Production is unaffected regardless**, since it has no v2 schema at all (verified earlier tonight).

---

### Where item #1 now stands

| piece | status |
|---|---|
| the corrected `::text` predicate | **executed** (E167) — returns 252 on the soak league |
| both INSERT branches | **executed** against real v2 picks (E178) — right rows, right types, idempotent |
| the plpgsql control flow, counts, return shape | **executed** in a `DO` block (E179) |
| **the backfill dry run** | **executed — 109 leagues, 1,718 rows, all test data** (this entry) |
| the backfill apply | dry-run reviewed only — **deliberately not run** |
| `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, `search_path` | **Garrett's** — DDL |

**Every part of the file except the DDL and the apply has now been executed.** The counts are recorded in the file itself so Garrett sees a measured number where the document previously said *"review the dry run first"* and left him to produce it at 6am.

**I did not run the apply.** It is a mutation across 109 leagues and it is his call, not mine — and unlike the dry run, nothing about it is reversible by re-reading.

**No function created. No migration applied. No DDL. Read-only for this entry apart from the file edit. Prod untouched. `ada00015` untouched.**
