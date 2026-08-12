
## Entry 155 — Chased the autopick safety net after E153 showed `draft_deadline_sweep` filters on a column that's stale on completed leagues. **The DB safety net was deliberately retired into the engine, and the engine half is verified running.** Two concrete leftovers: four completed leagues are armed to be swept if anyone ever restores the cron, and the live sweep function does not match the migration that last defined it.

**Why I looked.** `draft_deadline_sweep`'s predicate opens with `WHERE l.draft_state = 'active'`, and E153 established that completed leagues keep `draft_state = 'active'` forever. So: **can the sweep fire autopicks on a finished draft?**

**Read the function rather than reasoning about it** — E152's lesson, applied deliberately. Line 61 is the shield:

```sql
WHERE l.draft_state = 'active'
  AND l.pick_deadline IS NOT NULL          -- ← the shield
  AND l.pick_deadline < v_now - interval '2 seconds'
```

And `submit_pick_v2`'s completion branch sets `pick_deadline = NULL`, with a comment saying why in as many words: *"Completed leagues read honestly — no deadline, because nobody is on the clock. Kills the stale-deadline artifact class at the root (not just symptoms)."* **Amendment 1's author reasoned about this exact interaction.**

---

### But the data doesn't fully agree — four leagues are armed

| draft_status | draft_state | leagues | with a non-NULL `pick_deadline` | **match every sweep clause** |
|---|---|---|---|---|
| completed | active | 111 | **4** | **4** |
| in_progress | active | 1 | 1 | 0 (deadline in the future) |

Four completed leagues carry a stale deadline, **oldest 2026-08-07 16:31Z — five days old.** They satisfy every clause: stale `active` state, non-NULL deadline, long past, and no `pick`/`autopick_failed` event exists for the next slot (there is no next slot). Almost certainly leagues completed before Amendment 1 landed.

**They are inert for exactly one reason: nothing calls the sweep.**

---

### The sweep has never run, and that is on purpose

- **`cron.job` holds one job**: `log_security_drift`, daily at 05:30. **No `draft-deadline-sweep`.**
- **`draft_metrics` is completely empty** — zero rows, of any metric, since Phase 3 landed on 2026-04-26. The sweep writes a `safety_net_hit` row per affected league per run. **It has not fired once.**
- **The retirement is documented in the migration itself** (`20260511010000`, chunk 11g.8): *"The metric write is now meaningless under the persistent-engine model (engine handles its own deadlines via setTimeout — no 'missed deadline' case for the safety net to catch). **Chunk 11g.9 removes the function entirely along with its pg_cron job.**"*

**So this is not a missing safety net. It is a safety net that moved.**

**And the replacement is real, and I verified it is actually started** rather than assuming it:

`server/src/draft/index.ts:653` → `lobbyRegistry.startClockLivenessScanner()`, immediately after the idle-eviction timer, with the role stated in the comment: *"Every 5s the scanner iterates in-registry lobbies and hands any stalled clocks to the lobby's `attemptClockRecovery`. **Backstops the guard-side re-arm in `LobbyManager.handleClockExpired` for any stall cause the guard never sees.**"*

The scanner is careful work — 5s scan / 10s stall (F20 Piece 3 ruling), a **top-level try/catch so a scan error can never kill the interval**, a per-lobby try/catch so one bad lobby can't shield the rest, a strike map capped at 3 with an alertable ERROR at the ceiling, and strike-map pruning each pass to avoid F5's leak family. Its own comment names the failure it exists to prevent: *"a liveness watchdog that dies silently on the first malformed lobby is the same defect wearing the fix's clothes."*

**The Aug 20 chain, stated plainly:** `handleClockExpired` guard → clock-liveness scanner → nothing. There is no database-level backstop, by design, and the engine-side one is live and well-built. Combined with boot-scan resume (which rig `ada00015-…-01` is armed to prove on your next engine restart), the clock has two independent recovery paths and no third. **That is a fine place to be; it is just worth knowing there is no DB net underneath.**

---

### Item 1 — a trap laid for a future maintainer

Someone will eventually notice there is no `draft-deadline-sweep` cron job and, reasonably, restore it. The migration that creates it is still in the tree, and it schedules every 10 seconds.

**The moment that cron runs, those four completed leagues start enqueuing autopicks for finished drafts — six times a minute, forever**, each run writing a `safety_net_hit` metric row and a pgmq message. Nothing consumes the queue today (no `pgmq` reader exists anywhere in `server/src`), so the visible damage would be metric noise and queue growth rather than corrupt drafts. But it would look exactly like a live incident to whoever found it.

**Two-line defusal, and I am proposing rather than doing it** — these are not my rig leagues:

```sql
-- dry run first
SELECT id, name, pick_deadline FROM leagues
 WHERE draft_status = 'completed' AND pick_deadline IS NOT NULL;
-- then
UPDATE leagues SET pick_deadline = NULL
 WHERE draft_status = 'completed' AND pick_deadline IS NOT NULL;
```

This is what Amendment 1 already does going forward; it just never backfilled. **Better still, per the migration's own plan: finish chunk 11g.9 and delete the function and its scheduling migration outright.** Dead code that still looks live is how someone loses an afternoon.

### Item 2 — the live function does not match its last migration

`20260511010000` is recorded in `schema_migrations`, and its section 4 replaces `draft_deadline_sweep` **without** the pgmq emission. **The live function body on staging still contains `PERFORM pgmq.send('draft_deadlines', …)`.** Only two migrations ever define this function, and the one without pgmq is the later of the two.

**I do not know the cause and am not going to guess** — a partial apply, a snapshot restore, or a replay out of order would all produce this. What is certain is that **a migration recorded as applied is not reflected in the live function.**

**Why this is worth your attention specifically now:** the roster-sync fix (E142) is a migration you are about to apply. This is one data point, on a function nobody calls, so it is not evidence of a broken pipeline — but it is a reason to **verify the roster sync's function body from `pg_proc` after applying it**, rather than trusting that the migration ran. One query, and it closes the question:

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'sync_roster_assignments_v2';
```

---

**Net for Aug 20: nothing to do.** The safety net moved into the engine on purpose, the engine half is running, and the four armed leagues cannot fire because the thing that would fire them does not run. **The two items above are both post-draft cleanup.**

**No code changed. No writes to staging. Both databases read-only for this entry.**
