# Phase 4.5 Architecture

> **Status:** Stub. Awaiting full architecture content (authored by Zach,
> incoming CTO) to be pasted in. Until then, this file documents only the
> locked decisions captured in the Phase 4.5 design review.
>
> Once populated, this document is the **canonical reference** for Phase 4.5
> architecture. Conflicts with `docs/DRAFT_ENGINE_V2_SPEC.md` §0.5 / §0.5.1
> or with the "Phase 4.5 Architectural Decisions" section in `CLAUDE.md`
> are resolved in favor of this document.

## Locked decisions (do not deviate without an ADR)

- **Deploy target:** GCE VM. Single-tenant Day 1, Managed Instance Group by Stage 3.
- **Single platform:** Both `citrus-api` (HTTP) and the draft engine run on the same GCE platform.
- **HTTP framework:** Hono, unchanged (505 passing tests in production).
- **WS library:** uWebSockets.js, unchanged.
- **Process layout:** Hono and uWS share one Node process on two ports. Discovery endpoint bridges the two.

## Five locked principles

1. **Lobby ID is the shard key.** No shared mutable state across lobbies.
2. **Discovery as a function from Day 1.** Client → `GET /api/drafts/:id/server` → `{host, port, token}`. Day 1 returns env-driven constants; Stage 2+ shard-aware.
3. **Event sourcing to Postgres.** `draft_events` is the system of record at every stage.
4. **No in-memory state that cannot be reconstructed.** Snapshots + event replay handle every recovery path.
5. **Single-writer per lobby.** All mutations flow through one async queue.

## Stage progression

- **Day 1.** Single GCE VM, single Node process, Hono + uWS sharing the process.
- **Stage 2.** N uWS workers per VM (one per vCPU). HAProxy hashes lobby_id → worker.
- **Stage 3.** Multiple VMs in a MIG behind GCP HTTP(S) LB with `RING_HASH` session affinity on `X-Lobby-Id`.
- **Stage 4 (optional).** Memorystore Redis as read-through snapshot cache.

---

<!-- Full architecture content (context, why-not-Cloud-Run, stack decision,
the five principles with rationale, Day 1 implementation details, failure
modes handled on Day 1, the Stage 1–4 evolution path with comparison table,
explicit non-goals, "done" criteria, clarifying questions) goes here. -->
