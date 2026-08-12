
## Entry 164 — Audited the one document Garrett will actually **execute**. Four staleness defects found and fixed in place, including a closing line that flatly contradicted the sheet's own Deploy 3. **A drifted deploy sheet is worse than no deploy sheet.**

**Why this, now.** E162 closed the systematic audit; E163 verified the tree is green. What remained un-checked was the artifact that turns all of it into action. `DEPLOY_2026-08-12.md` was written early in the night and then had a third deploy appended, while six later entries (E155, E156, E158, E159, E162, E163) changed what it should say. **Every other document tonight is read; this one is run.**

---

### What was wrong

**1. It still described itself as a two-deploy sheet.** Deploy 3 (the API, E145) was appended without updating the framing, so the header said *"Two deploys, in this order"*, Step 0 was titled *"BEFORE YOU RUN EITHER DEPLOY"*, and its body said *"Neither deploy below…"* and *"Both deploys below…"*. Deploy 1's heading said *"first of the two"*. **A reader following the sheet top-to-bottom would have been told twice that the third deploy doesn't exist before reaching it.**

**2. The closing line contradicted Deploy 3 outright:**

> *"Nothing here touches production, the database, or `citrus-api`. Two surfaces, two commands each."*

**Deploy 3 is a `gcloud run deploy citrus-api`.** The line predated it and was never revisited. Now:

> *"Nothing here touches production or the database. Three surfaces: the engine VM, Firebase hosting, and — only if you do the optional third — `citrus-api`. The roster migration (Step 0) is the one thing that would touch the database, and it is deliberately not in this sheet."*

**3. The docs manifest was missing four files** created after it was written — `V1_TABLE_CONSUMERS.md`, `PROPOSED_roster_sync_v2.sql`, `NIGHT_ARC_2026-08-11.md`, and the runbook ordering. **A missing file in a commit manifest is how work silently doesn't ship.** Added, with a note that the `.sql` is a proposal — committing it is fine, running it is a separate decision.

**4. Nothing pointed at the post-apply verification.** Step 0 sends him to `PROPOSED_roster_sync_v2.sql` for the roster fix but never said to check the result. Added as step 4 of that list, carrying E155's finding: one migration on staging is recorded as applied while its live `pg_proc` body is not what the migration defines. **One data point on a dead function — not evidence of a broken pipeline — but this is the fix everything else waits on, and checking costs one query.**

### What was added

**A `✅ PRE-FLIGHT` section**, above Deploy 1, carrying the two things I need from him that I cannot do myself:

- **E163's verified-green status** — 70/70 across all seven test files, `server tsc` clean, against the exact tree these deploys ship, with the one flake named so red doesn't get re-litigated.
- **The §E12 and §E13 dry-runs** — `draft_extend`, `draft_pause`, `draft_resume`, with the actual SQL. These are the only two levers he has on the night, they are unreachable from the UI, and **their first execution should not be during the draft.** The section says plainly that pause doesn't show in the room and points at §E13 for the sentence to say out loud.

---

### One honest thing the sheet already got right, worth preserving

Deploy 3's block carries a caveat I wrote when I couldn't verify it:

> *"If your usual API deploy builds and pushes an image first rather than `--source`, use that — I don't have a verified API deploy block from tonight the way I do for the engine, and I'd rather say so than hand you a command I haven't seen work."*

**That stays.** The engine block is derived from a deploy that has actually run; the API block is not, and the sheet should keep saying so.

### Housekeeping

Cleared a stray `_ib_work.md` from `docs/` — a temp file from this cycle's inbox append whose cleanup didn't fire. **`docs/` is clean of temp files**; everything retired tonight is in `docs/_to_delete/` for Garrett to remove (device-side deletes aren't available to me).

---

**No code changed. Four in-place documentation fixes. Both databases untouched for this entry.**
