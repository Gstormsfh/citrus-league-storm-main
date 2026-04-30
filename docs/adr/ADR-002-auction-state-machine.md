# ADR-002 — Auction Draft State Machine

## §1. Status & Authority

**Status:** Draft. Pending Zach's review.

**Date:** 2026-04-30.

**Authority:** Garrett Storms, founder/CEO. Path A event-sourcing recommendation pending separate confirmation from Zach.

**Supersession convention:** Same append-only convention used in ADR-001. Any material revision adds a new "Decision History" entry; original wording preserved.

**Companion docs:**
- [`docs/PHASE_4_5_ARCHITECTURE.md`](../PHASE_4_5_ARCHITECTURE.md) — canonical architecture (Zach's design, snake/linear)
- [`docs/PHASE_4_5_ARCHITECTURE_ANSWERS.md`](../PHASE_4_5_ARCHITECTURE_ANSWERS.md) — Citrus-specific answers, ratified 2026-04-30
- [`docs/PHASE_4_5_PROJECT_PLAN.md`](../PHASE_4_5_PROJECT_PLAN.md) — schedule, dependencies, risk register
- [`docs/adr/ADR-001-persistent-node-draft-engine.md`](./ADR-001-persistent-node-draft-engine.md) — original deploy-target ADR with Cloud Run → GCE supersession note

---

## §2. Context

Phase 4.5 commits to all three draft formats — snake, linear, and auction — for the v1 NHL fantasy season launch (October 2026). Snake and linear share core mechanics (turn-based, single-pick-per-clock, predictable state transitions) and are well-served by the existing chunk 11g.6 plan in [`PHASE_4_5_PLAN.md`](../PHASE_4_5_PLAN.md). Auction is fundamentally different and requires its own architectural treatment.

A reconnaissance pass on the existing v1 auction infrastructure (April 30, 2026) revealed:

- **Auction is functionally implemented end-to-end in v1.** `AuctionService` (server), `AuctionDraftService` (frontend), three Postgres tables (`auction_budgets`, `auction_nominations`, `auction_bids`), conditional UI inside `DraftRoom.tsx`. Real CRUD path, real test coverage.
- **Three correctness gaps surface under load:**
  1. Bid placement is non-transactional. Two simultaneous bids of the same amount can both succeed because `placeBid` reads, validates, and writes without serialization (`AuctionService.ts:121-155`). This is happening in production today whenever two users bid at the same instant.
  2. Nomination close is browser-driven. Every connected client races to call `closeNomination` when the timer expires, with per-browser guards and a server-side `status !== 'active'` re-check serving as the only safety net (`DraftRoom.tsx:1141-1167`).
  3. `autoNominate` is dead code. The frontend method exists but has zero callers anywhere in the codebase; the `'__auto__'` sentinel it would pass has no server-side handling. If invoked, it would silently insert as a literal `player_id` and corrupt the winner's roster.

- **Auction is not event-sourced.** State lives as direct projections in tables, with `auction_bids` as the only append-only surface. This conflicts with chunk 11g.2's locked event-sourcing principle (Principle 3 in `PHASE_4_5_ARCHITECTURE.md`).

- **Anti-snipe semantics are non-standard.** v1 uses a fixed 30-second window per nomination, with a hard reset to 15 seconds if a bid lands in the last 10 seconds. Earlier bids do not extend at all. Industry standard (Yahoo, ESPN) is incremental extension on every bid in the final window.

- **No nomination-window timer exists.** A nominator can sit on the clock forever. The bid timer per nomination exists; the nominator's clock does not.

This ADR captures the architectural decisions for migrating auction from v1's direct-projection model into Phase 4.5's persistent-engine event-sourced model, with the correctness gaps fixed by construction and the missing primitives (nomination timer, auto-nominate, anti-snipe industry-standard semantics) added.

---

## §3. The Five Architectural Decisions

### §3.1 — Event sourcing model: single `draft_events` table, polymorphic event types

**Decision:** All auction events flow into the existing `draft_events` table alongside snake/linear events. The `event_type` column distinguishes types (`pick_submitted`, `auction_bid_placed`, `auction_nomination_started`, etc.). The `payload` JSONB column holds type-specific details. A partial index on `draft_events` for `event_type LIKE 'auction_%'` keeps auction-specific queries fast.

**Rationale:**

1. **Aligns with Principle 3 of the canonical architecture doc.** Zach's design treats `draft_events` as the singular system of record per draft. A separate `auction_events` table violates this principle for the sake of organizational tidiness.
2. **Keeps recovery code single-path.** Chunk 11g.7's process bootstrap loads `LobbyManager` from snapshot + event replay. With one table, that bootstrap is one query, format-agnostic. With two tables, bootstrap branches on `draft_type` — a branch point in the most safety-critical code in the system.
3. **Future cross-format features are cheaper.** Commissioner pause, undo, chat, override — all apply to both auction and snake/linear. One event type each in option A; defined twice in option B and kept in sync forever.
4. **Postgres handles polymorphic JSONB well.** Partial indexes are standard practice. The "won't queries get slow?" concern has a clean technical answer.

**Consequences:**

- Schema evolution: extend the `event_type` column's accepted values; payload shapes for new types are documented in §4.1 below.
- Migration: existing `draft_events` rows for snake/linear are unchanged. Auction events begin appending starting at chunk 11g.6 cutover.
- Test surface: snake/linear tests do not need to know about auction event types because they filter on type at the application layer.

**Sharpening: envelope vs payload polymorphism (added 2026-04-30 in response to Zach's pushback).**

The pushback worth addressing directly: polymorphic database tables are problematic when they force structurally different data into a uniform column shape. They are not problematic when the *envelope* is uniform and the *payload* is schema-flexible.

What this design proposes:

- **Envelope (uniform across all event types):** `lobby_id`, `seq`, `event_type`, `payload`, `created_at`, idempotency-key column, optional payload-hash for chunk 11g.4 validation. Every row in `draft_events` has the same envelope columns regardless of whether the event is a snake pick or an auction bid.
- **Payload (type-specific, schema-flexible):** stored as JSONB. Each event type defines its own payload shape (catalogued in §4.1 below). Postgres treats each row's payload as an opaque JSONB document; no schema-level constraint forces payload uniformity.

Concrete example. A snake/linear `pick_submitted` payload looks like `{team_id, player_id, pick_number, round_number, idempotency_key}`. An auction `auction_bid_placed` payload looks like `{nomination_id, team_id, bid_amount, idempotency_key}`. These are structurally different. They live in the same `payload` column because JSONB is the right tool for type-varying payloads — that's its purpose.

The polymorphism is at the envelope level only (one event-log table, multiple event types). The payload's structural variance is handled by JSONB, not by forcing snake and auction into a Procrustean common shape.

If the *envelope* ever needed to diverge — for example, if auction events required a different sequence-number primitive (per-nomination rather than per-lobby), different durability semantics, or different read-replica behavior — path B (separate `auction_events` table) would be revisited. None of those divergences are currently anticipated.

**Pending confirmation from Zach.** Garrett asked Zach separately to confirm this aligns with his architecture-doc intent. If Zach pushes back to path B (separate `auction_events` table), this section gets re-litigated; the rest of the ADR is unaffected.

### §3.2 — LobbyManager shape: format-aware single class with state-machine dispatch

**Decision:** The `LobbyManager` class introduced in chunk 11g.4 becomes format-aware via an internal state-machine dispatch. A single class instance handles snake, linear, and auction drafts; the message handler routes to format-specific submethods based on the draft's `format` field. No separate `AuctionLobbyManager` class.

**Rationale:**

1. **80% of LobbyManager's plumbing is format-agnostic.** Event log writes, single-writer queue, ring buffer (~200 events), broadcast via uWS pub/sub topics, snapshot persistence, process-bootstrap state recovery — all identical across formats. Branching only occurs at the message-handler level (e.g., `pick` vs `bid` vs `nominate`).
2. **One recovery path.** Chunk 11g.7's bootstrap loads `LobbyManager` instances regardless of draft format. Snapshot shape is uniform; replay is uniform.
3. **Smaller test surface.** Plumbing tests run once. Format-specific behavior tests run per format. Two classes would duplicate the plumbing tests.
4. **The single-writer queue from chunk 11g.4 fixes auction's race condition by construction.** Bid validation flows through the same queue as pick submission. Two simultaneous bids serialize; second bid sees first's commit and rejects cleanly per the existing strict-greater check.

**Consequences:**

- `LobbyManager` carries a `format: 'snake' | 'linear' | 'auction'` discriminator; message handlers dispatch on it.
- Auction-specific in-memory state (current nomination, budgets, nomination order, current nominator pointer) lives on the same `LobbyManager` instance as snake-specific state would, gated by `format`.
- Type signatures grow: handlers like `submitPick` are snake/linear-only; `placeBid`, `nominate`, `closeNomination` are auction-only. Compile-time discrimination via discriminated unions on TypeScript.

### §3.3 — Anti-snipe semantics: industry-standard incremental extension

**Decision:** When a bid is placed within the final 30 seconds of the nomination window, the window extends by 30 seconds. Each subsequent bid in the new final-30-second window extends again. Bids outside the final-30 window do not extend. Commissioner-customizable per league:

- `anti_snipe_threshold_seconds` (default: 30)
- `anti_snipe_extension_seconds` (default: 30)

**Rationale:**

1. **Matches user expectations from Yahoo, ESPN, Sleeper.** Citrus users coming from major-platform fantasy will expect this behavior. The v1 hard-reset-to-15s semantic is unusual and likely surprises users who don't read documentation.
2. **Prevents sniping.** A user firing a winning bid in the last 200ms doesn't end the auction; it triggers another 30-second window. Genuine bidding wars resolve naturally; snipers don't get the last word by virtue of fast clicking.
3. **Commissioner customization preserves flexibility.** Leagues that want faster auctions can shorten the threshold and extension. Leagues that want longer bidding wars can lengthen them.

**Consequences:**

- New event type: `auction_bid_extends_timer` (records the extension; the `auction_bid_placed` event records the bid itself).
- Schema additions to league config (see §3.4 schema additions).
- Backwards-incompatible behavior change from v1 — communication required at launch (release notes, in-app notification, optional commissioner toggle to revert to v1 hard-reset semantics during the transition window if support pressure surfaces).

### §3.4 — Nomination window timer: net-new, with auto-nominate on expiry

**Decision:** Each nomination begins with a 60-second window during which the nominator must nominate a player. If the window expires without nomination, the system auto-nominates server-side. Commissioner-customizable per league:

- `nomination_window_seconds` (default: 60)

**Rationale:**

1. **v1 has no nomination timer; auctions can stall indefinitely.** A nominator who walks away mid-draft halts the entire auction. Net-new primitive.
2. **60-second default is generous enough that disengaged users don't get auto-nominated mid-thought, but tight enough that the auction maintains pace.** Commissioners can adjust per league culture.
3. **Auto-nominate algorithm (per §4.2 below):** queue head → highest-projected-available by ML model → commissioner-pre-set fallback. No `'__auto__'` sentinel ever leaks into the data model; the algorithm resolves a real `player_id` server-side before writing the nomination event.

**Consequences:**

- New event types: `auction_nomination_started`, `auction_nomination_expired`, `auction_auto_nominated` (the auto-nominate variant of `auction_nomination_started`).
- Schema additions to league config (see schema additions below).
- Commissioner pre-set "fallback player" UI surface — net-new product feature for chunk 11g.6 design.

### §3.5 — Race condition fix: single-writer queue serialization

**Decision:** Bid validation and write flows through the LobbyManager's single-writer queue (per chunk 11g.4 Principle 5). The simultaneous-bid race window (`AuctionService.ts:121-155`) closes by construction.

**Rationale:**

1. **Inherits chunk 11g.4's primitive without modification.** The single-writer queue exists for exactly this class of problem; auction's race condition is a textbook case.
2. **No new locking primitive needed.** Postgres advisory locks, `SELECT ... FOR UPDATE`, or SECURITY DEFINER RPCs were considered; the single-writer queue is simpler and matches the architecture-doc principle.
3. **Idempotency keys (per chunk 11g.4) prevent duplicate-bid replay attacks.** Same primitive as snake/linear pick submission.

**Consequences:**

- Bids submitted simultaneously serialize at the LobbyManager level. The first bid commits; the second sees the updated `current_high_bid` and either succeeds (if higher) or rejects cleanly (if equal-or-lower).
- No retroactive data fix needed. The race in v1 is a behavioral defect, not a stored-data corruption — past races are silent and unrecoverable, but no remediation possible or needed.
- Latency: minor. Single-writer queue serialization adds <1ms per bid at expected concurrency.

---

## §4. Product Behavior Specification

### §4.1 — Auction event types catalog

The `event_type` values added to `draft_events` for auction support:

| Event type | Triggered by | Payload (illustrative) |
|---|---|---|
| `auction_nomination_started` | Nominator action OR auto-nominate after window expiry | `{nomination_id, player_id, player_name, opening_bid, nominator_team_id, expires_at}` |
| `auction_bid_placed` | Any team within budget | `{nomination_id, team_id, bid_amount, idempotency_key}` |
| `auction_bid_extends_timer` | System-generated when bid lands in final-N seconds | `{nomination_id, prior_expires_at, new_expires_at, triggering_bid_id}` |
| `auction_nomination_expired` | System-generated on window expiry without bid | `{nomination_id, reason: 'no_bids' \| 'auto_nominate_pending'}` |
| `auction_nomination_closed` | System-generated on bid window expiry with winning bid | `{nomination_id, winning_team_id, final_amount, total_bids}` |
| `auction_auto_nominated` | System-generated when nomination window expires | `{nomination_id, fallback_source: 'queue' \| 'ml_projection' \| 'commissioner_preset', resolved_player_id}` |
| `auction_paused` | Commissioner action | `{commissioner_user_id, reason}` |
| `auction_resumed` | Commissioner action | `{commissioner_user_id, prior_pause_event_id}` |
| `auction_commissioner_override` | Commissioner action (forced nomination, forced close, undo) | `{commissioner_user_id, override_action, prior_state, new_state}` |

All events carry the standard `draft_events` columns (`lobby_id`, `seq`, `created_at`) plus a payload-hash for chunk 11g.4's idempotency-key validation.

### §4.2 — Auto-nominate algorithm

When a nomination window expires without the nominator nominating:

1. **Queue head:** if the nominator has a pre-draft queue with available players, nominate the top player. Source: `apps/web/src/services/AuctionDraftService.ts` queue-management code (chunk 11g.6 owns the migration of queue lookup into the server).
2. **Highest-projected available by ML:** if no queue or all queued players are taken, nominate the available player with the highest ML projection (Citrus's existing autopick model).
3. **Commissioner pre-set fallback:** if both above paths return nothing (edge case: queue exhausted AND ML model returns nothing), nominate the commissioner's pre-set fallback player. Pre-set is a per-team configuration set during the draft setup phase; commissioner-set or team-owner-set per league policy.

The algorithm resolves a real `player_id` server-side before writing the `auction_auto_nominated` event. No sentinel string (`'__auto__'` or otherwise) is ever inserted into `auction_nominations` or `draft_picks`.

### §4.3 — Commissioner customization surface

Per-league fields added to league config:

| Field | Default | Range / values | Notes |
|---|---|---|---|
| `auction_budget_per_team` | $200 | Positive integer | Already exists in v1 |
| `auction_min_bid` | $1 | Positive integer | Already exists in v1 |
| `auction_min_bid_increment_tiers` | Flat $1 | JSONB array of `{below: int, increment: int}` tuples | New: enables tiered increments per chunk 11g.6 product spec. Default is flat $1 to preserve v1 behavior. |
| `nomination_window_seconds` | 60 | 15-300 | New: net-new primitive |
| `bid_window_seconds` | 30 | 10-120 | Existing v1 default; commissioner-customizable in Phase 4.5 |
| `anti_snipe_threshold_seconds` | 30 | 0-120 (0 disables) | New: industry-standard anti-snipe |
| `anti_snipe_extension_seconds` | 30 | 5-120 | New |

UI surface: commissioner-only league settings page; per-league, set during draft setup, locked once draft starts.

### §4.4 — Edge cases

- **Two simultaneous bids of equal amount.** Single-writer queue serializes. First bid commits; second bid sees the updated `current_high_bid` and rejects per the strict-greater check (`AuctionService.ts:128` logic preserved). No data corruption.
- **Nominator disconnects mid-window.** Nomination window timer continues server-side. On expiry, auto-nominate algorithm fires per §4.2. Nominator's reconnection arrives to a state with the auction already advanced.
- **Commissioner pause mid-bid window.** `auction_paused` event written; bid window timer suspended (state preserved in `LobbyManager`). On `auction_resumed`, timer resumes from where it stopped, not reset.
- **Anti-snipe cascade.** Bid placed at second 29 of a 30-second window with anti-snipe threshold 30s: window extends to second 59. Another bid at second 58: extends to second 88. No upper bound on cascade length — commissioners can configure max-cascade-count if pacing concerns surface (deferred to v1.1; not blocking).
- **Auto-nominate edge: nominator's queue is empty AND ML model returns nothing AND commissioner pre-set is unset.** System emits a critical-priority alert to the commissioner via the existing notification system (chunk 11g.6 wires this), pauses the draft, and waits for commissioner intervention. Last-resort fallback to prevent silent data corruption.

### §4.5 — Configuration model: per-league, set at draft setup, immutable mid-draft

All values in §4.3's "Commissioner customization surface" table are **per-league configuration**, not system-wide constants. When a draft starts, the LobbyManager reads that specific league's settings and uses them throughout. Two leagues drafting simultaneously can run with completely different budgets, timers, anti-snipe rules, and bid-increment tiers without affecting each other.

**Examples of legitimate league configurations:**

- **High-stakes league:** $500 budget, $5 min bid, 60s nomination window, 60s bid window, 60s anti-snipe threshold + 60s extension.
- **Speed auction:** $200 budget, $1 min bid, 30s nomination window, 15s bid window, 0s anti-snipe (disabled).
- **Casual home league:** $200 budget, $1 min bid, 90s nomination window, 30s bid window, defaults on everything else.
- **Tiered-increment league:** $200 budget, increments `[{below: 10, increment: 1}, {below: 50, increment: 5}, {below: 999, increment: 10}]` (i.e., $1 below $10, $5 below $50, $10 above).

**Locking behavior:** all values are mutable during draft setup (commissioner can change them up until the draft starts). Once the draft transitions to `in_progress`, all values are locked for the duration of the draft. Mid-draft commissioner changes are not supported (would require its own ADR; not in scope for v1).

**Validation:** values are validated server-side at draft-start time per the ranges in §4.3. Invalid configurations (e.g., `nomination_window_seconds: 5`, below the 15-second minimum) are rejected before the draft transitions to `in_progress`. The validation is mandatory because invalid values can corrupt the LobbyManager state machine (e.g., a 0s nomination window would auto-nominate before any human action is possible).

**Storage:** the per-league configuration lives in the existing `leagues.settings` JSONB column, with type-safe access via the existing league-settings type system in `packages/shared/src/types/league.ts`. Default values come from the auction-defaults constants module (chunk 11g.6 owns the migration of v1's hardcoded defaults into a centralized constants file).

---

## §5. Migration Plan from v1 to Live Engine

### §5.1 — What stays from v1

The following v1 schema and infrastructure carries forward unchanged:

- `auction_budgets` table (per-team budget tracking)
- `auction_nominations` table (existing structure, with new columns added per §5.4)
- `auction_bids` table (append-only bid history)
- `draft_picks` table (final ownership ledger; auction's `closeNomination` continues writing here)
- League configuration storage in `leagues.settings` JSONB (with new fields added per §4.3 / §5.4)

### §5.2 — What changes from v1

- **Bid validation moves into the LobbyManager.** `AuctionService.placeBid` is rewritten to delegate to LobbyManager's single-writer queue. The browser no longer talks directly to `AuctionService` for bid placement — bids flow through the WebSocket `bid` message handler.
- **Nomination close becomes server-driven.** Browser-driven `closeNomination` race (`DraftRoom.tsx:1141-1167`) is removed. The LobbyManager owns the nomination timer and fires `auction_nomination_closed` when the bid window expires.
- **Anti-snipe semantics rewritten.** v1's hard-reset-to-15s logic at `AuctionService.ts:148-151` is replaced by industry-standard incremental extension per §3.3.
- **Auto-nominate added.** `AuctionDraftService.autoNominate` (dead code) is deleted. Server-side auto-nominate algorithm per §4.2 is implemented in `LobbyManager`.
- **Nomination window timer added.** Net-new primitive per §3.4.
- **Polling loops removed.** v1's 5-7s bid history poll (`DraftRoom.tsx:1175`) is replaced by uWS broadcast push from the LobbyManager. Frontend subscribes to the draft's WS topic and receives events as they're committed.

### §5.3 — Race condition fix sequencing

The race condition in v1's `placeBid` is closed at chunk 11g.6 cutover. No retroactive data fix is needed because:

- The race's failure mode is *behavioral* (which team wins a contested bid), not *stored-data* (the row in `auction_bids` is correct; the row in `auction_nominations` reflects whichever UPDATE committed last).
- Past races are silent and unrecoverable — there's no log of which bids were affected.
- Going forward, single-writer queue serialization closes the race by construction.

If staging has any drafts in progress at chunk 11g.6 cutover, those drafts are completed under v1 semantics; only drafts started after cutover use the new engine.

### §5.4 — Schema additions

New columns and indexes (chunk 11g.6 migration):

- `leagues.settings` JSONB additions per §4.3 (no schema migration; JSONB is permissive).
- `draft_events.event_type` accepts new values per §4.1 (no schema migration; column is `TEXT`).
- New partial index: `CREATE INDEX idx_draft_events_auction ON draft_events (lobby_id, seq) WHERE event_type LIKE 'auction_%';` — enables fast auction-specific replay.
- `auction_nominations` adds `nomination_event_id BIGINT` referencing the `draft_events.seq` of the corresponding `auction_nomination_started` event. Allows traversal from projection back to event log.

### §5.5 — Backfill: dead code remnants

A query against staging at chunk 11g.6 implementation start:

```sql
SELECT count(*) FROM auction_nominations WHERE player_id = '__auto__';
SELECT count(*) FROM draft_picks WHERE player_id = '__auto__';
```

Expected count: zero (per the recon report's confirmation that `autoNominate` has no callers). If non-zero, investigate before chunk 11g.6 design proceeds — there's a code path the recon missed.

### §5.6 — Cutover plan

Chunk 11g.6 lands the new engine. v1's `AuctionService` is retained but only called for legacy drafts in progress at cutover; new drafts created after cutover route through the LobbyManager. Once all v1-era drafts complete, `AuctionService` is retired in a chunk 11g.7+ cleanup commit.

---

## §6. Alternatives Considered

### A1 — Separate `auction_events` table (rejected per §3.1)

Considered: maintain v1's separation of concerns by giving auction its own append-only event table, mirroring the shape of `draft_events` but isolated.

Rejected because:

- Conflicts with Principle 3 of the canonical architecture doc (one event log per draft).
- Doubles the recovery code's complexity for organizational tidiness only.
- Cross-format features (commissioner pause, undo, chat) require duplicate definitions.

### A2 — Separate `AuctionLobbyManager` class (rejected per §3.2)

Considered: a sibling class to `LobbyManager` that handles auction-specific message types and state.

Rejected because:

- 80% of `LobbyManager` plumbing is format-agnostic.
- Two classes duplicate plumbing tests.
- Recovery path branches on draft format — branch point in safety-critical code.

### A3 — Keep v1 anti-snipe semantics (rejected per Garrett 2026-04-30)

Considered: preserve v1's hard-reset-to-15s anti-snipe behavior as a deliberate product choice.

Rejected because:

- Garrett ratified industry-standard anti-snipe (incremental extension) on 2026-04-30.
- v1 behavior is unusual and likely surprises users coming from major-platform fantasy.
- Commissioner customization in §4.3 preserves flexibility for leagues that want shorter/different windows.

### A4 — Skip auction in v1, defer to v1.1 (rejected per Garrett 2026-04-30)

Considered: ship snake/linear only at v1 launch; add auction in v1.1 with more design time.

Rejected because:

- Garrett ratified all three formats v1 on 2026-04-30.
- Citrus's competitive positioning vs Yahoo/ESPN/Sleeper benefits from feature parity at launch.
- v1 already has working auction infrastructure; the migration path is incremental, not greenfield.

---

## §7. Consequences

### §7.1 — Positive

- **Race condition closes by construction.** Single-writer queue serialization eliminates the simultaneous-bid race that exists in v1 today.
- **Server-owned timers eliminate browser-driven races.** Nomination close is no longer subject to client-clock skew or per-browser race conditions.
- **Auto-nominate is a real, working feature.** v1's dead `autoNominate` becomes a server-side algorithm with real player resolution.
- **Industry-standard anti-snipe matches user expectations.** Citrus drafts feel familiar to users coming from major-platform fantasy.
- **Polymorphic event log keeps recovery code single-path.** Chunk 11g.7 process bootstrap is one query, format-agnostic.
- **Polling loops eliminated.** Frontend bid-history polling at 5-7s intervals (~120 requests per nomination across 12 clients in v1) replaced by broadcast push. Network load drops; latency improves.

### §7.2 — Negative

- **Chunk 11g.6 scope grows.** The auction state machine adds substantial complexity to chunk 11g.6 on top of snake/linear timer/autopick.
- **Test surface expands meaningfully.** Auction-specific tests, race-condition tests, anti-snipe cascade tests, auto-nominate algorithm tests, all net-new.
- **Auction migration is its own cutover risk.** Dual-mode operation (v1 `AuctionService` for legacy drafts, `LobbyManager` for new drafts) introduces a window where bugs in either path could surface.
- **Anti-snipe behavior change is user-visible.** Communication required at launch.

### §7.3 — Risks

- **Anti-snipe behavior change confuses existing users.** Mitigation: release notes, in-app first-draft notification ("we updated how anti-snipe works — here's why"), commissioner toggle to revert to v1 hard-reset semantics during the transition window if support pressure surfaces. Toggle deprecated after 1-2 seasons.
- **Auto-nominate algorithm fallback chain is incomplete in edge cases.** Mitigation: critical-priority commissioner alert + draft pause if all three fallbacks return nothing (per §4.4).
- **Polymorphic event types make `draft_events` schema harder to reason about.** Mitigation: type-safe access via TypeScript discriminated unions on the event-type catalog in §4.1; partial index for performance.
- **Auction load profile differs from snake/linear and needs explicit testing.** Auction concurrency is bid-driven, not pick-driven: many simultaneous bidders per nomination, bid-rate spikes in the final seconds of bid windows, anti-snipe cascades that extend nominations and extend write pressure on the event log. The 6-week pre-launch load test in `PHASE_4_5_PROJECT_PLAN.md` was scoped against snake/linear assumptions. Mitigation: chunk 11g.11 (load test) must include an auction-specific test profile — minimum 10 simultaneous auctions, ~12 bidders each, bid-rate burst tests in the final 5 seconds of bid windows, anti-snipe cascade depth ≥ 5 extensions. Acceptance gate: zero lost bids, zero state divergence, p95 bid-broadcast fanout ≤ 200ms (matching snake/linear performance mandate).

---

## §8. Open Questions for Zach

These are the items Garrett has flagged for Zach's explicit review before chunk 11g.6 implementation begins. Garrett's recommendations are noted; Zach has authority to confirm, push back, or revise.

- **§3.1 Polymorphic event types vs separate table.** Garrett asked Zach 2026-04-30 to confirm path A aligns with his architecture-doc intent. Awaiting reply.
- **§3.2 Format-aware LobbyManager vs separate class.** Garrett ratified format-aware 2026-04-30. Confirming Zach agrees this aligns with chunk 11g.4 plumbing intent.
- **§3.3 Anti-snipe defaults (30s threshold, 30s extension).** Garrett ratified industry-standard 2026-04-30. Confirming default values are reasonable for NHL fantasy auction culture.
- **§3.4 Nomination window default (60s).** Garrett ratified 2026-04-30. Confirming default is reasonable for NHL fantasy auction culture.
- **§4.2 Auto-nominate fallback algorithm.** Garrett ratified queue → ML → commissioner pre-set 2026-04-30. Confirming all three fallbacks are appropriately scoped, especially commissioner pre-set as the last-resort layer.
- **§4.3 Commissioner-customizable surface.** Confirming the customization surface is comprehensive; flagging anything missing.

---

## §9. Decision History

| Date | Author | Change |
|---|---|---|
| 2026-04-30 | Garrett Storms | Initial draft. Five architectural decisions captured per Garrett's ratifications 2026-04-30. Path A event-sourcing pending Zach's separate confirmation. |
| 2026-04-30 | Garrett Storms | Sharpened §3.1 in response to Zach's pushback on polymorphic events. Clarified that polymorphism is at the envelope level (uniform `draft_events` table structure) not the payload level (JSONB handles type-specific variance). No decision change; reasoning made explicit. |
