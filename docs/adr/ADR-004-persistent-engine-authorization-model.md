# ADR-004 — Persistent Engine Authorization Model

## §1. Status & Authority

**Status:** All architectural decisions ratified by Zach 2026-05-06. ADR locked.

**Date:** 2026-05-05.

**Authority:** Garrett Storms, founder/CEO. Decision recommended, three options analyzed, precedent identified in the existing `submit_pick_v2` migration. Pending Zach's review.

**Supersession convention:** Same append-only convention used in ADR-001, ADR-002, and ADR-003. Any material revision adds a new "Decision History" entry; original wording preserved.

**Companion docs:**
- [`docs/PHASE_4_5_ARCHITECTURE.md`](../PHASE_4_5_ARCHITECTURE.md) — canonical architecture (Zach's design)
- [`docs/PHASE_4_5_PROJECT_PLAN.md`](../PHASE_4_5_PROJECT_PLAN.md) — schedule, dependencies, Decision Log
- [`docs/adr/ADR-001-persistent-node-draft-engine.md`](./ADR-001-persistent-node-draft-engine.md) — establishes the persistent-engine architectural shape this ADR builds on
- [`docs/adr/ADR-002-auction-state-machine.md`](./ADR-002-auction-state-machine.md) — auction state machine; consumes the same `submit_pick_v2`-style RPC layer
- [`docs/adr/ADR-003-co-manager-authorization-model.md`](./ADR-003-co-manager-authorization-model.md) — locks WHO is authorized to submit picks (head/co via `team_authorized()`); ADR-004 locks HOW that authorization flows end-to-end through the persistent engine

---

## §2. Context

Phase 4.5's persistent draft engine (chunks 11g.4 steps 1–5) runs as long-lived code inside the Node server on GCE. One `LobbyManager` instance per active draft holds in-memory state, serializes mutations through a single-writer queue, and writes durably to Postgres via `submit_pick_v2` using a shared `DraftServiceV2` instance constructed once at process startup.

Chunk 11g.4 step 4's recon (commit `e06cad5`) surfaced an architectural blocker that affects every chunk landing real picks:

- **The persistent engine constructs `DraftServiceV2` with the admin Supabase client (`getSupabaseAdmin()` from `server/src/lib/supabase.ts:25`).** This is the only practical option for a long-lived process — a per-request user-scoped client doesn't fit a process that lives across many requests on behalf of many users.
- **Under admin-client mode, `auth.uid()` returns NULL** because the service-role JWT carries no user identity. `auth.role()` returns `'service_role'`.
- **`submit_pick_v2`'s `actor.kind = 'user'` branch enforces `auth.uid() = teams.owner_id`** at migration `20260425140000_draft_engine_v2_rpcs.sql` line 838. Under admin-client mode, the comparison `teams.owner_id IS DISTINCT FROM NULL` evaluates true and the call rejects with `unauthorized: caller <NULL> is not owner of team <uuid>`.
- **Every user-initiated pick from the persistent engine fails today.** The chunk 11g.4 unit tests pass because they mock `DraftServiceV2.submitPick`; the production path does not work.

This blocks chunks 11g.4 step 6 (state machine + real round/pickNumber computation), 11g.5 (resync protocol — landing real picks for round-trip verification), and 11g.6 (auction state machine + `place_bid` / `nominate` handlers). It does **not** block chunks 11g.4 steps 1–5 because those are auth-mocked at the unit-test level.

The blocker was logged in the `PHASE_4_5_PROJECT_PLAN.md` Decision Log on 2026-05-05 with a recommendation toward Option 3 below. JSDoc cross-references at `server/src/draft/LobbyRegistry.ts` (file-level header) and `server/src/draft/index.ts` (constructor block at line ~122) flag the concern at the import sites.

This ADR captures the resolution path, locking the architectural direction so chunks 11g.4 step 6 / 11g.5 / 11g.6 can be implemented against a known auth signature.

---

## §3. Options Considered

Three resolution paths surveyed in chunk 11g.4 step 4 recon. Each is examined here with full tradeoff analysis: mechanism, pros, cons, audit-trail implications, implementation cost.

### §3.1 — Option 1: Propagate the user's Supabase JWT through the WS handshake alongside the draft token

**Mechanism.** The chunk 11g.1 discovery endpoint issues two tokens for each draft session: the existing draft token (HS256, validates the user is allowed in this draft) plus the user's Supabase JWT (the standard auth.uid()-bearing token). Both are carried through the WebSocket handshake — either via an extended `Sec-WebSocket-Protocol` value or a dual-protocol mechanism.

The persistent engine, on each pick submission, constructs a per-call user-scoped Supabase client from the connection's stored Supabase JWT and uses that to call `submit_pick_v2`. `auth.uid()` resolves to the user's ID; `submit_pick_v2`'s existing `actor.kind = 'user'` branch validates ownership unchanged.

**Pros:**

- **Preserves the existing `submit_pick_v2` permission model exactly.** No SQL migration. The RPC's auth.uid() check continues to be the source of truth for team ownership; the RLS surface is unchanged.
- **No new "trusted role" concept.** Future engineers reading `submit_pick_v2` find the existing single-pattern check and don't need to reason about a service-role bypass.

**Cons:**

- **Doubles handshake complexity.** The chunk 11g.1 discovery endpoint and the chunk 11g.2 step 2 JWT verification both grow: two tokens to issue, two to verify, two to keep in sync.
- **Supabase JWT lifecycle is shorter than the draft token.** Supabase JWTs expire on the standard one-hour cycle (or whatever Supabase project configuration enforces); draft tokens currently mint with a 5-minute exp tied to draft session entry. A draft session may run 90+ minutes (NHL fantasy snake at 90s/pick × 252 picks = 6.3 hours). Mid-session Supabase-JWT expiry forces a refresh path: the engine must detect expiry, prompt the client to refresh, hold the action, retry. **Net effect: every draft session adds a Supabase-JWT-refresh state machine to the engine.**
- **Per-connection Supabase-client construction.** Each `submitPick` call becomes `new DraftServiceV2(createUserClient(jwt))` rather than reusing the shared admin-client instance. For a 12-team draft submitting ~252 picks, that's 252 client constructions on the hot path; for a load-tested 100-team scenario, 21,000 constructions. Each construction allocates an HTTP client with associated middleware. Not catastrophic, but a real cost on an architecture explicitly designed for shared dependencies.
- **Per-pick auth.uid() check fights the "engine authenticates once at WS upgrade" mental model.** The engine already has the verified userId from the draft token; re-authenticating against Supabase on every pick is redundant work hidden behind the RPC's permission check.

**Audit-trail implication.** Audit fidelity is preserved — every pick records `actor.kind = 'user'` and `actor.id = <real userId>` in `draft_events.actor`. No degradation.

**Implementation cost.** Heavy. Touches chunk 11g.1 discovery endpoint, chunk 11g.2 JWT verification, chunk 11g.4 step 6 LobbyManager (per-pick client construction + JWT refresh state machine). Estimated 2-3 PRs across the chunks.

### §3.2 — Option 2: Use `actor.kind = 'autopick'` to bypass the ownership check

**Mechanism.** The persistent engine, when submitting a manually-initiated pick on behalf of a user, calls `submit_pick_v2` with `actor.kind = 'autopick'` and `actor.id = <userId>`. The RPC's autopick branch (line 818-825 of the migration) requires `auth.role() IN ('service_role', 'postgres')` — which the admin client satisfies — and skips the ownership check entirely.

**Pros:**

- **No SQL migration.** The autopick branch already exists; the engine just routes user-initiated picks through it.
- **Zero handshake changes.** The draft token continues to be the only WS-time credential.

**Cons:**

- **Lies about `actor.kind` for every manual pick.** A user clicking "draft player" would result in `draft_events.actor = {kind: 'autopick', id: <userId>}` — durably stored as autopick forever.
- **Corrupts audit trail.** `draft_events.actor` is the canonical record of who submitted each event. Commissioner reviews, post-incident investigations, post-draft analytics ("how many picks were autopicked vs manually submitted?", "which users autopicked frequently?") all read from this column. Conflating manual and autopick at the storage layer is a permanent loss of fidelity.
- **Breaks the `is_autopick` payload field.** `submit_pick_v2` line 858 sets `payload.is_autopick = (v_actor_kind = 'autopick')`. Under Option 2, every manual pick would write `is_autopick: true` into the payload as well. Downstream readers (frontend pick history, draft recap, analytics pipeline) all read `is_autopick` to render the "this user autopicked" badge in the UI. Every manually-submitted pick would render with the autopick badge.
- **Cannot be undone retroactively without violating event sourcing.** The event log is append-only; rewriting historical `actor.kind` values to fix the lie is itself a violation of event-sourcing principles. The corruption is permanent.
- **Breaks the autopick worker's existing intent.** Phase 0–4's `actor.kind = 'autopick'` was explicitly the "autopick worker fired a pick because the deadline expired" signal. Reusing it for manual user picks fuzzes that signal and breaks any monitoring that tracks autopick rate.

**Audit-trail implication.** Catastrophic. Manual and autopick events become indistinguishable in `draft_events`.

**Implementation cost.** Trivial — change one literal string in `LobbyManager.processSubmitPick`. The audit-trail damage outweighs every cost-benefit consideration.

### §3.3 — Option 3 (recommended): Modify `submit_pick_v2` to accept `service_role + actor.kind = 'user'` when the engine has independently verified the actor

**Mechanism.** Modify `submit_pick_v2`'s user-kind branch (currently line 826-848) so that the ownership check is satisfied EITHER by the existing `auth.uid() = teams.owner_id` rule OR by the caller running with `service_role` (or `postgres`). The persistent engine, running as service_role and having independently verified the user's draft token + team authorization at the engine layer, calls `submit_pick_v2` with `actor.kind = 'user'` and `actor.id = <verified userId>`. The RPC trusts the application layer.

**Pros:**

- **Audit trail intact.** Every manual pick records `actor.kind = 'user'` and `actor.id = <real userId>` truthfully. `is_autopick` continues to mean what it has always meant.
- **Architectural cleanness.** Auth-at-engine + durability-at-RPC is the standard pattern in event-sourced systems. The engine becomes the auth boundary; the RPC becomes the durability boundary. Each layer has one job.
- **Consistent with Citrus's existing convention** for trusted-application-layer operations (full elaboration in §4 below).
- **Per-connection cost is zero on the hot path.** No per-pick client construction; no JWT refresh state machine; the shared admin-client `DraftServiceV2` keeps working as designed.
- **Handshake is unchanged.** Chunk 11g.1 discovery, chunk 11g.2 token verification — neither needs revisiting.

**Cons:**

- **Requires a new SQL migration to modify `submit_pick_v2`.** One migration file, one branch of one RPC, ~5 lines of SQL change. Smaller than Option 1's cross-chunk surface; larger than Option 2's zero-change footprint.
- **Introduces (more accurately: extends) a "trusted application layer" concept.** Future engineers reading `submit_pick_v2` will see the service-role bypass on user-kind and need to understand why. Mitigation: the migration includes a SQL comment block at the top explicitly documenting the trust model, citing this ADR, and warning against reverting without a corresponding ADR-004 supersession.
- **Engine compromise widens the blast radius.** A bug in the engine's auth verification could submit picks on behalf of arbitrary users. Mitigation: the engine's draft-token verification (chunk 11g.2 step 2) and team-authorization check (chunk 11g.6 implementation, citing ADR-003) are both deterministic and unit-tested; a compromise of those is equivalent to compromising the application layer of any authenticated SaaS product.

**Audit-trail implication.** Preserved. `actor.kind = 'user'`, `actor.id = <userId>`, `is_autopick = false` — all written truthfully.

**Implementation cost.** One small migration in chunk 11g.6. No engine code change required for the actor-construction call site; chunk 11g.4 step 2's `processSubmitPick` already passes `{kind: 'user', id: action.userId, session_id: action.sessionId}` per `server/src/draft/LobbyManager.ts:307-311`. Engine-side team-authorization verification is a chunk 11g.6 deliverable independent of this ADR (see §5.3 below).

---

## §4. Decision

**Option 3 is selected.** The persistent draft engine becomes a trusted executor: it authenticates the user (chunk 11g.2 step 2 draft-token verification) and verifies team authorization (engine-side check, per §5.3) before calling `submit_pick_v2` with `actor.kind = 'user'` and `actor.id = <verified userId>`. The RPC trusts service-role callers because they are the authenticated application layer.

**The decision rationale leads with precedent — this is not a novel pattern.** ADR-004 extends the existing service-role-trust convention from commissioner-kind operations to user-kind operations, both within the same migration file:

- **`draft_pause` (lines 1000-1007 of `20260425140000_draft_engine_v2_rpcs.sql`):**
  ```sql
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %', ...
  END IF;
  ```
- **`draft_resume` (lines 1119-1126):** identical pattern.
- **`draft_extend` (lines 1263-1270):** identical pattern.

All three already implement: *"the caller is authorized if they're the commissioner-by-auth.uid() OR they're a service-role caller (the trusted application layer)."* This is shipped Citrus code; it has been the pattern for commissioner lifecycle RPCs since Phase 2 of the v2 draft engine.

**ADR-004's recommendation extends this exact pattern to the user-kind pick branch** of `submit_pick_v2`. The proposed user-kind check becomes:

```sql
IF v_team_owner IS DISTINCT FROM auth.uid()
   AND v_caller_role NOT IN ('service_role', 'postgres')
THEN
  RAISE EXCEPTION 'unauthorized: caller % is not owner of team %', auth.uid(), p_team_id ...
END IF;
```

The shape mirrors the commissioner pattern exactly — and the engine's role as the trusted layer mirrors the autopick worker's existing role (which already runs service-role and is trusted by `submit_pick_v2` to submit `actor.kind = 'autopick'` events without ownership check).

Four supporting reasons reinforce the precedent argument:

1. **Audit-trail integrity.** Option 2 corrupts `draft_events.actor` permanently. Option 3 preserves it.
2. **Architectural cleanness.** Auth at the engine, durability at the RPC. Each layer has one well-defined job. Standard event-sourced pattern.
3. **Implementation cost.** Option 3's footprint is one small migration. Option 1's footprint spans chunks 11g.1 + 11g.2 + 11g.4 step 6 plus a Supabase-JWT-refresh state machine.
4. **The engine already verifies user identity at WS upgrade.** Chunk 11g.2 step 2's `verifyDraftToken` already proves the JWT signature, expiry, and draft-id binding. The engine has the verified `userId` in hand at action time. Re-authenticating against Supabase on every pick (Option 1) is redundant work hidden behind the RPC's permission check.

**Option 1 and Option 2 are explicitly rejected.** Option 1 is the right answer in a world where Citrus's engine has no service-role-trust precedent; that world is not the world we're in. Option 2 is rejected on audit-trail grounds alone — even if every other consideration favored it (which they don't), corrupting `draft_events.actor` for the lifetime of the platform is not an acceptable cost.

---

## §5. Implementation Plan

### §5.1 — Migration shape

A new migration file (canonical name: `20260506000000_submit_pick_v2_engine_trust.sql`) modifies the `actor.kind = 'user'` branch of `submit_pick_v2`. The change is to one IF clause; the rest of the RPC is unchanged.

**Before (current — line 826-848):**

```sql
ELSIF v_actor_kind = 'user' THEN
  -- Standard user pick. auth.uid() must own the team.
  SELECT owner_id INTO v_team_owner
    FROM public.teams
   WHERE id = p_team_id AND league_id = p_league_id;

  IF v_team_owner IS NULL THEN
    RAISE EXCEPTION 'unauthorized: team % is not in league %',
      p_team_id, p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_team_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized: caller % is not owner of team %',
      auth.uid(), p_team_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

**After (proposed):**

```sql
ELSIF v_actor_kind = 'user' THEN
  -- Standard user pick. Two acceptance paths (per ADR-004):
  --   1. Direct user call: auth.uid() must own the team.
  --   2. Trusted application layer (service_role / postgres): the
  --      persistent engine has already verified the user's identity
  --      via JWT and the user's team authorization via team_authorized()
  --      (per ADR-003) before reaching this RPC. RPC trusts the
  --      application layer.
  --
  -- This pattern mirrors the service-role-trust path already in use
  -- for the commissioner lifecycle RPCs (draft_pause, draft_resume,
  -- draft_extend). See ADR-004 §4 for the full rationale.
  --
  -- WARNING: do not revert this branch to the strict auth.uid()-only
  -- check without a corresponding ADR-004 supersession. The persistent
  -- draft engine REQUIRES the service-role acceptance path.
  SELECT owner_id INTO v_team_owner
    FROM public.teams
   WHERE id = p_team_id AND league_id = p_league_id;

  IF v_team_owner IS NULL THEN
    RAISE EXCEPTION 'unauthorized: team % is not in league %',
      p_team_id, p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_team_owner IS DISTINCT FROM auth.uid()
     AND v_caller_role NOT IN ('service_role', 'postgres')
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not owner of team %',
      auth.uid(), p_team_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

The migration's file-level header includes a SQL comment block citing this ADR by number, summarizing the trust model, and explicitly warning against reverting without supersession. Written so a future engineer reading the migration in 2030 understands the design intent without needing to dig through Decision Log archaeology.

### §5.2 — ADR-003 sequencing

ADR-004's migration is **independent of ADR-003** (`team_managers` schema + `team_authorized()` / `team_can_submit()` SQL helpers). The two migrations can ship in any order:

- **ADR-004's migration** modifies one IF clause in one branch of `submit_pick_v2`. No new tables, no new functions, no RLS changes.
- **ADR-003's migration** introduces `team_managers` table, two SQL helper functions, and rewrites 116 RLS sites across 45 migration files.

Sequencing is whichever lands first in implementation. **Chunk 11g.4 step 6 / 11g.6's choice of how the engine performs team-authorization is independent of this ADR:**

- **Pre-ADR-003-Phase-2 (today):** the engine queries `teams.owner_id` directly to verify `userId == teams.owner_id` before passing `actor.id = userId` to `submit_pick_v2`.
- **Post-ADR-003-Phase-2:** the engine calls `team_authorized(team_id, user_id)` (or `team_can_submit(team_id, user_id)` for write paths) — the function already exists per ADR-003 §3.2.

Chunk 11g.6 picks whichever helper exists at implementation time and migrates to `team_authorized()` once available. The ADR locks the architectural direction (engine MUST verify ownership before calling the RPC); the implementation surface (which SQL helper) is a chunk 11g.6 detail.

### §5.3 — Engine-side verification contract

The architectural contract that ADR-004 locks alongside the migration:

> **The persistent draft engine MUST verify team authorization before calling `submit_pick_v2` with `actor.kind = 'user'`.**
>
> Verification is two checks:
>
> 1. **User identity:** the userId passed as `actor.id` MUST match the userId derived from the WS connection's draft token (chunk 11g.2 step 2 `verifyDraftToken` produces this from the JWT `sub` claim).
> 2. **Team authorization:** the userId MUST be authorized to act on behalf of the team (per ADR-003: head manager today; head OR co-manager once ADR-003 Phase 2 ships and the implementation chooses the appropriate helper).
>
> This is an engine-layer responsibility. Bypassing either check while still calling `submit_pick_v2` with `actor.kind = 'user'` is a security vulnerability equivalent in severity to bypassing `auth.uid()` checks in any authenticated SaaS application.

The verification is unit-testable at the engine layer (mock the team-authorization helper, verify the engine refuses to call `submitPick` when authorization fails). Chunk 11g.6's implementation includes the test surface.

### §5.4 — Engine code changes

**Engine code change required: zero, for the actor-construction call site.** Chunk 11g.4 step 2's `processSubmitPick` already passes:

```typescript
const actor: DraftV2Actor = {
  kind: 'user',
  id: action.userId,
  session_id: action.sessionId,
};
```

at `server/src/draft/LobbyManager.ts:307-311`. This shape is exactly what ADR-004's modified RPC accepts. No change to the LobbyManager actor construction.

**Engine code change required: yes, for team-authorization verification.** Chunk 11g.6 adds an authorization check before `processSubmitPick` calls `this.draftService.submitPick(...)`. Pseudocode:

```typescript
// (Chunk 11g.6 — illustrative, not normative.)
private async processSubmitPick(action: ...): Promise<DraftActionResult> {
  // ... existing format / payload checks ...

  // ADR-004 §5.3 contract: verify team authorization at the engine
  // layer before calling the RPC. Implementation surface depends on
  // which helper is available (teams.owner_id today; team_authorized()
  // post-ADR-003-Phase-2).
  const authorized = await this.verifyTeamAuthorization(
    action.userId,
    action.teamId,
  );
  if (!authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  // ... existing submit_pick_v2 call ...
}
```

The exact implementation (which SQL helper, which Supabase client to use for the check, caching strategy) is chunk 11g.6's call.

### §5.5 — Test plan

**Unit tests at the engine layer:**

- Engine refuses to call `submit_pick_v2` when team-authorization verification fails (mock the helper to return false; assert `submitPick` is not invoked; verify `{ok: false, reason: 'unauthorized'}` returned).
- Engine calls `submit_pick_v2` with the correct actor shape when verification passes (mock the helper to return true; assert `submitPick` is invoked with `{kind: 'user', id: <userId>, ...}`).

**Integration tests against staging Supabase (chunk 11g.4 step 6 / 11g.6):**

- Service-role client with `actor.kind = 'user'` and a valid team ownership submits a pick successfully.
- Service-role client with `actor.kind = 'user'` against a team the user doesn't own gets rejected at the engine layer (NOT at the RPC — the engine should refuse to call the RPC).
- Existing user-JWT-direct submission paths (the `draftV2Pick.ts` HTTP route at `server/src/routes/draftV2Pick.ts`) continue to work unchanged — `auth.uid() = teams.owner_id` succeeds for legitimate user calls; non-owners are still rejected.

**Regression tests in `server/src/__tests__/draftV2Routes.test.ts`:**

- Existing 19 tests continue to pass (the user-JWT-direct path is unchanged behaviorally).
- New tests covering the service-role acceptance path (mock `auth.role()` returning `'service_role'`, verify the call succeeds without `auth.uid()` matching).

---

## §6. Audit & Observability Implications

The engine's relaxed RPC permission check is offset by stronger engine-layer logging. Every pick attempt MUST log at info level:

- The verified `userId` (from the draft token JWT `sub` claim, chunk 11g.2 step 2).
- The verified `teamId` (from the action payload, after engine-layer team-authorization succeeds).
- The resulting `actor` envelope shape passed to `submit_pick_v2`.
- The RPC result (success / failure with reason).

Concrete log shape (illustrative; structured-JSON conversion happens in chunk 11g.7's observability foundation):

```
[lobby] submit_pick verified userId=<uuid> teamId=<uuid> lobbyId=<uuid> idempotencyKey=<uuid>
[lobby] submit_pick rpc_result=ok eventSeq=<n> lobbyId=<uuid> userId=<uuid>
```

The combination of (a) `draft_events.actor` carrying truthful `actor.kind`/`actor.id`/`session_id` data and (b) engine-side info-level logs of every verified `userId` provides the audit chain that the RPC's relaxed permission check no longer enforces in isolation.

**Cross-reference to chunk 11g.7 observability foundation:** structured JSON logs with `actor.kind`, `actor.id`, `lobbyId`, and `eventSeq` as top-level dimensions enable post-incident reconstruction of "who actually submitted this pick, from which session, in which lobby, at which seq." The `PHASE_4_5_PROJECT_PLAN.md` 2026-05-04 Decision Log entry already commits chunk 11g.7 to "structured JSON logging via @citrus/shared logger refactor" — ADR-004's audit needs are first-class consumers of that capability.

---

## §7. Security Model Summary

ADR-004 establishes a two-layer security boundary for the persistent draft engine:

**Layer 1: the engine is the trusted application layer.** Compromise of the engine is equivalent in severity to compromise of any authenticated SaaS application's auth layer. The engine MUST verify (a) the user's identity via JWT signature + expiry + draftId binding (chunk 11g.2 step 2's `verifyDraftToken`), and (b) the user's team authorization via the SQL helper of record (per ADR-003). Both verifications are deterministic, unit-tested, and run before every call to `submit_pick_v2`. A bug in either is a security vulnerability the engine team is responsible for catching in code review and tests.

**Layer 2: RLS on `draft_events` and `draft_picks_v2` remains the read-side enforcement.** The relaxed permission check on `submit_pick_v2` affects only the WRITE path; it does not change READ-side row-level security. Users continue to read only the events and picks they're authorized to read, enforced by the existing RLS policies (which after ADR-003 Phase 2 will route through `team_authorized()`). A bug in the engine's write-side verification cannot leak read-side data; it can only cause incorrect writes — which then surface in the audit log per §6.

**This matches the standard pattern in event-sourced systems with a trusted application layer: write-side trust at the application, read-side enforcement at the row level.** The engine is no more or less trusted than the rest of the Hono API server; the RLS surface is no weaker than it was before this ADR.

---

## §8. Open Questions for Zach

Garrett's recommendations are noted; Zach has authority to confirm, push back, or revise.

- **§4 — Option 3 selection (extend service-role-trust pattern from commissioner-kind to user-kind).** ✅ Ratified by Zach 2026-05-06. The existing `draft_pause` / `draft_resume` / `draft_extend` precedent was the load-bearing argument; Zach confirmed the extension is consistent with shipped Citrus convention rather than a novel pattern.
- **§5.1 — Migration shape (SQL `OR auth.role() IN ('service_role', 'postgres')` modification to user-kind branch).** ✅ Ratified by Zach 2026-05-06. Five-line SQL change with a documented warning comment block. Migration lands in chunk 11g.6.
- **§5.3 — Engine-side verification contract (engine MUST verify identity + team authorization before calling the RPC).** ✅ Ratified by Zach 2026-05-06. The load-bearing requirement that makes Option 3 safe is locked. Engine-side `verifyTeamAuthorization` callback (already shipped in chunk 11g.4 step 4) satisfies the contract today.

---

## §9. Decision History

| Date | Author | Change |
|---|---|---|
| 2026-05-05 | Garrett Storms | Initial draft. Three options analyzed; Option 3 recommended grounded in (a) audit-trail integrity, (b) architectural cleanness, (c) consistency with the existing `service_role` trust pattern in `draft_pause` / `draft_resume` / `draft_extend` from migration `20260425140000_draft_engine_v2_rpcs.sql`. Pending Zach ratification per the ADR-002/-003 review pattern. |
| 2026-05-06 | Zach Drever | Verbally ratified all three architectural decisions (§4 Option 3 selection, §5.1 migration shape, §5.3 engine-side verification contract). ADR-004 fully locked. Migration to modify `submit_pick_v2`'s user-kind branch + engine-side team-authorization verification both unblocked for chunk 11g.6 implementation. |

---

## §10. Cross-References

**Depends on:**

- ADR-001 (persistent Node draft engine) — establishes the persistent-engine architectural shape that creates the auth.uid()=NULL blocker in the first place.
- ADR-003 (co-manager authorization model) — provides `team_authorized()` and `team_can_submit()` as the SQL-level source of truth for "is this user authorized to act on behalf of this team." Engine-side verification per §5.3 calls into ADR-003's helpers once Phase 2 ships; uses `teams.owner_id` directly until then.
- Chunk 11g.1 (discovery endpoint + JWT issuance) — the verified userId that the engine passes as `actor.id` originates from the draft token issued here.
- Chunk 11g.2 step 2 (JWT validation on uWS upgrade) — the engine verifies user identity at this point; the verified `userId` flows into the `DraftSocketUserData` and from there into every action.
- Chunk 11g.4 step 4 (LobbyRegistry + connection management, commit `e06cad5`) — the recon pass that surfaced this blocker.

**Unblocks:**

- Chunk 11g.4 step 6 (state machine + real round/pickNumber computation) — first chunk that lands real picks against `submit_pick_v2`. Engine-side team-authorization verification per §5.3 is delivered here.
- Chunk 11g.5 (resync protocol) — the resync server primitive shipped in chunk 11g.4 step 5 needs real round-trip pick events to validate against; that requires Option 3's migration to ship first.
- Chunk 11g.6 (auction state machine + `place_bid` / `nominate` handlers) — auction RPCs (when added in chunk 11g.6) will follow the same trust model; this ADR establishes the precedent for the auction RPC migration to cite.
