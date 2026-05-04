# ADR-003 — Co-Manager Authorization Model

## §1. Status & Authority

**Status:** All architectural decisions ratified by Zach 2026-04-30 in-person meeting. ADR locked.

**Date:** 2026-04-30.

**Authority:** Garrett Storms, founder/CEO. Five architectural decisions ratified by Garrett 2026-04-30. Pending Zach's broader review.

**Supersession convention:** Same append-only convention used in ADR-001 and ADR-002. Any material revision adds a new "Decision History" entry; original wording preserved.

**Companion docs:**
- [`docs/PHASE_4_5_ARCHITECTURE.md`](../PHASE_4_5_ARCHITECTURE.md) — canonical architecture (Zach's design, snake/linear)
- [`docs/PHASE_4_5_ARCHITECTURE_ANSWERS.md`](../PHASE_4_5_ARCHITECTURE_ANSWERS.md) — Citrus-specific answers, ratified 2026-04-30
- [`docs/PHASE_4_5_PROJECT_PLAN.md`](../PHASE_4_5_PROJECT_PLAN.md) — schedule, dependencies, risk register
- [`docs/adr/ADR-001-persistent-node-draft-engine.md`](./ADR-001-persistent-node-draft-engine.md) — original deploy-target ADR
- [`docs/adr/ADR-002-auction-state-machine.md`](./ADR-002-auction-state-machine.md) — auction draft state machine design

---

## §2. Context

Phase 4.5 commits to co-manager support in v1 NHL fantasy season launch (October 2026). The product behavior: each team has exactly one **head manager** with pick/bid/trade/waiver authority, plus zero or more **co-managers** who follow along with full read access but no submit authority. Both head and co-managers receive team notifications.

Reconnaissance pass on Citrus's existing team-membership and authorization infrastructure (2026-04-30) revealed:

- **Single-owner model is deeply embedded.** `teams.owner_id` is a single column referencing `profiles(id)`. Every authorization check in the codebase compares `auth.uid()` (or application-layer `userId`) to `teams.owner_id`.
- **Authorization is asymmetric across formats.** Snake/linear pick submission is enforced inside the `submit_pick_v2` SECURITY DEFINER RPC. Auction bid placement is enforced via RLS policy on `auction_bids`. Two different surfaces, both requiring updates for co-manager support.
- **116 RLS policy occurrences reference `owner_id = auth.uid()`** across 45 migration files. This is the largest cost driver in the migration.
- **Application-layer ownership checks are duplicated.** `TradeService.ts` repeats the `team.owner_id !== userId` pattern 4× across propose/accept/decline/cancel methods. Similar duplication likely exists in `WaiverService.ts` and other services.
- **Co-manager support is fully greenfield.** No existing partial implementation, no abandoned migration, no scaffolded service. Migration designs onto a clean slate.
- **AI teams use `owner_id IS NULL`.** `WaiverService.ts:475-485` has dedicated AI-team detection logic. Co-manager design must explicitly handle AI teams.
- **`UNIQUE(league_id, owner_id)` is a load-bearing constraint** that the rest of the codebase assumes (e.g., `getUserTeamId()` returns one team).

This ADR captures the schema design, authorization centralization strategy, and migration sequencing for adding co-manager support to Citrus's v1 model without breaking the existing single-owner authorization surface.

---

## §3. The Five Architectural Decisions

### §3.1 — Schema shape: `team_managers` join table

**Decision:** Introduce a new `team_managers` table with three columns: `team_id`, `user_id`, `role`. Role is an enum: `head | co`. `UNIQUE(team_id, user_id)` enforces one entry per user per team. `UNIQUE(league_id, user_id)` enforces exclusivity (per §3.4). Replaces `teams.owner_id` over time per the migration plan in §5.

**Schema sketch:**

```sql
CREATE TYPE team_manager_role AS ENUM ('head', 'co');

CREATE TABLE team_managers (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  role team_manager_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (league_id, user_id)
);

CREATE INDEX idx_team_managers_user ON team_managers (user_id, league_id);
CREATE INDEX idx_team_managers_team_role ON team_managers (team_id, role);
```

The `league_id` denormalization on the join table enables the exclusivity constraint and fast user-to-league authorization lookups without joining through `teams`.

**Rationale:**

1. Standard relational pattern for many-to-many with role discrimination. Postgres array columns (`co_manager_ids[]`) compose poorly with RLS and don't enforce uniqueness cleanly.
2. `role` enum (rather than separate boolean columns) makes future role additions cheap (e.g., `observer` for spectators, if ever needed).
3. `(team_id, user_id)` primary key prevents duplicate manager rows by construction.
4. `league_id` denormalization is justified by the exclusivity constraint — without it on the same table, we'd need a deferrable cross-table check.

**Consequences:**

- One row per manager per team. A team with one head + two co-managers has three rows.
- `teams.owner_id` is retained during the migration (per §5.2) for backwards compatibility, then dropped post-cutover (per §5.4).
- The `league_id` denormalization must stay in sync with `teams.league_id`. Trigger-enforced or migration-enforced (chunk 11g.6 implementer's call).

### §3.2 — Authorization centralization: `team_authorized()` SQL function

**Decision:** Introduce a SQL function `team_authorized(p_team_id UUID, p_user_id UUID) RETURNS BOOLEAN` as the single source of truth for "is this user authorized to act on behalf of this team." Used by both SECURITY DEFINER RPCs (snake/linear pick submission) and RLS policies (auction bids, all team-scoped tables).

**Function sketch:**

```sql
CREATE OR REPLACE FUNCTION team_authorized(p_team_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_managers
    WHERE team_id = p_team_id
      AND user_id = p_user_id
      AND role IN ('head', 'co')
  );
$$;
```

A complementary `team_can_submit(p_team_id, p_user_id) RETURNS BOOLEAN` is added for write paths that require head-manager authority specifically (pick submission, bid placement, trade actions). Reads `role = 'head'`.

**Rationale:**

1. Closes the asymmetric-authorization risk by construction. Snake/linear RPCs and auction RLS policies both call into the same function. Adding a manager type or changing the authorization rule happens in exactly one place.
2. `STABLE SECURITY DEFINER` matches the existing `submit_pick_v2` pattern. Postgres optimizer can cache results within a transaction.
3. Two functions, not one. "Authorized to view" (any manager) is different from "authorized to submit" (head only). Separating them at the function level prevents accidental over-permissioning when callers reach for the wrong primitive.

**Consequences:**

- All 116 existing RLS policies referencing `owner_id = auth.uid()` are rewritten to use `team_authorized(team_id, auth.uid())` (read paths) or `team_can_submit(team_id, auth.uid())` (write paths) per the migration plan in §5.
- SECURITY DEFINER RPCs (snake/linear) call the function instead of inlining the ownership check.
- Function changes are atomic: every consumer picks up the new logic on the next call.

### §3.3 — Application-layer centralization: `requireTeamAuthorization()` helper

**Decision:** Introduce a `requireTeamAuthorization(leagueId, userId, teamId, action: 'view' | 'submit')` method on `LeagueMembershipService` (both server and web parallel implementations). All application-layer ownership checks across services route through this helper.

**Method sketch (server-side TypeScript):**

```typescript
async requireTeamAuthorization(
  leagueId: string,
  userId: string,
  teamId: string,
  action: 'view' | 'submit'
): Promise<void> {
  const supabase = this.getSupabaseClient();
  const fnName = action === 'submit' ? 'team_can_submit' : 'team_authorized';
  const { data, error } = await supabase.rpc(fnName, {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error || !data) {
    throw new AppError('FORBIDDEN', 403, `User ${userId} not authorized for team ${teamId} (action=${action})`);
  }
}
```

**Rationale:**

1. Eliminates duplicated `team.owner_id !== userId` checks. `TradeService.ts` has this pattern 4× today; `WaiverService.ts` has at least 1×. Migration risk is "missed site = security hole." Centralizing first (per §5.1) eliminates duplication before the schema migration touches each site.
2. Cache-invalidation hooks colocate with the authorization read. The 30s `LeagueMembershipService` cache must invalidate on manager changes. Routing through one method gives one cache layer to manage.
3. Action discrimination at the call site. Read paths (viewing trade history, watching the draft) call `'view'`. Write paths (proposing trades, placing bids) call `'submit'`. Forces explicit consideration of permission level at every call site rather than implicit permission inheritance.

**Consequences:**

- Refactor PR (Phase 1 of the migration plan) routes all 4× `TradeService.ts` checks plus equivalent sites in `WaiverService.ts` and elsewhere through this helper.
- Server and web implementations stay in lockstep. Both have parallel tests.
- One choke point for future audit: "every team-action authorization goes through this method" is a true statement post-migration.

### §3.4 — Exclusivity enforcement: one role per user per league

**Decision:** A user holds at most one role in any given league. They cannot be the head manager of Team A and a co-manager of Team B in the same league. Enforced at the database level via `UNIQUE(league_id, user_id)` on `team_managers`.

**Rationale:**

1. Simpler invariant for users to reason about. "I have one team in this league" is an easier mental model than "I'm a head manager here, a co-manager there, and I should remember which is which."
2. Matches Yahoo and ESPN behavior. Industry-standard exclusivity.
3. Eliminates edge cases by construction. No need to define "does Team A's co-manager get notifications about Team B's draft picks?" because the situation is unrepresentable.
4. Database-enforced, not application-enforced. A bug in the application layer can't accidentally create a duplicate-role scenario.

**Consequences:**

- Existing `UNIQUE(league_id, owner_id)` on `teams` is preserved during the transition (Phase 2) and effectively superseded by `UNIQUE(league_id, user_id)` on `team_managers` post-migration.
- Invite flow rejects co-manager invitations to users already in the league with any role. UI surfaces a clear error: "User is already a manager of [Team Name] in this league."
- Multi-team scenarios in the same league are explicitly unsupported. If a future product decision wants to allow it (e.g., dynasty leagues with shared management), this ADR is superseded.

### §3.5 — AI team handling: zero rows in `team_managers`

**Decision:** AI teams (currently identified by `teams.owner_id IS NULL`) have zero rows in `team_managers`. The `team_authorized()` and `team_can_submit()` SQL functions short-circuit to `false` for any user when called against an AI team. The existing `WaiverService.ts:475-485` AI-team detection logic is preserved and continues to detect AI teams via the `teams.owner_id IS NULL` check during the transition; post-migration, it migrates to checking `NOT EXISTS (SELECT 1 FROM team_managers WHERE team_id = ?)`.

**Rationale:**

1. Prevents accidental authorization for AI teams. Without explicit handling, a user could theoretically insert themselves into `team_managers` for an AI team via a bug in the invite flow.
2. Preserves existing AI-team semantics. AI teams are managed by the system (autopick logic, scheduled lineup setting). They have no human authorization surface.
3. Migration-friendly. During the dual-mode period (Phase 2), `teams.owner_id IS NULL` and "no rows in `team_managers`" are equivalent — both true for AI teams.

**Consequences:**

- Backfill (per §5.2) only inserts rows for teams where `owner_id IS NOT NULL`. AI teams get zero rows.
- Invite flow validates that the target team has `owner_id IS NOT NULL` (during transition) or `EXISTS` rows in `team_managers` (post-migration) before accepting a co-manager invite.
- If a head manager's profile is deleted (per §4.3 below), the auto-promote-or-AI logic explicitly handles the "team becomes AI" case by deleting all `team_managers` rows for that team.

---

## §4. Product Behavior Specification

### §4.1 — Manager role definitions

| Role | Pick / bid authority | Trade / waiver authority | Settings authority | Notification recipient | Read access |
|---|---|---|---|---|---|
| Head manager | ✅ | ✅ | ✅ | ✅ | ✅ |
| Co-manager | ❌ | ❌ | ❌ | ✅ | ✅ |

Co-managers see everything the head manager sees (full read access including trade history, waiver claims, lineup decisions, draft state, chat). Co-managers cannot submit any team action — submit attempts return a 403 with structured error code `co_manager_no_submit_authority`.

Commissioner role remains independent of head/co-manager roles. A commissioner who is also a team's head manager has both sets of authorities; a commissioner who is a team's co-manager has commissioner authority for league-level actions plus co-manager (read-only) authority for that specific team.

### §4.2 — Lifecycle

**Adding a co-manager:**

1. Head manager OR commissioner initiates an invitation by entering the invitee's email or username.
2. Invite is validated: target user must not already be a manager of any team in this league (exclusivity per §3.4); target team must not be an AI team.
3. Invitee receives a notification with accept/decline. On accept: row inserted in `team_managers` with `role = 'co'`.

**Removing a co-manager:**

1. Head manager OR commissioner OR the co-manager themselves can initiate. On confirmation: row deleted from `team_managers`.

**Promoting co-manager → head manager:**

1. Head manager OR commissioner initiates. On confirmation: existing head's role updates to `co`; promotee's role updates to `head`. Atomic transaction. The team always has exactly one head manager.

**Demoting head manager → co-manager:**

1. Only valid as part of a promotion (above) — a head cannot demote themselves without naming a successor. Commissioner can override to demote a head and leave the team without a head temporarily; team becomes pseudo-AI until a co-manager is promoted or the head re-promotes.

### §4.3 — Edge cases

- **Head manager profile deletion.** If the head manager's profile is deleted (e.g., user closes account), the system auto-promotes the first co-manager (oldest `created_at`) to head. If no co-managers exist, all `team_managers` rows for the team are deleted; the team becomes AI (per existing AI-team semantics). Triggered by an `ON DELETE` cascade on `team_managers.user_id` plus a follow-up procedure that promotes oldest co-manager.
- **Co-manager attempts a submit action.** Returns 403 with structured error: `{code: 'FORBIDDEN', reason: 'co_manager_no_submit_authority', message: 'Only the head manager can submit picks/bids/trades for this team'}`. Frontend renders a contextual error in the relevant UI (e.g., disabled "Submit Pick" button with tooltip explaining why).
- **User invited as co-manager but already a manager in the same league.** Invite is rejected at the database level (`UNIQUE` constraint violation) before any state change. Frontend surfaces: "User is already a manager of [Team Name] in this league."
- **Commissioner is also a head manager of one of the league's teams.** Both roles compose. Commissioner authority for league-level actions; head manager authority for their own team.
- **Migration period: head manager exists in `teams.owner_id` but not yet in `team_managers`.** Per §5.2 backfill, this state is impossible after the schema migration completes — the migration backfills all existing `owner_id` values into `team_managers` atomically.

### §4.4 — Notification fanout (v1: all managers, all events)

Per Garrett's ratification 2026-04-30, v1 fanout policy: **all managers (head + co) receive all team notifications.** No per-event toggles in v1. Implementation: each team-event notification path iterates over `SELECT user_id FROM team_managers WHERE team_id = ?` and writes one notification row per recipient.

Fanout multiplier example: a team with 1 head + 2 co-managers writes 3 notification rows for each team event. Compared to v1 single-owner (1 row per event), this is a 3× write amplification per multi-manager team. Expected impact at v1 launch volume (10k-40k registered users, ~100-300 peak concurrent drafts) is modest but noted as a chunk 11g.11 load-test acceptance criterion: notification fanout for multi-manager teams must complete within 200ms p95 to avoid blocking the broadcast pipeline.

**v1.1 enhancement:** per-event toggle. Co-managers can opt out of specific event types (e.g., "notify me about: trades ✓, waiver claims ✓, autopicks ✗"). Defer to post-launch.

### §4.5 — Frontend implications

UI conditionals shift from `team.owner_id === currentUser.id` (single-owner check) to a role-aware check via the web-side `LeagueMembershipService`:

- `getCurrentUserTeamRole(leagueId): Promise<'head' | 'co' | null>` returns the current user's role in the league, or `null` if not a manager.
- Submit-action UI gates on `role === 'head'` (e.g., draft submit button, trade propose button, waiver claim button).
- Read-action UI gates on `role !== null` (e.g., team dashboard, trade history, draft state visibility).
- "Manage co-managers" UI surface is added: head manager and commissioner see invite/remove/promote actions; co-manager sees self-removal action only.

Files affected (per the recon report): `apps/web/src/services/StormyService.ts`, `apps/web/src/services/LeagueMembershipService.ts`, `apps/web/src/pages/Standings.tsx`, `apps/web/src/pages/PoolPlayoffHub.tsx`, `apps/web/src/pages/Matchup.tsx`, `apps/web/src/pages/LeagueDashboard.tsx`, `apps/web/src/pages/DraftRoom.tsx`, `apps/web/src/components/gm-office/StatsOverviewCards.tsx`, `apps/web/src/components/PoolLeagueHub.tsx`. Each gets touched during Phase 3 of the migration.

---

## §5. Migration Plan from Single-Owner to Co-Manager

Four phases. Each phase is its own PR with its own acceptance gate. Conservative sequencing chosen to minimize migration risk: behavior changes only happen in Phase 3 after the centralization (Phase 1) and schema (Phase 2) are stable.

### §5.1 — Phase 1: Centralization (no behavioral change)

**Goal:** introduce `team_authorized()` SQL function (initially identical to current `owner_id = auth.uid()` check) and `requireTeamAuthorization()` application-layer helper. Refactor all duplicated check sites to use the helpers.

**Schema change:** create `team_authorized(p_team_id, p_user_id)` and `team_can_submit(p_team_id, p_user_id)` SQL functions. Initial implementation reads `teams.owner_id`, **not** `team_managers` (which doesn't exist yet).

**Application-layer changes:**

- Add `requireTeamAuthorization()` to `server/src/services/LeagueMembershipService.ts` and `apps/web/src/services/LeagueMembershipService.ts`.
- Refactor `TradeService.ts` 4× checks (`proposeTrade`, `acceptTrade`, `declineTrade`, `cancelTrade`) to call `requireTeamAuthorization(..., 'submit')`.
- Refactor `WaiverService.ts` ownership checks to use the helper.
- Sweep remaining services (rosters, keepers, bestball, playoffs, lineups) for any inline `team.owner_id !== userId` patterns; route through helper.

**Acceptance gate:**

- Zero behavioral changes (every existing test still passes).
- All grep hits for `owner_id !== userId` and `owner_id != userId` across `server/src/services/` and `apps/web/src/services/` resolve to either (a) helper-routed call sites, or (b) explicitly justified exceptions (rare).
- New tests on `requireTeamAuthorization()` verifying view-vs-submit semantics.

### §5.2 — Phase 2: Schema migration (`team_managers` introduced)

**Goal:** create `team_managers` table, backfill from `teams.owner_id`, update `team_authorized()` to read from `team_managers`. RLS policies and service layer unchanged (they call the helper).

**Schema changes:**

```sql
-- Phase 2 migration
CREATE TYPE team_manager_role AS ENUM ('head', 'co');

CREATE TABLE team_managers (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  role team_manager_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (league_id, user_id)
);

CREATE INDEX idx_team_managers_user ON team_managers (user_id, league_id);
CREATE INDEX idx_team_managers_team_role ON team_managers (team_id, role);

-- Backfill: every team with owner_id IS NOT NULL gets a 'head' row
INSERT INTO team_managers (team_id, user_id, league_id, role)
SELECT id, owner_id, league_id, 'head'::team_manager_role
FROM teams
WHERE owner_id IS NOT NULL;

-- Update team_authorized to read from team_managers
CREATE OR REPLACE FUNCTION team_authorized(p_team_id UUID, p_user_id UUID) ...
```

**Backwards compatibility:** `teams.owner_id` is retained during this phase as a denormalized view of `team_managers` head-role row. A trigger on `team_managers` keeps `teams.owner_id` in sync (when a head row is inserted/updated/deleted, `teams.owner_id` is updated to match). This allows existing code that still reads `teams.owner_id` directly (frontend has not yet migrated) to continue working until Phase 3.

**Acceptance gate:**

- `SELECT count(*) FROM teams WHERE owner_id IS NOT NULL` equals `SELECT count(*) FROM team_managers WHERE role = 'head'` post-backfill.
- Zero head managers without a corresponding `teams.owner_id` (sanity).
- Zero AI teams with rows in `team_managers` (sanity).
- All RLS policies that previously inlined `owner_id = auth.uid()` are rewritten to call `team_authorized(team_id, auth.uid())`. The 116 occurrences identified in the recon are systematically rewritten.
- All existing tests still pass (no behavioral change yet — only the underlying data source for the helper has changed).

### §5.3 — Phase 3: Co-manager features

**Goal:** add invite/accept/remove/promote flows. Frontend role-aware UI. Notification fanout updates.

**Server-side changes:**

- `server/src/routes/teams.ts` (or new `team-managers.ts` route): endpoints for invite, accept, decline, remove, promote.
- Notification fanout: every team-scoped notification write iterates over `team_managers` and writes one row per recipient.

**Frontend changes:** all 9 files identified in the recon update to role-aware checks per §4.5. New "Manage co-managers" UI surface added.

**Acceptance gate:**

- Co-manager invitations work end-to-end (invite → accept → row in `team_managers`).
- Co-manager submit attempts return 403 with the structured error code.
- Notification fanout writes one row per manager for multi-manager teams.
- All exclusivity edge cases (already a manager, AI team invite) handled correctly.
- Auto-promote on head deletion works (per §4.3).
- All existing tests still pass.
- New tests on co-manager flows: invite, accept, decline, remove, promote, exclusivity violations.

### §5.4 — Phase 4: Cleanup

**Goal:** drop `teams.owner_id` after 2-3 weeks of `team_managers` being the authoritative source. Remove the trigger that kept them in sync.

**Schema changes:**

```sql
-- Phase 4 migration (after 2-3 weeks of stable Phase 3)
DROP TRIGGER IF EXISTS sync_teams_owner_id ON team_managers;
ALTER TABLE teams DROP COLUMN owner_id;
```

**Application-layer changes:** any remaining direct reads of `teams.owner_id` (should be zero post-Phase 3, but a final sweep) are routed through the helper.

**Acceptance gate:**

- `teams.owner_id` column dropped.
- All references to `teams.owner_id` in code are gone.
- All tests pass.

### §5.5 — Backfill verification

**Pre-Phase-2 query** (run against staging before migration):

```sql
SELECT count(*) AS teams_with_owner FROM teams WHERE owner_id IS NOT NULL;
SELECT count(*) AS teams_without_owner FROM teams WHERE owner_id IS NULL;
```

**Post-Phase-2 query** (run after backfill):

```sql
SELECT count(*) AS team_managers_head FROM team_managers WHERE role = 'head';
SELECT count(*) AS team_managers_co FROM team_managers WHERE role = 'co';
```

Expected: `teams_with_owner = team_managers_head` (every existing team with an owner gets a head-role row). `team_managers_co` should be 0 post-backfill (no co-managers added until Phase 3 invite flows are live).

If the counts disagree, the migration is incorrect — investigate before proceeding to Phase 3.

### §5.6 — Rollback plan

Each phase is independently reversible during its deployment window:

1. **Phase 1 rollback:** revert the centralization PR. Helpers are removed; inline checks restored.
2. **Phase 2 rollback:** drop `team_managers` table; rewrite `team_authorized()` to use `teams.owner_id`. `teams.owner_id` is retained throughout Phase 2, so this is safe.
3. **Phase 3 rollback:** revert the features PR. Schema (`team_managers`) is retained; frontend reverts to single-owner UI; invite endpoints disabled. `teams.owner_id` is still in sync via the trigger, so reads are unaffected.
4. **Phase 4 rollback:** re-add `teams.owner_id` from `team_managers`. Backfill: `UPDATE teams SET owner_id = (SELECT user_id FROM team_managers WHERE team_id = teams.id AND role = 'head' LIMIT 1)`.

---

## §6. Alternatives Considered

### A1 — Add `co_manager_ids[]` array column to `teams` (rejected per §3.1)

Considered: a denormalized array column on `teams` listing co-manager user IDs.

Rejected because:

- Postgres array columns compose poorly with RLS policies (unnesting is awkward in policy expressions).
- Uniqueness enforcement requires triggers rather than a clean DB constraint.
- Role discrimination (head vs co) requires a separate column or convention; the join-table pattern is cleaner.

### A2 — Skip centralization; do migration in-place across 116 RLS sites (rejected per Garrett 2026-04-30)

Considered: a single-PR migration that touches every `owner_id = auth.uid()` site directly without first introducing the helper functions.

Rejected because:

- "Missed site = security hole." 116 sites is too many to update by hand without missing one.
- The helper-function approach (§3.2) is more maintainable long-term.
- Centralization-first allows incremental verification: Phase 1 changes nothing behaviorally, so any test failure is caught before the schema migration starts.

### A3 — Defer co-manager support to v1.1 (rejected per Zach 2026-04-30)

Considered: ship v1 with single-owner only; add co-manager in v1.1 with more design time.

Rejected because:

- Garrett ratified co-manager support in v1 on 2026-04-30 (per `PHASE_4_5_ARCHITECTURE_ANSWERS.md` Q2.3).
- The migration touches whole-app authorization; doing it once at v1 is cheaper than doing it twice (v1 single-owner → v1.1 co-manager).
- Project plan schedules co-manager work for June 15 - July 5, well before the season opener load test.

### A4 — Allow non-exclusive (head of A, co of B in same league) (rejected per Garrett 2026-04-30)

Considered: a user can be head manager of one team and co-manager of another team in the same league.

Rejected because:

- Garrett ratified exclusivity 2026-04-30.
- Edge cases proliferate (cross-team trade authorization, notification routing, UI ambiguity).
- Yahoo/ESPN industry standard is exclusivity.

### A5 — Explicit commissioner intervention on head deletion (rejected per Garrett 2026-04-30)

Considered: when a head manager's profile is deleted, the team becomes ownerless and stays that way until a commissioner explicitly intervenes to promote a co-manager or assign a new owner.

Rejected because:

- **Less user-friendly.** The team stops functioning until commissioner action — picks/bids/trades all blocked.
- **Commissioner burden scales poorly.** In a league with frequent profile churn, this becomes a recurring task the commissioner must handle.
- **Auto-promote with deterministic tiebreaker is the better default.** "Oldest co-manager wins" matches the common-sense expectation ("the co-manager who joined first becomes the new head") and keeps the team operational.
- **Commissioner override remains available.** If the auto-promotion is wrong (e.g., the commissioner wanted a different co-manager promoted), the Phase 3 promote flow lets the commissioner re-promote a different co-manager.

---

## §7. Consequences

### §7.1 — Positive

- **Authorization model becomes consistent across snake/linear (RPC-enforced) and auction (RLS-enforced).** Both surfaces call the same SQL helper.
- **4× duplicated check pattern in `TradeService.ts` eliminated** during Phase 1 centralization.
- **Security surface centralized.** Future audits and changes happen in one place.
- **AI team handling is explicit.** Authorization helpers short-circuit cleanly.
- **Database-enforced exclusivity.** `UNIQUE(league_id, user_id)` prevents duplicate-role bugs by construction.
- **Co-manager support unblocks v1 launch** per Garrett's ratification.
- **Migration is reversible at every phase** — low operational risk.

### §7.2 — Negative

- **4-phase migration adds calendar time vs a single-PR approach.** Project plan budgets June 15 - July 5 (3 weeks) for the schema + features phases.
- **116 RLS policy rewrites are non-trivial.** Each policy must be verified individually; one mistake is a silent authorization bug.
- **Backfill must be perfect.** A single missed `teams.owner_id` value during backfill is a head manager who can't submit picks.
- **Notification fanout is 3× write amplification per multi-manager team.** Modest impact at v1 volume but flagged as chunk 11g.11 load-test criterion.
- **Test surface expansion.** Net-new tests for invite/accept/decline/remove/promote flows, exclusivity violations, AI team handling, auto-promote on head deletion. Estimated ~30-50 new tests across server + web.

### §7.3 — Risks

- **Missed call site during Phase 1 centralization.** Mitigation: greppable check pre-merge (`grep -r "owner_id" server/src/services/` produces zero hits except in `LeagueMembershipService.ts`); audit pass before Phase 2 begins.
- **`team_managers` cache invalidation edge cases.** The 30s `LeagueMembershipService` cache must invalidate on manager-row changes. Mitigation: explicit `LeagueMembershipService.clearCache(leagueId, userId)` calls on every `team_managers` mutation; tested per cache scenario.
- **Notification fanout amplification under load.** Mitigation: chunk 11g.11 load test must include multi-manager teams (≥1 team with 1 head + 2 co-managers per simulated league). Acceptance gate: p95 fanout latency ≤ 200ms (matching auction load-test mandate in ADR-002 §7.3).
- **Auto-promote tiebreaker non-determinism if multiple co-managers have identical `created_at` timestamps.** Mitigation: `ORDER BY created_at, user_id` adds a secondary deterministic tiebreaker (lexically lowest `user_id` wins).
- **Backwards-incompatible front-end deployment window.** During Phase 2, the trigger keeps `teams.owner_id` in sync so older frontend versions (cached browser, mobile app on slow update cycle) continue working. Mitigation: Phase 4 (drop column) is delayed 2-3 weeks after Phase 3 ships, giving the frontend ample time to fully roll out.

---

## §8. Open Questions for Zach

Garrett's recommendations are noted; Zach has authority to confirm, push back, or revise.

- **§3.1 `team_managers` schema shape (join table with role enum).** ✅ Ratified by Zach 2026-04-30 in-person meeting. Join table with `role` enum, `(team_id, user_id)` PK, `UNIQUE(league_id, user_id)`, denormalized `league_id` for exclusivity enforcement.
- **§3.2 `team_authorized()` SQL helper as single source of truth.** ✅ Ratified by Zach 2026-04-30 in-person meeting. `STABLE SECURITY DEFINER` two-function split (`team_authorized` for view paths, `team_can_submit` for head-only submit paths).
- **§3.3 `requireTeamAuthorization()` application-layer helper.** ✅ Ratified by Zach 2026-04-30 in-person meeting. `'view' | 'submit'` action discrimination at the call-site level forces explicit permission consideration.
- **§3.4 Exclusivity enforcement.** ✅ Ratified by Zach 2026-04-30 in-person meeting. Database-level `UNIQUE(league_id, user_id)` constraint; one role per user per league.
- **§3.5 AI team handling.** ✅ Ratified by Zach 2026-04-30 in-person meeting. AI teams have zero rows in `team_managers`; authorization helpers short-circuit to `false`.
- **§5 Four-phase migration sequencing (centralize → schema → features → cleanup).** ✅ Ratified by Zach 2026-04-30 in-person meeting. Conservative phasing keeps each phase independently reversible.
- **§4.3 Auto-promote oldest co-manager on head deletion.** ✅ Ratified by Zach 2026-04-30 in-person meeting. Auto-promote with `ORDER BY created_at, user_id` deterministic tiebreaker; commissioner override available via Phase 3 promote flow.
- **§4.4 Notification fanout policy v1 (all managers, all events).** ✅ Ratified by Zach 2026-04-30 in-person meeting. v1 simplicity (all managers, all events); v1.1 adds per-event toggles.

---

## §9. Decision History

| Date | Author | Change |
|---|---|---|
| 2026-04-30 | Garrett Storms | Initial draft. Five architectural decisions captured per Garrett's ratifications 2026-04-30. Pending Zach's broader review. |
| 2026-04-30 | Zach Drever | Verbally ratified all five architectural decisions (§3.1 `team_managers` schema, §3.2 `team_authorized()` SQL helper, §3.3 `requireTeamAuthorization()` application helper, §3.4 exclusivity enforcement, §3.5 AI team handling) plus 4-phase migration plan, auto-promote on head deletion, and v1 notification fanout policy during in-person meeting with Garrett. ADR-003 fully locked. |
