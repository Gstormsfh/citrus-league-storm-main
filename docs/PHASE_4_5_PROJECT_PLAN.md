# Phase 4.5 — Project Plan & Roadmap

Schedule, dependencies, and risk callouts for Phase 4.5 implementation through v1 production launch (NHL fantasy season opener, October 2026).

**Authority:** Garrett Storms, founder/CEO. Proposed 2026-04-29.
**Status:** Ratified 2026-04-30. Subject to revision per the same supersession-note convention used for ADR-001 if any date materially changes.

**Companion docs:**
- [`PHASE_4_5_ARCHITECTURE.md`](./PHASE_4_5_ARCHITECTURE.md) — canonical architecture (Zach's design).
- [`PHASE_4_5_ARCHITECTURE_ANSWERS.md`](./PHASE_4_5_ARCHITECTURE_ANSWERS.md) — Citrus-specific answers binding the architecture to product reality.
- [`PHASE_4_5_PLAN.md`](./PHASE_4_5_PLAN.md) — chunk-by-chunk implementation plan for chunks 11g.0–11g.10.
- [`adr/ADR-001-persistent-node-draft-engine.md`](./adr/ADR-001-persistent-node-draft-engine.md) — original architectural decision record with supersession history.

---

## Anchor Dates

- **Today:** April 29, 2026
- **Web Summit Vancouver:** May 11, 2026 *(playoff pool product — separate from Phase 4.5)*
- **NHL fantasy season opener (v1 launch target):** ~October 7, 2026 *(confirm with Zach against actual NHL schedule)*
- **6-week pre-launch load test gate:** ~August 26, 2026
- **Available work weeks for Phase 4.5:** ~21 weeks (May 12 – October 7)

---

## Roadmap

Backward-planned from the launch date. Date windows are target ranges, not bullseye commits — the goal is "done by end of window."

### Phase A: Web Summit & recovery (May 1 – May 18)

Web Summit Vancouver is May 11. No Phase 4.5 implementation work scheduled this window. Playoff pool product is the focus.

### Phase B: Snake/linear engine implementation (May 19 – July 31)

Chunks 11g.2 through 11g.10 from [`PHASE_4_5_PLAN.md`](./PHASE_4_5_PLAN.md). ~10 weeks of dev for the locked plan.

**Dependencies:**
- Chunk 11g.2 reshape brief landed (deploy target swap, GCE platform spike).
- Zach onboard to validate GCE machine type, region, container runtime decisions.

**Acceptance gate to Phase C:** chunks 11g.2–11g.10 complete, snake/linear drafts run end-to-end against the "done" definition in the architecture doc (1,000 simulated clients, process restart, network partition, no lost picks).

### Phase C: Parallel workstreams (June – August)

Three workstreams running in parallel with Phase B implementation. Each has its own owner, dependencies, and acceptance gate.

#### C1: Auction state machine (June 1 – August 9)

Citrus committed to all three draft formats (snake, linear, auction) for v1. Auction has fundamentally different state semantics than snake/linear and requires a separate state machine design.

| Sub-phase | Window | Output |
|---|---|---|
| C1.1 — Auction ADR + design doc | June 1 – June 21 | New ADR (e.g. `ADR-004-auction-state-machine.md`) + design doc covering: nomination order, bid timers (reset-on-bid semantics), budget tracking, simultaneous multi-bidder handling, integration with locked Phase 4.5 primitives (event sourcing, single-writer queue, discovery, durability). |
| C1.2 — Auction implementation | July 1 – August 9 | Auction `LobbyManager` (or format-aware `LobbyManager`), tests, reaches "done" definition equivalent to snake/linear. |

**Risk:** auction design is the rate-limiting step for the entire C1 stream. If C1.1 slips into July, C1.2 slips into August, which compresses load testing margin in Phase D. **Hard sub-deadline: auction design ratified by July 1.**

#### C2: Co-manager schema migration (June 15 – July 5)

Co-manager support requires net-new schema (likely `team_managers` join table with `role` column, or `head_manager_id` + `co_manager_ids[]` on `team`) and authorization-check refactor across the entire app — not just the draft engine. **Scheduled intentionally early** to give the migration ≥6 weeks of soak time before load testing exercises it.

| Sub-phase | Window | Output |
|---|---|---|
| C2.1 — Schema design + migration script | June 15 – June 21 | Migration script, RLS policies, rollback path. |
| C2.2 — Authorization refactor | June 22 – July 5 | All pick-submission paths updated; `team_managers` reads wired. |

**Risk:** this touches whole-app authorization. **Do not** schedule co-manager migration in the final month before launch. If C2 slips into August, defer co-manager support to v1.1 rather than ship a rushed authorization migration.

#### C3: Push notification infrastructure (July 6 – August 2)

FCM (Firebase Cloud Messaging) bring-up for web + mobile. Notification system itself stays the existing one; push is a delivery channel.

| Sub-phase | Window | Output |
|---|---|---|
| C3.1 — FCM design + setup | July 6 – July 19 | FCM project configured, web push tokens flowing, opt-in UX. |
| C3.2 — Mobile push (iOS + Android) | July 20 – August 2 | Native push delivery on both platforms, end-to-end test. |

**Fallback:** if push slips, in-app notifications still work. Push is enhancement, not gate. Lower priority than C1 and C2.

### Phase D: Load test gate (August 24 – September 4)

**Hard date.** Chunk 11g.11 (new — to be added to [`PHASE_4_5_PLAN.md`](./PHASE_4_5_PLAN.md) as part of this plan). Simulated peak load against a production-equivalent GCE deployment.

**Test parameters (per `PHASE_4_5_ARCHITECTURE_ANSWERS.md` Q4.1):**
- 1,000 concurrent WebSocket connections (lower bound of the 2,400–4,800 production estimate; scale up if Day 1 single-VM holds at 1,000).
- 300 concurrent active drafts (upper bound of the 150–300 production estimate).
- Mixed format: 70% snake, 20% linear, 10% auction.
- Sustained 4-hour test window (matches longest realistic draft duration).
- Mid-test simulated process restart and network partition (per architecture doc "done" definition).

**Acceptance gate:**
- Zero lost picks across the test window (P0 SLO bar).
- p95 manual pick latency ≤ 300ms, p99 ≤ 500ms (per existing performance mandate in `CLAUDE.md`).
- p95 reconnect recovery ≤ 2s.
- No instance saturation (CPU < 70%, memory < 70%).

**If saturation observed:** trigger Phase E (Stage 2 implementation). Otherwise, skip directly to Phase F.

### Phase E: Conditional Stage 2 implementation (September 7 – September 18)

Conditional on Phase D outcome. HAProxy in-VM + N uWS workers per vCPU, per the architecture doc's Stage 2 design. Application code unchanged (per the locked principles); supervisor + HAProxy config + container entrypoint updates only.

**Re-test gate:** repeat Phase D load test against Stage 2 deployment. Same acceptance criteria.

### Phase F: Pre-launch hardening (September 21 – October 4)

Final 2-week window before season opener.

| Work item | Window | Output |
|---|---|---|
| Sentry / client-side error tracking | September 21 – September 25 | Sentry wired into web client; error grouping configured; alert routing to on-call. |
| Alert routing + on-call setup | September 21 – September 28 | GCP alerts → SMS/email or Pagerduty; runbooks for top-5 expected incidents. |
| GCP environment tags | September 28 – September 29 | Hygiene fix on both projects. Quick. |
| Final smoke tests + draft-night dry runs | September 29 – October 4 | Internal dry-run drafts at low volume, end-to-end. |

### Phase G: Launch (October 7, 2026)

Season opener weekend. Deploy freeze in effect (per `PHASE_4_5_ARCHITECTURE_ANSWERS.md` Q4.2). On-call active. No code changes during opener weekend absent a P0 incident.

---

## Critical Path & Dependencies

```
Phase B (snake/linear, May 19 – Jul 31)
├─→ Phase D (load test gate, Aug 24 – Sep 4) ──┐
│                                                │
Phase C1 (auction, Jun 1 – Aug 9) ─────────────────→ │
│                                                │
Phase C2 (co-manager, Jun 15 – Jul 5) ─────────────→ │
│                                                │
Phase C3 (push, Jul 6 – Aug 2) [optional] ─────────→ │
                                                  ↓
                                  Phase E (conditional, Sep 7–18)
                                                  ↓
                                  Phase F (hardening, Sep 21 – Oct 4)
                                                  ↓
                                  Phase G (launch, Oct 7)
```

**Critical path:** Phase B → C1 → D → F → G. Auction is the rate-limiter.

---

## Risk Register

Risks ranked by impact-to-launch.

### R1 — Auction design slips past July 1 *(High impact, medium probability)*

If auction ADR isn't ratified by July 1, auction implementation compresses August, which compresses load testing margin.

**Mitigation:** auction ADR is a tracked work item with a dedicated window (June 1 – June 21). Garrett owns. Zach reviews. Re-evaluate weekly during June. **Tripwire:** if no ADR draft by June 14, escalate to Zach for direct involvement.

### R2 — Solo founder bandwidth *(High impact, medium probability)*

The plan assumes Garrett full-time on Phase 4.5 May 19 – October 7. Day job, fundraising, content work, advisor management, and Web Summit follow-up will compete for attention.

**Mitigation:** Zach onboarding earlier is the biggest unlock. If Zach is full-time by mid-June, Phase C workstreams can be split.

### R3 — Load test reveals Stage 2 is required *(Medium impact, medium probability)*

Phase D may surface saturation requiring Phase E (Stage 2 implementation). The plan budgets 2 weeks for this.

**Mitigation:** Phase E budget is real. If Stage 2 needs more than 2 weeks, Phase F hardening compresses.

### R4 — Co-manager migration too risky to ship *(Medium impact, low probability)*

Co-manager schema touches whole-app authorization. If C2 surfaces unexpected complexity (RLS policy edge cases, breaking changes to existing endpoints), it may not be safe to ship for v1.

**Mitigation:** scheduled early (June 15) for ≥6 weeks of soak time. **Tripwire:** if C2 isn't passing all existing test suites by July 5, defer co-manager support to v1.1.

### R5 — Solo on-call during opener weekend *(High impact if it happens, low probability)*

Garrett alone responding from his phone at 11pm during opener weekend. Fine for 50 leagues; risky for 300 concurrent drafts and 4,800 connections.

**Mitigation:** if Zach is available, he's on rotation. If not, identify at least one trusted contact who can be raised for a P0. Heavy observability investment in Phase F is the best preventative.

### R6 — Push notification slips *(Low impact, medium probability)*

Push is enhancement, not gate. In-app notifications work without it.

**Mitigation:** explicit fallback — defer push to v1.1 if C3 surfaces problems.

---

## Decision Log

Material schedule decisions captured here for traceability.

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-29 | Plan proposed by Garrett, awaiting Zach ratification | Anchored against October 7 launch and 6-week pre-launch load test gate. |
| 2026-04-29 | Co-manager migration scheduled early (Phase C2, June 15) | Whole-app authorization touches require ≥6 weeks of soak time before load testing. |
| 2026-04-29 | Auction ADR sub-deadline July 1 | Auction is critical-path; later ratification compresses load test margin. |
| 2026-04-29 | Push notification flagged as deferrable to v1.1 | Push is enhancement; in-app fallback works. |
| 2026-04-29 | Load test (chunk 11g.11) added as hard gate | Path B from `PHASE_4_5_ARCHITECTURE_ANSWERS.md` Q4.1 rests on this test. |
| 2026-04-30 | Chunk 11g.2.0 spike executed by Garrett, all findings recorded in `PHASE_4_5_GCE_PLATFORM_NOTES.md` | `e2-medium` right-sized at 15.5 MiB idle (saving ~$150/mo vs original `e2-standard-4` plan); regional decision deferred pending multi-city benchmark; `--container-image` flag deprecated by GCP (chunk 11g.2 deploy pattern adjusted); ~$97/mo Cloud Workstations drain killed during pre-spike audit. |
| 2026-04-30 | Zach ratified all five decision points (path B, three formats, co-manager v1, provisional Montreal, `e2-medium` VM tier) | Async Slack response. Architecture doc, project plan, and platform notes now operational. |
| 2026-04-30 | ADR-002 (auction state machine) drafted | Five architectural decisions ratified by Garrett. Path A event-sourcing pending Zach confirm. Auction load profile flagged as net-new chunk 11g.11 acceptance criterion. |
| 2026-04-30 | ADR-003 (co-manager authorization model) drafted | Five architectural decisions ratified by Garrett. `team_managers` join table, centralized authorization helper, exclusivity enforced. 4-phase migration plan: centralize first, then schema, then features, then cleanup. |
| 2026-04-30 | Zach ratified ADR-002 and ADR-003 in-person meeting | All architectural decisions in both ADRs locked. Auction state machine and co-manager authorization model are operational design references for chunks 11g.6 implementation. |
| 2026-05-04 | Chunk 11g.2 functionally complete | Server scaffold + JWT auth + Docker parity + production Dockerfile + GCE staging deploy + Cloud Logging integration. End-to-end smoke tests passed against real Montreal VM at 34.19.223.135. Staging resources torn down post-validation; service account, registry, and image preserved for chunk 11g.4 re-provisioning. |
| 2026-05-04 | World-class observability foundation scheduled under chunk 11g.7 | Structured JSON logging via `@citrus/shared` `logger` refactor, Cloud Monitoring dashboards-as-code, log-based metrics, alert policies. Deferred from chunk 11g.2 step 7 because dashboards/alerts should be designed against the real `LobbyManager` + event-sourced state machine (chunks 11g.4–11g.6), not the chunk 11g.2 hello-world echo scaffold. Native Google tooling (gcloud/Config Connector), no Terraform — per Zach's "all in one uniform place" principle. |
| 2026-05-05 | **Chunk 11g.5/11g.6 blocker logged: persistent engine writes to `submit_pick_v2` will fail `auth.uid()` check under admin-client mode.** Resolution requires an ADR. Recommend `submit_pick_v2` accept `service_role + actor.kind='user'` when the engine has independently verified the actor (Option 3 in chunk 11g.4 step 4 recon). Surfaced during chunk 11g.4 step 4 (LobbyRegistry + connection management) implementation; tracked here so chunks 11g.5 (resync protocol) and 11g.6 (state machine + auction handlers) don't land real picks before the auth path is settled. | The migration `20260425140000_draft_engine_v2_rpcs.sql` line 838 enforces `auth.uid() = teams.owner_id` when `actor.kind = 'user'`. The persistent draft engine constructs ONE `DraftServiceV2` at startup backed by the admin Supabase client (`getSupabaseAdmin()`), shared across all `LobbyManager` instances per chunk 11g.4 step 4. Under admin client `auth.uid()` returns null → `unauthorized`. Step 4 itself is unblocked because the LobbyManager unit tests mock `submitPick`. JSDoc flags placed in `server/src/draft/LobbyRegistry.ts` and `server/src/draft/index.ts`. |
| 2026-05-05 | Heartbeat / keepalive protocol scheduled under chunk 11g.7 | Server-driven WS ping/pong every 30s with 10s pong timeout, plus uWS `idleTimeout` configuration. Critical for mobile clients (carrier networks silently drop idle connections after 30-60s, leaving the client and server with mismatched views of liveness). Deferred from chunk 11g.4 step 5 because it's an operations-layer concern that pairs naturally with monitoring/alerting (idle-disconnect rate is a key observability metric) — both land together in chunk 11g.7. |
| 2026-05-05 | Per-event-type rate limiting + prioritization scheduled under chunk 11g.11 | Beyond brute disconnect-on-overflow (chunk 11g.4 step 5's 1 MiB per-connection threshold), world-class platforms prioritize state-changing events (picks, bids) over chat/presence events and gracefully degrade (drop chat first, preserve picks). Deferred to chunk 11g.11 (load test) where real bandwidth profiles per format inform the prioritization scheme. Step 5 ships the simple-but-correct floor; the smart degradation lands once we have real numbers to design against. |
| 2026-05-05 | Backpressure check is O(connections) per broadcast — accept for now, revisit at chunk 11g.11 | Chunk 11g.4 step 5's `LobbyManager.sweepBackpressure` iterates every connection on every broadcast and calls `ws.getBufferedAmount()`. Trivial cost for 12-team drafts (~12 connections per lobby × 252 picks ≈ 3,024 sweep iterations across a full draft). Becomes a concern only if a single lobby grows to 1000+ concurrent connections, which is not a real scenario for fantasy draft formats. Tracked alongside the chunk 11g.11 load test so real concurrency numbers inform whether to switch to lazy backpressure (only sweep recently-broadcast-to ws) or an async sweep timer. |
| 2026-05-05 | Five `draft_events` event types are durably emitted today but skipped-with-log by chunk 11g.4 step 6b's bootstrap — chunk 11g.4 step 6c (timers) and a future chunk own the real handlers | Step 6b's bootstrap dispatches all 11 currently-shipping `event_type` values per the `draft_events` CHECK enum. Of those, 6 are handled with state-machine semantics (`pick`, `pick_undone`, `commissioner_override`, `draft_completed`, `draft_cancelled`, plus the bootstrap's own seq-contiguity check). The remaining 5 are skipped-with-debug-log: `draft_paused` / `draft_resumed` / `draft_extended` (timer/deadline state — becomes 6c-relevant when timers land in the engine), `autopick_failed` (diagnostic), and `generation_bumped` (internal versioning). Skip-with-log is correct for state-machine integrity in 6b — none of these affect `picksMade` or the ring buffer. The pause/resume/extend trio will gain real handlers in chunk 11g.4 step 6c alongside the per-lobby `setTimeout` deadline timers per the architecture doc. ADR-002 §4.1 auction event types (`auction_*`) are not in the shipping CHECK constraint and would hit the bootstrap's `default:` branch as forward-compat warn-and-skip; chunk 11g.6 ALTERs the CHECK and ships the auction state machine that emits and consumes them. |
| 2026-05-05 | ADR-004 (persistent-engine authorization model) drafted | Option 3 selected — engine becomes trusted executor; `submit_pick_v2` accepts `service_role + actor.kind='user'` when the engine has independently verified the actor at the application layer. Decision rationale leads with precedent: the existing `draft_pause` / `draft_resume` / `draft_extend` RPCs in the same migration (`20260425140000_draft_engine_v2_rpcs.sql` lines 1000-1007, 1119-1126, 1263-1270) already accept `service_role` as a trusted-application-layer bypass for commissioner-kind operations. ADR-004 extends this pattern from commissioner-kind to user-kind. Pending Zach ratification. Unblocks chunks 11g.4 step 6, 11g.5, 11g.6. Migration shape is ~5 lines of SQL change to the user-kind branch of `submit_pick_v2`; engine-side team-authorization verification (the trust contract) is chunk 11g.6 work and is independent of ADR-003's `team_authorized()` migration sequence. |
