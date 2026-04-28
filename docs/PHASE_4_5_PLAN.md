# Phase 4.5 + 4.6 — Elixir/Phoenix Draft Engine Implementation Plan

| | |
|---|---|
| **Status** | Plan accepted (2026-04-27). Implementation not yet started. |
| **Authority** | `docs/adr/ADR-001-elixir-phoenix-draft-engine.md` (the architectural decision); `CLAUDE.md` § Citrus Draft Performance Mandate (the binding performance targets). |
| **Predecessor** | Phase 4 closeout, with autopick latency ~11.7s/pick measured on staging — non-competitive per the Mandate. |
| **Successor** | Phase 5 (UI client work) is **blocked** until Phase 4.6 sign-off. |
| **Estimated solo-founder timeline** | Phase 4.5 (foundation) ~3 weeks; Phase 4.6 (production-ready) ~4 weeks; ~16 weeks realistic with cushion for unknowns and the KI-010 learning-curve risk. |

## Working discipline (carried forward from Phase 0–4)

- **One chunk per commit.** Each chunk pushed and reviewed before the next starts.
- **Pause for review at every chunk gate.** No silent drift between chunks.
- **No deferral lands without a registry row.** New issues that surface during the build go into `docs/REGISTRY.md` (project-wide concerns) or `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (draft-engine-specific) at commit time.
- **Performance Mandate is the binding constraint for every chunk.** Any chunk that introduces a new latency-sensitive surface must measure it; any chunk that fails a target either fixes it before the next chunk starts or registers a KI- with a bounded resolution timeline.
- **Cross-runtime contract is the integration boundary.** Elixir engine ↔ Postgres uses the existing Phase 2 RPCs; Elixir engine ↔ browser clients uses Phoenix Channels. Both contracts are documented at the chunk that establishes them and don't change without an ADR.

## Performance targets (binding, from `CLAUDE.md` § Citrus Draft Performance Mandate)

These are the constraints every chunk's acceptance criteria reference:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms
- Draft state load: p95 ≤ 1500ms
- Timer drift: < 100ms across all clients
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Reconnection recovery: p95 ≤ 2000ms

A chunk's "performance gate" is a measured-on-staging assertion against these targets, scoped to whatever surface the chunk introduces.

---

## Phase 4.5 — Foundation (weeks 1–3)

The goal of Phase 4.5 is a **single working draft running end-to-end on staging**, with measured performance meeting the Mandate, integration with Postgres clean, and the solo founder's Elixir productivity confirmed.

The Week 1 sign-off (after chunk 4.5.2) is the KI-010 go/no-go gate. The Week 3 sign-off (after chunk 4.5.8) is the Phase 4.6 entry gate.

### Chunk 4.5.1 — Elixir + Phoenix install, repo layout, dev loop

**Deliverable.** Elixir 1.16+ and Erlang/OTP 26+ installed on the dev environment. Phoenix 1.7+ project scaffolded under `elixir/citrus_draft/` (or whatever path the chunk decides; document it). `mix phx.new --no-html --no-assets --no-mailer citrus_draft` (API-only, no LiveView) tested running locally. iex REPL works. ExUnit test runner passes the default scaffolded tests. CI hook lands but does not run yet (placeholder workflow that will be wired up in chunk 4.6.4).

**Dependencies.** None. Pure setup chunk.

**Acceptance criteria.**
- `cd elixir/citrus_draft && mix test` passes the scaffolded tests.
- `mix phx.server` boots locally; `curl localhost:4000` returns the default response.
- `iex -S mix phx.server` opens a REPL with the project loaded.
- The repo's top-level README documents how to install Elixir/Erlang and run the local dev loop. Same level of detail as the existing Node setup docs.

**Performance targets.** None for this chunk; pure infrastructure.

**Estimated effort.** 1 day. Mostly install + configuration. Buffer for any cliffs around asdf/Homebrew/etc.

---

### Chunk 4.5.2 — Phoenix chat tutorial + Week 1 validation gate

**Deliverable.** The canonical Phoenix chat tutorial (or equivalent — point is to feel out Phoenix Channels end-to-end) running locally. One non-trivial extension on top: a per-room rate limiter implemented as a separate GenServer, demonstrating that the solo founder can compose actor-model components rather than just copy-paste. A short writeup (paragraph or two) committed alongside the code: how `DraftServer` will be structured given what the tutorial taught, in concrete enough detail to suggest real understanding.

**Dependencies.** 4.5.1.

**Acceptance criteria — and the KI-010 Week 1 sign-off gate:**
- The chat tutorial works: two browser tabs can exchange messages over a Phoenix Channel.
- The rate-limit extension works: messages exceeding the configured rate from one user are dropped (or queued, if implemented that way) without affecting other users in the same room.
- The writeup describes `DraftServer`'s state shape, message protocol, supervision approach, and recovery flow at a level of specificity that suggests the solo founder _gets it_.
- Subjective gate (per ADR-001 § Validation Gates Week 1): the dev loop feels productive, not painful. Editing/recompiling/testing is fast. The actor model maps onto the domain.

**Pass:** proceed to chunk 4.5.3.
**Fail:** **stop**. Re-evaluate per KI-010. If pivoting to Go is the call, a follow-up ADR-002 supersedes ADR-001's language choice; otherwise rescope and try again.

**Performance targets.** None — the tutorial is for learning, not benchmarking.

**Estimated effort.** 3–5 days, depending on how much of the Elixir model needs to be internalized. This is the chunk where the KI-010 risk plays out.

---

### Chunk 4.5.3 — Postgres connection via Ecto, RPC client surface

**Deliverable.** Ecto 3.x configured against the staging Supabase Postgres. Read-only Ecto queries against `leagues`, `teams`, `draft_events`, `draft_picks_v2` working (verified via integration tests that read seeded fixtures). RPC-call wrapper module — a thin Elixir module that calls `submit_pick_v2`, `append_draft_event`, `reconstruct_draft_state` via raw SQL through Ecto, with the parameter shapes matching the Phase 2 RPC signatures byte-for-byte. UUIDv5 derivation of the autopick idempotency key implemented in Elixir using the same `AUTOPICK_NAMESPACE_UUID` as the existing TypeScript and SQL implementations; cross-runtime test asserts agreement against a known input vector.

**Dependencies.** 4.5.1, 4.5.2.

**Acceptance criteria.**
- An Elixir test calls `submit_pick_v2` against staging with a synthetic seed and verifies the projection trigger fires (i.e., a `draft_picks_v2` row lands).
- An Elixir test calls `reconstruct_draft_state` and parses the returned jsonb into an Elixir map matching the documented shape.
- UUIDv5 cross-runtime parity: given `(league_id, pick_number, generation, "autopick")`, the Elixir implementation produces the same UUID as `supabase/functions/draft-autopick/uuidv5.ts` and as `_v2_test._uuidv5` in the SQL test helpers. Three runtimes, one answer.
- Connection pooling configured. Ecto pool size, timeouts, and retry behavior documented.
- Cleanup: every test that mutates state uses an explicit DELETE-by-test-league-id or savepoint pattern; zero residue post-run.

**Performance targets.** None on this chunk's hot path (it's the foundation for the hot path), but baseline Ecto query latencies measured and recorded so chunk 4.5.5 (latency measurement) has a reference.

**Estimated effort.** 3–4 days.

---

### Chunk 4.5.4 — Single-draft `DraftServer` + `DraftChannel` skeleton

**Deliverable.** A `DraftServer` GenServer that holds the in-memory state for one draft: candidate pool, current pick number, generation, on-the-clock team, per-team queues, connected client set, last broadcast seq. `init/1` reconstructs state from Postgres via `reconstruct_draft_state` + the candidate pool query. `handle_call(:submit_pick, ...)` validates the pick against in-memory state, calls `submit_pick_v2`, updates the in-memory state on success, broadcasts to connected clients, returns the new state to the caller. A `DraftChannel` Phoenix Channel that joins clients to a per-draft topic, subscribes them to broadcasts, accepts `:submit_pick` events from the client, dispatches to the `DraftServer`, returns the result.

This chunk is single-draft only. No DynamicSupervisor yet — one server is started by hand in iex for the test. Multi-draft is chunk 4.5.6.

**Dependencies.** 4.5.3.

**Acceptance criteria.**
- A test seeds a draft on staging, starts a `DraftServer` for it manually, opens two WebSocket connections (mock clients), submits a pick from one, observes the broadcast on the other, verifies `draft_picks_v2` projection has the row, verifies `draft_events` has the pick event with correct `seq` and `idempotency_key`.
- The cross-runtime contract is exercised: the Elixir engine wrote via the existing Phase 2 RPC and the existing trigger fired correctly. Read the projection from a Node test client; it should be byte-identical to a pick committed via the existing TypeScript `DraftServiceV2` path.
- Server-side authoritative state: the `DraftServer`'s in-memory `current_pick_number` matches what the event log says after the pick.
- Idempotency: submitting the same pick twice via the channel returns `was_duplicate=true` from the second call without committing a second event.

**Performance targets** (first measurement against the Mandate):
- Manual pick submission (channel join → pick submit → broadcast received on other client): p95 ≤ 300ms over 100 trial picks. **This is the first hard performance gate.**

**Estimated effort.** 5–7 days. This is the chunk that proves the architectural shape works.

---

### Chunk 4.5.5 — Latency measurement harness

**Deliverable.** A standalone benchmark suite (`elixir/citrus_draft/bench/` or similar) that measures and reports against every Mandate target. Driver script seeds N drafts, opens M client connections per draft, runs picks at the deadline boundary, and emits a structured report: per-target p50/p95/p99 latency, throughput, error rate. Output is committed as part of the chunk so future chunks have a reference point and Week 3 sign-off has objective evidence.

**Dependencies.** 4.5.4.

**Acceptance criteria.**
- The harness measures, end-to-end on staging:
  - Manual pick latency (client submits → all connected clients have updated state)
  - Broadcast fanout (server commits → first/last client receives the broadcast)
  - State load (channel join → initial state delivered to the client)
  - Timer drift (server-displayed countdown vs. actual deadline, sampled across simulated clients)
- Report format: human-readable summary at the top, JSONL per-trial detail below for analysis. Committed to the repo alongside the harness.
- Re-running the harness is a single command: `mix bench` or equivalent.
- The current run's results meet every relevant Mandate target. **Failures fix forward, not in a follow-up chunk.**

**Performance targets.** All Mandate targets that have a corresponding measurement at this chunk's stage. (Autopick latency comes online in chunk 4.5.8 once the autopick path is implemented; reconnection in Phase 4.6.)

**Estimated effort.** 2–3 days.

---

### Chunk 4.5.6 — Multi-draft via `DynamicSupervisor` + `Registry`

**Deliverable.** `DraftSupervisor` (DynamicSupervisor) starts/stops `DraftServer` processes on demand. `DraftRegistry` (a `Registry` configured with `:unique` keys) lets the channel look up the per-draft server by `league_id` via `via_tuple/1`. Channel join handler ensures the server exists (start under supervision if not), then registers the connection. Server idle timeout: a `DraftServer` that has had no connected clients for N minutes shuts down gracefully, releasing memory; reconstructed on next join.

**Dependencies.** 4.5.4.

**Acceptance criteria.**
- Two simultaneous drafts run in the same Phoenix node, each with its own `DraftServer`. Picks in one draft don't appear in the other; broadcasts are scoped correctly.
- Crashing a single `DraftServer` (deliberately, in iex) causes the supervisor to restart it; the new server reconstructs state from the event log and connected clients reconnect via the channel's resume path. **No data loss.**
- Idle shutdown works: after the configured idle timeout (chunk picks the value; document it), a draft with no connected clients stops cleanly. Memory drops. Reconnect re-spawns.
- Latency benchmark from 4.5.5 still passes against multi-draft load (10 drafts running concurrently). Cross-draft interference is below noise.

**Performance targets.**
- All 4.5.4 targets continue to hold under 10 concurrent drafts.
- New: `DraftServer` start time (cold) ≤ 500ms. This is what bounds the "first user joins after a quiet period" experience.

**Estimated effort.** 3–4 days.

---

### Chunk 4.5.7 — State recovery from event log (formal)

**Deliverable.** The `DraftServer.init/1` recovery flow promoted from "calls reconstruct_draft_state" to a documented, tested, fault-tolerant procedure. Specifically: handles partial states (a draft mid-pause, a draft mid-extend, a draft after a generation bump), correctly identifies on-the-clock team across snake-order reversals, recovers per-team queues from `draft_queues`, recovers connected-clients-set from Phoenix presence on rejoin (not from the database — the client set is ephemeral by design). Handles the edge case where the engine recovers state but a sweep enqueued a stale pgmq message during the outage; the engine ignores those (the existing pgmq generation gate keeps them stale).

**Dependencies.** 4.5.6.

**Acceptance criteria.**
- Test suite: kill a `DraftServer` mid-draft (5 picks committed), restart via supervisor, verify reconstructed state matches what the event log says. Continue picking. Nothing visible to the client.
- Test suite: pause a draft via `draft_pause`, kill the engine, restart, verify the new server correctly identifies the draft as paused and rejects picks until resumed. Then call `draft_resume` and verify the engine accepts picks under the new generation.
- Test suite: simulate the disaster-recovery fallback path. With the Elixir engine intentionally down, the existing Edge Function `draft-autopick` autopicks an expired deadline. The Elixir engine boots back up and reconstructs state including the autopick that landed during the outage. No conflicts, no duplicate picks.
- Recovery latency: a `DraftServer` reconstructing state for an active draft (12 teams, 8 picks committed) completes init in < 1 second.

**Performance targets.**
- Draft state load (engine boot → first client can join and receive state): p95 ≤ 1500ms (Mandate target).

**Estimated effort.** 3–4 days. The disaster-recovery test scenario is the trickiest piece.

---

### Chunk 4.5.8 — Autopick port with in-memory candidate cache + Week 3 sign-off

**Deliverable.** The autopick path runs inside `DraftServer`. Candidate pool is loaded into memory at server init from `player_directory` + `player_season_stats` (CURRENT_SEASON), filtered against `draft_picks_v2` for already-picked players. The heuristic from `supabase/functions/draft-autopick/heuristic.ts` is ported to Elixir as a pure module — same algorithm, byte-for-byte: queue first (head of `draft_queues` for the on-the-clock team, filter to undrafted), heuristic fallback (FPTS + positional need, with the same default weights as the Node implementation). Deadline expiry inside the `DraftServer` (a `Process.send_after/3` timer) triggers the autopick: select via in-memory cache, call `submit_pick_v2` with `actor.kind='autopick'` and the same UUIDv5-derived idempotency key the Node and SQL paths produce, broadcast.

The Edge Function `draft-autopick` is **not** removed in this chunk. It stays paused on staging. Cutover to "Elixir engine is the primary path; Edge Function is the fallback" is a configuration change, not a code change.

**Dependencies.** 4.5.5, 4.5.6, 4.5.7.

**Acceptance criteria — and the Phase 4.6 entry gate per ADR-001 § Validation Gates Week 3:**
- A 12-team / 12-pick unattended draft runs to completion via the Elixir engine. Every pick is via autopick (no human clients). Total wall-clock time < 30 seconds.
- A 12-team / 180-pick (15 rounds) full unattended draft runs to completion via the Elixir engine. Total wall-clock time < 6 minutes (autopick p95 ≤ 1000ms × 180 picks ≈ 3 minutes; allow 2× for cushion).
- Cross-runtime parity: an autopick committed by the Elixir engine has the **same idempotency key** as the same logical pick would have had if committed by the Node Edge Function path. (Verified by computing the key in Elixir and asserting it matches the SQL `_v2_test._uuidv5` helper's output for the same inputs.)
- Latency benchmark from 4.5.5 passes every Mandate target: manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, draft state load p95 ≤ 1500ms.
- Operational story: the solo founder has runbook-quality notes on (a) deploying the Elixir engine to staging, (b) reading its logs, (c) restarting it cleanly, (d) what to do when the engine crashes mid-draft. Notes can be incomplete on hosting specifics (that's chunk 4.6.3) but must cover what's been measured.
- The Elixir codebase is maintainable: pattern-matched message handlers, clean module structure, ExUnit coverage on the hot paths, no `IO.inspect` left in shipped code.

**Pass:** proceed to Phase 4.6.
**Fail:** stop and review per ADR-001 § Validation Gates Week 3. Possible outcomes: targeted optimization, scope cut, or pivot back to Path 1.

**Performance targets.** All Mandate targets except reconnection (Phase 4.6).

**Estimated effort.** 5–7 days. The biggest chunk in Phase 4.5; closes the loop on the perf claim.

---

## Phase 4.6 — Production-readiness (weeks 4–7)

The goal of Phase 4.6 is **the engine is operationally credible in production**. Phase 4.5 ended with "it works on staging and meets the perf bar." Phase 4.6 ends with "we can run this in production without me being woken up at 3am for an outage we don't know how to handle."

Phase 5 (UI client work) starts at the end of Phase 4.6.

### Chunk 4.6.1 — Reconnection / resume protocol

**Deliverable.** A documented and tested reconnection protocol for browser clients. WebSocket dropped (network blip, page refresh, mobile context switch) → client reconnects → channel rejoin includes the client's last-seen `seq` → engine sends a state delta or full snapshot depending on the gap → client reconciles. Phoenix Channels' built-in reconnection logic is the substrate; the protocol on top of it handles the application-level state reconciliation.

**Dependencies.** Phase 4.5 complete.

**Acceptance criteria.**
- Test: open client, commit 3 picks, drop WebSocket connection forcibly, reopen connection, client receives the missed state without a full re-fetch.
- Test: open client, drop connection for 30 seconds, reconnect, client state reconciles. p95 ≤ 2000ms (Mandate reconnection target).
- Test: kill the engine mid-draft, restart, all clients reconnect and pick up from where they left off. (Distinct from chunk 4.5.7's engine-side test in that this verifies the client experience.)
- Test: figma-style scenario (`https://www.figma.com/blog/making-multiplayer-more-reliable/` informs this) — N clients, network partition split between two groups, partition heals, all clients re-converge to consistent state. N ≥ 4.

**Performance targets.**
- Reconnection recovery p95 ≤ 2000ms (Mandate target).

**Estimated effort.** 4–5 days.

---

### Chunk 4.6.2 — Multi-instance coordination

**Deliverable.** When the Elixir engine runs on more than one instance (whether for HA or because the autoscaler spun up a second one under load), each draft is owned by exactly one instance. Two instances cannot both run a `DraftServer` for the same draft — that would split the in-memory state, double-broadcast, and double-pick. Coordination via either (a) `:libcluster` + a global Registry across the cluster, (b) Phoenix Presence with cluster-wide deduplication, or (c) a Postgres-advisory-lock per-draft pattern. The chunk picks one based on hosting constraints (chunk 4.6.3 informs this).

**Dependencies.** 4.6.1.

**Acceptance criteria.**
- Test: two engine instances running locally (e.g., two `mix phx.server` on different ports clustered with `:libcluster`). Same draft attempted to be hosted by both: only one `DraftServer` exists; the other instance routes channel joins to the right node.
- Test: kill the instance hosting a draft mid-game; the surviving instance picks up the draft within N seconds (where N is the chunk's documented target — likely ≤ 5 seconds). Connected clients reconnect via 4.6.1's protocol.
- The cross-instance routing adds < 50ms of latency to picks routed via the non-owning instance. (For most drafts, all clients connect to the owning instance, so this is the worst-case path.)

**Performance targets.**
- All Mandate targets continue to hold under cross-instance routing for a fraction of the load.

**Estimated effort.** 4–6 days. This is operationally hairy; budget for cliffs.

---

### Chunk 4.6.3 — Hosting deployment (Fly.io evaluation + decision)

**Deliverable.** Production-ready hosting decision for the Elixir engine, with the deployment pipeline configured. The chunk evaluates Fly.io against alternatives (Render, Gigalixir, AWS ECS, GCP Cloud Run with always-on instances, self-hosted Kubernetes) on the dimensions that matter for this workload:

- WebSocket support and tail-latency characteristics
- Always-on instances (no cold starts on draft join — the Mandate's draft state load target depends on this)
- Multi-region placement options (most users are North American; a single US region is fine for v1)
- Cluster-friendly networking (for `:libcluster` if chunk 4.6.2 went that route)
- Deploy-without-dropping-connections support (Fly's blue/green; equivalents elsewhere)
- Ops surface and observability integrations
- Cost at the expected v1 scale (~50 concurrent drafts during peak draft season; trivial outside)
- Founder familiarity (lower-friction paths win ties)

The chunk's deliverable is the picked target deployed to staging with the engine running on it, full deploy → reconnect-without-dropping-clients verified, plus a one-page writeup of the evaluation rationale committed to the repo.

**Dependencies.** 4.6.2.

**Acceptance criteria.**
- The Elixir engine is deployed and running on the chosen hosting target's staging environment.
- WebSocket connections from a real browser to the deployed engine work end-to-end.
- A code change deployed via the production pipeline does NOT drop in-flight client connections (or, if it does briefly, the 4.6.1 reconnection protocol covers the gap so users don't notice).
- Latency benchmark from 4.5.5 re-runs against the deployed staging engine and meets every Mandate target.
- Cost projection at expected v1 scale documented.

**Performance targets.**
- All Mandate targets continue to hold against the deployed (not local) engine. This is the first measurement against real production network conditions; some adjustment may be needed.

**Estimated effort.** 5–7 days. Includes evaluation time. Expect surprises specific to whichever target gets picked.

---

### Chunk 4.6.4 — Observability + on-call runbook

**Deliverable.** Logs, metrics, and traces from the Elixir engine flow into the same aggregation as the Node main app (or document why they have to be separate). Critical alerts wired up: engine instance crash, draft state inconsistency between in-memory and event log, autopick latency p95 > Mandate target, reconnection failure rate > N%, message broadcast failure. On-call runbook documenting what to do for each alert: the indicator, the diagnosis, the remediation, the escalation. CI pipeline for the Elixir codebase enabled (the placeholder workflow from 4.5.1 wired up for real).

**Dependencies.** 4.6.3.

**Acceptance criteria.**
- Engine logs are queryable from the same place as Node app logs (or the runbook explicitly documents the second log surface).
- Each Mandate target has a corresponding metric. Dashboards exist showing trailing 24h p50/p95/p99 against target. Visible at a glance whether we're regressing.
- Alerts fire end-to-end: deliberately introduce a failure (e.g., kill the engine, deploy a regression in autopick latency), confirm the alert reaches the on-call surface (whatever it is — Discord webhook, email, etc.) within 5 minutes.
- Runbook is operationally credible: a fresh reader who has never touched the engine can read the runbook for an alert and know what to do, with a defined escalation path if the runbook's steps don't resolve it.
- CI pipeline runs `mix test` and `mix format --check-formatted` on every PR touching `elixir/`. Fails the PR on either failure.

**Performance targets.**
- N/A (this is the chunk that measures performance, not a chunk that introduces a new latency surface).

**Estimated effort.** 5–7 days.

---

## Phase 4.6 sign-off → Phase 5 unblocks

When 4.6.4 lands cleanly:

- Every Mandate target is met on the deployed engine.
- The dual-runtime production reality (KI-009) is operationally credible: deploy pipeline, observability, on-call runbook all in place.
- Solo-founder learning-curve risk (KI-010) is resolved: by definition of completing Phase 4.6, the founder is productive in Elixir. KI-010 closes.
- Phase 5 (UI client work) starts. The UI is built against the Elixir engine's WebSocket protocol from chunk 4.5.4 + the reconnection protocol from chunk 4.6.1. The Phase 0–4 server-side TypeScript pick path stays as a fallback for clients that can't open WebSockets but is no longer the primary path.

---

## Registry tracking during the build

New issues that surface during Phase 4.5 / 4.6 land in the appropriate registry at commit time:

- **Cross-cutting / project-wide concerns** → `docs/REGISTRY.md`. Examples: ops surface area changes, new external dependencies, hosting-cost surprises, security review gaps that span runtimes.
- **Draft-engine-specific concerns** → `docs/RUNBOOKS/draft-engine-v2-known-issues.md`. Examples: a specific Elixir performance gotcha around the BEAM scheduler, an Ecto query that needs an index added to Postgres, a Phoenix Channels behavior that diverges from documented expectation.
- **Spec-level concerns (changes to the cross-runtime contract)** → require an ADR. The cross-runtime boundary (RPC signatures, payload shapes, idempotency-key derivation, WebSocket message protocol) does not change without explicit governance.

Existing open KIs that interact with this work:

- **KI-003** (Phase 7 carryover): rate limiter session-affinity. The Elixir engine's `DraftServer` model effectively solves the per-instance rate limiter problem (per-draft state is per-instance by design). Re-evaluate KI-003 at the end of Phase 4.6 — likely RESOLVED by virtue of the architectural change.
- **KI-004** (Phase 8a target): hardcoded staging URL in keep-alive cron. Still applies if the Edge Function fallback path is retained. The cron's URL still needs to be Vault-resolved before prod cutover. No change.
- **KI-005** (Phase 8a target): DLQ paging trigger. Still applies — the Edge Function fallback path can still hit `read_ct >= 3` and write to `autopick_failures`. The Elixir engine's autopick path also writes to `autopick_failures` on terminal failure (chunk 4.5.8 deliverable). The paging trigger covers both.
- **KI-006** (Phase 7 target): heuristic O(N×M) candidate scan latency. **Largely resolved by chunk 4.5.8** — the Elixir engine's in-memory candidate cache eliminates the per-pick query that was the cost driver. The Phase 7 latency benchmark is now relevant only for the Edge Function fallback path. Re-evaluate at end of Phase 4.6.
- **KI-007** (Phase 7 target): vendored shared code drift. The Elixir engine introduces a third runtime that needs the same constants (`AUTOPICK_NAMESPACE_UUID`, scoring weights). Either keep the canonical-vs-vendored discipline (and add Elixir as a third vendor target) or move the shared constants to a language-neutral source (JSON file, env vars, dedicated table) that all three runtimes read. Decision deferred to Phase 4.6 chunk 4.6.4 alongside the broader observability work; track as **KI-007 expands to cover the third runtime**.

New KIs already filed at plan time:

- **KI-008**: Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft (architectural pivot rationale).
- **KI-009**: Operational complexity of dual-runtime production.
- **KI-010**: Solo founder learning curve risk; Week 1 validation gate.

Future KIs (likely to be filed during the build):

- A KI covering the chosen hosting target's specific quirks (filed in chunk 4.6.3).
- A KI covering whatever cross-instance coordination edge case turns out to be flaky (filed in chunk 4.6.2 or whenever it surfaces).
- A KI for any latency target the benchmark suite chronically misses by < 10% — bounded, documented, scheduled for follow-up.

---

## Cross-references

- `docs/adr/ADR-001-elixir-phoenix-draft-engine.md` — the architectural decision this plan implements.
- `CLAUDE.md` § Citrus Draft Performance Mandate — the binding performance targets.
- `CLAUDE.md` § Tech Stack — the hybrid runtime documentation.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 + §0.5 — spec-side reference.
- `docs/REGISTRY.md` — KI-008, KI-009, KI-010 (project-wide concerns).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KIs that continue to apply.

This plan is **accepted but not yet executing**. Implementation begins with chunk 4.5.1 in a separate session/commit. Each chunk lands as its own commit with deliverables verified before the next starts.
