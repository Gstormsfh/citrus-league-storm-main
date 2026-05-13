# Phase 4.5 — Productionization Plan (Chunk 11g.10)

> **Status.** Authored 2026-05-12 by chunk 11g.10 sub-step 10a.
> Sub-steps 10b–10f are Phase B work per
> [`PHASE_4_5_PROJECT_PLAN.md`](./PHASE_4_5_PROJECT_PLAN.md) and target the
> May 19–July 31 window. 10a delivers this planning artifact only; no
> code or staging changes land in 10a.
>
> **Authority.** Garrett Storms (executor + reviewer; solo founder
> productionization).
>
> **Source of truth.** Performance targets, binding architectural
> patterns, and non-negotiables are quoted verbatim from
> [`CLAUDE.md`](../CLAUDE.md) § "Citrus Draft Performance Mandate"
> (lines 1–58). **CLAUDE.md is the canonical source.** Updates flow
> CLAUDE.md → re-sync this doc. If any phrasing here drifts from
> CLAUDE.md, CLAUDE.md wins.

---

## §1 Mandate (verbatim quote from CLAUDE.md)

> The following section is reproduced verbatim from
> [`CLAUDE.md`](../CLAUDE.md) lines 1–58 so this plan is
> self-contained for reading. Do not edit the quote in place — edits
> flow from CLAUDE.md.

### 1.1 Non-negotiable competitive requirements

Citrus's live draft experience MUST be competitive with Yahoo Fantasy and ESPN Fantasy on every dimension users perceive. This is not an optimization goal. It is a foundational design constraint equivalent to correctness.

### 1.2 Hard performance targets

These targets define what "competitive" means. Any architecture, design, or implementation that cannot meet these targets is rejected by definition, regardless of how sophisticated, correct, or elegant it is.

- **Manual pick submission** (user clicks "draft player" → all participants see the pick): p95 ≤ 300ms, p99 ≤ 500ms
- **Autopick latency** (deadline expiry → pick committed and broadcast): p95 ≤ 1000ms, p99 ≤ 2000ms
- **Draft state load** (user enters draft room → fully rendered with current state): p95 ≤ 1500ms
- **Timer accuracy** (server-displayed countdown vs actual deadline): drift < 100ms across all clients
- **Pick-to-broadcast fanout** (server commits pick → all connected clients have updated UI): p95 ≤ 200ms
- **Reconnection recovery** (client WebSocket drops → reconnects → state resynced): p95 ≤ 2000ms

### 1.3 Architectural implications

The performance targets above require specific architectural choices. Designs that conflict with these are rejected:

1. **Persistent stateful worker per active draft.** Drafts run in long-lived processes that hold state in memory for the duration of the draft. Stateless function-per-request architectures cannot meet sub-200ms broadcast fanout at scale.

2. **WebSocket transport for live drafts.** Manual picks, broadcasts, timer updates, and chat all flow through bidirectional WebSocket connections. HTTP polling and long-poll are insufficient for the broadcast targets above.

3. **In-memory candidate pool and pre-computed scoring per draft.** Autopick decisions consult cached state, not Postgres queries. A per-pick query of the player pool cannot meet sub-1s autopick latency.

4. **Postgres as durability and disaster recovery, not hot path.** The event log, projection tables, and pgmq scheduler remain as the source of truth and the safety net. They are not on the hot path for manual pick submission, broadcast fanout, or autopick scoring.

5. **WebSocket reconnection with state snapshot recovery.** Mobile network blips, page refreshes, and brief connection drops are normal user behavior. Clients must reconnect and resync within 2 seconds without losing draft progress.

### 1.4 Design review checklist

Before any architectural change, design proposal, or new chunk plan is approved, it must explicitly answer:

1. Does this design meet every performance target listed above? Show the back-of-envelope calculation.
2. If not, which target does it fail and why? Is the failure acceptable given the alternative? (Default answer: no.)
3. Does this design support the architectural patterns in #1-5 above, or does it conflict with them?
4. If a chunk plan defers performance work to a later phase, does that later phase have a concrete plan and timeline, or is it "we'll figure it out"?

### 1.5 Non-negotiables

The following are NOT acceptable framings, regardless of how persuasive the surrounding argument:

- "We can optimize this later" — for any user-perceived latency
- "It's only slow in the autopick path" — autopick IS user-perceived
- "Most users won't notice" — Yahoo/ESPN users will compare; we lose
- "It's competitive with v1" — v1 is not the bar; Yahoo/ESPN are
- "It's good enough for the demo" — there is no demo bar separate from the competitive bar
- "The architecture supports optimization later" — only counts if later is scheduled and bounded

### 1.6 Recovery from prior decisions

The Phase 0-4 architecture solved correctness but did not solve competitive performance. The Phase 4.5 redesign (persistent worker + WebSocket transport + in-memory state) is required to bring the system to competitive parity before Phase 5 (UI) is built on top of it.

Phase 5 must NOT be built against the Phase 0-4 architecture alone. It must be built against the Phase 4.5-extended architecture, or it will require rework when performance gaps are discovered later.

This document is the source of truth on this. If a future plan contradicts it, this document wins.

> **End verbatim quote from CLAUDE.md.**

---

## §2 Architecture-to-Mandate Mapping

Each Mandate target maps to specific architectural pieces that have already shipped in chunks 11g.0–11g.9. This mapping makes the Mandate verifiable against shipped infrastructure; if any cell below is empty, that's a deferred-without-plan failure under §1.4 question 4.

| Mandate target | Architectural piece(s) | Shipped in | Where it gets measured |
|---|---|---|---|
| **Manual pick submission** p95 ≤ 300ms / p99 ≤ 500ms | WS receive → action queue → `submit_pick_v2` RPC commit → uWS publish | 11g.4 step 6 (pick flow) + 11g.7-7e (NOTIFY) | End-to-end: `client_send_action_ts` → `client_receive_broadcast_ts` |
| **Autopick latency** p95 ≤ 1000ms / p99 ≤ 2000ms | `LobbyManager.handleClockExpired` → `autopickStrategy` chain → `submit_pick_v2` RPC + broadcast | 11g.4 step 6c (timers + autopick) | `pick_deadline` → first-client `client_receive_broadcast_ts` |
| **Draft state load** p95 ≤ 1500ms | `GET /api/drafts/:id/server` → JWT issue → uWS upgrade → snapshot bootstrap → first state render | 11g.1 (discovery) + 11g.2 (uWS) + 11g.7-7b (HTTP snapshot) + 11g.7-7c (snapshot persistence) | Cold-room scenario: page load → first render of current pick + roster |
| **Timer accuracy** drift < 100ms | Server-authoritative `pick_deadline` from RPC return; client renders against server clock | 11g.4 step 6c + chunk 11g.6 sub-step 6c1 (pause/resume restores captured remaining) | Wall-clock comparison across N clients vs server `pick_deadline` |
| **Pick-to-broadcast fanout** p95 ≤ 200ms | uWS `publish` (in-process) post-RPC | 11g.4 step 5 (broadcast site) | RPC commit ts → all N WS observe ts |
| **Reconnection recovery** p95 ≤ 2000ms | WS resume protocol with `last_seen_seq` from ring buffer; snapshot fallback for >200-event gap | 11g.5a (state machine) + 11g.5b (UX) + 11g.7-7b (snapshot endpoint) | Disconnect → WS reconnect → snapshot fetch (if needed) → state resynced ts |

**Coverage check:** all six targets have shipped architecture to measure. No target is in "we haven't built it yet" status. 10c builds the harness; it does not build the underlying primitives.

---

## §3 Current State Assessment

### 3.1 What's shipped (chunks 11g.0–11g.9)

| Capability | Chunk | Status |
|---|---|---|
| GCE platform spike (region + machine type + Dockerfile) | 11g.2.0 | Complete 2026-04-30; VM torn down post-validation |
| Discovery endpoint + draft JWT | 11g.1 | Complete |
| uWS server bring-up + GCE staging deploy | 11g.2 | Functionally complete 2026-05-04; staging VM torn down post-validation |
| `LobbyManager` + single-writer queue + ring buffer | 11g.3 | Complete |
| Pick submission flow + draft-room chat | 11g.4 (steps 1–6) | Complete; 6c = timer + autopick |
| Client reconnection state machine + UX | 11g.5a + 11g.5b | Complete |
| Auction state machine (foundation + anti-snipe + pause/resume + tiered increments + auto-nominate + commissioner override) | 11g.6 (6a–6c4) | Complete |
| Observability foundation (structured logging) | 11g.7-7a | Complete |
| HTTP snapshot endpoint for client resync | 11g.7-7b | Complete |
| Snapshot persistence (periodic + milestone + lifecycle) | 11g.7-7c | Complete |
| WebSocket heartbeat (hybrid uWS native + app-level scan) | 11g.7-7d | Complete |
| Live event subscription via LISTEN/NOTIFY | 11g.7-7e | Complete |
| Remove pgmq emissions from writer-side RPCs | 11g.8 | Complete |
| Remove legacy pgmq infrastructure (Edge Function + cron + extension + protocol cleanup) | 11g.9 | Complete (2026-05-12, commit `9f72fd8`) |

### 3.2 What's NOT shipped (gaps to close in 10b–10f)

| Gap | Sub-step that closes it |
|---|---|
| **Staging GCE VM is torn down.** Last live state was 2026-05-04 at `34.19.223.135` (chunks 11g.3+ have been local-only). Service account + Artifact Registry + Docker image preserved; VM, static IP, firewall rules torn down. | 10b |
| **No `server/bench/` perf harness.** Directory does not exist. `PHASE_4_5_BASELINE.{json,md}` (target output per PLAN.md 11g.10) are not yet written. | 10c |
| **No Mandate-target measurement against shipped engine.** Latency / throughput / drift have never been measured end-to-end against the Phase 4.5 stack on GCE. | 10c |
| **No Cloud Monitoring dashboards or alert policies.** The structured-logger foundation (11g.7-7a) emits the events; nothing consumes them yet. The 11g.7-7a Decision Log entry referenced "Cloud Monitoring dashboards-as-code, log-based metrics, alert policies" — only 7a shipped. | 10d |
| **Engine runbooks are pgmq-era stale.** `docs/RUNBOOKS/draft-engine-v2-{operations,staging-preflight,known-issues}.md` reference `pgmq.q_draft_deadlines`, `pgmq.purge_queue`, `draft_generation`, and other removed surface. KI-007/KI-009 RESOLVED + KI-004 SUPERSEDED annotations added 2026-05-12 but the bodies still describe the legacy architecture. | 10e |
| **No rollback playbook for persistent-engine world.** Post-11g.9, legacy pgmq path is permanently gone; rollback = git revert + redeploy + engine restart (event-replay/snapshot-bootstrap recovers state). This is not yet documented anywhere. | 10e |
| **No production cutover plan.** No league-by-league rollout strategy. No canary criteria. No post-cutover monitoring playbook. | 10f |

### 3.3 What's known about staging

Preserved per chunk 11g.2 (Decision Log 2026-05-04):

- Service account: `citrus-draft-engine@citrus-fantasy-staging.iam.gserviceaccount.com`
- Artifact Registry repo: `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/...`
- Docker image: most-recent build from chunk 11g.2 era (pre-chunks 11g.3 through 11g.9)
- Region: `northamerica-northeast1` (Montreal) — locked per Decision Log 2026-04-30
- Machine type: `e2-medium` (2 vCPU, 4 GB) — locked per Zach 2026-04-30
- Container OS pattern: Debian VM + Docker (NOT COS `--container-image`, which is deprecated)
- Startup script: `infra/gce/draft-engine-startup.sh` pattern

10b will need to:
1. Rebuild the Docker image off `phase-4-5-implementation` tip (includes all of chunks 11g.3–11g.9, which were never deployed).
2. Re-provision the VM (static IP, firewall rules, VM itself).
3. Wire `SUPABASE_DB_URL` direct-connection env var (required by chunk 11g.7-7e LISTEN/NOTIFY — pgbouncer-pooled connections drop LISTEN frames).
4. Run smoke tests against staging to verify all chunks 11g.3+ work in deployed form, not just locally.

---

## §4 Mandate § Binding Patterns: Architecture Compliance

Verification that each of the 5 binding architectural patterns from §1.3 is satisfied by shipped infrastructure. Catches drift cheaply.

| # | Pattern | Compliance | Evidence |
|---|---|---|---|
| 1 | **Persistent stateful worker per active draft.** | ✅ Satisfied | `LobbyManager` (chunk 11g.3); one instance per active draft held in `LobbyRegistry` for the lifetime of the draft; in-memory state (`picksMade`, `currentNomination`, `teamBudgets`, ring buffer) persists across actions. Server `server/src/draft/index.ts` is a long-lived Node process; no stateless invocations on the hot path. |
| 2 | **WebSocket transport for live drafts.** | ✅ Satisfied | uWS server (chunk 11g.2) listens on port 3002; clients connect with draft JWT (chunk 11g.1); all picks, broadcasts, timer updates, chat flow through bidirectional WS. No HTTP polling on the hot path. HTTP snapshot endpoint (chunk 11g.7-7b) is for cold resync only, not live updates. |
| 3 | **In-memory candidate pool and pre-computed scoring per draft.** | ✅ Satisfied | `autopickStrategy.ts` (snake/linear) + `auctionAutoNominateStrategy.ts` (auction) use in-memory candidate state. KI-010 Tier 1 perf bake-ins (Decision Log 2026-04-29) committed to `LobbyManager._candidates` cached at draft start, updated in place on pick events. No per-pick Postgres query for the candidate pool. |
| 4 | **Postgres as durability and disaster recovery, not hot path.** | ⚠️ Compliant in substance; CLAUDE.md wording is stale. | The principle holds: Postgres = durability via `draft_events` event log + `draft_picks_v2` / `auction_nominations` / `auction_budgets` projection tables; the hot path is uWS broadcast, not Postgres. **CLAUDE.md wording references "pgmq scheduler" — pgmq was removed entirely in chunk 11g.9 (commit `9f72fd8`, 2026-05-12).** The role pgmq played (cross-process scheduling) is now filled by LISTEN/NOTIFY (chunk 11g.7-7e) — also Postgres-native, also off the hot path, also durability-only. CLAUDE.md should be updated to reflect the LISTEN/NOTIFY substitution; that update is out of scope for 10a and lives in a follow-up CLAUDE.md sync (open item). |
| 5 | **WebSocket reconnection with state snapshot recovery.** | ✅ Satisfied | Chunks 11g.5a/5b ship the client-side reconnect state machine with `last_seen_seq` resume; chunk 11g.7-7b ships the HTTP snapshot endpoint for >200-event gaps; chunk 11g.7-7c ships periodic snapshot persistence. Reconnect path is end-to-end. Target verification at 10c (p95 ≤ 2000ms). |

**Open item from this audit:** CLAUDE.md pattern #4 wording. Surfaces during 10c if the wording would confuse measurement-method discussions; otherwise resolves at the next CLAUDE.md sync. Not blocking.

---

## §5 Mandate § Non-Negotiables: Operational Discipline

How each remaining sub-step respects the §1.5 rejected framings. If 10c surfaces a Mandate gap, **this section disallows deferral** — the gap gets closed, not rationalized.

| Rejected framing | How 10b–10f respects it |
|---|---|
| **"We can optimize this later"** | 10c is the gate. Any Mandate target missed by > 10% triggers targeted optimization in the same chunk 11g.10 envelope, not a punt to Phase B+ work. The chunks 11g.0–11g.9 baseline already absorbed the "build it right the first time" cost (KI-010 Tier 1 baked into chunks 11g.3 + 11g.4). |
| **"It's only slow in the autopick path"** | The Mandate measures autopick as a first-class p95/p99. 10c measures autopick latency on equal footing with manual pick latency. The harness produces a per-target verdict; "autopick failed but manual pick passed" is a 10c **fail**, not a partial pass. |
| **"Most users won't notice"** | 10c's benchmark configuration mirrors realistic production load (12-team lobbies, 5+ concurrent drafts) rather than a single-user happy path. Per-target p95/p99 reporting prevents averaging-away tail latencies that real users experience. |
| **"It's competitive with v1"** | 10c's success criteria are the CLAUDE.md absolute thresholds, not deltas against v1. v1 is not referenced. |
| **"It's good enough for the demo"** | This plan exists post-Web-Summit. Demo deadlines do not influence 10c's pass/fail. The bar is the Mandate. |
| **"The architecture supports optimization later"** | If a Mandate gap is structural (not tuning-friendly), 10c documents the structural fix and 10c does not close until the fix lands. "Later" is scheduled and bounded — within chunk 11g.10's timeline, not punted to chunk 11g.11 or Phase 5. |

**The discipline is binding on 10b–10f's reviewer (Garrett).** Sub-step sign-offs reject any of these framings. The CLAUDE.md Mandate `wins` clause (line 58) is the tiebreaker on disputes.

---

## §6 Sub-Step Decomposition (10a–10f)

| Sub-step | Deliverable | Effort (focused-work) | Dependencies | Parallel-safe with |
|---|---|---|---|---|
| **10a (this)** | Plan document + Mandate consolidation + sub-step decomposition + risk register + 10f sign-off criteria | ~1 day | None | — |
| **10b** | Staging re-provisioning + smoke verification | ~1–2 days | 10a | — (must precede 10c/10d) |
| **10c** | Perf measurement harness (`server/bench/`) + execution against staging + `PHASE_4_5_BASELINE.{json,md}` committed | ~3–5 days | 10b | 10d, 10e |
| **10d** | Cloud Monitoring dashboards + alert policies (native gcloud / Config Connector per chunk 11g.2 decision; no Terraform) | ~2–3 days | 10b | 10c, 10e |
| **10e** | Runbook rewriting (3 engine runbooks + new rollback playbook) + new persistent-engine KIs | ~1–2 days | None hard (parallel-safe with 10a, 10b, 10c, 10d — runbook work doesn't need deployed infrastructure; pgmq content needs to go regardless of staging state) | 10a, 10b, 10c, 10d |
| **10f** | Production cutover plan: canary strategy, league-by-league rollout playbook, post-cutover monitoring playbook, cutover sign-off criteria | ~1 day | 10c (baseline), 10d (monitoring), 10e (runbooks) | — (gate to Phase 5) |
| **Total** | | **~10–14 focused-work days** | | |

### 6.1 10b detail — Staging re-provisioning + smoke verification

**Deliverable.** A live GCE staging VM running the `phase-4-5-implementation` tip, with the chunk 11g.7-7e LISTEN/NOTIFY path verified end-to-end. Documented in a Decision Log entry + an updated `PHASE_4_5_GCE_PLATFORM_NOTES.md`.

**Steps.**
1. Rebuild Docker image off branch tip (includes chunks 11g.3–11g.9 never previously deployed).
2. Provision: static IP, firewall rules (tcp:3001 + tcp:3002), VM (`e2-medium`, `northamerica-northeast1`).
3. Configure secrets: `SUPABASE_JWT_SECRET` via GCP Secret Manager; `SUPABASE_DB_URL` direct-connection (not pooled — pgbouncer drops LISTEN frames per chunk 11g.7-7e Decision Log 2026-05-11).
4. Deploy via `infra/gce/draft-engine-startup.sh` (Debian + Docker pattern, not COS `--container-image` deprecated flag).
5. Smoke tests: existing `scripts/smoke-uws-step2.js` against staging (WS auth) + manual: HTTP snapshot endpoint roundtrip + heartbeat timeout + LISTEN/NOTIFY self-test (the migration's embedded checklist).
6. Document any net-new gotchas in `PHASE_4_5_GCE_PLATFORM_NOTES.md` §11.

**Pass criteria.**
- All 4 smoke-uws-step2.js scenarios PASS against staging.
- HTTP `GET /api/drafts/:id/snapshot` against an active league returns 200 with valid snapshot.
- Engine startup logs include `event_subscription.started` within 5 seconds.
- Triggering an RPC from psql produces `event_subscription.notification_received` within 1 second.

**Fail mode.** Re-provisioning surfaces a config drift between local + staging (most likely candidate: `SUPABASE_DB_URL` pooling) → fix in 10b, do not advance.

### 6.2 10c detail — Perf measurement harness + execution

**Deliverable.** `server/bench/` directory + `PHASE_4_5_BASELINE.json` (machine-readable per-target metrics) + `PHASE_4_5_BASELINE.md` (human-readable summary) committed.

**Harness scope.**
- Drives load against staging via WS clients (mirrors realistic 12-team lobby × N concurrent lobbies).
- Captures per-action timestamps: `client_send_ts`, `server_receive_ts` (from structured logs), `rpc_commit_ts` (from logs), `client_receive_broadcast_ts`.
- Reports per-Mandate-target p50/p95/p99 + throughput + error rate.
- Records environmental context: VM machine type, region, Postgres connection settings, engine git SHA.

**Two-harness split (Decision Log entry per user feedback).**
- `server/bench/` (this harness, **new**) — WS engine / Mandate-target measurement. Sized to the chunks 11g.2–11g.9 architecture.
- `scripts/load-test/` (existing k6 suite) — app-perimeter / PostgREST / general-API testing. Stays calibrated to its current targets (Cloud Run API + Supabase Realtime). No rewrite in 10c.

Rationale: each tool sized to its target architecture. Conflating them would require rebuilding either to serve both — strictly worse than two focused tools.

**Pass criteria.** All 6 Mandate targets from §1.2 met:
- Manual pick p95 ≤ 300ms / p99 ≤ 500ms
- Autopick p95 ≤ 1000ms / p99 ≤ 2000ms
- Draft state load p95 ≤ 1500ms
- Timer drift < 100ms
- Pick-to-broadcast fanout p95 ≤ 200ms
- Reconnection recovery p95 ≤ 2000ms

Plus `git grep "KI-010 Tier 1"` returns ≥ 4 hits in `server/src/draft/` (per PLAN.md 11g.10 acceptance criterion — the optimizations are verified-in-place).

**Fail criteria.** Any target missed by > 10% triggers targeted optimization within chunk 11g.10. No deferral to Phase B+ per §5.

**Note on harness build vs. execution.** The first 1–2 days are harness scaffolding; the remaining 2–4 days are run + analyze + iterate. If first runs surface a Mandate gap, optimization work absorbs the remaining 10c budget.

### 6.3 10d detail — Cloud Monitoring + alert policies

**Deliverable.** GCP Cloud Monitoring dashboards committed as code (native gcloud / Config Connector per chunk 11g.2 "no Terraform, all in one uniform place" Zach principle). Alert policies committed alongside.

**Dashboard scope.**
- Engine SLO dashboards keyed to chunk 11g.7-7a structured-logger events (`correlationId`, `leagueId`, `lobbyId`, `event` namespaces).
- Per-Mandate-target latency dashboards (manual pick, autopick, broadcast fanout, snapshot, reconnect).
- Engine-internal health: lobbies-active, WS connections-active, RPC error rate, heartbeat-timeout rate.

**Alert policy scope.**
- `snapshot.bootstrap.fallback_full_replay` rate (warn) — non-zero indicates engine restart with no usable snapshot; investigates `reason` discriminator.
- `heartbeat.pong_timeout` rate (warn) — non-zero indicates zombie connections / mobile-network instability.
- `event_subscription.connection_lost` + reconnect attempts (warn after N retries) — LISTEN/NOTIFY plumbing health.
- RPC error rate on `submit_pick_v2` / auction RPCs (warn) — anything > 1% in any 5-min window pages.
- Mandate-target p95 breach (warn, then critical) — feeds back into 10c baseline.

**Pass criteria.**
- Dashboards live on staging with non-zero data (i.e., harness from 10c has run and the dashboards show real numbers, not synthetic test data).
- Alert policies fire end-to-end through a deliberate test trigger (e.g., kill staging engine and verify the appropriate alert lands).

**Out of scope for 10d.** PagerDuty / on-call rotation routing — that's Phase F per project plan. 10d configures alerts on staging; production routing is a Phase F deliverable.

### 6.4 10e detail — Runbook rewriting + rollback playbook

**Deliverable.** Three engine runbooks rewritten for the post-pgmq world; one new rollback playbook; net-new persistent-engine KIs.

**Files touched.**
- `docs/RUNBOOKS/draft-engine-v2-operations.md` — heavy rewrite. Pgmq sections deleted; replaced with persistent-engine operations: "How to drain a stuck LobbyManager", "How to force snapshot persistence", "How to interpret LISTEN/NOTIFY reconnect storms", "How to read structured-logger events for incident triage".
- `docs/RUNBOOKS/draft-engine-v2-staging-preflight.md` — heavy rewrite. `pgmq install verification` and `draft_generation` checks deleted; replaced with persistent-engine preflight: WS handshake check, `SUPABASE_DB_URL` direct-connection verification, snapshot persistence enablement check, structured-logger emission verification.
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — partial rewrite. KI-007 / KI-009 RESOLVED + KI-004 SUPERSEDED annotations are already in place (added 2026-05-12 by chunk 11g.9). 10e adds net-new persistent-engine KIs surfaced during 10b–10d: any operational quirks, any monitoring blind spots, any rollback-path edge cases.
- **NEW**: `docs/RUNBOOKS/draft-engine-v2-rollback-playbook.md` — net-new doc.

**Rollback playbook scope.**
- Post-11g.9 the legacy pgmq path is permanently gone. Rollback = `git revert` + redeploy.
- Engine restart recovery = automatic via chunk 11g.7-7c snapshot+delta bootstrap; chunk 11g.4 step 6b full-replay bootstrap is the belt-and-suspenders fallback.
- Specific scenarios documented: (a) bad migration applied to staging; (b) engine binary regression deployed; (c) Postgres connection pool exhaustion; (d) LISTEN/NOTIFY misconfiguration post-deploy; (e) snapshot table corruption.
- Each scenario: detection signal → mitigation steps → rollback decision tree → recovery verification.

**Pass criteria.**
- `git grep -n "pgmq\|draft_generation\|generation_bumped\|draft_deadline_sweep\|draft-autopick" docs/RUNBOOKS/` returns zero references to the removed surface in any rewritten runbook (KI annotations explaining the historical removal are acceptable).
- Rollback playbook reviewed by Garrett against at least one scenario (dry-run, no staging changes — running a scenario against staging is 10b/10c territory, not 10e).
- Net-new KIs filed for any operational quirks 10b/10c/10d surfaced.

**Parallel-safe positioning.** 10e can start immediately, in parallel with 10a (this sub-step), or before 10b. Pgmq content needs to go regardless of staging state; runbook clarity benefits the rest of the chunk. The user explicitly asked this be surfaced as a productivity option.

### 6.5 10f detail — Production cutover plan

**Deliverable.** A cutover plan document. Concrete enough that the actual cutover work (Phase F per project plan, post-load-test) can execute against it.

**Plan scope.**
- **Canary strategy.** First production traffic = a single low-stakes league (commissioner pre-briefed). Success criteria + abort criteria.
- **League-by-league rollout playbook.** Order of leagues (size, stakes, commissioner reachability). Per-league rollout actions. Per-league monitoring checkpoints.
- **Post-cutover monitoring playbook.** Which dashboards (from 10d) to watch in the first hour, first day, first week. Alert thresholds tightened post-cutover vs staging.
- **Cutover sign-off criteria.** Mirrors §7 below — the operational gates that say "yes, ship this to the next league".
- **Cutover rollback.** When to abort, who decides, what the user-facing communication looks like.

**Pass criteria.**
- Document committed.
- Garrett signs off as cutover executor.
- Plan references 10c baselines, 10d dashboards, 10e runbooks — all three must exist before 10f can be ratified.

---

## §7 Timeline + Sequencing

### 7.1 Phase mapping (per `PHASE_4_5_PROJECT_PLAN.md`)

- **Today (2026-05-12)** = inside Phase A "Web Summit & recovery" window (May 1–May 18). Web Summit was 2026-05-11.
- **Phase B** = May 19–July 31 = ~10 weeks. 10b–10f land here. The PROJECT_PLAN's Phase B brief says "Chunks 11g.2 through 11g.10 from PHASE_4_5_PLAN.md" — chunks 11g.0–11g.9 shipped ahead of that window; 11g.10 (this productionization work) inherits the Phase B envelope.

### 7.2 Calendar mapping

> **Effort estimates above (§6) reflect focused-work hours; calendar
> duration depends on solo-founder bandwidth allocation. 10–14
> focused-work days probably translates to 3–4 calendar weeks given
> parallel commitments** (Phase C workstreams: auction implementation,
> co-manager schema, push notifications all run June 1+).

### 7.3 Sequencing

```
10a (now, 2026-05-12) ─┐
                       │
10e (start immediately, parallel-safe) ─┐
                       │                │
10b (May 19+) ─────────┴───┐            │
                           │            │
10c ──────────┐            │            │
              │            │            │
10d ──────────┴─ parallel-safe with 10c, 10e
              │
10f ──────────┴── after 10c + 10d + 10e
```

10a + 10e can both ship before 10b — neither needs deployed infrastructure. 10c and 10d run in parallel after 10b. 10f is the closer that requires the other three.

### 7.4 Phase 5 (UI) entry gate

Per PHASE_4_5_PLAN.md 11g.10 and §8 below: Phase 5 (UI work on the Phase 4.5 architecture) does NOT start until 10f signs off. That's a binding gate, not a soft preference.

---

## §8 10f Sign-Off Criteria

Concrete enumeration of what Phase 5 (UI) entry looks like operationally. All bullets must be true; sign-off is binary.

1. **Mandate compliance.** All 6 Mandate targets from §1.2 verified at staging perf via the 10c harness. Per-target p95/p99 + drift recorded in `PHASE_4_5_BASELINE.json`. Zero targets missed.
2. **Architecture compliance.** `git grep "KI-010 Tier 1"` returns ≥ 4 hits in `server/src/draft/` (KI-010 verifies the Tier 1 optimizations are in place, not deferred). The §4 binding-patterns audit re-runs clean (or any drift flagged in this audit is documented).
3. **Monitoring live with non-zero data.** Cloud Monitoring dashboards from 10d are populated with real metrics from staging (i.e., 10c has run and the dashboards are showing real engine activity, not synthetic placeholder data). Alert policies have been test-fired end-to-end at least once.
4. **Runbooks rewritten + reviewed.** All three engine runbooks rewritten per 10e. The rollback playbook exists and has been dry-run reviewed by Garrett against at least one scenario.
5. **Rollback path tested.** At least one rollback scenario (e.g., "bad migration applied to staging" or "deploy a known-broken engine binary") has been exercised end-to-end on staging. The persistent-engine recovery path (snapshot+delta bootstrap from chunk 11g.7-7c) has been observed to recover state cleanly on at least one engine restart during the 10b–10d window.
6. **Canary plan ratified.** 10f's cutover plan exists, referenced 10c/10d/10e artifacts, and has been ratified by Garrett as executor.

**On 10f sign-off, Phase 5 (UI) unblocks.** Until then, no UI work is started against the Phase 4.5 architecture (per CLAUDE.md §1.6: "Phase 5 must NOT be built against the Phase 0-4 architecture alone").

---

## §9 Risk Register

### R10A — Mandate gap surfaces during 10c (medium probability, medium impact)
10c is the first end-to-end Mandate measurement against the shipped engine on real GCE infrastructure. A gap is possible (manual pick target is the tightest at 300ms p95). **Mitigation:** §5 non-negotiables disallow deferral — gap closure absorbs remaining 10c budget. Worst case 10c slips by 3–5 days; calendar slips into late Phase B (June). **Pre-emptive design:** KI-010 Tier 1 optimizations baked into chunks 11g.3 + 11g.4 — the underlying architecture was sized against the Mandate targets, so any gap is more likely tuning than structural.

### R10B — Staging re-provisioning surfaces config drift (medium probability, low impact)
Local-only chunks 11g.3–11g.9 may have introduced env-var dependencies or behaviors that don't survive Docker / GCE deploy. Most likely candidate: `SUPABASE_DB_URL` pooled-vs-direct (chunk 11g.7-7e is sensitive to this). **Mitigation:** 10b smoke tests are the diagnostic gate. The 11g.7-7e migration's embedded post-deploy checklist explicitly tests for the LISTEN/NOTIFY misconfiguration. Surfaces in 10b, fixes in 10b. Calendar impact ~1 day if so.

### R10C — Single-operator risk (high impact if it happens, ongoing probability)
**Solo founder is the only person who can execute productionization.** Calendar duration is sensitive to founder availability. Phase C workstreams (auction, co-manager, push) start June 1+ in parallel; bandwidth contention is real. **Mitigation:** incremental sub-step delivery so any single sub-step can be picked up after a gap without losing context; clean Decision Log entries on each sub-step preserve resumability; 10a (this document) IS the operational onboarding doc — Zach could read it cold and pick up 10b–10f with no further handoff.

### R10D — k6 suite drift becomes a liability (low probability, low impact)
The existing `scripts/load-test/` k6 suite is calibrated to the old Cloud Run + Supabase Realtime architecture. It is NOT being rewritten in chunk 11g.10 (per §6.2 two-harness Decision Log). If a future engineer assumes the k6 suite tests the new engine, they'd run it and conclude wrongly. **Mitigation:** `scripts/load-test/README.md` should get a small note clarifying its scope ("app-perimeter / general API; engine Mandate measurement is in `server/bench/`"). Net-new task in 10c when it touches the bench-vs-load-test boundary. Not a chunk 11g.10 deliverable; flagged here so it doesn't get lost.

### R10E — Cutover plan ratification slips past launch buffer (low probability, medium impact)
10f gates Phase 5 (UI). If 10f drags into July, Phase 5's window compresses; if Phase 5 drags, the load test gate (Phase D, Aug 24) compresses. **Mitigation:** keep 10f genuinely scoped to ~1 day (cutover plan, not cutover execution); cutover execution is Phase F territory anyway. If 10f reveals work that should be in cutover execution rather than plan, the plan describes it and Phase F absorbs the execution.

### R10F — CLAUDE.md staleness creep (low probability, low impact)
CLAUDE.md §1.3 pattern #4 references pgmq — stale post-11g.9. The §4 audit caught this; updates flow CLAUDE.md → this doc, not the reverse. **Mitigation:** open item explicitly logged; sync happens at next CLAUDE.md touch (e.g., when Phase 5 kicks off and updates the doc). Not a 10a deliverable; not a blocker.

---

## §10 Success Criteria

Chunk 11g.10 is **complete** when:

1. All §8 10f sign-off criteria are met.
2. PROJECT_PLAN.md Phase B work-item "Chunk 11g.10" carries a `**COMPLETE (commit-sha, date)**` annotation in its Decision Log entry.
3. PHASE_4_5_PLAN.md 11g.10 section carries a status line documenting completion.
4. This document (PHASE_4_5_PRODUCTIONIZATION_PLAN.md) carries a closing Decision Log section enumerating which sub-steps shipped on which dates, with SHAs, and any surprises surfaced during execution.

**Phase 5 (UI) starts after chunk 11g.10 is complete and not before.**

---

## §11 Decision Log (this plan)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-12 | Plan doc created at `docs/PHASE_4_5_PRODUCTIONIZATION_PLAN.md` separate from `PHASE_4_5_PLAN.md` | Depth required (risk register, monitoring spec, cutover playbook) warrants dedicated doc. PHASE_4_5_PLAN.md's 11g.10 section becomes a pointer + decomposition table. |
| 2026-05-12 | Mandate quoted verbatim from CLAUDE.md (lines 1–58); CLAUDE.md is the canonical source of truth | Faithful representation; no paraphrasing drift. Updates flow CLAUDE.md → this doc. |
| 2026-05-12 | Sub-step decomposition 10a–10f with effort estimates ~10–14 focused-work days | Splits productionization into distinct deliverables (planning, staging, perf, monitoring, runbooks, cutover) rather than treating chunk 11g.10 as a single-deliverable sprint. |
| 2026-05-12 | k6 / `server/bench/` two-harness split | Two harnesses by design: `scripts/load-test/` (k6) for app-perimeter / PostgREST / general-API testing; `server/bench/` for WS engine / Mandate-target measurement. Each tool sized to its target architecture. Conflating them would force a rewrite that strictly degrades both. |
| 2026-05-12 | Mandate compliance verification approach: §4 (Binding Patterns) audit + §5 (Non-Negotiables) operational discipline checklist | Catches both structural drift (§4) and rationalized-deferral drift (§5) cheaply, before 10c's empirical measurement. |
| 2026-05-12 | Solo-founder risk surfaced as R10C in risk register | Single-operator productionization is the load-bearing operational risk. Incremental sub-step delivery + clean Decision Log entries are the mitigation. |
| 2026-05-12 | 10e positioned parallel-safe (can start immediately, before 10b) | Runbook rewriting doesn't require deployed infrastructure; pgmq content needs to go regardless of staging state. Banking 10e early is a productivity option. |
| 2026-05-12 | 10a delivers a planning artifact, not deployed code | This sub-step's deliverable is this document. No code changes, no staging changes. 10b is where infrastructure changes begin. |

---

## §12 Cross-references

- [`CLAUDE.md`](../CLAUDE.md) § "Citrus Draft Performance Mandate" — source of truth for §1.
- [`PHASE_4_5_PLAN.md`](./PHASE_4_5_PLAN.md) § "Chunk 11g.10" — one-paragraph pointer to this doc + decomposition table.
- [`PHASE_4_5_PROJECT_PLAN.md`](./PHASE_4_5_PROJECT_PLAN.md) — Phase A/B/C/D/E/F/G calendar; Decision Log entries 2026-05-12 reference this doc's creation.
- [`PHASE_4_5_GCE_PLATFORM_NOTES.md`](./PHASE_4_5_GCE_PLATFORM_NOTES.md) — staging deployment shape from chunk 11g.2.0 spike; 10b updates the post-re-provision state.
- [`PHASE_4_5_ARCHITECTURE.md`](./PHASE_4_5_ARCHITECTURE.md) — canonical architecture; §1.3 binding patterns map to architecture pieces here.
- [`adr/ADR-001-persistent-node-draft-engine.md`](./adr/ADR-001-persistent-node-draft-engine.md) — the architectural commitment that shaped chunks 11g.0–11g.9.
- [`REGISTRY.md`](./REGISTRY.md) — project-wide KIs; KI-009 RESOLVED (2026-05-12) is the foundation that this productionization plan rests on.
- [`RUNBOOKS/draft-engine-v2-known-issues.md`](./RUNBOOKS/draft-engine-v2-known-issues.md) — engine-specific KIs; 10e adds net-new persistent-engine entries.
