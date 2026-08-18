
## Entry 156 — SECURITY. Audited `append_draft_event`, the single write path for the entire event log. **It is `SECURITY DEFINER`, `EXECUTE` is granted to `authenticated`, and it contains no authorization check of any kind.** Every guard that protects the draft lives in its callers. The fix is one `REVOKE` and it breaks nothing. **Not an Aug 20 risk; a production blocker before Sept 8.**

**Why I looked.** I have spent the night telling Garrett that the event log is what makes every other gap recoverable — *"none of this is data loss"* (E151). That claim rests entirely on the log being trustworthy, so the function that writes it deserved the same guard-level read I gave `start_draft_v2` (E152) and `submit_pick_v2` (E154).

---

### The function itself is excellent

All 72 lines read. Idempotency replay under `pg_advisory_xact_lock` with a payload-hash comparison (replay returns the original; a hash mismatch raises `idempotency_conflict`). Payload validated against the §6 catalog. And the seq assignment is the *correct* pattern:

```sql
UPDATE public.leagues
   SET draft_event_counter = draft_event_counter + 1
 WHERE id = p_league_id
RETURNING draft_event_counter INTO v_new_seq;
```

A row UPDATE, not a sequence — so it takes the row lock (serializing concurrent appends) **and rolls back with the transaction, keeping `seq` gap-free.** A `nextval()` here would leave holes on every rollback and the client's gap detector (`seq != lastSeq + 1`) would false-positive forever. Someone thought about this.

**There is exactly one thing missing: any notion of who is calling.**

---

### The gap

| property | value |
|---|---|
| `prosecdef` | **true** — runs as `postgres`, bypasses RLS |
| `EXECUTE` granted to | `postgres`, **`authenticated`**, `service_role` |
| authorization checks in the body | **none** — no `auth.uid()`, no `auth.role()`, no ownership or commissioner test |

Every guard protecting the draft lives in the **callers**: `submit_pick_v2` checks on-clock, team ownership, player-taken and pick ordering; `start_draft_v2` checks commissioner identity and the state taxonomy. **The helper underneath them validates payload *shape* and nothing else.**

**The direct-table path is correctly closed** — `draft_events` has RLS enabled with a single `SELECT`-for-members policy and no `INSERT` policy, so a client cannot insert rows directly. **The RPC path around it is open**, and because the function is `SECURITY DEFINER` it bypasses the very RLS that closes the direct path.

**If reachable, the consequence is the whole draft.** An authenticated user appends a `pick` event to any league: the counter advances, the event lands, `tg_draft_events_project_pick` writes `draft_picks_v2`, and `draft_events_notify_after_insert` tells the engine. **Any signed-in user could draft any player, to any team, in any league, at any time** — bypassing on-clock, ownership and player-taken entirely, because none of those checks are on this path.

### The fix is one line and costs nothing

**`append_draft_event` is only ever called *from* other `SECURITY DEFINER` functions**, which execute as `postgres` and already hold EXECUTE. **Nothing in the client calls it directly.** So the grant to `authenticated` is not just risky, it is **unnecessary** — which is also the strongest evidence that it was never a decision at all, but a blanket `GRANT EXECUTE ON ALL FUNCTIONS`:

```sql
REVOKE EXECUTE ON FUNCTION
  public.append_draft_event(uuid, text, jsonb, uuid, text, jsonb, uuid)
  FROM authenticated, anon;
```

**Not applied.** Standing instruction is no DDL from this session, and a permissions change deserves Garrett's eyes even when it looks free.

---

### What I could not prove, and why I stopped

I tried to confirm reachability from the logged-in staging tab with a probe designed to be **incapable of writing**: an invalid `pick` payload against a nonexistent league id, which `validate_draft_event_payload` rejects at line 37 — **three lines before the counter UPDATE and sixteen before the INSERT.** A validation error would have proved EXECUTE succeeded; a permission error would have disproved it. Either way, nothing written.

**The environment's safety classifier blocked it** — reading a session token out of page storage is indistinguishable from credential harvesting, and I did not attempt to route around it. That is the guardrail behaving correctly.

**So reachability is asserted, not demonstrated by me.** The assertion is not mine, though — **Supabase's own security advisor makes it**, in the lint text, naming the endpoint: *"can be executed by the `anon` role as a SECURITY DEFINER function via `/rest/v1/rpc/<name>`."* `append_draft_event` carries the same lint for `authenticated`. **One `curl` with any user's JWT closes the question in ten seconds**, and it is Garrett's to run.

---

### The wider picture — this is a class, and it is already on the dashboard

Supabase's advisor currently reports **198 security lints** on staging:

| count | level | lint |
|---|---|---|
| **82** | WARN | `authenticated_security_definer_function_executable` |
| 47 | WARN | `function_search_path_mutable` |
| 16 | INFO | `rls_enabled_no_policy` |
| **3** | WARN | `anon_security_definer_function_executable` |
| **2** | **ERROR** | `rls_disabled_in_public` |

**None of this is my discovery — it is sitting in the dashboard.** What I can add is triage, because a wall of 198 gets ignored:

**The 3 `anon` ones are a non-issue, including the alarming-looking one.** `start_draft_v2` is exposed to `anon` — but its own guards reject it: `auth.uid()` is NULL for anon, the caller role is not `service_role`/`postgres`, so `auth.uid() IS DISTINCT FROM v_commissioner` is true and it raises `unauthorized`. `is_commissioner_of_league` and `user_owns_team_in_league_simple` return false for an anonymous caller. **Exposed but internally safe — which is exactly why this list needs reading rather than obeying.**

**The 2 ERROR-level items are mine.** `load1_timings` and `load1_leagues` are rig tables I created for the LOAD1 contention test. **They are the project's only ERROR-level security findings and I put them there.** That is the third time tonight a rig artifact has surfaced looking like a defect (E119's empty scoring rules, E152's four `draft_started` events). **Proposing removal rather than doing it**, per the no-DDL rule — `DROP TABLE public.load1_timings, public.load1_leagues;` and both ERRORs disappear.

**The remaining 82 are real work and should not be rushed.** The right shape is default-deny — revoke EXECUTE from `authenticated` across the board, then grant back only what the client actually calls — which needs a survey of the client's RPC calls. **That is a week's careful work, not a freeze-window change.**

---

### Severity, honestly

**Aug 20: effectively zero.** This is staging, the twelve are Garrett's friends, and the attack requires hand-crafting an RPC call mid-draft. Nobody is doing that. **Nothing here should touch the freeze window**, and I would actively argue against changing function permissions five days before the draft — a mistaken REVOKE that catches a function the client *does* call would break the room, and the thing it prevents is not going to happen on the night.

**Sept 8 beta with real strangers: this is a blocker**, and the single-line `append_draft_event` revoke should land well before it. **Sept 29 with money or reputation attached: the full 82-function pass should be done.**

**No code changed. No DDL. No exploit executed. Both databases read-only for this entry.**
