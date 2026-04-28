# ADR-001: Persistent Node Draft Engine in Existing Server

| | |
|---|---|
| **Status** | Accepted (2026-04-28). |
| **Authority** | Supersedes the Phase 0–4 architecture for the live draft hot path. |
| **Binding constraints** | `CLAUDE.md` § Citrus Draft Performance Mandate; `docs/DRAFT_ENGINE_V2_SPEC.md` § §0. |
| **Companion docs** | `docs/PHASE_4_5_PLAN.md` (chunks 11g.0–11g.9); `docs/REGISTRY.md` KI-008 (architectural pivot), KI-009 (Edge Function infrastructure removed entirely), KI-010 (Tier 1 perf optimizations baked in from start). |

## Context

### The 11.7s autopick problem

Phase 4 verification on staging measured the autopick path's end-to-end latency at **~11.7 seconds per pick**. That number is the time from `pick_deadline` expiry to the resulting `pick` event being committed and broadcast. It comprises:

- ~10s of pg_cron + Edge Function cold-start + worker idle-sleep tail before the `draft-autopick` Edge Function runs the `submit_pick_v2` RPC for the expired league.
- ~1.5s of per-pick Postgres work (candidate-pool fetch ≈ 2000 rows × 14 stat columns; reconstruct_draft_state; submit_pick_v2 with idempotency-key advisory lock; trigger-driven projection insert; pgmq archive).
- ~200ms of Supabase Realtime broadcast fanout to connected clients, _when broadcast succeeds at all_; per-channel rate limits surface at modest connection counts.

11.7s/pick is **non-competitive**. Yahoo Fantasy and ESPN Fantasy commit autopicks in well under 1 second. Sleeper, the closest UX comparable in fantasy hockey/football, does the same. A user making 12 picks in an unattended round on Citrus would wait ~140 seconds total for the round to clear, vs. ~12 seconds on competing platforms. That is a marketing-material-grade delta visible in any side-by-side comparison.

### The Performance Mandate

On 2026-04-27, the project ratified a binding **Performance Mandate** (`CLAUDE.md` § Citrus Draft Performance Mandate, commit `1427b18`; mirrored at `docs/DRAFT_ENGINE_V2_SPEC.md` § §0, commit `b2354d7`). The mandate sets hard targets:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Draft state load: p95 ≤ 1500ms
- Timer drift: < 100ms across all clients
- Reconnection recovery: p95 ≤ 2000ms

The mandate explicitly rejects the framing "we can optimize later" for any user-perceived latency. The Phase 4 result violates the autopick target by ~10×. No optimization within the existing architecture closes that gap — the structural causes (pg_cron 2-min cadence; Edge Functions cold-start and die between invocations; per-pick Postgres reads of the candidate pool) are inherent to the architecture, not to the implementation.

### The gap is structural, not implementation

Three concrete properties of the Phase 0–4 architecture make the targets physically unreachable:

1. **No persistent per-draft state.** Every Edge Function invocation starts cold (or warm-but-stateless) and re-fetches the candidate pool, the reconstructed state, and the team queues from Postgres. At ~1500 active NHL players × 14 stat columns × 1 query per pick, this is a guaranteed multi-hundred-millisecond floor _before_ the worker does any actual decision-making.
2. **Scheduling cadence dominates.** pg_cron's keep-alive fires every 2 minutes; the Edge Function's loop budget is 140s. Even if the per-pick work were instantaneous, the worst-case time-from-deadline-to-worker-pickup is ~2 minutes. The current Phase 4 measurement (~11.7s) reflects the average case across a single invocation; tail latency is bounded only by the keep-alive period.
3. **Broadcast fanout is third-party.** Supabase Realtime has documented per-channel rate limits and tail-latency profiles that don't meet sub-200ms. Even if the server-side path were instant, the broadcast leg fails the mandate.

Optimization within the existing structure can shave ~30–50% off the per-pick number. It cannot deliver an order-of-magnitude reduction. The architecture is what needs to change.

## Research

Web research into how successful real-time multiplayer / live-collaboration systems are actually built revealed a convergent architectural pattern. The convergence is striking: independent teams, working in different domains (chat, design, fantasy sports), with different team sizes and different scaling pressures, arrived at the same approximate shape.

### Sleeper — Elixir for fantasy at scale

Sleeper is the obvious comparable: a fantasy sports app whose live-draft UX is the gold standard in the space. Their engineering writeups document Elixir as the runtime for the user-facing live components.

- **"The Story of Sleeper"** ([draftkick.com/blog/story-of-sleeper](https://draftkick.com/blog/story-of-sleeper/)) — narrative on Sleeper's stack choices. Elixir + Phoenix for the live experience.
- **ScyllaDB case study** ([scylladb.com/2020/10/22/sleeper-app-using-scylla-to-level-the-playing-field](https://www.scylladb.com/2020/10/22/sleeper-app-using-scylla-to-level-the-playing-field/)) — Sleeper's engineering team discussing scaling pressures, persistent process model, low-latency reads. Confirms Elixir/Phoenix as the live-draft runtime and surfaces the data-layer thinking around hot-path reads vs. durability.

The takeaway: a directly-comparable competitor in our exact domain converged on Elixir/Phoenix for the same reason we are about to. This is not a speculative bet on an unproven runtime; it's the runtime our most credible reference point already runs.

### Discord — Elixir at billion-message-per-day scale

Discord runs a substantial portion of its real-time gateway and chat fanout on Elixir. The case for Elixir as a credible production runtime at hyperscale is well-documented:

- **"Architecting for Hyperscale: An In-Depth Analysis of Discord's Billion-Message-Per-Day Infrastructure"** ([d4dummies.com/architecting-for-hyperscale-an-in-depth-analysis-of-discords-billion-message-per-day-infrastructure](https://d4dummies.com/architecting-for-hyperscale-an-in-depth-analysis-of-discords-billion-message-per-day-infrastructure/)) — the case study of Discord's real-time gateway. Persistent processes, Phoenix Channels, BEAM-level scheduling, fault-tolerant supervision trees.

Discord's pattern is the "single-tenant guild process" — one BEAM process per guild, holding presence/channel/permission state in memory, handling fanout. The pattern translates almost exactly to "one DraftServer process per active draft" for Citrus. The scaling envelope (Discord runs millions of guilds; we will run thousands of drafts at peak) is comfortably within what the Discord case studies demonstrate.

### Figma — persistent-process multiplayer

Figma's collaborative editor is the closest non-fantasy reference for the architectural pattern. Their engineering blog has two relevant pieces:

- **"How Figma's Multiplayer Technology Works"** ([figma.com/blog/how-figmas-multiplayer-technology-works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)) — the per-document persistent-server pattern, in-memory state, WebSocket transport, conflict resolution. Figma is not Elixir (they're in Rust now), but the architectural pattern is what we're adopting; the language is implementation detail.
- **"Making Multiplayer More Reliable"** ([figma.com/blog/making-multiplayer-more-reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/)) — the operational lessons on reconnection, snapshot recovery, partition handling. Directly informs the Phase 4.6 reconnection/resume protocol.

Takeaway from Figma: the persistent-process + WebSocket pattern is generalizable beyond chat. It works for any user-perceived "live multi-user editing" experience. A live draft is exactly that.

### Phoenix Channels — the framework

The Phoenix framework's WebSocket abstraction (Phoenix Channels) is the specific tool we'll use for the bidirectional transport between clients and the Elixir engine.

- **Phoenix Channels documentation** ([hexdocs.pm/phoenix/channels.html](https://hexdocs.pm/phoenix/channels.html)) — canonical reference for join/leave/broadcast/push primitives, presence, channel-level authorization, and the BEAM-level message routing that makes sub-200ms fanout achievable without per-message Postgres round-trips.

Phoenix Channels is _the_ tool for what we're doing. Sleeper uses it. Many smaller production systems use it. The framework's abstractions map almost trivially to a "draft room" mental model: a channel per active draft, joined by every connected participant, with broadcast/push primitives for picks and timer ticks.

### Elixir in production — the honest retrospective

Adopting a new language and runtime carries real cost. The most credible voice on what actually happens after three years of running an Elixir service in production:

- **"Elixir Three Years in Production"** ([ryanrasti.com/blog/elixir-three-years-production](https://ryanrasti.com/blog/elixir-three-years-production/)) — a balanced retrospective covering wins (per-process supervision, hot-code-reload, low operational overhead per service, GenServer-as-state-machine fitting domain models cleanly) and friction (smaller hiring pool than Node; some libraries less mature; deployment tooling has improved but isn't as turnkey as JS; type system limitations vs. TypeScript). The piece is explicit that Elixir's per-runtime ops cost is _lower_ than Node's, but adopting it as a _second_ runtime alongside an existing stack is more overhead than running one stack regardless of which one. That observation is the basis for KI-009.

This retrospective informed the choice of Path 3 (hybrid) over Path 2 (full rewrite) — see Alternatives below.

### The convergent pattern

Across Sleeper, Discord, Figma, and the broader live-multiplayer space, the architectural shape we're adopting recurs:

1. **One persistent server process per "room" / "doc" / "draft" / "guild."** State held in memory for the duration of the session.
2. **Bidirectional WebSocket transport** between clients and that process.
3. **Durability layer** (database, event log, blob storage) for crash recovery and historical access — **not** on the hot path of action → broadcast.
4. **Reconnection via snapshot or event-replay** so brief network drops don't lose state.

This is not a novel architecture for Citrus to invent. It is the architecture that the relevant reference systems all converge on. Choosing it for Phase 4.5 brings Citrus's draft engine into the same architectural neighborhood as the systems users are unconsciously comparing it to.

## Decision

**Citrus builds the live draft engine as persistent code inside the existing Node.js / Hono server on Cloud Run.** Not a separate service. Not Elixir. Not Edge Functions. The engine is a new module set in `server/` consisting of:

- A `DraftRoom` class holding **per-draft in-memory state** (one instance per active draft).
- A **WebSocket layer** added to the existing Hono server, accepting connections from browser clients for picks, broadcasts, timer ticks, presence.
- An **autopick scheduler** driven by `setTimeout` per draft.
- A **recovery path that replays the event log on server startup** — on boot, the server queries `draft_events` for active drafts, rebuilds in-memory `DraftRoom` state, and resumes timers. Connected clients reconnect via the WebSocket resume protocol with `last_seen_id`.

Writes go to Postgres via the existing Phase 2 RPCs (`submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload`). The integration boundary is the existing RPC surface; it does not change without an ADR.

**The Edge Function infrastructure is removed entirely** in chunk 11g.8 — not retained as a safety net. The Deno code at `supabase/functions/draft-autopick/`, the pg_cron jobs (`draft-deadline-sweep`, `draft-autopick-keepalive`), the pgmq queue (`draft_deadlines`) and its archive, the vendored shared code at `supabase/functions/_shared/_vendored/`, and the cross-runtime hash-agreement infrastructure (Node-side hashing is sufficient now) all get deleted. Recovery via event log replay on Cloud Run restart is sufficient (KI-009).

Phase 0–4 work is **preserved**, not replaced:

- The append-only `draft_events` log remains the source of truth and the durability substrate.
- Idempotency-key + payload-hash semantics, projection trigger, RPC contracts, RLS policies, validators — all unchanged. The in-server engine is a new caller of these surfaces.

The engine moves into the existing server. Everything underneath stays.

## Decision History

This ADR records three accepted decisions in close succession. The audit trail matters because reviewers will see the renames and prior commits and need to understand the path.

### 2026-04-27 — Elixir/Phoenix accepted (superseded)

The first version of this ADR adopted Elixir/Phoenix as a separate service alongside the existing Node main app. Rationale: Sleeper, Discord, Figma all run persistent state holder per "room" + WebSocket transport, and Sleeper specifically runs Elixir/Phoenix. OTP supervision trees mapped cleanly onto "one process per active draft." Reversed the next day after CTO consultation on solo-founder execution risk: a new language + new runtime + new framework + new deploy target + new observability surface, all simultaneously, against a 16-week timeline. The architectural pattern carries; the language is implementation detail.

### 2026-04-28 (morning) — Persistent Node on Cloud Run as a separate service (superseded same day)

Replaced Elixir with persistent Node on Cloud Run. Same architectural pattern, fewer net-new variables (kept TypeScript, npm, Vitest). Edge Functions retained as a cron-driven disaster-recovery safety net. Reversed later the same day on the simplification call below.

### 2026-04-28 (final) — Persistent Node code inside the existing server, Edge Functions removed entirely

Two further simplifications, made together:

1. **The engine lives inside the existing Node server, not a separate Cloud Run service.** A separate service would add a deployment unit, a CI pipeline, an observability surface, and a routing layer for marginal architectural benefit at v1 scale. The existing Hono server already runs on Cloud Run; adding a WebSocket layer + a `DraftRoom` class to it is a code change, not an infrastructure change. **If future scale demands service separation, splitting out the draft engine is a refactor, not a rewrite — Phase 0–4 primitives don't change.**
2. **Edge Function infrastructure is removed entirely**, not retained as a safety net. Recovery via event log replay on Cloud Run restart (chunk 11g.6) is sufficient. The pgmq scheduler, pg_cron jobs, vendored shared code, and the Deno autopick worker were a Phase 0–4 correctness scaffold; once the in-server engine carries the hot path and event log replay carries recovery, the scaffold isn't pulling its weight. Per CTO ethos of operational simplicity: the simplest thing that works.

What carries forward from the prior decision-day work: the Performance Mandate, the Phase 0–4 primitives (event log, idempotency, projection trigger, RPCs), and the architectural pattern (persistent state holder per draft + WebSocket transport + in-memory state + event log underneath). No code from those decision days was committed; only documentation. The simplification reduces deployment surface, observability surface, and conceptual surface without giving up the architectural pattern.



## Alternatives Considered

### (a) Separate Cloud Run service for the draft worker (rejected)

**Shape.** New Node.js service deployed to its own Cloud Run instance, alongside the existing Hono server. WebSocket client connections terminate at the new service; the existing server stays focused on the HTTP API.

**Why considered.** Architectural separation: clean failure isolation, independent scaling, independent deploys for the draft engine without rolling the API.

**Why rejected.** Operational complexity for marginal v1 benefit. Two deployment units, two CI configurations, two observability surfaces, a routing layer between them, and increased coordination overhead during deploys — all to host a workload that comfortably fits inside the existing server at v1 scale (~50 concurrent drafts at peak). The architectural pattern (persistent state per draft + WebSocket transport + event log) doesn't require service separation; it requires persistent code, which the existing server already provides. **If future scale ever justifies splitting it out, doing so is a refactor, not a rewrite — Phase 0–4 primitives don't change.**

### (b) Keep Edge Functions as a disaster-recovery safety net (rejected)

**Shape.** Move the hot path to in-server code but retain the Phase 0–4 Edge Function infrastructure (pgmq queue, pg_cron sweep + keep-alive, Deno autopick worker, vendored shared code) as a passive fallback that activates if the persistent worker is unavailable.

**Why considered.** Defense in depth. If the server crashes mid-draft, the cron sweep would catch missed deadlines and commit autopicks via the existing Edge Function path.

**Why rejected.** The infrastructure cost outweighs the benefit at v1 scale, and event log replay on Cloud Run restart already provides the recovery story. Concretely: keeping the safety net means maintaining the pg_cron jobs (`draft-deadline-sweep`, `draft-autopick-keepalive`), the pgmq queue (`draft_deadlines`) and archive table, the vendored shared code (KI-007), the cross-runtime hash agreement infrastructure, the Vault secret and keep-alive token plumbing, and the Deno-runtime worker — for a code path that almost never fires under normal operation. Cloud Run restart latency is on the order of seconds; the WebSocket reconnect protocol covers that gap. The simplest thing that works wins. KI-009 captures the reasoning in the registry.

### (c) Elixir/Phoenix migration (rejected)

**Shape.** Separate Elixir/Phoenix service, persistent BEAM processes per draft, Phoenix Channels for transport.

**Why considered.** Sleeper and Discord both run Elixir for similar workloads. OTP supervision trees map cleanly onto "one process per active draft." Best-in-class tail-latency profile under sustained load.

**Why rejected.** Solo-founder execution risk over a 16-week timeline. New language + new runtime + new framework + new deploy target + new observability surface + new testing harness, all simultaneously. The architectural pattern is what delivers the Mandate's targets, not the language; persistent Node code delivers the same pattern with the founder's existing toolchain (TypeScript, npm, Hono, Vitest, Cloud Run). The full audit trail is in § Decision History.

### (d) Optimize within the Edge Function model (rejected)

**Shape.** Stay on Edge Functions and tighten the existing autopick path: shorter cron cadence, candidate caching across keep-alive ticks, request coalescing.

**Why considered.** Lowest-friction path. No deployment changes.

**Why rejected.** **Ephemeral functions are the wrong runtime model for live multiplayer state.** The 11.7s/pick on Phase 4 staging breaks down structurally — pg_cron cadence, cold starts, no persistent state across invocations, third-party Realtime fanout limits. Best-case in-architecture optimization is ~30–50% reduction; the Mandate requires ~10×. The architecture, not the implementation, is what fails the targets.

## Consequences

### Positive

1. **Performance Mandate compliance is achievable.** Persistent in-memory state + WebSocket transport + an in-process autopick scheduler put every Mandate target in the achievable envelope. Manual pick p95 ≤ 300ms is one in-memory state mutation + one broadcast. Autopick p95 ≤ 1000ms is a `setTimeout` firing in-process + in-memory selection + RPC write + broadcast. Sub-200ms broadcast fanout to ~12–24 clients per draft is well inside what a single Node process serves.
2. **Single deployment unit, single observability surface, single CI pipeline.** No separate service to deploy, monitor, or coordinate during releases. The existing Cloud Run rollout pipeline carries the engine forward.
3. **Same toolchain end-to-end.** TypeScript, npm, Hono, Vitest, `@citrus/shared` imported directly. No vendoring, no cross-runtime hash agreement, no second package ecosystem to keep in sync.
4. **KI-007 closes.** Vendored shared code at `supabase/functions/_shared/_vendored/` exists only to feed the Edge Function path; deleting that path resolves the drift problem entirely.
5. **Edge Function infrastructure removal is real cleanup.** Less code to maintain, fewer cron jobs to monitor, less Vault wiring, fewer deploy-time gotchas. The simplest thing that works.
6. **Phase 0–4 durability primitives preserved.** Event log, idempotency contracts, projection trigger, RLS, RPC signatures — all unchanged. The pivot is at the engine layer; underneath, the durability stack we already built does its job.
7. **Reversible by refactor, not rewrite.** If future scale demands a separate Cloud Run service for the engine, the `DraftRoom` class and WebSocket layer extract cleanly into their own deployment unit. The integration boundary (Postgres RPC surface + WebSocket protocol) doesn't change. KI-009 captures this.

### Negative

1. **Server restart drops live WebSocket connections briefly.** On deploy or crash, every connected client reconnects. Mitigation: chunk 11g.4's `last_seen_id` resume protocol replays missed events from `draft_events`; chunk 11g.6's startup recovery rebuilds in-memory state for active drafts. Brief reconnect blip, no draft progress lost.
2. **Engine and HTTP API can't be rolled independently.** Any deploy rolls both. For v1 scale this is acceptable — deploys are infrequent and the reconnect protocol covers the gap.
3. **WebSocket library dependency on existing server.** Adds a `ws` (or `socket.io`) dependency to the existing Hono server. **Chunk 11g.0 (dependency compatibility verification) is the explicit go/no-go gate** for this. If the existing server's middleware, async patterns, or build setup conflict with WebSocket upgrades in a way that can't be cleanly resolved, the alternative (a) — separate Cloud Run service — is the documented fall-back, not a rewrite.
4. **No hot-code-reload across deploys.** Unlike the BEAM, Node deploys mean restarting the process. Same mitigation as (1): the reconnect protocol covers the gap.

## What stays vs. what changes

### Stays (Phase 0–4 work, all unchanged — the durability foundation is correct)

- `draft_events` event log — append-only, gap-free per-league `seq`, single source of truth.
- `draft_picks_v2` projection — synchronously maintained by the Phase 2 trigger.
- All Phase 2 RPCs: `submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload`. The in-server engine becomes a new caller; signatures don't change.
- All RLS policies, all schemas, all idempotency-key derivation (`AUTOPICK_NAMESPACE_UUID` + UUIDv5 over `(league_id, pick_number, generation, 'autopick')`), payload-hash semantics (`computePickPayloadHash` from `@citrus/shared`).
- `autopick_failures` DLQ + `draft_autopick_dlq()` RPC — kept for terminal-failure logging from the in-server engine.
- Phase 2 server-side pick path (`server/src/services/DraftServiceV2.ts`) — kept during cutover; once chunk 11g.3 ships and the WebSocket pick path is verified, the HTTP path becomes a fallback for clients that can't open WebSockets.
- The Phase 0–4 Known Issues registry (`docs/RUNBOOKS/draft-engine-v2-known-issues.md`) — KI-001..KI-005 still apply. **KI-006 likely RESOLVED** at chunk 11g.7 by the in-memory candidate cache. **KI-007 RESOLVED** at chunk 11g.8 when vendored code is deleted.

### Changes (the engine layer + Edge Function infrastructure removal)

- **New code in `server/`** (Phase 4.5+): a `DraftRoom` class holding per-draft in-memory state, a WebSocket layer added to the existing Hono server, a `setTimeout`-driven autopick scheduler, and a startup recovery routine that replays the event log for active drafts. Same TypeScript, same `@citrus/shared`, same npm tooling, same Vitest harness, same Cloud Run deployment.
- **New transport.** WebSocket (library decided in chunk 11g.1) for picks, broadcasts, timer ticks, presence. The rest of the app continues to use Supabase Realtime where it currently does (chat, presence on non-draft surfaces).
- **Removed entirely in chunk 11g.8 (per KI-009):**
  - `supabase/functions/draft-autopick/` (the Deno autopick worker).
  - The pg_cron jobs `draft-deadline-sweep` and `draft-autopick-keepalive`.
  - The pgmq queue `draft_deadlines` and its archive table.
  - The vendored shared code at `supabase/functions/_shared/_vendored/` (KI-007 closes).
  - The cross-runtime hash-agreement infrastructure (Node-side hashing in `@citrus/shared` is sufficient; no Deno or SQL parity test surface needed once the Edge Function is gone).
  - The Vault secret + keep-alive token plumbing tied to the Edge Function path.

The chunk 11g.8 commit verifies that nothing else in the codebase depends on these surfaces before the deletes land.

## Validation Gates

The implementation is gated by chunk-level go/no-go review points in `docs/PHASE_4_5_PLAN.md`. Each chunk's acceptance criteria reference the relevant Performance Mandate target; failures fix forward, not in a follow-up chunk.

### Chunk 11g.0 — "Does the existing server tolerate a WebSocket layer?"

**The first gate.** Before any draft engine code lands, chunk 11g.0 audits the existing Node server's `package.json`, runtime config, build pipeline, and middleware stack for compatibility with a WebSocket library and HTTP-upgrade handling. Output is binary: "all clean, proceed to 11g.1" or a specific list of conflicts.

**Fail mode.** If conflicts exist that can't be cleanly resolved (e.g., the existing Hono setup or middleware materially conflicts with WebSocket upgrades and patching it is high risk), the documented fall-back is alternative (a) — a separate Cloud Run service. That's a deploy-surface change, not an architectural rewrite; the `DraftRoom` class and WebSocket protocol from chunks 11g.1+ are unaffected. KI-009's "refactor not rewrite" framing is the binding promise.

### Chunk 11g.3 — "Does the WebSocket pick path commit and broadcast?"

End of chunk 11g.3. First end-to-end pick path: client opens WebSocket, submits a pick, server validates against in-memory state, calls `submit_pick_v2`, broadcasts to all clients in the room.

- Pick committed via `submit_pick_v2`; projection trigger fires; `draft_picks_v2` row appears.
- Idempotency-key derivation matches the existing TypeScript path (UUIDv5, `AUTOPICK_NAMESPACE_UUID`).
- **Manual pick p95 ≤ 300ms** over 100 trial picks, measured end-to-end. **First hard performance gate.**

### Chunk 11g.6 — "Does crash recovery work?"

End of chunk 11g.6. Worker is killed and restarted; on boot it loads all active drafts from `draft_events` + `draft_picks_v2`, rebuilds in-memory state, resumes timers. Connected clients reconnect via the chunk 11g.4 `last_seen_id` resume protocol; no picks lost; no duplicates. Per-draft reload p95 ≤ 1500ms (Mandate target).

### Chunk 11g.9 — "Does it meet every Mandate target end-to-end?"

End of chunk 11g.9. Performance instrumentation harness runs against the deployed server. **This is the Phase 5 entry gate.** Sign-off requires every Mandate target met: manual pick p95 ≤ 300ms / p99 ≤ 500ms; autopick p95 ≤ 1000ms / p99 ≤ 2000ms; broadcast fanout p95 ≤ 200ms; draft state load p95 ≤ 1500ms; reconnection recovery p95 ≤ 2000ms; timer drift < 100ms.

**Pass:** Phase 5 (UI client work) unblocks. **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts.

### Reversibility

The architectural pattern (persistent state holder per draft + WebSocket transport + in-memory state + event log replay) is unchanged across any plausible future re-evaluation. If v1 scale outgrows the in-server model, splitting the engine out into a separate Cloud Run service is a deployment refactor; the `DraftRoom` class, WebSocket protocol, and integration boundary all carry forward. KI-009 binds.

---

## Cross-references

- `CLAUDE.md` § Citrus Draft Performance Mandate — the binding targets this ADR enables.
- `CLAUDE.md` § Tech Stack — the in-server engine documentation.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 + §0.5 — spec-side reference to this ADR.
- `docs/PHASE_4_5_PLAN.md` — chunks 11g.0–11g.9 implementation plan.
- `docs/REGISTRY.md` KI-008 (architectural pivot from Edge Functions), KI-009 (Edge Function infrastructure removed entirely; refactor-not-rewrite framing for future service separation), KI-010 (Tier 1 perf optimizations baked in from start).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KI registry. KI-001..KI-005 still apply; KI-006 likely RESOLVED at chunk 11g.7; **KI-007 RESOLVED at chunk 11g.8** when vendored shared code is deleted.

This ADR is **accepted**. Implementation begins in `docs/PHASE_4_5_PLAN.md` chunk 11g.0. Future ADRs that supersede or modify this decision must reference this number explicitly.
