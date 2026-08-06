# DESIGN — F27 `start_draft_v2` (Commissioner Start)

**Status:** Awaiting architect final sign-off. Code begins after sign-off.
**Authors:** Architect (design brief 2026-08-06), terminal (investigation + riders integration 2026-08-06).
**Slotting:** Combined engine deploy with F26 (external-apply broadcast) — same file, same PR, same review surface, same deploy risk. Freeze target Aug 17. Twelve-human draft after.
**Deprecates:** `scripts/proof/set-draft-status.local.mjs` (retires to break-glass status the day this ships).

---

## 1. Why now

Every draft in this engine's history was started by ops scripts (`set-draft-status.local.mjs` flipping columns from PowerShell). The twelve-human draft has Garrett commissioning — he needs a button, not a paste. TestFlight leagues make it mandatory. There is no path to launch that keeps the flip-script.

## 2. What "start a draft" actually is today (evidence, not guess)

Ignition is three writes the rig performs by hand:

- `leagues.draft_state = 'active'` — the RPC's pick gate (`submit_pick_v2:Step 2`) reads this.
- `leagues.pick_deadline = <first deadline>` — the engine's snapshot serves the first clock from this column.
- `leagues.draft_status = 'in_progress'` — the discovery/join gate reads this.

Setup separately guarantees teams + a populated `draft_order`. Nothing else is required for picks to flow — proven across every run since 11g.10.

The event catalog (validator §6.4, `20260425140000_draft_engine_v2_rpcs.sql:86-88` read on live) also defines a `draft_started` event with required payload:

```json
{
  "started_at": <timestamptz>,
  "first_pick_deadline": <timestamptz>,
  "total_rounds": <int>,
  "total_teams": <int>,
  "pick_time_limit_seconds": <int>,
  "draft_format": <text>
}
```

— the room-facing announcement of ignition. Not currently emitted by any code path.

## 3. Investigation findings (Q1–Q4)

### Q1 — Does the engine consume `draft_started` today? **NO.**

- Grep of `server/src/draft/*` for `draft_started`: zero matches.
- `LobbyManager.applyEventDuringBootstrap` switch (`server/src/draft/LobbyManager.ts:2823-2891`) handles: `pick`, `pick_undone`, `commissioner_override`, `draft_completed`, `draft_cancelled`, `draft_paused`, `draft_resumed`, `draft_extended`, `auction_*`. **No `draft_started` case.** Falls through to default no-op (the "live-apply skip" pattern).
- F26 rebuilds this exact switch (its scope is the `draft_completed` case at line 2833-2835 — silent apply → needs broadcast + timer-cancel + teardown). Adding a `draft_started` case is a small delta to the same PR.
- **Consequence for F27 slotting:** F26+F27 land as one engine deploy. Same file, same switch, same rebuild boundary.

### Q2 — What starts the lobby? **First WS join.**

- `LobbyRegistry.getOrCreate(lobbyId, leagueId)` (`server/src/draft/LobbyRegistry.ts:397`) is called from the WS upgrade handler at `server/src/draft/uws-server.ts:396`.
- Zero-client commissioner-start sequence, verified safe:
  1. `start_draft_v2` RPC writes `draft_state='active'`, `pick_deadline=<first>`, `draft_status='in_progress'`, emits `draft_started` event.
  2. LISTEN/NOTIFY fires; engine LISTEN handler receives the row.
  3. **No lobby exists** → external-apply path short-circuits (nothing in memory to apply to). Event stays durable in `draft_events`.
  4. First WS join → `getOrCreate` → bootstrap replay + `init()` covering-fallback reads `leagues.pick_deadline` and arms the clock from the DB column. (The bootstrap dispatcher gets a proper `draft_started` case in Rider 1's engine work — but the DB column fallback holds as backstop.)
- If first join happens AFTER `pick_deadline` elapsed: F20 guard fires → normal expired-clock handling (autopick or scanner). This is F20's designed behavior; F27 relies on it (see Rider 2).

### Q3 — Which column names the commissioner? **`public.leagues.commissioner_id`**

- Definition: `commissioner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL` (`20250101000001_create_leagues_teams_tables.sql:8`).
- Established v2 pattern (used identically by `draft_pause`/`draft_resume`/`draft_extend` in `20260425140000_draft_engine_v2_rpcs.sql:982-1004`):

```sql
IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
  RAISE EXCEPTION 'unauthorized: start_draft_v2 requires actor.kind=commissioner (got %)',
    p_actor ->> 'kind'
    USING ERRCODE = 'insufficient_privilege';
END IF;

SELECT commissioner_id INTO v_commissioner FROM public.leagues WHERE id = p_league_id;

IF auth.role() NOT IN ('service_role','postgres')
   AND auth.uid() IS DISTINCT FROM v_commissioner
THEN
  RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
    auth.uid(), p_league_id
    USING ERRCODE = 'insufficient_privilege';
END IF;
```

- `start_draft_v2` mirrors byte-for-byte. Parity with the other lifecycle RPCs is what makes the auth story reviewable.
- ADR-003 co-manager split (head + co) is intentionally out of scope for F27 — adopting it here would require a paired update across all four lifecycle RPCs, which is scope creep. Defer to a coordinated ADR-003 landing.

### Q4 — Startable-state definition (see Rider 1 for the full pin)

- `draft_status` (native PG enum, added `'queued'` via `20260206000000_add_scheduled_draft_time.sql:17`).
- `draft_state` (architect: `∈ {not_started, active}`).
- Startable rule: see Rider 1.

## 4. Riders (folded in per architect ratification 2026-08-06)

### Rider 1 — Enum labeling + illegal-combo taxonomy pinned in the design

**Column values (terminal verifies against live schema at build time before migration authorship — capture-before-replace analog for reads):**

| Column | Values |
|---|---|
| `leagues.draft_status` (native PG enum) | `not_started`, `queued`, `in_progress`, `completed` |
| `leagues.draft_state` (text, per architect) | `not_started`, `active` |

**Preflight reads BOTH columns.** Illegal combos (e.g. `status=in_progress` with `state=not_started`) refuse via named error `draft_state_not_startable`.

**KI-034 discipline — status check MUST fire FIRST.** Completed leagues carry `state='active'` (F24 completion path deliberately doesn't touch `draft_state`, per Amendment 2 evidence-closed). If the state check fired first, a completed league would appear startable because `state <> 'active'` is false. Ordering:

```
1. status = 'completed'                    → REFUSE draft_already_completed (hard, no restart)
2. status = 'in_progress'                  → REFUSE draft_already_in_progress
3. status IN ('not_started', 'queued')
   AND state <> 'not_started'              → REFUSE draft_state_not_startable (illegal combo)
4. status IN ('not_started', 'queued')
   AND state  = 'not_started'              → PROCEED
5. any other status value                  → REFUSE draft_state_not_startable (unexpected)
```

Named refusals surface as PostgreSQL exceptions with `insufficient_privilege` or `check_violation` SQLSTATE (matching `submit_pick_v2`'s `illegal_state` / `pick_out_of_order` / `not_on_clock` style). The API layer maps each to a 4400-class HTTP response for the UI to render honestly.

**Preflight also checks (all-or-refuse, before any write, in the same DO block):**
- League exists (else `illegal_state`).
- `commissioner_id` is set (else `illegal_state`).
- `draft_order` rows exist for at least round 1 with `deleted_at IS NULL`, `team_order` non-empty (Amendment 3 discipline — mirror the `submit_pick_v2:Step 2` on-clock SELECT filter).
- `league_size` sane and matches `array_length(team_order[round=1])`.
- `settings.pickTimeLimit` extractable (else default 90, matching `submit_pick_v2:259-262`).

Any missing/malformed preflight input surfaces as `draft_not_configured` — the honest 4400-class refusal already ratified as v1 behavior.

### Rider 2 — Zero-client start is DESIGNED behavior with a pre-registered acceptance test

Zero-client start is not an incidental case — it is the expected commissioner UX for many drafts (Garrett clicks start; players trickle in). This behavior gets its own pre-registered acceptance test in the rig:

**Scenario (zero-client start + late-arrival autopick):**
1. `start_draft_v2` invoked with actor=commissioner. **Zero WebSocket clients connected** to the engine for this league.
2. Assert: `draft_state='active'`, `pick_deadline=<first>`, `draft_status='in_progress'`, `draft_events` row at `seq=1` with `event_type='draft_started'` and all six validator fields.
3. **Wait until `first_pick_deadline` elapses** (real wall-clock wait; not sped up).
4. First harness client connects.
5. Assert (F20 absorb-and-announce): the connecting client observes pick 1 as autopicked via the standard expired-clock path. Engine emits an `autopick` event (or the `pick` event with `is_autopick=true` per §6.1) at `seq=2` with `picked_by_actor.kind='autopick'`.
6. Assert: engine logs contain no orphan/error signals; F20 scanner recorded the expired-clock detection at boot-time timer arm; the autopick landed via the same code path as any other autopick.
7. Draft continues normally through remaining picks.

**Documented as absorb-and-announce** — same discipline as F20 guard. The zero-client → late-join → past-deadline path IS a normal operational mode; the rig proves it stays honest.

### Rider 3 — Idempotency key is caller-supplied per click-session (F11 lesson promoted)

**Semantics:**
- Caller (the UI's Start button handler) generates a fresh UUID per click-session and passes it as `p_idempotency_key`.
- The DB is the double-submit gate — the button's click handler doesn't need to disable itself, doesn't need to track "was I clicked already?" state, doesn't need retry-safety logic. All of that lives in the RPC.
- **Replay semantics** (exactly mirrors `submit_pick_v2:Step 1`):
  - **Same key, same payload hash** → return the stored `{event_id, seq, first_pick_deadline}` from the first successful call. Idempotent-safe retry. UI displays "already started, resuming" and navigates to the room.
  - **Same key, different payload hash** → raise `idempotency_conflict` (SQLSTATE `unique_violation`). Should be unreachable — same click-session should always produce identical payloads — but defended against.
  - **Different key, draft already `in_progress`** → falls through idempotency short-circuit, hits Rider 1's step 2 preflight, raises `draft_already_in_progress`.
- **Rationale (F11 promoted).** F11 established that double-submit protection lives at the DB, not the client (F11's specific instance: double-submit no longer reports false clock expiry). Same discipline for start: any layer between click and DB is unreliable (network retries, tab duplication, hot-reload during dev). The DB is the only layer that sees every attempt.

### Rider 4 — THE LIFECYCLE RUN (combined F26+F27 acceptance)

**One rig, button to banner.** Single test proves the entire draft lifecycle end-to-end. Also serves as the first engine deploy since `527ceb38` — full documented pipeline + boot verification is part of the rider's deliverable.

**Sequence:**

1. **Ignition** — `start_draft_v2(p_league_id, {kind:'commissioner', id:<garrett>}, p_idempotency_key, ...)`.
   - Assert (A): `draft_started` event at `seq=1` with all six validator fields (`started_at`, `first_pick_deadline`, `total_rounds`, `total_teams`, `pick_time_limit_seconds`, `draft_format`).
   - Assert (B): `leagues.draft_state='active'`, `draft_status='in_progress'`, `pick_deadline` equals `payload.first_pick_deadline`.
2. **First-clock arming from the event** (not the DB column fallback — proves F27's new receiver works).
   - Assert (C): observing harness client (connected before ignition) receives the `draft_started` WS frame and arms its local timer from `payload.first_pick_deadline`. Engine logs `external_event.applied league=<lg> seq=1 type=draft_started broadcasted=true` (mirror F26's broadcast-path fix — this frame is the F26 assertion applied to the ignition event class).
3. **12 harness picks** — full snake round, standard pick-path exercise.
4. **F24 completion emitter fires** — `draft_completed` event at `seq=13` (or `seq=N+1` for however many events landed).
   - Assert (D): `leagues.draft_status='completed'`, `pick_deadline=NULL`, event payload hash is server-computed (Amendment 4 sha256), event `correlation_id` equals pick 12's correlation.
5. **F26 broadcast reaches the observer** — the completion event's WS frame lands at every connected client.
   - **Assert (C-mandatory).** F24's C block was true-negative because F26 wasn't in place; this run demands PASS. Zero-drops on the `draft_completed` frame across all connected clients.
6. **Timer cancellation** — pick 12's armed timer was cancelled by F26's teardown, not absorbed by the F20 guard after the fact.
   - **Assert (E).** Zero occurrences of `'clock fired but draftStatus=completed — ignored (timer should have been cancelled)'` WARNING in engine logs. Contrast with F24 acceptance where this warning fired at 18:27:03 (F20 guard absorbing the residual F26 was supposed to prevent).
7. **Teardown** — lobby drained, snapshot flushed, cull scheduled per standard shutdown path.

**Boot verification (companion to Rider 4):** the deploy log carries the standard 9-item verification (`deployment.fingerprint` shows `imageSha == push digest`, `commitSha == HEAD`, uWS port bound, LISTEN client connected, snapshot writer ticking, etc. — same as the `527ceb38` boot log format). First deploy since 527ceb38 — this is the checkpoint.

**Pre-registration.** All five assertions (A/B/C/D/E) declared before the run. Any single miss = failure. Zero-client acceptance (Rider 2) runs as a SECOND rig invocation after the lifecycle run passes — separate scenario, separate assertions, but same commit ratifies both.

## 5. Product shape — `start_draft_v2` RPC

### Signature

```sql
CREATE OR REPLACE FUNCTION public.start_draft_v2(
  p_league_id        uuid,
  p_actor            jsonb,             -- {kind:'commissioner', id:auth.uid()}
  p_idempotency_key  uuid,              -- caller-supplied per click-session (Rider 3)
  p_correlation_id   uuid DEFAULT NULL  -- optional; RPC generates if NULL
) RETURNS jsonb                          -- {event_id, seq, first_pick_deadline}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

### Body (steps mirror `submit_pick_v2`)

- **Step 0 — Idempotency short-circuit** (mirror `submit_pick_v2:Step 1`).
  - `pg_advisory_xact_lock(hashtext('draft_events_idem:' || p_idempotency_key::text))`.
  - Lookup `draft_events` by `idempotency_key`. Same key + same payload hash → return the stored `{event_id, seq, first_pick_deadline}` (extract `first_pick_deadline` from stored payload). Same key + different hash → raise `idempotency_conflict`.
- **Step 1 — Authorization** (Q3 pattern, verbatim).
  - actor.kind must be `'commissioner'`; caller must be `commissioner_id` OR service_role/postgres.
- **Step 2 — Preflight** (Rider 1 taxonomy, ordered).
  - Read `draft_status`, `draft_state`, `commissioner_id`, `league_size`, `settings` in one SELECT.
  - Apply the 5-step Rider 1 taxonomy in order: completed → in_progress → illegal combo → startable → unexpected.
  - Validate `draft_order` (round 1 exists, `deleted_at IS NULL`, `team_order` non-empty, length matches `league_size`).
  - Compute `v_pick_time := COALESCE((v_settings ->> 'pickTimeLimit')::int, 90)`.
- **Step 3 — Compute first deadline** (mirror `submit_pick_v2:263-265`).
  ```sql
  v_first_pick_deadline := date_trunc('second', now())
                        + make_interval(secs => ceil(v_pick_time)::int)
                        + interval '1 second';
  ```
- **Step 4 — Build payload** (all six §6.4 required fields).
  ```sql
  v_payload := jsonb_build_object(
    'started_at',             v_now,
    'first_pick_deadline',    v_first_pick_deadline,
    'total_rounds',           v_total_rounds,
    'total_teams',            v_league_size,
    'pick_time_limit_seconds', v_pick_time,
    'draft_format',           v_draft_format
  );
  PERFORM public.validate_draft_event_payload('draft_started', v_payload);
  ```
- **Step 5 — Hash payload** (Amendment 4 rule — `draft_events.payload_hash` is NOT NULL).
  ```sql
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  ```
- **Step 6 — Emit event** via `append_draft_event`.
  ```sql
  PERFORM public.append_draft_event(
    p_league_id, 'draft_started', v_payload,
    p_idempotency_key, v_payload_hash, p_actor, v_correlation_id
  );
  ```
  - `event_version=1` (append_draft_event default; same as `draft_started`'s peer lifecycle events per KI-029 observation).
  - Retrieve `v_event_id` and `v_new_seq` from the append's return.
- **Step 7 — Atomic column writes** (single UPDATE, same row lock as the counter increment inside append_draft_event, so no race with a concurrent submitter).
  ```sql
  UPDATE public.leagues
     SET draft_state    = 'active',
         draft_status   = 'in_progress',
         pick_deadline  = v_first_pick_deadline
   WHERE id = p_league_id;
  ```
- **Step 8 — Return**.
  ```sql
  RETURN jsonb_build_object(
    'event_id',            v_event_id,
    'seq',                 v_new_seq,
    'first_pick_deadline', v_first_pick_deadline
  );
  ```

### Property posture

`SECURITY DEFINER`, `SET search_path = public`. Consistent with `submit_pick_v2`, `draft_pause`, `draft_resume`, `draft_extend`. STEP 3 of the apply harness asserts `prosecdef=true` + `proconfig='search_path=public'` post-apply (parity check, mirror the same guards used by prior direct-apply harnesses this campaign — property-preservation-family).

## 6. Engine receiver — `draft_started` case (F27 delta to F26's switch rebuild)

Landed in the same `LobbyManager.applyEventDuringBootstrap` switch that F26 rebuilds. New case:

```typescript
case 'draft_started': {
  // Guard against replay on an already-started draft (F27 idempotency
  // discipline mirrors the RPC's status-check ordering).
  if (this.draftStatus !== 'not_started') {
    // Silent no-op — F27's Rider 3 idempotency semantics: replay-safe.
    // Log via structuredLogger.debug for observability.
    break;
  }
  this.draftStatus = 'in_progress';

  // Arm the first clock from the event payload (Rider 4 assert C).
  // Mirror the draft_resumed case at LobbyManager.ts:2852-2872.
  const firstDeadline = (event.payload as Record<string, unknown>).first_pick_deadline;
  if (typeof firstDeadline === 'string' && firstDeadline.length > 0) {
    const parsed = new Date(firstDeadline);
    if (!Number.isNaN(parsed.getTime())) {
      this.setPickDeadline(parsed, 'pick');
    }
  }

  // Broadcast to any early-connected clients (Rider 4 assert C — mirror
  // F26's draft_completed broadcast fix; same code path, same signal).
  this.broadcastDraftLifecycleEvent(event);   // exact API is F26's; F27 reuses
  break;
}
```

**Bootstrap replay note.** During bootstrap on service restart, if `draft_started` appears in the replay and the draft is already in-progress (subsequent picks landed), the guard short-circuits — bootstrap-mode already has `init()`'s covering-fallback reading `leagues.pick_deadline`. No double-arm.

## 7. UI touchpoint

- One button on the league page, commissioner-only.
- Client generates a fresh UUID per click-session as `idempotency_key`.
- Button posts through the existing API layer (`server/src/routes/*` — F27 adds one route, mirroring existing draft-service RPC-wrapping routes).
- On success: navigate to the draft room. On refusal: render the named error honestly (`draft_not_configured` / `draft_already_in_progress` / etc.).
- Countdown-to-start scheduling is OUT of v1 scope (silence-is-consent clock runs Aug 15; waiting-room deferred).

## 8. Migration + apply plan

**Migration file:** `supabase/migrations/20260807xxxxxx_start_draft_v2.sql` (exact timestamp at authorship time).

**Apply pattern:** F24-descended (5th reuse of the pattern). All five standing rules apply:
- Rule 1 — capture-before-replace. `pg_get_functiondef` on any function being replaced (this is a fresh CREATE, so N/A here — no prior function to capture).
- Rule 2 — real SQL in direct-apply history rows via `\lo_import` + INS-6 GUC bridge.
- Rule 3 — `client_encoding=UTF8` forced.
- Rule 4 — `--quiet` on any read-only gcloud interrogations (N/A this migration; DB-only).
- Rule 5 — no direct `cron.job` DML (N/A this migration; no cron touch).

**Apply harness:** `scripts/proof/apply-start-draft-v2.local.sql`. STEP 0 pin: N/A (fresh function — pin against absence: `pg_get_functiondef` returns NULL / raises `object not found`). STEP 3 marker set: 6 payload fields + Rider 1 preflight ordering + property posture (`prosecdef=true`, `proconfig='search_path=public'`) + no-stray-writes.

**Dry-run harness:** `scripts/proof/dryrun-apply-start-draft-v2-checks.local.mjs`. INS-5 mandatory gate before apply.

**Pre-apply cross-workstream check (PROD_CHANGE_LEDGER Rule 2):**
```sql
SELECT version, name, left(statements[1], 200) AS first_stmt_snip
  FROM supabase_migrations.schema_migrations
 WHERE ARRAY_TO_STRING(statements, ' ') ILIKE '%leagues%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_events%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_status%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_state%'
 ORDER BY version DESC LIMIT 20;
```
Run against prod before authoring. Any DB-overhaul workstream mutation on these surfaces since 2026-08-06 triggers the reply-migration convention. Zero expected today; positive control.

## 9. Break-glass retirement of `set-draft-status.local.mjs`

Same PR that ships F27 also:
- Renames `scripts/proof/set-draft-status.local.mjs` to `scripts/proof/BREAK-GLASS-set-draft-status.local.mjs`.
- Adds a header block: "BREAK-GLASS ONLY. Production commissioner-start is `start_draft_v2` via the UI button. This script exists for engineer-only rescue of a stuck draft. If you find yourself reaching for this, first check: (a) can the commissioner press the button; (b) is `start_draft_v2` throwing a preflight refusal that names the actual issue?"
- README `scripts/proof/README.md` updated to reflect the retirement.

## 10. Combined F26+F27 deploy plan

**Single engine deploy** — F26's `case 'draft_completed'` fix + F27's `case 'draft_started'` addition + F26's `broadcastDraftLifecycleEvent` mechanism (F27 reuses it) — one PR, one image, one deploy fingerprint, one boot-verification checklist.

**Migration** ships separately (DB-only, applies before the engine deploy so the RPC is callable when the new engine boots).

**Sequence:**
1. Design doc final sign-off (this doc).
2. Terminal reads prod migration history (PROD_CHANGE_LEDGER Rule 2) — zero expected on `leagues` / `draft_events` / `draft_status` / `draft_state` since 2026-08-06.
3. Migration authored (`20260807xxxxxx_start_draft_v2.sql`). Dry-run gate PASS. Apply harness authored + dry-run gate PASS.
4. Rehearsal on prod. Apply on prod. STEP 3 marker + property-preservation asserts PASS.
5. Engine PR authored (F26 + F27 in one diff). Local tests pass. CI green. Deploy image tagged.
6. Engine deploy — full 9-item boot verification.
7. Lifecycle acceptance run (Rider 4): button-to-banner. All A/B/C/D/E asserts PASS.
8. Zero-client acceptance run (Rider 2): 5-step scenario. Autopick lands honestly.
9. Break-glass rename lands in the same PR docs.
10. Ledger updates: REGISTRY (F27 close), INSTRUMENT_LEDGER (any new INS entries surfaced), PROD_CHANGE_LEDGER (F27 as counterpart candidate if the DB-overhaul workstream has any adjacent touch).

**Freeze checkpoint:** Aug 17. Twelve-draft slot: after freeze, with Garrett pressing a real button.

## 11. Awaiting

Architect final sign-off on this design doc. Sign-off → I proceed to code (migration + dry-run + apply harness + engine PR + acceptance rigs) per section 10 sequence.

If any of Q1–Q4 answers, Rider 1's ordered taxonomy, Rider 4's five asserts (A/B/C/D/E), the RPC signature, or the combined-deploy plan needs adjustment — flag it and I revise before code lands.
