# Citrus — Project Registry

> **Purpose.** Top-level project registry for cross-cutting known issues
> and deferred decisions. The conversation history is not durable; this
> file is.
>
> **Scope.** Project-wide concerns that span multiple subsystems
> (draft engine + main app, Node.js + Elixir, ops + product). Issues
> scoped to a single subsystem live in that subsystem's own registry —
> for the draft engine, see
> `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (KI-001 through
> KI-007 live there; KI-008+ may live in either registry depending on
> scope).
>
> **Hard rule.** Same as the draft-engine registry: no deferral lands
> without a row here. Code review responses of "defer to later" must
> reference a KI- ID, and the commit shipping the deferral updates this
> file in the same change.
>
> **Lifecycle.** Append-only. Resolved issues stay with a
> `**RESOLVED (commit, date)**` annotation. Audit trail beats tidiness.
>
> **Numbering.** KI-IDs are monotonic across both registries. The
> draft-engine registry holds KI-001..KI-007 (Phase 0–4 era). KI-008
> and onward live here for project-wide concerns; subsystem-specific
> KIs continue to land in the subsystem's registry. When in doubt,
> file in the subsystem registry; this file is for things that genuinely
> cross subsystem boundaries.

## Schema

| Column | Meaning |
|---|---|
| **ID** | `KI-NNN`, monotonically assigned across both registries. |
| **Severity** | `low` / `medium` / `high` / `critical`. `low` and `medium` ship in the same phase as introduced unless explicitly re-targeted; `high` and `critical` block phase exit. |
| **Surface** | The subsystems / files / runtimes the issue spans. |
| **Description** | What the issue is, in plain language. |
| **Why deferred** | Why we didn't fix it in the change that surfaced it. |
| **Target phase / timeline** | When this gets resolved and what triggers the work. |
| **Verification test** | What proves the fix landed. Hypothetical until then; name it anyway. |

## See also

- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — draft-engine-specific KIs (KI-001..KI-007).
- `docs/adr/` — Architecture Decision Records. Read these for context on _why_ the system is structured the way it is.
- `CLAUDE.md` § Citrus Draft Performance Mandate — binding performance targets.

---

## Registry

### KI-008 — Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft

| | |
|---|---|
| **Severity** | high — blocks Phase 5 (UI) until resolved by Phase 4.5. |
| **Surface** | The entire draft engine. Spans `supabase/functions/draft-autopick/`, `supabase/migrations/2026042*/`, `server/src/services/DraftServiceV2.ts`, the pgmq scheduler, and (post-resolution) the new Elixir/Phoenix service. |
| **Description** | The Phase 0–4 architecture (event log + Edge Function autopick worker invoked via pg_cron keep-alive) is **correct** but **not competitive**. Phase 4 verification on staging measured autopick latency at **~11.7 seconds per pick** — an order of magnitude over the Performance Mandate's p95 ≤ 1000ms target (`CLAUDE.md` § Citrus Draft Performance Mandate). Causes are structural, not optimizable: pg_cron's 2-minute minimum keep-alive cadence introduces tail latency, the Edge Function cold-starts and dies between invocations (no per-draft persistent state), the candidate pool is re-fetched from Postgres every pick (~2000 rows × 14 stat columns), and broadcast fanout via Supabase Realtime hits per-channel rate limits at modest connection counts. No combination of optimizations within the existing architecture closes the gap to Yahoo/ESPN/Sleeper. |
| **Why deferred** | This is itself the deferral. Phase 0–4 shipped correctness; performance was knowingly punted to a later phase ("optimization work in Phase 7"). The Performance Mandate (added 2026-04-27) reframes performance as a foundational constraint rather than an optimization, retroactively making the deferral unacceptable. ADR-001 documents the structural pivot. |
| **Target phase / timeline** | **Phase 4.5** (`docs/PHASE_4_5_PLAN.md`). Foundation work in weeks 1–3 (Elixir install, Phoenix prototype, single-draft `DraftServer` skeleton with latency measurement). Production-readiness in weeks 4–7 (multi-draft, reconnection, deployment, observability). Total estimated timeline: ~16 weeks of solo founder work assisted by Claude Code, with Phase 5 UI work blocked behind Phase 4.5 completion. |
| **Verification test** | Phase 4.5 latency benchmark suite (chunk plan TBD): seed 5 concurrent drafts on the deployed Elixir engine, drive picks at the deadline boundary, measure end-to-end (`deadline_expiry → submit_pick_v2 commit → all clients have updated UI`). **Pass:** every Performance Mandate target met (manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, etc.). **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts. The benchmark suite re-runs at each Phase 4.5 chunk gate (not just at phase exit) so regressions are caught early. |

### KI-009 — Operational complexity of dual-runtime production (Node.js + Elixir)

| | |
|---|---|
| **Severity** | medium — accepted cost of the Phase 4.5 architectural pivot, must be tracked. |
| **Surface** | All ops surfaces: deployment pipeline, monitoring, on-call runbooks, CI, dependency management, security review, the developer onboarding flow. |
| **Description** | Pre–Phase 4.5, Citrus runs on a single primary runtime (Node.js / Next.js + Supabase Edge Functions on Deno). Phase 4.5 introduces Elixir/Phoenix as a second primary runtime — meaning two independent production stacks to deploy, monitor, secure, alert on, scale, debug, and onboard new contributors into. Concretely: two CI pipelines (Node + Elixir), two language toolchains (npm/pnpm + mix), two release vehicles (Firebase/Cloud Run + the chosen Elixir hosting target), two log aggregation contexts to correlate during incidents, two dependency security scanners, two sets of platform-specific gotchas. Solo-founder ops capacity is the real bottleneck. The ADR-001 retrospective citation (`https://ryanrasti.com/blog/elixir-three-years-production/`) is explicit that Elixir is operationally lower-overhead per-runtime than Node, but **two runtimes is more overhead than one runtime regardless of how good either is**. |
| **Why deferred** | Not a deferral so much as an accepted cost. The Performance Mandate forces the architectural pivot; the pivot forces the dual-runtime reality. The mitigation is to track the operational surface area carefully so the cost is visible during budget conversations, not invisible. |
| **Target phase / timeline** | **Ongoing.** Phase 4.6 (chunks 4.6.3 hosting deployment + 4.6.4 observability) is when most of the ops surface gets stood up. Re-evaluate the dual-runtime cost annually: if Elixir engine maintenance becomes the dominant ops cost AND the main app could be simplified to a static frontend that talks to the Elixir engine directly, a future ADR could collapse to single-runtime. **Not a Phase 4.5 concern; flag for re-evaluation at end of 2026.** |
| **Verification test** | Operational SLA test, run quarterly: time-to-deploy a small change to each runtime (Node main app, Elixir draft engine). **Pass:** both ≤ 30 minutes from PR-merge to deployed-on-staging, ≤ 2 hours to production with the appropriate gates. **Fail:** either runtime regressing past those thresholds triggers a process review. Plus an incident-response drill: simulate a draft-engine outage, measure time-to-detection (alerting), time-to-mitigation (failover or restart), time-to-resolution. **Pass:** all three within the runbook's documented targets. The runbook itself is part of Phase 4.6's chunk 4.6.4. |

### KI-010 — Solo founder learning curve risk on Elixir

| | |
|---|---|
| **Severity** | medium — gates Phase 4.5 entry; Week 1 validation determines proceed-vs-pivot. |
| **Surface** | The solo founder's productive time. Indirectly affects every Phase 4.5 / 4.6 chunk and the realistic timeline to Phase 5. |
| **Description** | Adopting Elixir/Phoenix is a language + runtime + framework change for the solo founder, who is ramping from a Node/TypeScript baseline. ADR-001 § Consequences (negative) estimates a **4–8 week learning curve** to confident productivity, with the upper end reflecting unexpected cliffs around concurrency primitives, BEAM operations, or Phoenix internals. The Phase 4.5 plan is timeboxed (3 weeks foundation, 4 weeks production-readiness ≈ 7 weeks total before Phase 5 unblocks); a learning curve at the 8-week end of the range stretches the realistic timeline materially. The risk is that we discover this _after_ committing several weeks, at which point Path 1 (Node-only Phase 4.5) becomes harder to pivot to. |
| **Why deferred** | Not a deferral — a tracked risk with an explicit go/no-go gate. The mitigation is the **Week 1 validation gate** in ADR-001 § Validation Gates: end of week 1, the solo founder evaluates whether Elixir feels workable. Pass criteria include reading/writing GenServer code unaided, completing the Phoenix chat tutorial end-to-end, and the dev loop feeling productive rather than painful. Fail-fast is the explicit goal: catching "this isn't going to work" at week 1 costs a week of learning, while catching it at week 4 costs a month plus several committed chunks. |
| **Target phase / timeline** | **Phase 4.5 Week 1 sign-off.** The fall-back if Week 1 fails is to pivot to **Go** as the engine language (ADR-001 § Alternatives). Same architectural shape, different runtime, ~3-week shorter learning curve from a Node/TS background. Sunk cost at the Week 1 gate is one week of Elixir study; recoverable. KI-010 closes when either (a) Week 1 passes and we proceed in Elixir — RESOLVED, no further action; or (b) Week 1 fails and we pivot to Go — RESOLVED, supersedes ADR-001's language choice via a follow-up ADR-002. |
| **Verification test** | The Week 1 gate itself is the test. Concrete pass criteria: (1) author a non-trivial GenServer module + ExUnit tests without copy-pasting from blog posts; (2) extend the Phoenix chat tutorial with one new feature (e.g., per-room rate limiting via a separate GenServer); (3) describe in writing how `DraftServer` will be structured — supervision, message protocol, state shape, recovery flow — at a level of detail that suggests genuine understanding rather than vibes. The writeup goes into Phase 4.5 chunk 1's deliverable artifacts. |

---

## How to add a row

1. Append a new `### KI-NNN` section. Use the next sequential ID across **both** registries (this one and `docs/RUNBOOKS/draft-engine-v2-known-issues.md`). Check the highest existing ID in each before assigning.
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g. `// TODO(KI-008): swap to Elixir engine`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. When resolving: append `**RESOLVED (commit-sha, date)**` plus a one-line note. Do not delete the row.
