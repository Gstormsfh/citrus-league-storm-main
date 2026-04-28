# ADR-001: Persistent Node Service on Cloud Run for the Live Draft Engine

> **Filename note.** Retained as `ADR-001-elixir-phoenix-draft-engine.md` for traceability — the Elixir/Phoenix candidate was the originally accepted decision (2026-04-27) and is now recorded as a rejected path under § Decision History. The accepted decision is persistent Node on Cloud Run.

| | |
|---|---|
| **Status** | Accepted (2026-04-28). Supersedes the prior Elixir/Phoenix acceptance (2026-04-27, see § Decision History). |
| **Authority** | Supersedes the Phase 0–4 architecture for the live draft hot path. |
| **Binding constraints** | `CLAUDE.md` § Citrus Draft Performance Mandate (commit `1427b18`); `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 (commit `b2354d7`). |
| **Companion docs** | `docs/PHASE_4_5_PLAN.md` (chunks 11g.1–11g.9 implementation plan); `docs/REGISTRY.md` KI-008 (architectural pivot from Edge Functions), KI-009 (Edge Functions retained as cron-driven safety net), KI-010 (Tier 1 perf optimizations baked in from start). |

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

Web research into how successful real-time multiplayer / live-collaboration systems are actually built revealed a convergent architectural pattern. The convergence is striking: independent teams, working in different domains (chat, design, fantasy sports), with different team sizes and different scaling pressures, arrived at the same approximate shape. **The pattern is what matters; the language is implementation detail.** This research originally drove the Elixir/Phoenix candidate (see § Decision History); it equally drives the Cloud Run Node decision because the architectural pattern — persistent process per "room" + WebSocket transport + in-memory state + durable event log underneath — is runtime-agnostic.

### Sleeper — Elixir for fantasy at scale

Sleeper is the obvious comparable: a fantasy sports app whose live-draft UX is the gold standard in the space. Their engineering writeups document Elixir as the runtime for the user-facing live components.

- **"The Story of Sleeper"** ([draftkick.com/blog/story-of-sleeper](https://draftkick.com/blog/story-of-sleeper/)) — narrative on Sleeper's stack choices. Elixir + Phoenix for the live experience.
- **ScyllaDB case study** ([scylladb.com/2020/10/22/sleeper-app-using-scylla-to-level-the-playing-field](https://www.scylladb.com/2020/10/22/sleeper-app-using-scylla-to-level-the-playing-field/)) — Sleeper's engineering team discussing scaling pressures, persistent process model, low-latency reads. Confirms Elixir/Phoenix as the live-draft runtime and surfaces the data-layer thinking around hot-path reads vs. durability.

The takeaway: a directly-comparable competitor in our exact domain converged on Elixir/Phoenix for the same reason we are about to. This is not a speculative bet on an unproven runtime; it's the runtime our most credible reference point already runs.

### Discord — Elixir at billion-message-per-day scale

Discord runs a substantial portion of its real-time gateway and chat fanout on Elixir. The case for Elixir as a credible production runtime at hyperscale is well-documented:

- **"Architecting for Hyperscale: An In-Depth Analysis of Discord's Billion-Message-Per-Day Infrastructure"** ([d4dummies.com/architecting-for-hyperscale-an-in-depth-analysis-of-discords-billion-message-per-day-infrastructure](https://d4dummies.com/architecting-for-hyperscale-an-in-depth-analysis-of-discords-billion-message-per-day-infrastructure/)) — the case study of Discord's real-time gateway. Persistent processes, Phoenix Channels, BEAM-level scheduling, fault-tolerant supervision trees.

Discord's pattern is the "single-tenant guild process" — one BEAM process per guild, holding presence/channel/permission state in memory, handling fanout. The pattern translates almost exactly to "one `DraftRoom` instance per active draft" for Citrus (the persistent Node worker's equivalent of Discord's per-guild process; see § Decision). The scaling envelope (Discord runs millions of guilds; we will run thousands of drafts at peak) is comfortably within the demonstrated load floor for the persistent-process pattern, regardless of runtime.

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

**Citrus builds the live draft engine as a persistent Node.js service on Cloud Run, alongside the existing Node API server. Edge Functions are retained as the cron-driven disaster-recovery safety net only.**

The persistent worker holds per-draft state in memory (one `DraftRoom` instance per active draft), accepts WebSocket connections from browser clients for picks/broadcasts/timer ticks/presence, and writes durably to the existing Postgres database via the Phase 2 RPCs (`submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload`). It reads the event log via the existing `@supabase/supabase-js` client. The cross-runtime contract is the existing Postgres RPC surface (which doesn't change without an ADR) plus the new WebSocket message protocol (chunk 11g.2's deliverable).

The architecture stays in a **single language and single runtime ecosystem**: TypeScript on Node, the existing `@citrus/shared` package, the existing npm tooling, the existing observability surface. The Cloud Run worker is a separate deployment unit, not a separate stack. Cloud Run is sized with CPU allocation set to "always" (instance lifetime, not per-request), enabling persistent in-memory state and long-lived WebSocket connections.

Phase 0–4 work is **preserved**, not replaced:

- The append-only `draft_events` log remains the source of truth and the durability substrate.
- Idempotency-key + payload-hash semantics, projection trigger, RPC contracts, RLS policies, validators — all unchanged. The persistent worker is a new caller of these surfaces, not a replacement for them.
- The pgmq sweep + keep-alive cron + Edge Function `draft-autopick` remain on cron as the **disaster-recovery safety net** (KI-009). If the persistent worker is unavailable mid-draft (deploy in flight, crash, network partition between Cloud Run and Postgres), the existing Edge Function autopick path still catches expired deadlines and commits picks. Degraded latency, correct outcome, no data loss.
- The vendored shared code at `supabase/functions/_shared/_vendored/` (KI-007) stays in place but its scope narrows — only the Edge Function fallback path consumes it. The persistent worker imports `@citrus/shared` natively (same Node ecosystem as the main server), no vendoring needed.

Tier 1 perf optimizations (parallel async on independent state reads, byte-limited deltas on broadcast, fanout protection per room, in-memory candidate caching) are **baked into the design from chunk 11g.3 onward**, not deferred to a later phase (KI-010). The Performance Mandate forbids "optimize later" framings; this ADR's plan complies.

The engine cutover is the only architectural change. Everything underneath stays.

## Decision History

This ADR records two distinct accepted decisions in close succession; the audit trail matters because reviewers will see Phase 4.5 commits and other ADRs that reference the path that got us here.

### 2026-04-27 — Elixir/Phoenix accepted (now superseded)

The first version of this ADR adopted Elixir/Phoenix as the runtime for the live draft engine, alongside the existing Node main app (a hybrid two-runtime production architecture). The rationale was the convergent architectural pattern documented in § Research above: Sleeper, Discord, Figma all run persistent-process per "room" + WebSocket transport, and Sleeper specifically runs Elixir/Phoenix for the same workload (live fantasy drafts). OTP supervision trees map almost too neatly onto "one process per active draft, supervised, restart on crash, hot-code-reload on deploy." The decision was bounded by a Week 1 sign-off gate (KI-010, in its prior framing) for the solo founder's Elixir learnability and a Week 3 sign-off gate for measured perf parity.

This decision is **now superseded** by the present ADR but is recorded here, not deleted. The Phase 0–4 work it informed (the event log, idempotency, projection trigger) is unaffected — those were already runtime-neutral Postgres surfaces.

### 2026-04-28 — CTO consultation, reversal to persistent Node on Cloud Run

After CTO consultation on solo-founder execution risk for the 16-week Phase 4.5 + 4.6 timeline, the Elixir decision was reversed. The reversal logic:

1. **The architectural pattern carries; the language is implementation detail.** Sleeper, Discord, Figma all run the same pattern (persistent state holder per session + WebSocket transport + durable event log). Sleeper happens to use Elixir, Figma uses Rust, the underlying shape is what makes them work — not the choice of BEAM-vs-V8. Persistent Node on Cloud Run delivers the same architectural pattern.
2. **Fewer net-new variables for the founder.** The Elixir path required learning a new language (Elixir), a new runtime (BEAM), a new framework (Phoenix), a new deploy target (Fly.io or equivalent), a new observability stack, and a new testing harness — simultaneously, against a 16-week clock. The Cloud Run Node path keeps the language, runtime, framework, package ecosystem, observability, and testing harness the founder already operates fluently. The only net-new variables are Cloud Run as a deploy target and a WebSocket library choice.
3. **v1 scale fits comfortably inside Node's competitive envelope.** The Performance Mandate's targets are achievable in Node for ~50 concurrent drafts at peak draft season. Node's per-process GC has worse worst-case tail latency than the BEAM under sustained extreme load, but v1 scale is nowhere near that regime. If daily-fantasy expansion ever pushes the worker into a load profile where the BEAM's tail-latency story matters, that's a future ADR backed by concrete measurements, not pre-emptive architectural insurance.
4. **Tier 1 perf optimizations baked in from the start.** The original Elixir plan deferred several perf optimizations (KI-006, broadcast fanout limits) to "later." That deferral pattern produced the 11.7s problem in the first place. The Cloud Run Node plan (chunks 11g.1–11g.9) makes Tier 1 perf optimizations design-time non-negotiables: parallel async on independent reads, byte-limited deltas, fanout protection, candidate caching — all baked in from chunk 11g.3 onward. KI-010's role is to track this discipline, not to track learning curve.

### What carries forward from the Elixir-decision-day work

The Elixir-decision-day work was a planning artifact, not a code commit. No Elixir code was written. The work that carries forward unchanged:

- The Performance Mandate (`CLAUDE.md` § Citrus Draft Performance Mandate, commit `1427b18`).
- The architectural pattern: persistent state holder per draft + WebSocket transport + durable event log underneath + reconnection via snapshot/replay.
- The Phase 0–4 primitives (event log, idempotency, projection trigger, pgmq sweep) as the durability and disaster-recovery layer.
- The framing of Edge Functions as the disaster-recovery safety net rather than the hot path (now codified as KI-009).
- The Research section's references — Sleeper, Discord, Figma, the persistent-process pattern. Still the right reference points for the architectural shape.

## Alternatives Considered

### Path 1 — Optimize within Edge Functions (rejected)

**Shape.** Stay on Edge Functions. Optimize the existing autopick path inside the Deno runtime: tighter cron cadence (the pg_cron 6-field every-5-seconds form), better Realtime channel reuse, in-Edge-Function candidate caching across keep-alive ticks, request coalescing.

**Why considered.** Lowest-friction path. No new deployment target, no new runtime configuration. If it could close the gap, it would ship fastest.

**Why rejected.** The 11.7s/pick measurement on Phase 4 staging breaks down structurally: ~10s of pg_cron + Edge Function cold-start + worker idle-sleep tail before the worker runs at all, plus per-pick Postgres reads and broadcast fanout that hit third-party rate limits. None of those costs are under the Edge Function code's control. Best-case in-architecture optimization is ~30–50% reduction; the Mandate requires ~10× reduction. The architecture, not the implementation, is the constraint. Confirmed by the 11.7s number being **measured**, not estimated.

### Path 2 — Elixir/Phoenix on persistent BEAM processes (considered, rejected on 2026-04-28)

**Shape.** Separate Elixir/Phoenix service. `DraftServer` GenServer per active draft, `DraftSupervisor` (DynamicSupervisor) for lifecycle, `DraftRegistry` for `via_tuple` lookups, `DraftChannel` for WebSocket transport via Phoenix Channels.

**Why considered.** This was the originally accepted path (2026-04-27, see § Decision History). Sleeper and Discord both run Elixir/Phoenix for similar workloads — direct reference architecture in our exact domain. OTP supervision trees map cleanly onto "one process per active draft, supervised, restart on crash, hot-code-reload on deploy." The BEAM's per-process / generational GC has better tail-latency characteristics than V8's stop-the-world GC under sustained extreme load.

**Why rejected (2026-04-28).** Solo-founder execution risk over a 16-week timeline. New language (Elixir) + new runtime (BEAM) + new framework (Phoenix) + new deploy target (Fly.io) + new observability stack + new testing harness, all simultaneously. The architectural pattern (persistent process per "room" + WebSocket transport + in-memory state + durable event log) is what delivers the Mandate's targets, not the language. Persistent Node delivers the same pattern. The dual-runtime ops cost the original ADR documented (in its KI-009 framing) was real; collapsing back to single-runtime Node sidesteps it entirely.

The Elixir candidate stays on the table for a possible future ADR if (a) daily-fantasy expansion drives a load profile where BEAM tail latency demonstrably matters, **and** (b) the team has grown enough that the founder isn't single-handedly carrying a new-language adoption. Neither condition holds today. The decision is reversible if those conditions change.

### Path 3 — Persistent Node service on Cloud Run (selected)

**Shape.** What's described in the Decision section above. New Cloud Run service running Node + a WebSocket library (`ws` or `socket.io`, decided in chunk 11g.2). One `DraftRoom` instance per active draft holding candidate pool, current pick, timer, per-team queues, connected-clients set, last-broadcast event id. Picks/broadcasts/timer ticks/presence over WebSocket. Writes durably via the existing Phase 2 RPCs.

**Why selected.** Same architectural pattern as Path 2, fewer net-new variables. Same TypeScript, same `@citrus/shared`, same npm tooling, same observability stack. Cloud Run handles always-on instances + sustained WebSocket connections natively (CPU allocation set to "always" for instance lifetime). Node's GC profile is a known limitation under the hyperscale regime; v1 scale stays comfortably inside the regime where Node delivers the targets. Tier 1 perf optimizations are baked in from chunk 11g.3 (KI-010), not deferred — sidestepping the deferral pattern that produced the 11.7s problem in the first place.

The Edge Function disaster-recovery path stays operational on cron (KI-009). The vendored shared code (KI-007) stays in place but its scope narrows to the fallback path only.

### Path 4 — Full rewrite to a single new runtime (rejected)

**Shape.** Rewrite the entire app — main API, web SPA, data pipeline, AI Assistant — in some new runtime. Maximum architectural coherence; eliminates any cross-deployment-unit overhead.

**Why considered.** Eliminates all cross-deployment overhead. Single language across the stack. Hiring story simpler.

**Why rejected.** Scope. The non-draft features represent ~18 months of work and perform fine on the current Node/Next.js/Supabase stack. The Mandate's targets are about the live draft experience; the rest of the app can take 800ms to load a roster page and no user notices. Rewriting is a year-plus project that solves a problem we don't have. The Path 3 decision keeps the entire main app exactly as it is.

### Go (rejected as the worker language)

Go was the strongest non-Elixir alternative when the original (now-superseded) Elixir decision was made. The same arguments still rule it out today: Go gets the architectural pattern but adds another runtime to the founder's operational surface (different toolchain, different observability conventions, different testing harness). Persistent Node delivers the same pattern with the existing toolchain. If Node's GC ever proves to be the bottleneck the Mandate cares about, Elixir/BEAM is the more disciplined re-evaluation, not Go.

## Consequences

### Positive

1. **Performance Mandate compliance is achievable, not aspirational.** The architectural pattern (persistent state holder per draft + WebSocket transport + in-memory candidate pool + parallel async on independent reads) brings every Mandate target into the achievable envelope. Manual pick p95 ≤ 300ms is a single in-memory state mutation + WebSocket broadcast. Autopick p95 ≤ 1000ms is a `setTimeout`-driven deadline firing inside the `DraftRoom` + in-memory selection + `submit_pick_v2` write + broadcast. Sub-200ms broadcast fanout to ~12–24 connected clients per draft is well within a single Node process's envelope.
2. **Single language, single ecosystem, single set of tools.** TypeScript, npm, Vitest, the existing observability stack, the same `@citrus/shared` package on both the main server and the worker. No new language to learn, no new framework to learn, no new testing harness. The founder's existing fluency carries directly into the worker.
3. **Tier 1 perf optimizations baked into the design from chunk 11g.3 onward.** Parallel async on independent state reads (player_directory + player_season_stats + draft_picks_v2 in parallel), byte-limited deltas on broadcast (don't ship full state every tick), per-room fanout protection, in-memory candidate caching. Tracked as KI-010 specifically to prevent the chunk-by-chunk pressure that produced the original 11.7s problem from re-asserting itself.
4. **Architectural parity with the reference systems.** Sleeper, Discord, Figma, Yahoo, ESPN — all run persistent state holder per "room" + WebSocket transport. Citrus's draft engine joins that architectural neighborhood. The runtime differs from Sleeper/Discord; the architecture matches.
5. **Edge Function safety net stays at near-zero cost.** The pgmq sweep + keep-alive cron + `draft-autopick` Edge Function continue to run; under normal operation the worker drains the queue first and the cron path finds nothing to do. The disaster-recovery story (worker outage during a draft) is real and tracked as KI-009.
6. **Phase 0–4 work is preserved.** Event log, idempotency contracts, projection trigger, RLS, RPC signatures — all stay. The pivot is at the hot-path host; underneath, the durability stack we already built does its job.
7. **Reversible if v1 outgrows the runtime.** If daily-fantasy expansion ever pushes the worker into a regime where Node's GC tail-latency demonstrably matters, a future ADR can revisit (Elixir/BEAM is the disciplined re-evaluation). The architectural pattern is unchanged across that hypothetical pivot — only the runtime changes — so the work is not wasted.

### Negative

1. **Node's GC tail-latency is worse than the BEAM's under sustained extreme load.** Accepted as a v1 trade-off: peak-season scale (~50 concurrent drafts) is well inside the regime where Node delivers the targets. Monitor the p99 broadcast fanout and autopick latency closely as scale ramps. If a regression appears as scale grows, that's the trigger for a future ADR re-evaluating runtime choice.
2. **Two deployment units instead of one.** The existing Node API server stays; the new Cloud Run worker is a second deployment surface. Same language, but two release vehicles, two scaling configurations, two sets of Cloud Run / GCP gotchas. Mitigation: same observability stack, same CI conventions, narrow integration contract (Postgres RPC + WebSocket message protocol). The cost is real but bounded.
3. **Cloud Run cost model differs from Edge Functions.** Edge Functions are billed per-request; Cloud Run with always-on CPU is billed per-instance-hour. At v1 scale this is comfortably affordable; chunk 11g.9 documents projected cost at ~50 concurrent drafts. Cost monitoring is part of the chunk 11g.9 deliverable so a cost regression doesn't surprise us in a later draft season.
4. **WebSocket connection limits per Cloud Run instance.** Cloud Run instances cap concurrent connections; the worker design (chunk 11g.6 and 11g.7) accounts for this with per-instance draft sharding and graceful redistribution on scale events. Specific limits and the sharding strategy are documented in the relevant chunk.
5. **No hot-code-reload across deploys.** Unlike the BEAM, Node deploys mean restarting the process. The mitigation is chunk 11g.7 (graceful drain + fast reload) plus the WebSocket reconnection protocol from chunk 11g.5: deploys cause a brief reconnection blip for connected clients, the protocol covers the gap, no draft progress is lost. Deploys during active drafts are still operationally cautious — the runbook (chunk 11g.9 deliverable) documents the deploy-during-draft posture.

## What stays vs. what changes

### Stays (Phase 0–4 work, all unchanged)

- `draft_events` event log — append-only, gap-free per-league `seq`, single source of truth.
- `draft_picks_v2` projection — synchronously maintained by the Phase 2 trigger.
- `submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload` — RPC surface unchanged. The persistent worker becomes a new caller.
- `pgmq` `draft_deadlines` queue + `draft_deadline_sweep()` RPC — the safety-net path stays operational as the disaster-recovery fallback (KI-009).
- `autopick_failures` DLQ + `draft_autopick_dlq()` RPC — same role.
- All RLS policies, idempotency-key derivation (`AUTOPICK_NAMESPACE_UUID` + UUIDv5 over `(league_id, pick_number, generation, 'autopick')`), payload-hash semantics (`computePickPayloadHash` from `@citrus/shared`).
- Phase 2 server-side pick path (`server/src/services/DraftServiceV2.ts`) — until the persistent worker subsumes the manual-pick hot path, this remains the production code path for pick submission. Cutover is staged, not Big Bang.
- Phase 4 Edge Function `supabase/functions/draft-autopick/` — role changes (see below), code unchanged. Stays on cron as the disaster-recovery safety net (KI-009).
- Vendored shared code at `supabase/functions/_shared/_vendored/` (KI-007) — stays in place but its scope narrows to feeding the Edge Function fallback path only. The persistent worker imports `@citrus/shared` directly.
- The Phase 0–4 Known Issues registry (`docs/RUNBOOKS/draft-engine-v2-known-issues.md`) — KI-001 through KI-007 still apply. KI-008+ in `docs/REGISTRY.md` are project-wide additions, not replacements.

### Changes (the worker layer)

- **New service.** A persistent Node service on Cloud Run. Path inside the repo TBD in chunk 11g.1 (likely a new top-level workspace alongside `apps/`, `server/`, `packages/`). The service contains a `DraftRoom` class holding per-draft in-memory state, a WebSocket layer accepting client connections, an autopick scheduler driven by `setTimeout`, and the Postgres client wiring that consumes the existing Phase 2 RPCs.
- **New transport.** WebSocket (library decided in chunk 11g.2 — `ws` for minimal surface area, `socket.io` if the reconnection/heartbeat conveniences earn their weight) for picks, broadcasts, timer ticks, presence. The rest of the app continues to use Supabase Realtime where it currently does (chat, presence on non-draft surfaces).
- **Edge Function `draft-autopick` role demotes from hot-path worker to disaster-recovery safety net.** The pgmq sweep + keep-alive cron continue to run in production but only act when the persistent worker is unavailable. Cron stays paused on staging until chunk 11g.8 wires the integration explicitly; then it becomes the secondary path. No code is deleted.
- **Server-side TypeScript pick path role changes.** `server/src/services/DraftServiceV2.ts` continues to handle the user-pick HTTP entry point during the Phase 4.5 cutover window. Once the persistent worker's WebSocket-based pick submission is verified, the HTTP path becomes a fallback for clients that can't open WebSockets (rare but needs to work). The RPC contract underneath is identical, so both paths converge on the same Postgres state.

The deployment target is **Cloud Run**, decided as part of this ADR. Specific Cloud Run configuration (CPU allocation set to "always", min instances ≥ 1 during peak draft seasons, multi-region placement) is documented in chunk 11g.9 alongside performance verification. Staging deployment lands during chunk 11g.1 (skeleton service) and is exercised at every subsequent chunk's gate.

## Validation Gates

The architectural cost is bounded by chunk-level go/no-go gates inside `docs/PHASE_4_5_PLAN.md`. Each chunk's acceptance criteria reference the relevant Performance Mandate target, and chunk 11g.9 is the final cross-cutting verification gate.

### Chunk 11g.4 — "Does the worker accept picks via WebSocket and commit them?"

End of chunk 11g.4. The first end-to-end pick path is exercised: client opens WebSocket, sends `submit_pick`, worker validates against in-memory state, calls `submit_pick_v2`, broadcasts to all connected clients in the same room. Sign-off requires:

- Pick submitted via WebSocket commits to Postgres via `submit_pick_v2`. Projection trigger fires. `draft_picks_v2` row appears.
- Same idempotency-key derivation as the existing TypeScript path (UUIDv5 over `(league_id, pick_number, generation, 'autopick')` using `AUTOPICK_NAMESPACE_UUID`). Cross-runtime test asserts agreement against the SQL `_v2_test._uuidv5` helper output.
- Manual pick p95 ≤ 300ms over 100 trial picks, measured end-to-end (client send → all connected clients receive broadcast). **First hard performance gate.** Failure triggers chunk-level revisit before 11g.5 starts.

### Chunk 11g.7 — "Does the worker recover state after a restart?"

End of chunk 11g.7. The worker can be killed and restarted; on boot it reloads all active drafts from `draft_events` + `draft_picks_v2` and resumes timers. Sign-off requires:

- Worker restart with N active drafts in flight: all N drafts' state reconstructed; timers resumed; connected clients reconnect via the chunk 11g.5 protocol; no picks lost; no duplicate picks.
- Disaster-recovery drill (KI-009): worker stopped intentionally mid-draft; pg_cron sweep catches the next expired deadline within ~10s; Edge Function commits the autopick; worker restarts; loads state including the picks committed during the outage; resumes cleanly.
- State load p95 ≤ 1500ms (Mandate target) for a draft with 12 teams and 8 picks committed.

### Chunk 11g.9 — "Does it meet every Mandate target end-to-end?"

End of chunk 11g.9. The full performance instrumentation harness runs against the deployed Cloud Run worker. **This is the Phase 5 entry gate.** Sign-off requires every Mandate target met:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms.
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms.
- Pick-to-broadcast fanout: p95 ≤ 200ms.
- Draft state load: p95 ≤ 1500ms.
- Reconnection recovery: p95 ≤ 2000ms.
- Timer drift: < 100ms across all clients.

Each Tier 1 perf optimization (KI-010) called out by name in the chunk that introduces it: parallel async in 11g.3, in-memory candidate caching in 11g.3, byte-limited deltas in 11g.4, fanout protection in 11g.4. A code reviewer can grep for the design-decision comments.

**Pass:** Phase 5 (UI client work) unblocks. **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts. The benchmark suite re-runs at each chunk gate so regressions are caught early, not at the end.

### Reversibility

If chunk 11g.9 fails by a margin that suggests a structural Node limitation (rather than a fixable implementation bug), the Elixir/Phoenix candidate from § Decision History is the disciplined re-evaluation. The architectural pattern (persistent state holder per draft + WebSocket transport + durable event log) is unchanged across that hypothetical pivot — only the runtime changes — so the Phase 4.5 design work is portable. Sunk cost at chunk 11g.9 is the Cloud Run Node implementation; the architectural understanding carries forward. KI-010's "no carry-forward to Phase 7" rule applies.

---

## Cross-references

- `CLAUDE.md` § Citrus Draft Performance Mandate (commit `1427b18`) — the binding targets this ADR enables.
- `CLAUDE.md` § Tech Stack — the hybrid runtime documentation (persistent Node worker + existing Node main app).
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 (commit `b2354d7`) and § §0.5 — spec-side reference to this ADR.
- `docs/PHASE_4_5_PLAN.md` — chunks 11g.1–11g.9 implementation plan.
- `docs/REGISTRY.md` KI-008 (architectural pivot from Edge Functions), KI-009 (Edge Functions retained as cron-driven safety net), KI-010 (Tier 1 perf optimizations baked in from start).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KI registry, all entries still apply.

This ADR is **accepted**. Implementation begins in `docs/PHASE_4_5_PLAN.md` chunk 11g.1. Future ADRs that supersede or modify this decision must reference this number explicitly.
