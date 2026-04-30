# Live Draft System — Architecture & Evolution Plan

> *"A complex system that works is invariably found to have evolved from a simple system that worked. A complex system designed from scratch never works and cannot be patched up to make it work. You have to start over with a working simple system."*
> — John Gall

This document describes both the Day 1 architecture for the live draft system and the evolution path to horizontal scaling. The two are designed together so each stage is a mechanical progression from the previous one — no rewrites, no retrofits, no architecture migrations.

The principles in the Day 1 architecture exist specifically because they make Stages 2–4 cheap. We are not building Stage 4 on Day 1. We are building Day 1 in a shape that can become Stage 4 without rework.

---

## Context

We're building a live draft feature for a fantasy sports app. Drafts are the highest-stakes interaction in the product — users tolerate slowness elsewhere, but a broken draft is unrecoverable both technically and reputationally.

Scale targets:

- Typical lobby: ~12 users. Architectural ceiling: 1,000 users per lobby for edge cases.
- Tens of concurrent active drafts at launch, growing to hundreds.
- Draft duration: 1–4 hours typical.
- Existing stack: Vite (frontend) + Express (backend) + Postgres.

  > *Citrus note: actual Citrus stack is Vite/React frontend + Hono backend + Supabase (PostgreSQL). The architectural reasoning is unchanged.*

The interesting scale dimension is concurrent lobbies, not users-per-lobby. Per-lobby load is trivial. Lobby isolation, per-lobby state correctness, and graceful handling of many simultaneous independent drafts matter a lot. Don't over-engineer fan-out within a lobby. Do invest in the per-lobby state machine and recovery semantics.

---

## How to Read This Document

The architectural principles in Day 1 are firm — they exist because retrofitting them later is expensive, and each one is justified by a specific failure mode we want to avoid. They are also exactly what unlocks the later stages.

Endpoint paths, table column names, library choices below the stack level (JWT library, validation library, ORM, test framework, frontend state management) are illustrative. Match the conventions and technology choices already established in the project. If a project convention conflicts with a principle, flag it for discussion rather than working around it silently.

The stages beyond Day 1 are a plan, not a build target. Stage 2 is what you do when one Node process stops being enough. Stage 3 is what you do when one VM stops being enough. We are building Day 1. We are designing for the rest.

---

## Why Not Cloud Run

Three hard platform constraints make Cloud Run wrong-shaped for the draft workload:

- 60-minute WebSocket cap. Drafts run longer. Clients get kicked mid-pick.
- Best-effort session affinity. In-memory `LobbyManager` needs all clients for a lobby on the same instance. Cloud Run can't guarantee this.
- No graceful WS drain on deploy. Every push disconnects active drafts.

The HTTP API moves to GCE alongside the draft engine. Unified architecture, single deploy target, single set of operational primitives. Splitting Express on Cloud Run from uWS on GCE would mean two runtimes, two deploy pipelines, two networking contexts, and cross-service auth coordination — a tax we'd pay every day for the lifetime of the system. For a small team, the simplification of one platform outweighs Cloud Run's serverless conveniences for the HTTP side.

---

## Stack Decision

We are extending the existing Node stack rather than introducing a second runtime. Solo/small team, single-language operational simplicity, Node is genuinely capable at this scale if the architecture is right.

Components:

- Express stays for HTTP: auth, lobby CRUD, league management, post-draft state.

  > *Citrus note: "Express" in this doc is framework-agnostic shorthand. The Citrus HTTP layer is Hono and stays Hono — no rewrite. Confirmed with Zach. All references to "Express" below should be read as "the existing Hono HTTP server."*

- uWebSockets.js for the live WebSocket layer — not Socket.IO, not `ws`. uWS has dramatically lower per-connection overhead and a C++-backed pub/sub fast path for broadcasts.
- Postgres as the durable system of record for draft events.
- Two ports / one process: Express on its existing port, uWS on a separate port. Same process is fine; uWS does not compose with Express middleware.

---

## Architectural Principles (Non-Negotiable)

These five principles must be present in the Day 1 implementation. They are cheap to build now and prohibitively expensive to retrofit. They are also the primitives that make Stages 2–4 a mechanical change rather than a redesign.

### 1. Lobby ID is the shard key

All draft state is partitioned by lobby ID. No shared mutable state across lobbies. No global counters, caches, or maps that mix lobby data. Every operation on lobby state goes through a `LobbyManager` instance keyed by lobby ID.

Why this matters later: When we add a worker pool (Stage 2), HAProxy hashes lobby ID to pick a worker. When we add multiple VMs (Stage 3), the load balancer hashes lobby ID to pick a VM. Both layers route on the same key.

### 2. Discovery as a function from Day 1

Clients do not connect directly to a hardcoded WebSocket URL. The flow is:

1. Client calls `GET /api/drafts/:id/server` on Express.
2. Express returns `{ host, port, token }` where `token` is a short-lived JWT scoped to that draft.
3. Client opens WSS to the returned host:port with the token.

On Day 1, this endpoint returns a constant from environment config. The point is the protocol shape.

Why this matters later: When we shard across processes (Stage 2) or nodes (Stage 3), the discovery endpoint starts returning shard-specific addresses. Zero client changes. This single primitive is what makes horizontal scaling a config change instead of a client release.

### 3. Event sourcing to Postgres

Every state-changing draft action (pick submitted, pick auto-assigned, timer expired, commissioner override) is written to a `draft_events` table before being broadcast to clients. The broadcast is the confirmation that the event is durable.

Schema sketch:

```sql
draft_events (
  lobby_id    uuid,
  seq         bigint,
  event_type  text,
  payload     jsonb,
  created_at  timestamptz,
  PRIMARY KEY (lobby_id, seq)
)
```

The current draft state (board, rosters, on-the-clock, time remaining) is a projection of the event log. Maintain it in memory for hot reads and snapshot to a `draft_state` table periodically (every N picks or every 30s). On process restart, load the snapshot and replay events since.

Why this matters later: When a draft moves between instances (Stage 3 rehash, Stage 4 instance death), the new instance reconstructs state from snapshot + event replay. No distributed in-memory state, no Redis-as-source-of-truth, no consistency protocols. Postgres is the system of record at every stage.

### 4. No in-memory state that can't be reconstructed

If a client reconnects, the only things they need are: their JWT (stateless), the current lobby state (snapshot + event log), and their last-seen sequence number (sent by the client). Do not introduce in-memory state outside `LobbyManager` that doesn't have a Postgres-backed equivalent.

### 5. Single-writer per lobby

All mutations to a lobby's state are serialized through a single async queue inside `LobbyManager`. Use a promise chain (`this.queue = this.queue.then(() => doMutation())`) or equivalent. On one Node process the event loop already serializes, but the pattern must be present.

Why this matters later: Future multi-process sharding doesn't require finding and fixing concurrent-access bugs. The lobby is single-writer by construction at every stage.

---

## Day 1 Implementation

### Backend

Express side:

- POST /api/drafts/:id/start — commissioner action. Writes initial `draft_state` row, transitions lobby status to `drafting`, calls into the uWS module to activate the draft.
- GET /api/drafts/:id/server — returns `{ host, port, token }`. Token is a JWT with `{ user_id, draft_id, team_id, exp: now + 5min }` signed with a shared secret.
- GET /api/drafts/:id/state — returns current `draft_state` projection. Used for spectator views and post-draft reads.

uWS side:

- WebSocket endpoint at `/ws/draft/:lobbyId`.
- On upgrade: validate JWT, confirm `draft_id` in token matches `lobbyId` in path. Reject otherwise.
- On open: subscribe socket to topic `draft:${lobbyId}` (uWS native pub/sub).
- Message handlers:
  - `pick` — `{ player_id, idempotency_key }` → forward to `LobbyManager.submitPick()`.
  - `resync` — `{ last_seq }` → reply with events from in-memory ring buffer since `last_seq`, or full snapshot if gap exceeds buffer.
  - `chat` — optional, same pattern.
- Broadcast all accepted events via `app.publish('draft:${lobbyId}', event)`. Do not iterate subscribers manually.

LobbyManager (one instance per active lobby, held in a `Map<lobbyId, LobbyManager>`):

- Owns in-memory state: current pick number, on-the-clock team, time remaining, recent events ring buffer (~200 events).
- Single-writer queue for all mutations.
- `submitPick(userId, playerId, idempotencyKey)`:
  1. Validate: is it this user's turn, is the player available, is the idempotency key unused.
  2. Insert into `draft_events` with next sequence number (transactional).
  3. Update in-memory projection.
  4. Push to ring buffer.
  5. Publish to uWS topic.
- Timer: `setInterval` per lobby ticking every 1s, broadcasting time remaining, triggering auto-pick at zero.
- Snapshot to `draft_state` table every N picks or every 30s.

Process bootstrapping:

- On startup, query `lobbies` for status `drafting` and reload `LobbyManager` for each from snapshot + event replay.
- Health endpoint that surfaces active lobby count and per-lobby last-event timestamps.

### Frontend (Vite SPA)

WebSocket client wrapper:

- Calls discovery endpoint, opens WSS with returned token.
- Tracks `lastSeenSeq`, increments as events arrive.
- On disconnect: exponential backoff with jitter (start 500ms, max 30s).
- On reconnect: re-call discovery (server may have changed), re-open WSS, send `resync` with `lastSeenSeq`.

State store using the project's existing state management library. Lobby state is normalized; events are applied by sequence number; out-of-order or duplicate sequences are dropped.

Idempotency keys generated client-side (UUID v4) for every pick submission. Retried submissions reuse the key.

Timer UI displays server time as authoritative. Local clock is used only for smoothing between server ticks; never decides expiry.

### Persistence

- `draft_events` — append-only event log, primary key `(lobby_id, seq)`.
- `draft_state` — current projection per lobby, one row per lobby, updated on snapshot.
- `lobbies` — gains a `status` column (`scheduled | drafting | completed`) if not already present.

Single Postgres connection pool. Pick mutations are transactional: `BEGIN; INSERT INTO draft_events; UPDATE draft_state; COMMIT;` then broadcast.

---

## Day 1 Topology

Single GCE VM, single Node process, Express + uWS sharing a process. Discovery endpoint returns the VM's address.

```
client ──► GCE VM ──► Node process (Express + uWS) ──► Postgres
```

That's it. No load balancer, no Redis, no worker pool, no MIG, no standby.

On redundancy: A hot standby would protect against single-VM failure but adds operational complexity (failover detection, DNS or IP switchover, keeping the standby warm). Stage 3 makes the system genuinely redundant via the MIG — multiple active VMs behind a load balancer, with automatic health-check-driven failover. Getting to Stage 3 buys real horizontal capacity and removes the single-point-of-failure at the same time. A standby is a strict subset of that benefit. Skip the half-measure.

For Day 1 outages, the recovery path is: VM restarts (or is replaced), process boots, snapshots load from Postgres, events replay, clients reconnect via discovery. Expected impact: minutes, not seconds — acceptable until Stage 3 lands.

---

## Failure Modes Handled on Day 1

These must work correctly on Day 1, with tests:

- **Process crash mid-draft.** New process starts, loads snapshot + replays events, clients reconnect via discovery, resync via `last_seq`. Expected user impact: 10–30s blip, no lost picks.
- **Client reconnect after network drop.** Backoff, re-discover, resync. No duplicate picks (idempotency keys). No missed events (ring buffer replay).
- **Duplicate pick submission.** Same idempotency key submitted twice. Second submission returns the first result; no duplicate event written.
- **Two users racing on the clock.** Auto-pick triggers at the same instant a user submits. Single-writer queue serializes; one wins, the other gets a clean rejection. No split state.
- **Slow client.** One user on bad wifi cannot drain their socket buffer. Server checks `getBufferedAmount()` before send; disconnects clients exceeding threshold (~1MB). Other users unaffected.
- **Deploy during active draft.** Drain mode: refuse new lobby activations, let active drafts complete, then exit. For now this means scheduling deploys around draft windows; revisited at Stage 3.

---

## Evolution Path

Each stage is triggered by a specific bottleneck. Don't pre-build. Don't skip stages. Each stage is a mechanical change because the Day 1 principles already shaped the system.

### Stage 2 — Worker Pool on a Single VM

Trigger: One Node process is saturating CPU on the VM. Vertical scaling (bigger VM) hasn't run out yet, but one core isn't enough.

Why this happens: Node is single-threaded. uWS is fast, but at some volume of concurrent lobbies, one event loop is the bottleneck. The VM has 8 or 16 cores; we're using one.

What changes:

- N independent uWS processes per VM, one per vCPU, on ports 3001–300N.
- HAProxy added to the container, listens on the VM's exposed port. On WS upgrade, extracts `lobby_id` from the path, consistent-hashes to one of the N workers.
- Each worker runs the full Express + uWS application. Each worker holds `LobbyManager` instances for the lobbies hashed to it.
- Supervisor / entrypoint detects CPU count at startup, launches HAProxy + N workers. Propagates SIGTERM to all.

What does not change:

- Discovery endpoint still returns the VM's address.
- Application code is unchanged. Lobby ID is already the shard key (Principle 1), single-writer per lobby is already enforced (Principle 5), so each worker just owns its subset of lobbies with no coordination.
- Postgres is still the system of record. Each worker reads/writes its own lobbies' events.

Why it's mechanical: HAProxy hashing on `lobby_id` works because Principle 1 guarantees no shared state across lobbies. A worker process crashing only affects the lobbies hashed to it, and they recover via Principle 3 (event replay) when HAProxy redirects them to a surviving worker.

```
client ──► GCE VM ──► HAProxy ──► uWS worker K ──► Postgres
                       hash(lobby_id)
```

### Stage 3 — Multiple VMs Behind a Load Balancer

Trigger: One VM is saturating, even with N workers. Or availability requirements demand redundancy. Or draft day surge needs capacity that exceeds the largest practical instance type.

What changes:

- Managed Instance Group (MIG) — N GCE instances, same container image as Stage 2.
- GCP external HTTP(S) Load Balancer in front. Session affinity: `HEADER_FIELD` with consistent hashing on `X-Lobby-Id`. Locality policy: `RING_HASH`.
- Discovery endpoint changes: starts returning the load balancer's address instead of a constant VM address. The token includes the lobby ID, which the client sends as `X-Lobby-Id` on the WS upgrade so the LB can hash on it.
- Two hash layers now, both required: LB picks the VM, HAProxy picks the worker on that VM.

What does not change:

- Application code. The discovery endpoint is already the indirection (Principle 2).
- Routing primitives. Both layers hash on lobby ID (Principle 1).
- Recovery semantics. When the LB rehashes a lobby to a different VM (deploy, scale event), the new VM's worker has no in-memory state for it. Triggers the standard event replay path (Principle 3 + Principle 4). Same code path as a process restart.

```
client ──► Load Balancer ──► VM N ──► HAProxy ──► uWS worker K ──► Postgres
            hash(X-Lobby-Id)            hash(lobby_id)
```

Draft day: scale the MIG up before drafts start, scale down after. Mid-draft scale events are safe — affected lobbies hit the standard rehydrate path. No special handling required.

Graceful deploy across VMs: rolling update via MIG, one VM at a time. Each VM drains via the existing SIGTERM handler. Clients reconnect to the LB, get rehashed to a healthy VM, lobbies rehydrate.

### Stage 4 — Optional: Redis as Rehydrate Cache

Trigger: Postgres event replay on rehash is fast enough at small scale, but as event logs grow long, replay latency becomes user-visible during scale events or instance failures.

What changes:

- Add Memorystore Redis. Each lobby's snapshot is written to Redis on every projection update.
- Workers check Redis first on a cache miss, fall through to Postgres if absent.

What does not change:

- Postgres remains the system of record. Redis is a read-through cache for snapshots.
- Application logic. The "lobby missing from memory" code path already exists (Principle 4); it just gets a faster source.

This is the only place Redis enters the architecture, and only if measured rehydrate latency is actually a problem. At the scale targets in this brief, it likely never is.

---

## Stage Comparison

| Dimension          | Day 1       | Stage 2             | Stage 3                              | Stage 4         |
| ------------------ | ----------- | ------------------- | ------------------------------------ | --------------- |
| Node processes     | 1           | N (per VM)          | N × M                                | N × M           |
| VMs                | 1           | 1                   | M (MIG)                              | M (MIG)         |
| Load balancer      | None        | None                | GCP HTTP(S) LB                       | Same            |
| In-VM routing      | None        | HAProxy hash        | HAProxy hash                         | Same            |
| State of record    | Postgres    | Postgres            | Postgres                             | Postgres        |
| Rehydrate cache    | None        | None                | None                                 | Redis           |
| Discovery returns  | VM address  | VM address          | LB address                           | LB address      |
| Triggered by       | —           | One core saturated  | One VM saturated or availability need | Slow rehydrate  |

Each row is the only thing that changes between stages. Application code is unchanged across all four.

---

## Explicit Non-Goals (Day 1)

These are deliberately out of scope until we have load to justify them. Do not build them speculatively, but do not architect in ways that preclude them.

- Multi-process sharding (`SO_REUSEPORT` or per-port processes). That's Stage 2.
- Cross-node coordination (load balancer, MIG). That's Stage 3.
- Distributed actor frameworks. The `LobbyManager` pattern is sufficient at every stage.
- Hot code reload. Rolling restarts with drain mode are acceptable.
- Custom backpressure beyond uWS defaults. Add if profiling shows slow-consumer issues.
- Redis. That's Stage 4, and only if needed.

---

## What "Done" Looks Like for Day 1

A draft can be created, started, played to completion with 1,000 simulated clients, and the resulting rosters in Postgres exactly match the picks made — across at least one simulated process restart and one simulated network partition for a subset of clients. Event log is complete and replayable. No picks lost, no picks duplicated, no state divergence between clients.

---

## Clarifying Questions Before Implementation

> *See [`docs/PHASE_4_5_ARCHITECTURE_ANSWERS.md`](./PHASE_4_5_ARCHITECTURE_ANSWERS.md) for Citrus-specific answers to all questions below.*

Some of these will change the implementation meaningfully; others are flagged so we don't make implicit assumptions.

### Product / draft mechanics

- What draft formats are supported (snake, linear, auction)? Auction has very different timer and state semantics.
- Is there a draft pause feature (commissioner halts the clock)? If yes, how is resume authorized?
- Can commissioners undo or override picks mid-draft? If yes, this needs the same event-sourcing treatment as a normal pick.
- What happens when a user is on the clock but disconnected? Auto-pick from a queue? Auto-pick best-available? Skip and come back?
- Are there pre-draft queues (users rank players in advance for auto-pick fallback)? Where does that data live and when is it loaded?

### Users and access

- Who can connect — only rostered team owners, or also spectators? If spectators, do they get a different message stream?
- Can a single user have multiple connections (web + mobile) to the same draft? How do conflicting submissions resolve?
- Are co-managers a concept (multiple users authorized to pick for one team)? Affects authorization on pick submission.

### Existing system integration

- What ORM / query layer is in use on the Express side?
- What auth library and JWT structure is currently in use? The discovery endpoint should extend the existing auth.
- What's the existing logging/metrics setup? The uWS module should plug into it.
- Is there an existing notification system? Pre/post-draft notifications should go through it.
- Deployment target details for the GCE VM (machine type, region, container runtime)? Confirming the existing HTTP API also moves to this VM rather than staying split across platforms.

### Operational

- Expected launch volume — 10 concurrent drafts? 50? 200? Order of magnitude is enough.
- Do drafts run on a predictable schedule (e.g., draft night) or continuously? Affects whether deploy windows are viable.
- Existing on-call rotation? Affects how much investment is justified in observability and runbooks Day 1.
- SLO for a draft? "No lost picks ever" is the assumed bar; confirm. Threshold for reconnect blips before they're an incident?

### Out-of-scope confirmation

- Confirming: chat is optional / lower-priority and can be added after core draft mechanics work?
- Confirming: spectator/replay views are post-launch?
- Confirming: mobile (if any) uses the same WebSocket protocol as web?

If any answer would meaningfully change the architecture, flag it before starting implementation rather than building to an assumption.
