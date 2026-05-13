# Phase 4.5 — Persistent Node Draft Engine in Existing Server (Chunks 11g.0–11g.11)

> **2026-04-29 update:** deploy target changed from Cloud Run to GCE. See `docs/PHASE_4_5_ARCHITECTURE.md` for the canonical architecture; `CLAUDE.md` for high-level rationale; ADR-001 supersession note for the decision trail. Inline references in this plan have been updated to match. Chunk 11g.2 has been reshaped for the GCE pivot and a new chunk 11g.2.0 (GCE platform spike) added before it; other chunks stand as-written.

| | |
|---|---|
| **Status** | Plan accepted (2026-04-28). Deploy target updated 2026-04-29 (Cloud Run → GCE). Implementation in progress. |
| **Authority** | `docs/adr/ADR-001-persistent-node-draft-engine.md` (the architectural decision: persistent code inside the existing Node.js / Hono server on GCE, with `uWebSockets.js` as the live WebSocket layer; Edge Functions removed entirely); `docs/PHASE_4_5_ARCHITECTURE.md` (canonical architecture reference for the deploy topology); `CLAUDE.md` § Citrus Draft Performance Mandate (binding performance targets). |
| **Predecessor** | Phase 4 closeout, with autopick latency ~11.7s/pick measured on staging — non-competitive per the Mandate. |
| **Successor** | Phase 5 (UI client work) is **blocked** until chunk 11g.10 sign-off. |
| **Estimated solo-founder timeline** | Chunks 11g.0–11g.11 ≈ 4–6 weeks of solo-founder work assisted by Claude Code, including cushion for unknowns. No new language or runtime; the engine ships inside the existing server. |

## Working discipline (carried forward from Phase 0–4)

- **One chunk per commit.** Each chunk pushed and reviewed before the next starts.
- **Pause for review at every chunk gate.** No silent drift between chunks.
- **No deferral lands without a registry row.** New issues that surface during the build go into `docs/REGISTRY.md` (project-wide concerns) or `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (draft-engine-specific) at commit time.
- **Performance Mandate is the binding constraint for every chunk.** Any chunk that introduces a new latency-sensitive surface must measure it; any chunk that fails a target either fixes it before the next chunk starts or registers a KI- with a bounded resolution timeline.
- **Tier 1 perf optimizations are baked in, not deferred (KI-010).** Parallel async via `Promise.all`, candidate pool cached at draft start in `LobbyManager` (chunk 11g.3), byte-limited delta broadcasts and per-socket fanout protection via `getBufferedAmount()` (chunk 11g.4) — each lands in the chunk that introduces the relevant surface, with code-comment evidence. End-to-end verification at chunk 11g.10.
- **Integration boundary is the existing Postgres RPC surface plus the WebSocket message protocol.** RPC surface (`submit_pick_v2`, `append_draft_event`, `reconstruct_draft_state`, etc.) doesn't change without an ADR. WebSocket message protocol is established across chunks 11g.2 (transport + upgrade) and 11g.4 (pick + chat message types); same governance discipline.

## Performance targets (binding, from `CLAUDE.md` § Citrus Draft Performance Mandate)

Every chunk's acceptance criteria reference these:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms
- Draft state load: p95 ≤ 1500ms
- Timer drift: < 100ms across all clients
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Reconnection recovery: p95 ≤ 2000ms

A chunk's "performance gate" is a measured-on-staging assertion against these targets, scoped to whatever surface the chunk introduces. The full target set is verified end-to-end at chunk 11g.10 — that's the Phase 5 entry gate.

---

## Phase 4.5 — Build the in-server engine, remove the Edge Function infrastructure

### Chunk 11g.0 — Dependency compatibility verification

**Deliverable.** A pre-flight audit on the existing Node server before any draft-engine code lands. The chunk's commit produces a single document — pass/fail with specifics — and zero application code. Audit scope:

- Existing `server/package.json` dependencies vs. uWebSockets.js. Confirm the native C++ binary builds cleanly for the GCE container architecture (Linux x64), peer-deps and types resolve, no version conflicts. Per ADR-001 the architecture specifies uWebSockets.js; alternative libraries (`ws`, `socket.io`) are explicitly not in scope. *(2026-04-29: audit findings still apply — uWS + Hono compose fine in one Node process; the port-conflict concern that drove the original A/B/C topology decision is moot on GCE since the platform does not impose Cloud Run's single-port constraint.)*
- Hono's HTTP-upgrade handling. Confirm Hono routes can coexist with a WebSocket upgrade handler on the same port, or document the specific Hono version + adapter combination required.
- TypeScript build pipeline. Confirm `tsc` / `tsx` build path handles both the existing routes and the new WebSocket code without configuration churn.
- Existing middleware (auth, JWT, RLS context). Confirm the middleware stack extends cleanly to WebSocket connections — auth on the upgrade handshake, league-membership check before `LobbyManager` join.
- Async patterns and event loop. Confirm the existing server's existing background tasks, cron callers, and request handlers won't conflict with long-lived WebSocket connections holding the event loop.

**Output.** A short writeup committed at `docs/PHASE_4_5_CHUNK_11g_0_compat_audit.md`: either "all clean, proceed to 11g.1" with the specific library + version pinned, or a numbered list of conflicts with proposed resolutions.

**Dependencies.** None.

**Acceptance criteria.**
- The audit document exists at the path above and answers each scope item with a definite yes/no/conflict.
- A scratch branch demonstrates the WebSocket library installing into `server/` cleanly and Hono accepting a WebSocket upgrade on a test endpoint. The scratch branch is committed but not merged into `staging-setup` — its purpose is evidence, not deployable code.
- If conflicts exist that can't be cleanly resolved, the chunk **escalates** before proceeding. The documented fall-back is alternative (a) from ADR-001 — a separate service on the same GCE platform. KI-009's "refactor not rewrite" framing is the binding promise; the architectural pattern carries either way.

**Performance targets.** None.

**Estimated effort.** 1–2 days. Mostly install + a tiny prototype to prove the upgrade path works on the existing Hono setup.

---

The goal of Phase 4.5 is a **single working draft running end-to-end on the existing Node.js / Hono server (deployed to GCE)**, with measured performance meeting the Mandate, the Edge Function infrastructure deleted, and the in-memory `LobbyManager` model proven under realistic load. No new language, no new runtime; the engine ships inside the existing server. (Deploy target moved from Cloud Run to GCE on 2026-04-29 — see header note.)

Sign-off discipline carries forward from Phase 0–4: each chunk lands as its own commit, runs on staging, and is reviewed before the next chunk starts. The chunk 11g.10 sign-off is the Phase 5 entry gate.

### Chunk 11g.1 — Discovery endpoint + JWT issuance

**Deliverable.** A new Hono route `GET /api/drafts/:draftId/server` that returns `{ host, port, token }`. The `host` and `port` are sourced from environment configuration (single GCE VM Day 1; the protocol shape is what matters for future sharding — see `docs/PHASE_4_5_ARCHITECTURE.md` Stage 2/3 progression). The `token` is a short-lived JWT (5-minute expiration) signed with `SUPABASE_JWT_SECRET` (the same secret Supabase signs auth tokens with — one auth surface for the whole server), with claims `{ sub: userId, draftId, leagueId, iat, exp }`. The route runs through the existing `authMiddleware` and `membershipMiddleware` so only authenticated league members can request a token. (Note: `draftId` and `lobbyId` are the same identifier in Citrus — the draft IS the lobby. `draftId` is the canonical wire-format claim; later chunks may use `lobbyId` as an internal variable name for the same value.)

**Dependencies.** 11g.0.

**Acceptance criteria.**
- `GET /api/drafts/:draftId/server` returns 200 with `{ host, port, token }` for a league member.
- Returns 401 without a valid Authorization header. Returns 403 if the caller is not a member of the draft's league.
- Token claims include `sub`, `draftId`, `leagueId`, `iat`, and `exp` (= `iat + 300`). Signed with `SUPABASE_JWT_SECRET` (HS256) so that future fast-path verification by the uWS upgrade handler is local-only (no Supabase round-trip).
- Token decode helper (`server/src/lib/draftToken.ts`) exports `issueDraftToken(...)` and `verifyDraftToken(token, expectedDraftId)`. The verify helper rejects expired tokens, tokens with bad signatures, and tokens whose `draftId` claim does not match the `expectedDraftId` argument (the draft-mismatch check is exercised in chunk 11g.2 but the helper lands here).
- Vitest covers: happy-path issuance, expired-token rejection, wrong-secret rejection, lobby-mismatch rejection, missing-claim rejection.

**Performance targets.** Discovery endpoint p95 ≤ 50ms (it is a config lookup + signed JWT; no DB read beyond the membership check the existing middleware already does).

**Estimated effort.** 2–3 days.

---

### Chunk 11g.2.0 — GCE Platform Spike *(test-first, throwaway)*

> **Status:** Complete (2026-04-30). See [`docs/PHASE_4_5_GCE_PLATFORM_NOTES.md`](./PHASE_4_5_GCE_PLATFORM_NOTES.md) for findings. Approval to proceed to chunk 11g.2 pending Zach's review.

**Goal:** validate GCE as the Phase 4.5 deploy platform on a throwaway VM before locking implementation decisions in chunk 11g.2. Output is a written platform-decisions doc, not production deployment.

**Why this exists.** Citrus has zero prior GCE experience (all GCP compute to date is Cloud Run). The platform pivot decided in `PHASE_4_5_ARCHITECTURE.md` is sound on paper, but the operational specifics (machine type, region, container runtime, networking, IAM, Docker base image, startup script pattern) need to be learned hands-on before chunk 11g.2 implementation locks them. 1–2 days here saves rework risk in 11g.2 and downstream chunks.

**What this chunk produces:**

1. A throwaway GCE VM (`citrus-spike-uws`) running Citrus's existing Hono server + a minimal uWS hello-world server in the same Node process, on two ports.
2. A written platform-decisions doc at `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` capturing: machine type chosen, region chosen, container runtime, Docker base image, firewall rules, IAM service account setup, deploy pipeline shape, observed startup time, observed memory baseline, observed network latency from Garrett's Edmonton location.
3. The throwaway VM deleted at chunk close.

**Acceptance criteria:**

- GCE VM provisioned in the chosen region.
- Container with Hono + uWS hello-world deployed and reachable on two distinct external ports.
- WebSocket upgrade succeeds against the uWS port (e.g. `wscat -c wss://<vm-ip>:<uws-port>/ws/draft/test` returns a 101 Switching Protocols response).
- HTTP GET succeeds against the Hono port (e.g. `curl https://<vm-ip>:<hono-port>/api/health` returns 200).
- Both servers run from the same Node process (verified via `ps aux | grep node` showing one PID).
- SIGTERM handler verified: kill the process, both servers shut down cleanly within 10 seconds.
- Platform-decisions doc committed at `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md`.
- Throwaway VM deleted (`gcloud compute instances delete citrus-spike-uws --zone=<zone> --project=citrus-fantasy-staging`).
- GCP billing for spike resources cleaned up (no orphaned static IPs, persistent disks, etc.).

**Decisions to lock during the spike (capture in platform-decisions doc):**

| Decision | Provisional default (review during spike) |
|---|---|
| Machine type (staging) | `e2-standard-4` (4 vCPU, 16 GB) — overprovisioned but cheap (~$100/mo); confirms headroom |
| Region | `northamerica-northeast1` (Montreal) preferred for Canadian user proximity; benchmark vs `us-central1` |
| Container runtime | Docker via Container-Optimized OS (COS) — GCP-managed, standard pattern |
| Base image | `node:22-alpine` (matches Cloud Run config) |
| Networking | Static external IP (release on VM delete); VPC firewall rule for ports `${PORT}` and `${DRAFT_WS_PORT}` |
| IAM | Dedicated service account `citrus-draft-engine@<project>.iam.gserviceaccount.com` with scoped Secret Manager + Cloud Logging access |
| Startup script | systemd unit + Docker pull on boot; container restart-always policy |
| Deploy pipeline shape | TBD: github-actions → docker build → push to Artifact Registry → SSH-deploy script vs gcloud-managed instance template; decide during spike |
| Health check | TCP on Hono port + WS handshake on uWS port |
| Logging | stdout/stderr → Cloud Logging via COS default agent |

**Constraints:**

- Use `citrus-fantasy-staging` GCP project. Do NOT use prod.
- Do not modify any production code paths. Spike is throwaway.
- Do not provision any persistent resources (Cloud SQL, Memorystore, etc.). VM only.
- Do not edit `ops/cloudrun/service*.yaml` or any production Dockerfile in this chunk. Hands off.
- Hard time-box: 2 working days. If spike runs longer, stop and surface blockers to Garrett before continuing.

**Estimated effort:** 1–2 days.

**Dependencies:** none. Can start immediately after Web Summit (May 19, 2026).

**Acceptance reviewer:** Garrett. Zach if onboard.

---

### Chunk 11g.2 — uWS Server Bring-Up + GCE Staging Deploy

> **Status:** Complete (2026-05-04). Five execution steps committed on `phase-4-5-implementation`: server scaffold (`50a7983`), JWT middleware (`afd9371`), Docker parity verification (no commit — re-validated step 2 inside the rebuilt container), production Dockerfile cleanup + parameterized GCE startup script (`6985b2f`), GCE staging deploy with Cloud Logging integration via `gcplogs` Docker driver (final commit `fdbc76f`). Staging VM (`citrus-draft-engine-staging` at 34.19.223.135) provisioned, validated end-to-end against five smoke scenarios + `gcloud logging read` proof, then torn down post-validation. Service account, Artifact Registry repo, and `:latest` image preserved for chunk 11g.4 re-provisioning.

**Goal:** stand up a real uWebSockets.js server alongside the existing Hono server in the same Node process, deploy to a real GCE staging VM (not throwaway), and verify the discovery endpoint flow end-to-end against the deployed pair.

**Why reshape from original 11g.2.** The original chunk 11g.2 was written assuming Cloud Run as the deploy target. Cloud Run's one-port-per-container constraint forced a A/B/C topology decision (uWS owns 8080 with Hono adapter / two services / sidecars), and option A would have required a 300–500 line Hono-on-uWS adapter. With the GCE pivot ratified in `PHASE_4_5_ARCHITECTURE.md`, the constraint disappears: GCE containers expose multiple ports trivially. Two ports, one process is the simplest solution, exactly as Zach's architecture doc specifies. The adapter work is gone. The A/B/C decision is moot.

**Pre-requisite:** chunk 11g.2.0 (GCE platform spike) complete, with platform-decisions doc committed.

**What this chunk produces:**

1. A real GCE staging VM (`citrus-staging-draft`) deployed and serving traffic. Not throwaway.
2. The existing Hono server running on its existing port, unchanged in behavior.
3. A new uWS server in the same Node process, listening on `${DRAFT_WS_PORT}` (default 3002), with a single WebSocket route at `/ws/draft/:lobbyId` that accepts upgrades and echoes incoming messages (no LobbyManager wiring yet — that's chunk 11g.3).
4. JWT validation on WebSocket upgrade: extract token from `Sec-WebSocket-Protocol` header (per `lib/draftToken.ts` design decision §4), call `verifyDraftToken` against the `:lobbyId` path param, reject mismatches with WS close code 4401 and structured close reason.
5. Discovery endpoint (`GET /api/drafts/:draftId/server`) updated so `host` and `port` env-driven values reflect the GCE staging VM's actual IP and uWS port.
6. Container Dockerfile updated to expose both ports.
7. CI/CD pipeline updated: GitHub Actions builds the container, pushes to Artifact Registry, deploys to GCE staging via the deploy pipeline shape locked in chunk 11g.2.0.
8. SUPABASE_JWT_SECRET wired from GCP Secret Manager into the running container at boot.
9. End-to-end smoke test: client calls discovery → opens WSS to returned host/port with returned token → JWT validates → WS connects → echo round-trip succeeds.

**Out of scope** (deferred to later chunks):

- LobbyManager class and per-draft state machine (chunk 11g.3).
- Pick submission, idempotency keys, event sourcing transactional writes (chunk 11g.4).
- Pub/sub broadcast via uWS topics (chunk 11g.5).
- Timer ticking and autopick (chunk 11g.6).
- Snapshot persistence and process bootstrap state recovery (chunk 11g.7).
- Failure-mode test suite (chunk 11g.8).
- Production GCE deploy (chunk 11g.10).
- Cloud Run YAML retirement (in or after chunk 11g.3, once GCE staging is verified working).

**Acceptance criteria:**

- GCE staging VM provisioned per platform-decisions doc, with static external IP allocated.
- Container builds reproducibly via the GitHub Actions pipeline; image tag matches commit SHA.
- SUPABASE_JWT_SECRET resolves from GCP Secret Manager at container boot; absence is detected and surfaces as a 503 from the discovery endpoint per existing `draftToken.ts` behavior.
- Hono server reachable on `${PORT}` via VM external IP; existing `/api/health` endpoint returns 200.
- uWS server reachable on `${DRAFT_WS_PORT}`; WebSocket upgrade with valid JWT in `Sec-WebSocket-Protocol` succeeds (101 Switching Protocols).
- WebSocket upgrade with missing JWT, invalid signature, expired token, or `:lobbyId` path mismatch is rejected with WS close code 4401.
- On successful WS upgrade, the verified JWT claims (`userId`/`sub`, `draftId`, `leagueId`, `exp`) are attached to the per-connection context (uWS `userData` or equivalent) for downstream message handlers in chunks 11g.4+. The attachment shape is documented in chunk 11g.2's deliverables.
- Both servers run in the same Node process (verified `ps`).
- SIGTERM handler shuts both servers down cleanly within 10 seconds (verified).
- Discovery endpoint returns the correct staging VM host/port for valid league member callers; 401/403/404/409/503 paths still behave per chunk 11g.1's contract.
- End-to-end smoke test passes: real client (test script) calls discovery → opens WSS → echoes message → receives echo → closes cleanly.
- All 505 existing tests still pass on the staging-deployed image.
- 5+ new tests covering uWS upgrade JWT validation paths.
- `docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` (from chunk 11g.2.0) updated with any deviations discovered during real deploy.
- **Cloud Run YAMLs untouched** — left in repo as fallback until chunk 11g.3 cleanup.

**Performance verification (preliminary, not the full 11g.10 perf gate):**

- Discovery endpoint p95 latency ≤ 300ms on the GCE staging deploy (matches existing performance mandate for Hono routes).
- WS upgrade handshake completes within 100ms of client request (no LobbyManager work yet, so this is pure JWT verify + uWS upgrade).
- Container cold-start time recorded and added to platform-decisions doc.

**Risk callouts:**

- **Static IP allocation cost.** GCE static external IPs are billed when *unattached*; budget the staging IP into ongoing GCP costs. Estimate: ~$3/mo while VM is running, ~$8/mo if VM is stopped. Document in platform-decisions.
- **Secret Manager IAM scope.** The container's service account needs `roles/secretmanager.secretAccessor` on `SUPABASE_JWT_SECRET` only — not blanket Secret Manager access. Verify minimum scope.
- **Sec-WebSocket-Protocol token transport.** Per `lib/draftToken.ts` §4, the design decision is to carry the JWT in the WS subprotocol header to avoid URL-leakage. uWS supports this but the client wrapper (chunk 11g.5+) needs to send the protocol value correctly. Note in platform-decisions for the chunk 11g.5 implementer.
- **Firewall rules and CORS.** Hono CORS allowlist (in `app.ts`) currently includes Firebase Hosting origins for staging. uWS connections originate from the same Firebase-hosted SPA but bypass CORS (WS doesn't enforce it). Verify staging Firebase site can establish WS to the GCE VM.

**Estimated effort:** 5–7 working days.

**Dependencies:**

- Chunk 11g.2.0 complete (platform-decisions doc committed).
- Zach onboard (or available for review) for the deploy pipeline architecture review.
- SUPABASE_JWT_SECRET provisioned in `citrus-fantasy-staging` (✅ done 2026-04-29).

**Acceptance reviewer:** Garrett + Zach (both required for the deploy pipeline + GCE config review).

**Cross-references:**

- `PHASE_4_5_ARCHITECTURE.md` — Stack Decision section for two-ports-one-process; Day 1 Topology section for the staging deploy shape.
- `PHASE_4_5_ARCHITECTURE_ANSWERS.md` — Q3.5 GCE deploy target details.
- `server/src/lib/draftToken.ts` — JWT verification contract; `Sec-WebSocket-Protocol` token transport decision.
- `server/src/routes/drafts.ts` — discovery endpoint that this chunk's deploy must serve correctly.
- Chunk 11g.1 (commits 00b8776, eb784cd) — discovery endpoint and JWT issuance, already committed.

---

### Chunk 11g.3 — `LobbyManager` class with single-writer queue and ring buffer

**Deliverable.** A `LobbyManager` class (`server/src/draft/LobbyManager.ts`) holding the in-memory state for one active draft. One instance per active lobby in a top-level `Map<lobbyId, LobbyManager>` (`LobbyRegistry`). Per-instance state: `pickNumber`, `onClockTeamId`, `pickDeadline`, `recentEvents` (ring buffer of ~200 events), `candidatePool` (cached at draft start; updated in place on pick events), `connectedSockets` (set of uWS WebSocket refs), `lastBroadcastSeq`. The constructor loads initial state from Postgres: `reconstruct_draft_state(draftId)` for the projection, plus a parallel `Promise.all` fetch of `player_directory`, `player_season_stats`, and `draft_picks_v2` to build the in-memory candidate pool. A single-writer queue serializes mutations: `this.queue = this.queue.then(() => doMutation())` so concurrent pick submissions never interleave. The lobby is registered into `LobbyRegistry` on construction and de-registered on shutdown.

Imports `DraftType` and `DraftStatus` from `@citrus/shared` — both types exist in `packages/shared/src/types/league.ts` after chunk 11g.1's follow-up commit (`eb784cd`). Do NOT recreate either type. `DraftType` (`snake | linear | auction`) determines pick algorithm; `DraftStatus` (`not_started | queued | in_progress | paused | completed`) determines lobby connectability and timer behavior. They are orthogonal but both colloquially called "draft" in code — keep them distinct in `LobbyManager`.

**Dependencies.** 11g.2.

**Acceptance criteria.**
- Constructing a `LobbyManager` for a seeded staging draft completes the full state load (RPC + parallel candidate fetch) in p95 ≤ 1500ms (Mandate: draft state load).
- Two concurrent in-process mutations on the same `LobbyManager` execute in the order they were enqueued; a Vitest test deliberately races 50 mutations and asserts the resulting in-memory state matches a sequential application.
- Ring buffer: pushing > 200 events keeps the most recent 200; older events are dropped from the buffer (they remain authoritative in `draft_events`).
- `LobbyRegistry.get(lobbyId)` returns the same instance across calls within a process; `LobbyRegistry.evict(lobbyId)` clears it cleanly without leaking sockets.
- **KI-010 Tier 1 evidence:** the parallel `Promise.all` candidate-pool load is annotated with a `// KI-010 Tier 1: parallel async on independent reads` comment so a reviewer can grep for it. The candidate pool is held on `this._candidates` for the lifetime of the draft (`// KI-010 Tier 1: candidate pool cached at draft start`).

**Performance targets.**
- Draft state load p95 ≤ 1500ms (Mandate).

**Estimated effort.** 3–4 days.

---

### Chunk 11g.4 — Pick submission flow + draft-room chat

**Deliverable.** WebSocket message handler routes inbound `{ type: 'submit_pick', ... }` and `{ type: 'chat', ... }` messages to the right `LobbyManager` method. `submitPick` validates: the sender is on the clock for this lobby, the player is available in the cached candidate pool, the idempotency key is unused. On valid input, it executes a transactional `submit_pick_v2` RPC against Postgres (which appends to `draft_events` and updates `draft_state` atomically), updates the in-memory projection (decrements candidate pool, advances pick number, recomputes on-clock team), pushes the event onto the ring buffer, and broadcasts a delta event over uWS topic `draft:${lobbyId}`. Broadcast is byte-limited (delta only, not full state) and uses `getBufferedAmount()` to skip slow sockets above a documented threshold (~1MB) — those sockets are flagged for the chunk 11g.5 reconnection path. Chat handler is a thin pass-through: validates league membership (already on the connection context from chunk 11g.2's upgrade handler) and calls the existing `send_league_chat_message` Postgres RPC. Chat does NOT broadcast over uWS — it goes through the existing notifications real-time path so it appears in `LeagueNotifications.tsx` everywhere, exactly as in-product chat does today (per the chat/notification architecture findings: draft chat = league chat that happens during a draft).

**Dependencies.** 11g.3.

**Acceptance criteria.**
- Two test clients connected to the same lobby; client A submits a pick; client B receives the broadcast event with the pick payload and updated `pickNumber` within p95 ≤ 200ms (Mandate: pick-to-broadcast fanout). Client A receives the same broadcast (or a `pick_committed` ack — chunk decides).
- A duplicate `submit_pick` with the same idempotency key from the same client returns `{ was_duplicate: true }` without committing a second `draft_events` row.
- A pick submitted by a client who is not on the clock is rejected with a typed error message and does not commit.
- A pick for an already-drafted player is rejected with a typed error message.
- A chat message sent over the WebSocket appears in `notifications` for every league member via `send_league_chat_message` and renders in `LeagueNotifications.tsx` for any user who has the matchup view open. The draft-room UI (chunk arrives in Phase 5) will read the same notification feed; nothing parallel is built.
- End-to-end manual pick latency (client submit → broadcast received on other client) p95 ≤ 300ms / p99 ≤ 500ms over 100 trial picks (Mandate: manual pick submission).
- **KI-010 Tier 1 evidence:** broadcast site annotated `// KI-010 Tier 1: byte-limited delta (not full state)` and `// KI-010 Tier 1: per-socket fanout protection via getBufferedAmount()`. Pick handler annotated `// KI-010 Tier 1: parallel async via Promise.all` at any independent read site.

**Performance targets.**
- Manual pick submission p95 ≤ 300ms / p99 ≤ 500ms.
- Pick-to-broadcast fanout p95 ≤ 200ms.

**Estimated effort.** 4–5 days. The biggest correctness chunk in 11g — the integration with the existing RPC surface and the in-memory projection consistency are both load-bearing.

---

### Chunk 11g.5 — Reconnection with `last_seen_seq` resume

**Deliverable.** WebSocket resync handler. Client reconnects after a drop and sends `{ type: 'resume', lastSeenSeq }` as the first message after upgrade. Server compares to the lobby's ring buffer: if the gap is small (`lastSeenSeq` is still in the buffer), the server replays missed events from the buffer in order; if the gap exceeds the buffer (~200 events behind), the server sends a full snapshot — the same payload shape as `LobbyManager.constructor` produces — and the client reconciles. Reconnection state is per-socket; the lobby's authoritative state is unaffected.

**Dependencies.** 11g.4.

**Acceptance criteria.**
- Test: open a client, commit 5 picks while the client is connected, drop the WebSocket, reconnect with `lastSeenSeq` from before the drop. Client receives the 5 missed picks via ring-buffer replay, no full snapshot needed.
- Test: open a client, commit 250 picks (more than the ring buffer), reconnect with the pre-burst `lastSeenSeq`. Client receives a full snapshot (the buffer overflow path) and the resulting in-memory client state matches what `LobbyManager` says.
- Test: the figma-style scenario — two clients reconnect simultaneously after a network blip; both reconcile correctly without one starving the other.
- Reconnection recovery p95 ≤ 2000ms (Mandate: reconnection recovery), measured as `client.connect() → client has consistent state`.

**Performance targets.**
- Reconnection recovery p95 ≤ 2000ms.

**Estimated effort.** 2–3 days.

---

### Chunk 11g.6 — Pick deadline timer + autopick

**Deliverable.** Each `LobbyManager` runs a `setInterval` (1s tick) for the duration of the lobby's life. Each tick: compute `timeRemaining = pickDeadline - now`, broadcast `{ type: 'time_remaining', value }` over the lobby topic. On expiration (`timeRemaining ≤ 0`): the autopick path runs through the same single-writer queue as manual picks. Selection algorithm: queue head first (head of `draft_queues` for the on-clock team, filter against the in-memory candidate pool); heuristic fallback (FPTS + positional need — port the existing `supabase/functions/draft-autopick/heuristic.ts` to TypeScript inside `server/src/draft/heuristic.ts`, same algorithm byte-for-byte). Autopick calls `submit_pick_v2` with `actor.kind='autopick'` and the existing UUIDv5-derived idempotency key (same `AUTOPICK_NAMESPACE_UUID` and same `(league_id, pick_number, generation, 'autopick')` derivation). Same broadcast path as a manual pick. Additionally, **autopicks write a single-recipient notification** to the affected user via the `notifications` table (`type='SYSTEM'`, `user_id = autopicked_team.owner_id`) so a user away from the draft room sees the autopick happened on their next visit to the in-product activity feed. This is the only `notifications` table write the engine performs per pick — manual picks are not surfaced through `notifications` (they reach in-room clients via the WebSocket and reach absentee users via the draft room's event log on next visit). This deliberate scope-cut is the "no notification storm" guarantee per the chat/notification architecture findings.

Reads and writes `leagues.draft_status` using the `DraftStatus` type from `@citrus/shared` (per chunk 11g.1 follow-up). The `paused` state must be respected: timers do not tick while paused; autopicks do not fire while paused; the lobby remains alive (so chat and commissioner-resume work). When a pick commits and the draft transitions to `completed`, the timer stops and the autopick scheduler unregisters.

**Dependencies.** 11g.4.

**Acceptance criteria.**
- Timer ticks: with the deadline 60s out, clients receive 60 `time_remaining` events ±100ms (Mandate: timer drift < 100ms across clients).
- Autopick on deadline: a 12-team / 12-pick unattended draft runs to completion. Every pick is via autopick. Total wall-clock < 30 seconds. Per-pick p95 ≤ 1000ms / p99 ≤ 2000ms (Mandate: autopick latency).
- A 12-team / 180-pick (15 rounds) full unattended draft completes in < 6 minutes (autopick p95 × 180 ≈ 3 minutes plus 2× cushion).
- Cross-runtime parity preserved during cutover: an autopick committed by the in-server engine produces the same idempotency key as the existing Edge Function path would have for the same `(league_id, pick_number, generation)`. Verified at chunk 11g.6 time against `_v2_test._uuidv5` SQL helper output for a known input vector. The helper itself is removed in chunk 11g.9 after the second runtime is gone — the parity check is a one-shot verification at cutover, not an ongoing invariant.
- Per autopick: one row in `notifications` with `user_id = autopicked_team.owner_id`, `type = 'SYSTEM'`, `metadata.source = 'draft_engine'`, `metadata.pick_number = N`. Zero rows for manual picks. Vitest asserts both directions.

**Performance targets.**
- Autopick latency p95 ≤ 1000ms / p99 ≤ 2000ms.
- Timer drift < 100ms across all connected clients.

**Estimated effort.** 4–5 days.

---

### Chunk 11g.7 — Snapshot persistence + operations & observability foundation

**Deliverable.** `LobbyManager` writes a snapshot to `draft_state` every N picks (suggest N=5) and every 30 seconds, whichever comes first. Snapshot payload is the minimum needed to recover the in-memory projection without replaying the full event log: `pickNumber`, `onClockTeamId`, `pickDeadline`, `lastBroadcastSeq`. The candidate pool is NOT persisted in the snapshot — it gets rebuilt from `player_directory` + `draft_picks_v2` on bootstrap (cheaper than serializing 2000 rows × 14 columns). On process startup, a bootstrap routine queries `leagues WHERE draft_status IN CONNECTABLE_DRAFT_STATUSES` (the `'queued' | 'in_progress' | 'paused'` subset from `@citrus/shared`; **note**: there is no `'drafting'` value in the actual enum — the schema fact established by chunk 11g.1's follow-up) and, for each, instantiates a `LobbyManager` from the latest snapshot + replay of `draft_events` since the snapshot's `lastBroadcastSeq`. Lobbies are registered into `LobbyRegistry` and timers resume. Connected clients reconnect via chunk 11g.5's protocol; the server-side state is already there waiting for them.

Reads and writes `leagues.draft_status` using the `DraftStatus` type from `@citrus/shared` (per chunk 11g.1 follow-up). The `paused` state must be respected: snapshots still occur for paused lobbies (the lobby is alive, just not advancing — pause/resume must survive a process restart); the timer is restored from the snapshot's `pickDeadline` but does not tick while paused; the bootstrap routine includes paused drafts in its lookup so a paused-then-server-crashed-then-restarted draft survives intact.

**Dependencies.** 11g.6.

**Acceptance criteria.**
- A snapshot row appears in `draft_state` after every 5 committed picks during a test draft, and at least one row per 30 seconds even if no picks happen. Verified via row count + timestamp inspection.
- Test: kill the server process mid-draft (5 picks committed, 2 clients connected, deadline 30s out). Restart. The bootstrap reloads the lobby from snapshot + 5 events of replay; the timer resumes with the correct `pickDeadline`; clients reconnect via 11g.5 and receive the current state. **No picks lost. No duplicates. Total recovery time < 5 seconds.**
- Test: the snapshot/replay path agrees with a from-scratch `reconstruct_draft_state` call — the in-memory projection after bootstrap is byte-equal to a full reconstruction. Vitest property test runs over a corpus of synthetic event logs.
- Bootstrap routine logs structured events (`lobby_bootstrap_started`, `lobby_bootstrap_complete`, `lobby_bootstrap_failed`) at INFO/INFO/ERROR for ops visibility.

**Performance targets.**
- Bootstrap completes in < 5 seconds for a 12-team / 50-picks-committed draft.
- Snapshot write does not block the single-writer queue (runs as a fire-and-forget side effect after the mutation commits).

**Estimated effort.** 3–4 days.

---

**Additional scope (operations & observability foundation, added 2026-05-04 per chunk 11g.2 step 5 finding):**

Chunk 11g.2 step 5 surfaced that container logs were not reaching Cloud Logging on the Debian-based staging VM (the chunk 11g.2.0 spike's `--metadata=google-logging-enabled=true` assumption was wrong for non-COS images). The fix landed in commit `fdbc76f` (Docker `gcplogs` log driver applied at `docker run` time). With logs now shipping, the world-class observability foundation can be built on top — and is deliberately deferred to here, chunk 11g.7, because dashboards/alerts/metrics should be designed against the real `LobbyManager` + event-sourced state machine (chunks 11g.4–11g.6), not the chunk 11g.2 hello-world echo scaffold.

**Scope of the observability addition:**

- **(a) Structured JSON logging.** `@citrus/shared` `logger` refactor to JSON-by-default output across all services. Today's `console.log`-style strings (`[uws] upgrade rejected lobbyId=lobby-A reason=no_token`) become structured records with explicit fields (`{event: "uws_upgrade_rejected", lobby_id: "lobby-A", reason: "no_token", ts: "..."}`). Cloud Logging parses JSON automatically; queries and log-based metrics gain typed-field semantics.
- **(b) Cloud Monitoring dashboards-as-code.** New file `infra/gce/observability-setup.sh` provisions dashboards via `gcloud monitoring dashboards create`. Initial dashboard set:
  - **Live connection count** (per-VM gauge).
  - **WS upgrade success vs failure rate** (per-minute, with `reason` breakdown for failures).
  - **Latency distributions** (discovery endpoint p50/p95/p99; WS upgrade handshake p50/p95/p99; pick-submit-to-broadcast p50/p95/p99 once chunk 11g.4 lands).
  - **Error rate** (5xx + uncaught exception count).
- **(c) Log-based metric definitions.** Provisioned via `gcloud logging metrics create`. Initial set:
  - `uws_upgrade_rejection_rate` (counter, labels: reason, environment).
  - `uws_upgrade_accepted_rate` (counter, labels: environment).
  - `error_rate` (counter, severity: ERROR).
- **(d) Alert policies as code.** Provisioned via `gcloud alpha monitoring policies create`. Initial set:
  - **Rejection-rate spike** — > 10× the rolling 24h baseline for 5 min triggers a P2 alert (likely client misconfiguration or attack).
  - **Container-exit anomaly** — non-zero exit code or unexpected restart triggers a P1 alert.
  - **p95 latency breach** — discovery endpoint p95 > 300ms or WS upgrade p95 > 100ms for 5 min triggers a P2 alert (matches the existing performance mandate in `CLAUDE.md`).
- **(e) On-call runbooks.** New `docs/RUNBOOKS/` files for the most common failure modes: container won't start, secret access denied, image pull fails, port conflict, JWT verification fails systemically. Each runbook is one page: symptom → first diagnostic command → likely cause → remediation.

**Operational principle (per Zach):** native Google tooling only — `gcloud` commands committed as bash scripts under `infra/gce/`. No Terraform. Future migration path to Config Connector when complexity warrants it (i.e., when the alert/dashboard inventory grows past what's comfortable in shell scripts).

**Target window:** pre-launch operations hardening (~6 weeks before NHL season opener, aligned with chunk 11g.11 load test). Dashboards/alerts go live alongside the load test so we can validate them under realistic traffic before launch.

**Additional dependencies:** chunks 11g.4–11g.6 complete (LobbyManager + pick path + timer/autopick exist to instrument). Chunk 11g.2 fully deployed with `gcplogs` driver (✅ done 2026-05-04).

**Additional estimated effort:** 4–6 days (logger refactor 1–2 days; dashboards/metrics/alerts 2–3 days; runbooks 1 day).

---

### Chunk 11g.8 — Remove pgmq emissions from writer-side RPCs *(re-scoped 2026-05-11)*

> **Re-scope note.** The original chunk 11g.8 ("Failure mode test suite") moved to chunk 11g.11 — it's load-test-adjacent work that exercises the engine under conditions only meaningful once observability + legacy cleanup are done. Doing failure-mode tests pre-cleanup would mean writing tests against an architecture that still has dead pgmq plumbing in it. The natural sequencing is: legacy cleanup (now-11g.8/11g.9) → production rollout (11g.10) → load test + failure mode tests (11g.11). The new 11g.8 + 11g.9 split partitions the legacy autopick infrastructure cleanup into writer-side (this chunk) and consumer-side (11g.9). See `PHASE_4_5_PROJECT_PLAN.md` Decision Log 2026-05-11 for the reorganization rationale.

**Deliverable.** Remove every `PERFORM pgmq.send(...)` call from every Postgres RPC. The persistent draft engine (chunk 11g.4 step 6c) fires autopicks via in-memory `setTimeout` timers + direct `submit_pick_v2` invocation; the pgmq emission is a side effect nothing in the engine observes. This chunk removes the writer wiring; chunk 11g.9 (next) removes the consumer + tables + extension.

Single migration `supabase/migrations/20260511010000_remove_pgmq_emissions.sql` `CREATE OR REPLACE`s four RPCs:

- **`submit_pick_v2`** — removed Step 5's `v_send_delay` computation + `PERFORM pgmq.send` block (was 20260425140000:904-923). Engine reads `result.pick_deadline` from the RPC return and runs its own in-memory timer.
- **`draft_resume`** — removed the trailing pgmq emit block (was 20260511000000:376-396). `generation_bumped` event-write **retained** (Option B: defer protocol removal to 11g.9).
- **`draft_extend`** — removed the trailing pgmq emit block (was 20260511000000:528-548). `generation_bumped` retained.
- **`draft_deadline_sweep`** — removed inner `PERFORM pgmq.send` (was 20260426130000:140-150). The function's predicate walk + `safety_net_hit` metric write are preserved; the function itself + its pg_cron job are removed in chunk 11g.9.

Each RPC's other behavior is preserved: idempotency, actor authorization, atomicity contracts, the chunk 11g.7 sub-step 7e `draft_events_notify_after_insert` trigger (which fires on the durable INSERT, NOT on pgmq emission — unaffected by this change).

**Dependencies.** 11g.7 (the live-event subscription path replaces pgmq as the cross-process notification mechanism).

**Acceptance criteria.**
- `git grep -n "pgmq.send" supabase/migrations/20260511010000_remove_pgmq_emissions.sql` returns zero hits in the *new* migration body (sanity check that the removal is complete).
- `grep "PERFORM pgmq.send" supabase/migrations/*.sql | wc -l` returns the count BEFORE this migration; after applying, the four CREATE OR REPLACE statements supersede the older bodies.
- All 874 server tests stay green (no test references pgmq behavior, recon-verified).
- Engine flows continue to function — autopick paths work end-to-end against staging without any pgmq involvement.

**Performance targets.** None (subtractive chunk).

**Estimated effort.** ~0.5 days. Migration-only commit; no engine code changes, no test additions.

---

### Chunk 11g.9 — Edge Function infrastructure removal *(expanded 2026-05-11, shipped 2026-05-12)*

**Status.** Shipped 2026-05-12 on branch `phase-4-5-implementation`. Migration `supabase/migrations/20260512000000_remove_pgmq_infrastructure.sql` removed all legacy pgmq surface; `supabase/functions/draft-autopick/` deleted in the same commit. KI-007 RESOLVED, KI-009 RESOLVED, KI-004 SUPERSEDED. See migration header (Decision Log D1–D8) for the chunk-specific decisions, including the corrected CHECK-enum recount (21 → 20, not 20 → 19 as the recon report had said), the `submit_pick_v2 v_generation` leak cleanup brought in here under Path A, and the leagues.`draft_generation` DROP COLUMN rationale.

**Deliverable.** Once chunk 11g.8's pgmq emissions are removed and chunk 11g.7 sub-step 7e's LISTEN/NOTIFY path is the canonical cross-process notification mechanism, this chunk deletes the Phase 0–4 Edge Function infrastructure entirely. Specifically:

- Delete `supabase/functions/draft-autopick/` (the Deno autopick worker — pgmq consumer).
- Drop the pg_cron jobs `draft-deadline-sweep` and `draft-autopick-keepalive` via a new migration in `supabase/migrations/`.
- Drop the pgmq queue `draft_deadlines` and its archive table via the same migration.
- Drop the pgmq wrapper RPCs `draft_autopick_read` and `draft_autopick_archive` (from `20260426140000_draft_engine_v2_phase3_pgmq_wrappers.sql`).
- Drop the `pgmq` extension itself (no remaining consumers after the above).
- Drop the `draft_deadline_sweep()` function (its writer-side emission was already a no-op after 11g.8; the function + its cron job both go).
- **(Expanded scope 2026-05-11):** Remove the `generation_bumped` event-write protocol. Drop `'generation_bumped'` from the `draft_events.event_type` CHECK enum. Remove the two `PERFORM append_draft_event(... 'generation_bumped' ...)` calls from `draft_pause` / `draft_resume` / `draft_extend` (per chunk 11g.8 Option B — protocol cleanup deferred to 11g.9 alongside the rest of the pgmq teardown). Remove the bootstrap dispatcher's `default: skip-with-debug-log` arm OR keep it as a defensive forward-compat catch (decision in 11g.9 recon — **2026-05-12 recon resolved: RETAIN** the explicit `case 'generation_bumped':` arm in `LobbyManager.applyEventDuringBootstrap` for replay of historical events; the write side goes, the read side stays).
- **(Recon addition 2026-05-12):** Drop `leagues.draft_generation` column. The column was used exclusively for pgmq message-staleness coordination (workers compared message-attached `generation` against the live column to no-op stale messages). The engine never reads it; with pgmq removed, no consumer remains. All snake/linear RPCs that referenced the column are CoR'd in the same migration; auction RPCs never referenced it.
- **(Recon addition 2026-05-12):** Clean up the `submit_pick_v2 v_generation` declaration left over from chunk 11g.8 (Path A — natural completion of the cleanup arc; preferred over force-push of 11g.8 for commit-history hygiene).
- ~~Delete `supabase/functions/_shared/_vendored/`~~ Already absent from this codebase version per 11g.9 recon — directory does not exist. The PLAN line is left here as historical context; no action was needed in 11g.9.
- ~~Remove the SQL `_v2_test._uuidv5` cross-runtime parity helper and the corresponding TypeScript test fixture~~ Already absent. Same context as the line above.
- `git grep` audit confirms zero remaining references to deleted surfaces in shipped code (test fixtures, comments, runbooks). Stale references either get updated or get deleted. **2026-05-12 audit:** legacy SQL integration scripts at `supabase/tests/draft_engine_v2_phase{1,2,3}*.sql` and `supabase/seeds/phase1_regression_seed.sql` still reference `draft_generation` / `generation_bumped` / `pgmq`. These are standalone scripts (not in CI/vitest); they test the legacy pgmq architecture and will fail to apply after this migration. Left in place; retirement deferred to 11g.10 / 11g.11.

The chunk also closes the runbook entries: **KI-007** (vendored shared code drift) flips to `RESOLVED (chunk 11g.9 commit-sha, date)`. **KI-004** (Phase 3 keep-alive cron's hardcoded staging URL) is annotated `SUPERSEDED by chunk 11g.9 — surface deleted` with the same commit SHA.

**Dependencies.** 11g.8 (pgmq emissions removed — necessary precondition; deleting the queue while any RPC still emits to it would break those RPCs).

**Acceptance criteria.**
- `git ls-files supabase/functions/draft-autopick/` returns 0 files.
- `git ls-files supabase/functions/_shared/_vendored/` returns 0 files.
- `git grep -n "_vendored\|draft-deadline-sweep\|draft-autopick-keepalive\|draft_deadlines\|generation_bumped"` returns no references in shipped code (matches in `docs/RUNBOOKS/draft-engine-v2-known-issues.md` and migration history are expected and acceptable).
- The removal migration applies cleanly on staging and is idempotent (re-running is a no-op).
- The chunk 11g.11 failure-mode test suite (relocated from former 11g.8) re-runs after the deletion and all six scenarios still pass — confirming the Edge Function was already not on the critical path.
- KI-007 row in `docs/RUNBOOKS/draft-engine-v2-known-issues.md` carries `RESOLVED (commit-sha, date)`. KI-004 row similarly annotated.

**Performance targets.** None (subtractive chunk).

**Estimated effort.** 1–2 days. Mostly auditing and writing the migration; the deletes themselves are mechanical. **Actual effort:** ~0.5 day (recon + migration + doc updates + commit on 2026-05-12).

---

### Chunk 11g.10 — Productionization + Mandate verification *(re-scoped 2026-05-12 via sub-step 10a)*

**Pointer.** Full plan lives at [`docs/PHASE_4_5_PRODUCTIONIZATION_PLAN.md`](./PHASE_4_5_PRODUCTIONIZATION_PLAN.md) (authored 2026-05-12 by chunk 11g.10 sub-step 10a). That document carries the Mandate verbatim quote, architecture-to-Mandate mapping, current-state assessment, binding-patterns audit, non-negotiables operational discipline, full sub-step decomposition, risk register (including solo-founder risk R10C), 10f sign-off criteria, and Decision Log. This section here is the per-chunk pointer + decomposition table — the productionization plan doc is the canonical reference.

**Re-scope rationale.** The original chunk 11g.10 was scoped as a single-deliverable perf-verification sprint. Sub-step 10a recon surfaced that the staging GCE VM was torn down 2026-05-04 (chunks 11g.3–11g.9 shipped local-only); engine runbooks are pgmq-era stale post-11g.9; no Cloud Monitoring dashboards exist; no rollback playbook exists for the post-pgmq world; no production cutover plan exists. Productionization is genuinely multi-deliverable work, not single-sprint. The re-scope decomposes chunk 11g.10 into sub-steps 10a–10f.

**Sub-step decomposition table.**

| Sub-step | Deliverable | Effort (focused-work) | Dependencies |
|---|---|---|---|
| 10a | Plan document + Mandate consolidation + sub-step decomposition + risk register | ~1 day | None |
| 10b | Staging re-provisioning + smoke verification | ~1–2 days | 10a |
| 10c | Perf measurement harness (`server/bench/`) + execution + `PHASE_4_5_BASELINE.{json,md}` | ~3–5 days | 10b |
| 10d | Cloud Monitoring dashboards + alert policies (gcloud / Config Connector, no Terraform) | ~2–3 days | 10b |
| 10e | Runbook rewriting (3 engine runbooks + new rollback playbook) | ~1–2 days | None hard (parallel-safe with 10a, 10b, 10c, 10d) |
| 10f | Production cutover plan (canary, league-by-league rollout, sign-off) | ~1 day | 10c + 10d + 10e |

**Total effort:** ~10–14 focused-work days. Calendar duration is ~3–4 weeks given solo-founder parallel commitments per Phase B–C overlap.

**Mandate targets (verbatim from `CLAUDE.md`).** Per-target verification at 10c against staging:
- Manual pick submission: p95 ≤ 300ms / p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms / p99 ≤ 2000ms
- Draft state load: p95 ≤ 1500ms
- Timer accuracy: drift < 100ms
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Reconnection recovery: p95 ≤ 2000ms

Plus `git grep "KI-010 Tier 1"` ≥ 4 hits in `server/src/draft/` (chunks 11g.3 + 11g.4 baked these in).

**Dependencies.** 11g.9 (the post-pgmq world is the foundation this chunk rests on).

**Acceptance criteria — and the Phase 5 entry gate.** All 6 bullets in PRODUCTIONIZATION_PLAN.md §8 "10f Sign-Off Criteria" must be met. Summary: Mandate compliance + architecture compliance + monitoring live with non-zero data + runbooks rewritten and reviewed + rollback path tested + canary plan ratified.

**Pass:** Phase 5 (UI client work) unblocks. KI-010 closes (RESOLVED) when 10c confirms the Tier 1 optimizations carry the Mandate targets.
**Fail (any target missed by > 10%):** stop. Targeted optimization absorbs remaining 10c budget. **Not a deferral** — the Mandate is binding per `CLAUDE.md` §1.5 non-negotiables.

**Sub-step status (this section updates as sub-steps ship).**

| Sub-step | Status | Commit / date |
|---|---|---|
| 10a | **Complete 2026-05-12.** Plan document at `docs/PHASE_4_5_PRODUCTIONIZATION_PLAN.md`. | (this commit) |
| 10b | Pending | — |
| 10c | Pending | — |
| 10d | Pending | — |
| 10e | Pending (parallel-safe; can start any time post-10a) | — |
| 10f | Pending | — |

---

### Chunk 11g.11 — Failure mode test suite + load test *(combined 2026-05-11)*

> **Note.** This chunk combines the original 11g.8 "Failure mode test suite" content (relocated 2026-05-11) with the previously-net-new "load test as hard gate" tracked in `PHASE_4_5_PROJECT_PLAN.md` Decision Log (2026-04-29). Doing both together is the right sequencing — failure-mode scenarios exercise the engine under conditions only meaningful once observability + legacy cleanup + perf-baselined production are in place. Tests written pre-cleanup would have been against an architecture still carrying dead pgmq plumbing.

**Deliverable.** Six failure-mode integration tests + load test against a real production-equivalent GCE deployment. Failure-mode scenarios:

1. **Process crash mid-draft** — kill the Node process during an active draft (5 picks committed, 2 clients connected). Expected: clients see WS disconnect, server restarts, lobby bootstraps from snapshot + replay (chunk 11g.7), clients reconnect with `last_seen_seq` (chunk 11g.5), draft continues. No picks lost, no duplicates.
2. **Client reconnect after network drop** — drop a single client's WS connection mid-draft (TCP close). Expected: client reconnects, replays missed events from ring buffer (chunk 11g.5). No effect on other clients. Reconnection p95 ≤ 2000ms.
3. **Duplicate pick submission with idempotency keys** — client A submits the same pick twice (same idempotency key, e.g. retry after a flaky network). Expected: second submission returns `{ was_duplicate: true }`, no second `draft_events` row, no second broadcast.
4. **Two users racing on the clock** — clients A and B both submit picks within the same single-writer-queue tick. Expected: one wins (commits + broadcasts), the other receives a typed "not on clock" rejection without committing.
5. **Slow client** — one client's WS has `getBufferedAmount() > 1MB` (simulated by withholding ACKs). Expected: chunk 11g.4's fanout protection skips the slow socket on subsequent broadcasts; the slow client is flagged for resync; other clients receive picks at normal latency.
6. **Deploy during active draft (drain mode)** — GCE rolling restart (process receives SIGTERM, drains, exits; new process boots) while a draft is mid-clock. Expected: old process flushes its single-writer queue and commits in-flight mutations before exit; new process bootstraps the lobby from snapshot + replay (chunk 11g.7); clients reconnect via 11g.5. Draft continues without operator intervention. *(See `docs/PHASE_4_5_ARCHITECTURE.md` "Failure Modes Handled on Day 1" and "Day 1 Topology" for the canonical drain semantics on GCE.)*

Plus the load test (the Path B from `PHASE_4_5_ARCHITECTURE_ANSWERS.md` Q4.1): simulated peak load against a production-equivalent GCE deployment. 1,000 simulated clients across multiple concurrent leagues; verify Mandate targets continue to hold under sustained pressure; gather scale data on the snake-vs-auction broadcast cost (auction is hotter — anti-snipe cascades produce extension events per bid).

**Dependencies.** 11g.10 (Performance verification — the perf baseline established there is the floor under load).

**Acceptance criteria.**
- All six failure-mode tests pass on staging. Each test produces a structured log artifact (committed alongside the test) showing the timeline of events for review.
- Each test asserts both the happy outcome AND the absence of a failure mode (e.g., scenario 3 also asserts that `draft_events` has exactly one row, not zero or two).
- Mandate targets continue to hold under each scenario where they apply (e.g., scenario 2 asserts reconnection p95 ≤ 2000ms; scenario 4 asserts manual pick latency under contention p95 ≤ 300ms).
- Load test: Mandate targets hold under 1000-client sustained load for ≥ 30 minutes. Report committed alongside the chunk 11g.10 baseline.

**Performance targets.** Full Mandate set holds under both single-scenario stress and sustained 1000-client load.

**Estimated effort.** 5–7 days. Scenario 6 is the trickiest — needs the GCE rolling-restart / SIGTERM-drain mechanism documented and a drain-mode hook on the engine (chunk should design this). Load harness setup is real work (1–2 days alone).

---

## Registry tracking during the build

New issues that surface during Phase 4.5 land in the appropriate registry at commit time:

- **Cross-cutting / project-wide concerns** → `docs/REGISTRY.md`. Examples: ops surface area changes, new external dependencies, hosting-cost surprises.
- **Draft-engine-specific concerns** → `docs/RUNBOOKS/draft-engine-v2-known-issues.md`. Examples: a `uWebSockets.js` quirk on GCE, a Postgres query that needs an index, a Hono+uWS coexistence gotcha.
- **Spec-level concerns (changes to the integration boundary)** → require an ADR. The integration boundary (Postgres RPC signatures, payload shapes, idempotency-key derivation, WebSocket message protocol) does not change without explicit governance.

Existing open KIs that interact with this work:

- **KI-003** (Phase 7 carryover): rate limiter session-affinity. The single-process Day 1 architecture means every connection for a given lobby lands on the same instance, which solves the immediate session-affinity problem in a degenerate way. Re-evaluate KI-003 if/when multi-process sharding ships.
- **KI-004** (Phase 8a target): hardcoded staging URL in the keep-alive cron. **SUPERSEDED by chunk 11g.9** — the cron job ceases to exist. The runbook row carries the supersede annotation with the chunk 11g.9 commit-sha.
- **KI-005** (Phase 8a target): DLQ paging trigger on `autopick_failures`. Still applies, but now narrower in scope: the in-server engine writes to `autopick_failures` on terminal autopick failure (chunk 11g.6 deliverable). The Edge Function path is gone (chunk 11g.9), so this is the only writer.
- **KI-006** (Phase 7 target): heuristic O(N×M) candidate scan latency. **RESOLVED at chunk 11g.10** — the chunk 11g.3 in-memory candidate cache eliminates the per-pick query that was the cost driver; chunk 11g.10's benchmark confirms.
- **KI-007** (Phase 7 target): vendored shared code drift. **RESOLVED at chunk 11g.9** — the vendored `_shared/_vendored/` directory is deleted alongside the Edge Function infrastructure. The in-server engine imports `@citrus/shared` natively; no second runtime needs vendored copies.

New KIs filed at plan time (all rewritten to match the in-server engine direction):

- **KI-008**: Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft (architectural pivot rationale; the autopick latency was structural to the Edge Function model).
- **KI-009**: Edge Function infrastructure removed entirely; engine in existing server (operational simplicity over dual-runtime hedging).
- **KI-010**: Tier 1 perf optimizations baked into Phase 4.5 design from the start (parallel async, candidate pool caching, byte-limited delta broadcasts, fanout protection — closes at chunk 11g.10 with measured evidence).

Future KIs (likely to be filed during the build):

- A KI covering whichever GCE quirk surfaces (e.g., WebSocket idle-timeout tuning, rolling-restart drain-mode behavior, MIG rehash semantics if/when Stage 3 lands).
- A KI covering whichever Hono+uWS coexistence quirk surfaces (port allocation, middleware reuse, build-pipeline interactions).
- A KI for any latency target the benchmark suite chronically misses by < 10% — bounded, documented, scheduled for follow-up before Phase 5 starts.
- **KI-011** is filed at plan time for the Day 2 multi-process sharding transition (single-process Day 1 is a deliberate scope cut, not a long-term posture; trigger conditions and refactor-not-rewrite contract documented in the registry row).

---

## Cross-references

- `docs/adr/ADR-001-persistent-node-draft-engine.md` — the architectural decision this plan implements.
- `CLAUDE.md` § Citrus Draft Performance Mandate — the binding performance targets.
- `CLAUDE.md` § Tech Stack — the in-server engine architecture documentation.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 + §0.5 — spec-side reference. `LobbyManager` is the in-process holder of the same projection (formerly referred to as `DraftRoom` in early architectural drafts; see ADR-001 Decision History).
- `docs/REGISTRY.md` — KI-008, KI-009, KI-010 (project-wide concerns; rewritten for the in-server direction).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KIs; KI-004 SUPERSEDED and KI-007 RESOLVED at chunk 11g.9.

This plan is **accepted but not yet executing**. Implementation begins with chunk 11g.0 in a separate session/commit. Each chunk lands as its own commit with deliverables verified on staging before the next starts.
