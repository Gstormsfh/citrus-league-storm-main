# Phase 4.5 Architecture — Citrus Answers

Answers to the "Clarifying Questions Before Implementation" section of [`PHASE_4_5_ARCHITECTURE.md`](./PHASE_4_5_ARCHITECTURE.md). The architecture doc is framework- and product-agnostic by design; this doc binds it to Citrus's actual product, codebase, and operational reality.

**Authority:** Garrett Storms, founder/CEO. Answered 2026-04-29.
**Status:** Ratified for Phase 4.5 chunk planning. Subject to revision when Zach (incoming CTO) is onboard, per the same supersession-note convention used for ADR-001.

---

## Scope clarification

Phase 4.5 (live draft engine) is **not** for Web Summit Vancouver 2026. Web Summit features the playoff pool product, which is already refined and uses a different surface. Phase 4.5 ships for the **NHL fantasy season opener (September–October 2026)** — the v1 production launch of the live draft engine.

---

## Product / Draft Mechanics

### What draft formats are supported (snake, linear, auction)?

All three: **snake, linear, and auction**.

- **Notes:** Auction has fundamentally different state semantics (bid timers, simultaneous multi-user bidding, budget tracking). The architecture doc's Day 1 implementation as written assumes turn-based snake/linear semantics. Auction needs its own state machine design — either a separate `AuctionLobbyManager` sharing the locked primitives (event sourcing, single-writer queue, discovery, durability), or a format-aware `LobbyManager`. **This is a follow-up design story, not part of Phase 4.5 chunks 11g.0–11g.10 as planned.** Flagged for ADR before auction-format implementation begins.

### Is there a draft pause feature (commissioner halts the clock)? If yes, how is resume authorized?

Yes. **Commissioner-only.** Pause and resume are emergency commissioner actions. No other roles can pause or resume.

### Can commissioners undo or override picks mid-draft?

Yes. Implemented as **emergency commissioner override picks**, treated as a `commissioner_override_pick` event in the event log — same durability path, same single-writer serialization, same broadcast pattern as a normal pick. Audit trail preserved.

### What happens when a user is on the clock but disconnected? Auto-pick from a queue? Auto-pick best-available? Skip and come back?

**Auto-pick.** Engage the user's pre-draft queue if they have one set; if no queue or all queued players are unavailable, fall back to **best-available by ML projection** (Citrus's existing autopick model).

### Are there pre-draft queues (users rank players in advance for auto-pick fallback)? Where does that data live and when is it loaded?

Yes. Pre-draft queues exist in the current product (users can build their queue ahead of the draft).

- **Notes:** Exact storage table and load timing (on draft start vs. on demand per pick) not yet identified for the architecture-doc record. Trivial grep at chunk 11g.2 implementation time. Not blocking.

---

## Users and Access

### Who can connect — only rostered team owners, or also spectators? If spectators, do they get a different message stream?

**Members of the draft only.** No spectator support in v1. Membership is enforced via `LeagueMembershipService.checkMembership` (already wired in chunk 11g.1's discovery endpoint).

### Can a single user have multiple connections (web + mobile) to the same draft? How do conflicting submissions resolve?

**Allow multiple connections.** A user on laptop and phone simultaneously is supported. Conflict resolution: **idempotency keys + first-write-wins** at the single-writer queue. The single-writer guarantee (Principle 5) plus client-generated idempotency keys make this safe by construction. Yahoo's draft client follows the same pattern.

- **Notes:** Fallback if implementation surfaces problems: kick-old-on-new (last connection wins). Not expected to be necessary.

### Are co-managers a concept (multiple users authorized to pick for one team)?

Yes, with a designated **head manager** model. One user is the head manager and holds pick authority. Zero or more co-managers have read access to the live draft and follow along, but cannot submit picks.

- **Notes:** This is **net-new schema work** beyond what exists today. Likely shape: a `team_managers` join table with a `role` column (`head | co`), or `head_manager_id` plus `co_manager_ids[]` on the `team` model. Authorization check on pick submission changes from `userId == team.owner_id` to `userId == team.head_manager_id`. Both head and co-managers receive event broadcasts via the same WS channel. **Database migration story to schedule before live draft v1 ships next NHL season.** Not blocking Phase 4.5 architecture decisions.

---

## Existing System Integration

### What ORM / query layer is in use on the Hono side?

*(Zach's doc says "Express side" — the Citrus equivalent is Hono. See the Citrus note in the canonical architecture doc's Stack Decision section.)*

**Supabase JS client (`@supabase/supabase-js`).** Not a traditional ORM — direct PostgREST under the hood. Pattern: `supabase.from('table').select(...)` for simple queries, RPC calls (`submit_pick_v2`, `send_league_chat_message`, etc.) for complex transactional operations. User-scoped clients via `createUserClient(userToken)` for RLS enforcement.

### What auth library and JWT structure is currently in use? The discovery endpoint should extend the existing auth.

**Supabase Auth.** User-facing JWTs are issued by Supabase, validated via `supabase.auth.getUser()` (network call to Supabase Auth) in `server/src/middleware/auth.ts`. **Draft-scoped JWTs** are signed locally with `SUPABASE_JWT_SECRET` (HS256, 5-minute TTL) via `hono/utils/jwt`. See `server/src/lib/draftToken.ts`. Two validation paths — both already wired and in production:

- User-auth path: network round-trip to Supabase, asymmetric-key-safe, used by `authMiddleware` on every API route.
- Draft-token path: local HMAC, sub-millisecond, used by the discovery endpoint and (forthcoming) the WS upgrade handler.

The variable name `SUPABASE_JWT_SECRET` is legacy. Supabase staging has been migrated to asymmetric JWT Signing Keys; the legacy HMAC secret is vestigial. Citrus's `SUPABASE_JWT_SECRET` is now an **independent random secret** (provisioned 2026-04-29 in GCP Secret Manager for both staging and prod) used only by `draftToken.ts` for its closed sign/verify loop. Decoupled from Supabase's secret rotation lifecycle.

### What's the existing logging/metrics setup? The uWS module should plug into it.

- **Logging:** `@citrus/shared` `logger` — custom structured-JSON output for Cloud Logging / Datadog parsing.
- **Metrics:** custom `metrics` module with Prometheus text export at `/api/metrics`. Web vitals receiver at `/api/vitals`.
- **No third-party observability stack implemented yet.** Sentry was discussed but not deployed.

- **Notes:** Sentry (or equivalent client-side error tracking) is **valuable for live-draft debugging** — knowing why a client disconnected matters when a draft fails. Post-Web-Summit follow-up story.

### Is there an existing notification system? Pre/post-draft notifications should go through it.

Yes. `notificationRoutes` in `server/src/app.ts`. Existing rules from the April 10, 2026 live-draft-disaster postmortem:

- No per-pick notifications writes for manual picks (prevents notification storm).
- Single-recipient writes only for autopicks.
- Chat routes through the existing `send_league_chat_message` RPC.

Phase 4.5 notifications scope:
- Pre-draft heads-up notifications (e.g. "draft starting in 1 hour").
- Post-draft summary notifications (e.g. "draft complete, here's your roster").
- **Push notifications** (web + mobile) for the above.

- **Notes:** Push notification implementation is **separate technical design** beyond Phase 4.5 chunks. Likely path: Firebase Cloud Messaging (Citrus already uses Firebase Hosting). Alternatives: OneSignal, Pusher Beams. Push delivery is a channel; the notification system itself remains the existing one. **Schedule as separate work story before next NHL season.**

### Deployment target details for the GCE VM (machine type, region, container runtime)? Confirming the existing HTTP API also moves to this VM rather than staying split across platforms.

Yes — **single platform.** Both the Hono HTTP API and the uWS draft engine deploy to the same GCE VM(s). Specific deploy-target details (machine type, region, container runtime) **TBD pending GCE platform spike** during chunk 11g.2 reshape. Decision delegated to Zach's Cloud Run / GCE production experience.

- **Provisional placeholders for chunk 11g.2 spike to confirm or revise:**
  - Machine type: `e2-standard-4` (4 vCPU, 16 GB RAM) for staging Day 1.
  - Region: `northamerica-northeast1` (Montreal, closer to Canadian user base) or `us-central1`. Confirm with latency test.
  - Container runtime: Docker on Container-Optimized OS (COS).
  - Same machine type for prod, scale up only when measured load demands it.

---

## Operational

### Expected launch volume — 10 concurrent drafts? 50? 200? Order of magnitude is enough.

**Target: 10,000–40,000 registered users for the v1 NHL fantasy draft season (Sep–Oct 2026).** Most don't draft in the same hour.

Estimated peak concurrent drafts and connections (math, conservative):
- Total leagues: 40,000 / 12 ≈ 3,300.
- 60% of drafts complete in the 4-day season-opener window; 40% concentrated in two prime-time evenings.
- Per-evening drafts: 3,300 × 0.40 / 2 ≈ 660.
- Within a single evening, drafts cluster in a 4-hour window; each draft runs 1–4 hours.
- **Peak concurrent drafts: 150–300 at upper bound; 40–75 at lower (10k registered) bound.**
- Per-draft connections: 12 typical × 1.3x multi-connection multiplier ≈ 16.
- **Peak concurrent WebSocket connections: 2,400–4,800 at upper bound.**

Implication for Day 1 architecture: this is **above** Zach's "tens of concurrent active drafts at launch, growing to hundreds" assumption. **Decision (path B from the discussion): trust the architecture doc's mechanical-progression promise.** Build Day 1 single-process clean per the canonical architecture. Load-test against simulated peak (1,000 connections + 300 active drafts) **6 weeks before season opener**. Trigger Stage 2 (HAProxy + per-vCPU worker pool) if load testing surfaces saturation. The locked principles (lobby-ID shard key, single-writer per lobby, event sourcing, no-unrecoverable-state, discovery-as-function) make Stage 2 a config change, not a redesign.

- **Notes:** Flagged for Zach's ratification when he's onboard. The "tens at launch" assumption needs his sign-off on path B before chunk 11g.2 implementation locks the Day 1 deploy shape.

### Do drafts run on a predictable schedule (e.g., draft night) or continuously? Affects whether deploy windows are viable.

**Heavy seasonality.** NHL fantasy drafts cluster on season-opener weekend (late September), with prime-time evenings (Friday/Saturday 7–11pm local) as the peak. Pre-season has scattered drafts. Mid-season has very few new drafts (rosters mostly drafted). Off-season is dead.

Deploy window policy:
- **Off-season and mid-season:** unrestricted deploy windows.
- **Season-opener weekend:** deploys locked or restricted to demonstrably-empty hours.
- **Opener prime-time evenings:** deploy freeze. No exceptions absent a P0 hotfix.

### Existing on-call rotation? Affects how much investment is justified in observability and runbooks Day 1.

**Solo founder, on-call always.** Zach is incoming. There is no on-call rotation today. Garrett is the responder for any production incident, including 11pm Saturday nights during draft opener weekend.

Implications for Day 1 observability investment:
- Structured logs to GCP Cloud Logging — already wired.
- Prometheus metrics + alert routing to Garrett's phone (GCP-native alerts → SMS/email, or Pagerduty/Opsgenie).
- **Heavy observability is justified Day 1**, not deferred. Garrett alone needs to diagnose a failed draft from his phone in low-bandwidth conditions.
- Sentry post-Web-Summit (high-value for client-side disconnect debugging).

### SLO for a draft? "No lost picks ever" is the assumed bar; confirm. Threshold for reconnect blips before they're an incident?

**No-lost-picks is the bar. Confirmed mission-critical.** Losing a pick during the first NHL fantasy season would be the fastest way to lose Citrus's user base. The event log + idempotency keys + transactional pick path (`BEGIN; INSERT INTO draft_events; UPDATE draft_state; COMMIT;`) make this technically achievable.

Severity ladder for incidents:
- **P0 — wake-Garrett incident:** any draft that loses a pick or has split state across clients (data corruption). Includes any draft where the event log and broadcast diverge.
- **P1 — notify-but-don't-wake:** any draft where >25% of users see >30s of disconnect during an active draft.
- **P2 — logged, not alerted:** transient single-user reconnects under 10s. Expected behavior; just track frequency.

---

## Out-of-Scope Confirmations

### Confirming: chat is optional / lower-priority and can be added after core draft mechanics work?

**Override: chat is in v1, not v1.1.** Garrett's call. Chat is an additional event type on the same WS channel, broadcast via `app.publish('draft:${lobbyId}', event)`, persisted via the existing `send_league_chat_message` RPC. Adds modest scope to the v1 test surface but is mechanically straightforward given the architecture's primitives.

### Confirming: spectator/replay views are post-launch?

**Confirmed. Both out of scope for v1.** Post-draft summary only — served by the existing `GET /api/drafts/:id/state` projection. No live spectator stream; no replay-as-animation product feature.

### Confirming: mobile (if any) uses the same WebSocket protocol as web?

**Confirmed. Single protocol, web + mobile.** WebSockets are a transport, not a protocol. The application layer (JWT auth, message format, event types, idempotency keys) is identical. Transport differences (browser WS API vs. ReactNative WS lib) are client-side only. Building two parallel protocols would mean maintaining two state machines forever — pure cost, no benefit. Standard pattern across the industry (Yahoo, ESPN, Sleeper).

---

## Surfaced Follow-Up Work (Beyond Phase 4.5 Chunks 11g.0–11g.10)

Surfaced during the Q&A. Tracked here so nothing gets lost. None blocks Phase 4.5 architecture decisions.

1. **Auction format state machine** — separate ADR / design doc. Required before auction live-drafting ships next NHL season.
2. **Co-manager schema migration** — `team_managers` join table (or equivalent) and authorization-check refactor. Required before live draft v1 ships next NHL season.
3. **Push notification infrastructure** — separate technical design (FCM most likely). Required before next NHL season.
4. **Sentry / client-side error tracking** — post-Web-Summit. Valuable for live-draft debugging.
5. **GCP environment tags** — quick organizational hygiene fix on both `citrus-fantasy-staging` and `citrus-fantasy-prod`. Post-Web-Summit.
6. **GCE platform spike** — machine type, region, container runtime decisions. Inside chunk 11g.2 reshape; awaiting Zach.
