
## Entry 168 — **The `draft_state` fix I recommended in E153 was already written on Aug 8** — migration, rehearsal gate, rollback capture, apply script, post-apply census, and a separate backfill deliberately dated for after the draft. **Neither is applied.** E153's "discovery" was a rediscovery of an enumeration someone had already done better.

**Why I looked.** E167 closed the loop on documents I had written. `SUNDAY_EXECUTION_BLOCKS.md` is one I had never opened — §6c of the draft-night runbook delegates **rollback** to it, so it is what Garrett runs if Aug 20 goes badly. Auditing everything except the rollback procedure would have been an odd place to stop.

**The rollback blocks are in better shape than anything else I have audited tonight.** Group A captures the pin *first*, reverts metadata *before* reset, and carries an explicit doctrine — *"do NOT roll back to `8b7b43f6-draft`; if `0ecbe605-draft` is itself the problem, deploy a new build from HEAD, do not descend further."* It also already caught its own real defect: **DIVERGENCE 3** found that the capture command produced an *aligned* psql table with borders and a `(1 row)` footer, which the rollback's `psql -f` would have choked on — *"a capture that cannot be re-applied is not a capture."* Fixed with `-At` before I ever got there. **Nothing to correct in Group A or C.**

---

### What Group B turned out to be

**`GROUP B — N-2 staging migration (submit_pick_v2 clears draft_state)`.**

That is the exact fix E153 recommended and E154 argued for. It exists:

| artifact | state |
|---|---|
| `supabase/migrations/20260808120000_v2_draft_completion_clears_draft_state.sql` (33 KB) | **written 2026-08-08 — NOT APPLIED** |
| `supabase/migrations/20260821000000_v1_completed_leagues_backfill_draft_state.sql` | **written — NOT APPLIED** (numbered for Aug 21 on purpose, so it sorts after the draft) |
| `scripts/proof/apply-n2-draft-state.local.sql` | exists — the rehearsed apply with a capture-hash pin and STEP-3 marker verification |
| `supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql` | exists — the pre-N-2 body, for `psql -f` rollback |
| B-3 post-apply census | written: counts `still_incoherent` vs `coherent_completed` |

Confirmed against `schema_migrations`: **both migrations absent, the surrounding ones present.**

The backfill's core statement is precisely what §5a asked for:

```sql
UPDATE public.leagues SET draft_state = 'completed'
 WHERE draft_status = 'completed' AND draft_state IS DISTINCT FROM 'completed';
```

### The part I have to own

The N-2 migration's header contains this:

> *"Architect Q3 ruling: **must enumerate EVERY reader of `draft_state`**"* — followed by the server-side enumeration, including the snapshot service's mapping to `LobbyStatus` and the sync route's verbatim passthrough `draft_state: league.draft_state ?? 'not_started'`.

**Those are the readers I "found" in E153 and filed as an addendum to §5a.** Someone enumerated them on Aug 8, under a ruling that required exactly that enumeration, and wrote the fix. **E153 rediscovered a solved problem and presented it as new.** E154's observation that Amendment 2's premise had expired is in that header too, as options (A) and (B).

**Why I missed it:** I searched the codebase for *defects* and never searched `supabase/migrations/` for *pending fixes*. Every sweep tonight asked "what is broken?" and none asked "what is already written and waiting?"

**Rule, added to the list: before proposing a fix, grep the migrations directory for one that already exists.** Unapplied migrations are invisible to every method I used — they are not in the live schema, not in the running code, and not in any document I was reading.

---

### What Garrett should actually do

**Not before Aug 20 — and the reasoning is the same one I have applied all night.** N-2 is a `CREATE OR REPLACE` on the **completion path of `submit_pick_v2`**, the RPC that runs 252 times on the night. Applying a 33 KB migration to it five days from freeze, to fix something E153/E161 showed is **inert** — boot-scan filters on `draft_status`, and the arm site guards on `pauseState` and a NULL deadline — is a bad trade.

**The runbook already handles both states.** §5a says *"`draft_state = 'completed'` (post-N-2 deploy; pre-N-2 it stays `'active'` — cosmetic but log it)."* It was written by someone who knew N-2 was pending. **It is correct as it stands whether or not Garrett applies this.**

**After Aug 20**, Group B is a much smaller job than E153 implied: **not "write a migration" but "run the block that is already rehearsed."** Then the backfill, which is already dated to follow.

**One thing to check first, given E167.** N-2 is SQL that was written and never executed — the same class that produced ten defects tonight. **Its B-1 rehearsal gate exists precisely for that**, so it is better protected than most. But when it is applied, use B-3's census query as the proof, not the migration exiting cleanly.

---

**No migration applied. No DDL. Both databases read-only for this entry.**
