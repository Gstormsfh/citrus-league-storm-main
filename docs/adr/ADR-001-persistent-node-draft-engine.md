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

### Path 1 — Node.js-only Phase 4.5 (rejected)

**Shape.** Stay on Node.js + Supabase Edge Functions. Address Phase 4's perf failures within the existing runtime: replace pg_cron + 2-min keep-alive with a Cloud Run service running a Node.js process that holds in-memory state per draft, switch transport from Supabase Realtime to Socket.IO or `ws` running on the same Node service, port the candidate-pool cache.

**Why considered.** Lowest-friction path. No new language, no new ops surface, no learning curve. Could ship fastest if it worked.

**Why rejected.** Two reasons:

1. **Insufficient ceiling for the longer roadmap.** Citrus's product roadmap includes daily-fantasy expansion: short-window contests, real-time score updates, large concurrent contest pools, live in-game scoring deltas. These workloads demand sustained high-concurrency message fanout with predictable tail latency — the regime where Node's single-threaded event loop and per-request memory model start showing their limits without aggressive workarounds. We'd be re-architecting again in 12–18 months for the same reason we're re-architecting now: chasing a competitive performance bar against a roadmap the current runtime wasn't sized for. Pay the architectural cost once.
2. **No reference architecture at the relevant scale.** No fantasy-sports comparable we can find runs the live experience on Node. The pattern that demonstrably works at scale (Sleeper, Discord) is on the BEAM. Choosing Node here means inventing a path no one we're aware of has actually shipped to the relevant scale, while passing on the path our most credible competitor demonstrably ships.

### Path 2 — Full Elixir rewrite (rejected)

**Shape.** Rewrite everything — main app, Stormy AI, data pipeline, scoring, public pages — in Elixir/Phoenix. Single runtime in production. Maximum architectural coherence.

**Why considered.** Eliminates the dual-runtime ops cost (KI-009). Single language across the stack. Hiring story simpler.

**Why rejected.** Scope. The non-draft features in the Citrus codebase represent ~18 months of work: leagues, rosters, matchups, scoring, the data pipeline, Stormy, public pages, the React SPA. Rewriting them is a year-plus project that solves a problem we don't have. The non-draft features perform fine on Node. The mandate's perf targets are about the live draft experience; the rest of the app can take 800ms to load a roster page and no user notices. There's no UX win from rewriting the rest, and there's a year of opportunity cost.

### Path 3 — Hybrid: Node main app + Elixir draft engine (selected)

**Shape.** What's described in the Decision section above.

**Why selected.** Pays the architectural cost exactly where the cost is justified: the live draft engine, which (a) has the binding performance mandate, (b) has a clear reference architecture in the Elixir/Phoenix world, (c) has the most direct user-perceived UX impact. Leaves the rest of the application in its current mature, working state. The ~16-week implementation timeline (Phases 4.5 + 4.6) is bounded; a full rewrite would have been 12+ months.

The dual-runtime ops cost is real (tracked as KI-009). The mitigation is to define the cross-runtime contract narrowly (the Postgres RPC surface + the WebSocket message protocol) and let each runtime own its lane. The boundary is the integration; everything inside each lane is single-runtime.

### Go (rejected as the engine language)

Go was the strongest non-Elixir candidate. Goroutines, channels, mature ecosystem, smaller learning curve from a Node/TS background, excellent tooling. Many high-concurrency real-time systems run on Go. Discord famously moved one of its hot paths from Go to Rust, not from Go to Elixir — suggesting Go can clear the relevant performance bar.

We rejected Go for the engine for three specific reasons:

1. **Predictability under sustained load.** Go's per-process garbage collector pauses are well-bounded but apply to the entire process. Under sustained high-concurrency workloads (the daily-fantasy regime), GC pause tail latency in Go is observably worse than BEAM's per-process / generational scheme. The BEAM was designed for soft-real-time telecom workloads where tail latency is the metric; that design pays off exactly in our hot-path regime.
2. **Supervision tree as a domain fit.** Erlang/OTP's supervisor + GenServer + DynamicSupervisor patterns map almost too neatly onto "one persistent process per draft, restart on crash, hot-code-reload on deploy without dropping connections." In Go we'd be hand-rolling the same patterns with goroutines, channels, and a custom restart policy. We'd end up reinventing OTP poorly. In Elixir, OTP is the runtime.
3. **Architectural parity with the reference systems.** Sleeper and Discord both run Elixir for the workloads we're modeling. Choosing Elixir means our debugging, profiling, and capacity-planning playbooks can borrow from theirs. Choosing Go means we're alone in our specific architectural neighborhood — possibly fine, but a different risk profile.

Go would have been a defensible choice. Elixir is the better-fit choice given our roadmap. The Week 1 validation gate (see below) explicitly leaves the door open to revisiting Go if the Elixir learning curve proves unworkable for a solo founder.

## Consequences

### Positive

1. **Performance Mandate compliance is achievable, not aspirational.** The architectural pattern (persistent process per draft + WebSocket transport + in-memory candidate pool) brings every mandate target into the achievable envelope. Manual pick p95 ≤ 300ms is a single in-memory state mutation + Phoenix Channel broadcast. Autopick p95 ≤ 1000ms is a deadline timer firing inside the DraftServer + in-memory selection + Postgres write + broadcast. Sub-200ms broadcast fanout to ~12–24 connected clients per draft is well within Phoenix Channels' published envelope.
2. **Architectural parity with the reference systems users compare against.** Sleeper, Discord, Figma, the Phoenix Channels community — these are the live-collaboration patterns. Citrus's draft engine joins that architectural neighborhood instead of inventing a different one.
3. **OTP fault tolerance maps onto the domain.** A `DraftServer` process crashes, the supervisor restarts it, the new process recovers state via `reconstruct_draft_state(...)` from the event log, connected clients reconnect via Phoenix Channels' built-in resume. The "let it crash + supervised restart" model is what we'd want anyway; OTP just ships it.
4. **Hot-code-reload preserves in-progress drafts during deploys.** This is a real operational property, not theoretical. A code change to the autopick heuristic deployed mid-draft does not drop connected clients or restart the in-memory state. Drafts in flight at deploy time complete on the new code without users noticing. The Node + Edge Function path has no equivalent.
5. **Architectural ceiling supports daily-fantasy expansion.** The live-scoring and live-contest workloads on the roadmap fit the same persistent-process + Phoenix Channels pattern. Adopting it now amortizes the architectural cost across the live draft AND the future daily-fantasy product. Single architectural pivot, multiple downstream uses.
6. **Phase 0–4 work is preserved.** Event log, idempotency contracts, projection trigger, RLS, RPC signatures — all stay. The pivot is at the engine layer; underneath, the durability stack we already built does its job.

### Negative

1. **New language and runtime to learn.** Solo founder ramping on Elixir + Phoenix + OTP from a Node/TypeScript baseline. Realistic learning curve: **4–8 weeks** to confident productivity (the upper end if there are unexpected cliffs around concurrency primitives or BEAM operations). The Week 1 validation gate (see below) is explicitly designed to surface "this is going to take 12 weeks not 6" early enough to course-correct.
2. **Operational complexity of dual-runtime production.** Two runtimes in production = two CI pipelines, two log aggregation contexts, two security review surfaces, two release vehicles, two sets of platform gotchas. Tracked formally as **KI-009** in `docs/REGISTRY.md`. The retrospective citation (`https://ryanrasti.com/blog/elixir-three-years-production/`) is explicit that Elixir's per-runtime ops cost is _lower_ than Node's, but **two runtimes is more overhead than one**, regardless. Mitigation: narrow cross-runtime contract, clear ownership boundaries, runbook covering both stacks (Phase 4.6 chunk 4.6.4).
3. **~16-week total Phase 4.5+4.6 timeline before Phase 5 (UI work) can resume.** Phase 4.5 foundation is weeks 1–3; Phase 4.6 production-readiness is weeks 4–7; reasonable cushion for unknowns brings the realistic horizon to ~16 weeks of solo founder work assisted by Claude Code. UI work blocks behind this. The opportunity cost is real and should be visible in roadmap conversations.
4. **Hiring pool considerations.** Elixir's hiring pool is materially smaller than Node's. For a solo founder at the current stage this is irrelevant; if/when Citrus hires its first engineer, the Elixir engine becomes a hiring constraint. Re-evaluate at hiring time.

## What stays vs. what changes

### Stays (Phase 0–4 work, all unchanged)

- `draft_events` event log — append-only, gap-free per-league `seq`, single source of truth.
- `draft_picks_v2` projection — synchronously maintained by the Phase 2 trigger.
- `submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload` — RPC surface unchanged. The Elixir engine becomes a new caller.
- `pgmq` `draft_deadlines` queue + `draft_deadline_sweep()` RPC — the safety-net path stays operational as the disaster-recovery fallback.
- `autopick_failures` DLQ + `draft_autopick_dlq()` RPC — same role.
- All RLS policies, idempotency-key derivation (`AUTOPICK_NAMESPACE_UUID` + UUIDv5 over `(league_id, pick_number, generation, 'autopick')`), payload-hash semantics (`computePickPayloadHash` from `@citrus/shared`).
- Phase 2 server-side pick path (`server/src/services/DraftServiceV2.ts`) — until the Elixir engine subsumes the manual-pick hot path, this remains the production code path for pick submission. Cutover is staged, not Big Bang.
- Phase 4 Edge Function `supabase/functions/draft-autopick/` — role changes (see below), code unchanged.
- The Phase 0–4 Known Issues registry (`docs/RUNBOOKS/draft-engine-v2-known-issues.md`) — KI-001 through KI-007 still apply. KI-008+ in `docs/REGISTRY.md` are project-wide additions, not replacements.

### Changes (the engine layer)

- **New service.** `elixir/citrus_draft/` (or similar; structure TBD in Phase 4.5 chunk 1) — Phoenix application with `DraftServer` GenServer per active draft, `DraftSupervisor` (DynamicSupervisor) for lifecycle, `DraftRegistry` for `via_tuple` lookups, `DraftChannel` for WebSocket transport, `DraftServer.AutopickWorker` for in-memory candidate selection.
- **New transport.** Phoenix Channels (WebSocket) for picks, broadcasts, timer ticks, presence. Replaces Supabase Realtime for the live-draft experience. The rest of the app continues to use Supabase Realtime where it currently does (e.g., chat, presence on non-draft surfaces).
- **Edge Function `draft-autopick` role demotes from hot-path worker to fallback-only.** The pgmq sweep + keep-alive cron continue to run in production but only act when the Elixir engine is unavailable. Cron stays paused on staging until Phase 4.5 verification confirms the Elixir engine is the primary path; then the cron becomes the secondary path. No code is deleted.
- **Server-side TypeScript pick path role changes.** `server/src/services/DraftServiceV2.ts` continues to handle the user-pick HTTP entry point during the Phase 4.5 cutover window. Once the Elixir engine's WebSocket-based pick submission is verified, the HTTP path becomes a fallback for clients that can't open WebSockets (rare but needs to work). The RPC contract underneath is identical, so both paths converge on the same Postgres state.

The deployment target for the Elixir engine — Fly.io vs. alternatives — is decided in Phase 4.6 chunk 4.6.3 alongside production hosting concerns (autoscaling, regional placement, cold-start, observability integrations). The Phase 4.5 foundation work uses local development for the first few chunks; staging deployment is its own chunk gate.

## Validation Gates

The pivot is bounded by two explicit go/no-go review points where solo-founder time and architectural fit get evaluated against measured reality.

### Week 1 — "Is Elixir workable for me?"

End of week 1 of Phase 4.5. Sign-off criteria:

- I (the solo founder) can read and write basic Elixir / GenServer code without copy-pasting from blog posts. I understand the actor model well enough to design a simple state machine in it.
- I have run the Phoenix `mix phx.new` chat tutorial (or equivalent) end-to-end, including modifying a channel, adding presence, and connecting via a JS WebSocket client. I understand what's happening at the BEAM, Phoenix, and JS layers.
- The development loop (edit, recompile, test) feels productive, not painful. iex REPL works. ExUnit tests pass. Tooling is set up.
- I have a credible mental model of how `DraftServer` will work — even if no production code is written yet.

**Pass:** proceed to Phase 4.5 chunks. **Fail:** stop and revisit. The fall-back is **Go** (see Alternatives above) — same architectural shape (one goroutine + struct per draft, gorilla/websocket transport, Postgres persistence), different runtime, ~3-week shorter learning curve. KI-010 tracks this gate explicitly. Sunk cost at this point is one week of learning, which is acceptable.

### Week 3 — "Does it actually meet the targets?"

End of week 3 of Phase 4.5. Sign-off criteria — these gate Phase 4.6 entry:

- A single-draft `DraftServer` is running on staging. Picks submitted via WebSocket commit to Postgres via `submit_pick_v2`. Broadcast fanout works.
- **Latency benchmark suite passes.** Manual pick p95 ≤ 300ms (mandate target), autopick p95 ≤ 1000ms (mandate target), broadcast fanout p95 ≤ 200ms. Measured end-to-end on staging, not in unit tests.
- The cross-runtime contract works: Phoenix engine writes via the existing `submit_pick_v2` RPC, the projection trigger fires, `draft_picks_v2` projection is consistent, the event log is gap-free, the same `idempotency_key` derivation produces the same UUIDv5 in both runtimes.
- **Operational gotchas understood.** I have a deploy runbook, a "what to do when the engine crashes" runbook draft, a logs-from-Elixir-into-our-existing-aggregation pipeline. The Phase 4.6 work is now scope-bounded and de-risked.
- The Elixir codebase is maintainable. Specifically: it's not a pile of `IO.inspect` calls and one massive `handle_call`. The patterns I'm using look like they'd survive 6 months of adding features.

**Pass:** proceed to Phase 4.6 (production-readiness). **Fail:** stop and review. Possible outcomes: targeted optimization within Elixir, scope cut on Phase 4.5 (e.g., defer multi-instance coordination to Phase 5), or, in the worst case, pivot back to Path 1 with the lessons learned from the Phase 4.5 prototype informing what we now know we need from the Node implementation. Sunk cost at this point is three weeks; uncomfortable but recoverable.

### Beyond Week 3

Phase 4.6 (weeks 4–7) is production-readiness — reconnection protocol, multi-instance coordination, hosting, observability. No new gates beyond the Phase 4.6 sign-off itself, which is the precondition for Phase 5 (UI work) starting.

---

## Cross-references

- `CLAUDE.md` § Citrus Draft Performance Mandate (commit `1427b18`) — the binding targets this ADR enables.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 (commit `b2354d7`) and § §0.5 — spec-side reference to this ADR.
- `docs/PHASE_4_5_PLAN.md` — chunk-by-chunk implementation plan.
- `docs/REGISTRY.md` KI-008 (architectural pivot), KI-009 (dual-runtime ops cost), KI-010 (learning-curve risk + Week 1 gate).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KI registry, all entries still apply.

This ADR is **accepted**. Implementation begins in `docs/PHASE_4_5_PLAN.md`. Future ADRs that supersede or modify this decision must reference this number explicitly.
