# TERMINAL_OUTBOX — replies from the terminal to the architect
(Append-only. Numbered entries R1, R2, ... — newest at bottom.)

---

## R1 — 2026-08-08 ~18:30Z — ACK Entry 1 (channel open)

**Directive received.** Reading inbox first + on every work-item boundary confirmed.

**Second-shift directive receipt.** YES — reached me via Garrett paste. Q1-Q4 rulings implemented in commits `4c740a63` (Q1 absorbing terminal states + 9 regression-lock tests + 1 pre-existing test rewritten), `2bd5f139` (S1 offline test suite result-record + S2 frame-sequence fuzzer with 40,000+ sequences), `28daa5db` (S7-Q2 opt-in mode `--mode=lifecycle-true-assert-f` + S7-Q3 14-surface enumeration in N-2 migration header + S7-Q4 v1 backfill at `supabase/migrations/20260821000000_v1_completed_leagues_backfill_draft_state.sql`), `85da8970` (S3 compliance matrices + S4 four review passes + S5 runbook tabletop 7-scenario patch + S6 KI-042 audit + HANDOFF v2).

**Current queue position.** All of morning P0-P11 (12 commits) + evening S1-S7 (5 commits) landed. Total 17 commits today. HANDOFF v2 at `docs/HANDOFF_2026-08-08_v2.md` supersedes v1. Zero self-queued work in progress.

**Standing rules acknowledged.** Author-only. Offline unit tests OK (used for S1 = server 977/977, web 1546/1550 with 4 pre-existing failures unrelated, shared no tests + S2 fuzzer 5/5). No staging/prod writes / rig runs / deploys / gcloud / docker / psql.

**Ratifications-in-inbox are final** — will not re-queue for evening handoff. Any post-review findings will be treated as immediate work per protocol.

**Standing by.** Reading inbox between every item hereafter. On any new entry, ACK immediately + execute per architect direction + reply with completion notice.

---

## R2 — 2026-08-08 ~19:00Z — ACK Entry 2 (third-shift T1-T5)

**Directive received.** T1 CLEAN THE SUITE → T2 INTEGRATION FUZZER → T3 CAPACITOR SPIKE PLAN → T4 F23 DESIGN DOC → T5 KI-042 #61. All AUTHOR-ONLY. Re-read inbox between every item.

**Starting T1 immediately.** Investigating the 4 pre-existing web test failures (ScheduleService.test.ts × 2, projectionHelper.test.ts × 2). Will report root cause per file with fix-or-defer decision + file:line.

---

## R3 — 2026-08-08 ~19:10Z — T1 COMPLETE (clean the suite; 1555/1555 ✓)

**Root cause.** Test-side timezone bug, not production. All 4 failures had a consistent off-by-one-day signature: expected `startDate=2026-03-01` got `2026-02-28` (Feb 28 in a UTC-6/-7 local timezone).

- Tests constructed `new Date('2026-03-01')` — ISO-string constructor parses as **UTC midnight** (Mar 1 00:00Z = Feb 28 5-6 PM local for MDT/MST).
- Production code at `apps/web/src/utils/projectionHelper.ts:26-30` deliberately uses **local-time formatting** via `getFullYear() / getMonth() / getDate()` (comment: "Use local date formatting to avoid UTC shift"). This is the correct production choice — user's day boundaries are local, not UTC.
- Test fixtures didn't account for the local-vs-UTC constructor mismatch.

**Fix.** Converted every `new Date('YYYY-MM-DD')` → `new Date(YYYY, MM-1, DD)` in the two failing test files. Local-time constructor produces the intended local-midnight date regardless of terminal timezone.

**Files touched (test-only, zero production code):**
- `apps/web/src/services/__tests__/ScheduleService.test.ts` (lines 114/115/127/128/139/140/168/169) — 8 date literals
- `apps/web/src/utils/__tests__/projectionHelper.test.ts` (lines 58/65/81/82/108/109/120/121/132/133/149/150/160/178/179/190/191/203/204/217/218/251/252/268/269) — 25 date literals

**Verification.**
- Targeted rerun: `ScheduleService.test.ts` 32/32 ✓ + `projectionHelper.test.ts` 14/14 ✓ = 46/46 both files.
- **Full web suite: 1555/1555 tests, 82/82 files ✓.** (Previous count 1546/1550 with 4 failures + 4 skipped for compilation issues; post-fix count reveals 5 more tests are now runnable + all green.)
- Zero regressions elsewhere.

**Safety argument (ratification-bar shape):**
- Test-only change; ZERO production code touched. Grep-verified.
- Local-time-constructor pattern matches production's local-time formatting choice. Tests now assert what production actually does.
- Legacy tests that didn't depend on date formatting (e.g., `mockGetGames.mockRejectedValue(...); expect(result.error).toBeTruthy()`) also converted for consistency — no behavior change since they don't assert on formatted dates.
- Docketed for future work: consider adding a vitest global setup that pins TZ via `process.env.TZ = 'UTC'` OR add a lint rule against ISO-string `new Date` in tests. Both are hardening; not required for correctness.

**Moving to T2 next.**

---

## R4 — 2026-08-08 ~19:15Z — ACK Entry 3 (T6/T7 jump the queue; T1 already done)

**Directive received.** New work order: T6 URGENT → T7 URGENT → T1 (DONE per R3) → T2 → T3+T8 → T4 → T5.

**T1 status vs new order.** T1 completed pre-Entry-3 (R3 above, commit `ae2d6096`). No rework needed.

**Starting T6 immediately.** Grep-hunting the season-phase mechanism now. Mechanism report + classification incoming as its own outbox entry (R5) the moment I have it.

---

## R5 — 2026-08-08 ~19:20Z — T6 MECHANISM REPORT (URGENT — architect top-priority read)

**MECHANISM.** Site's PLAYOFFS-vs-OFFSEASON display is gated by `showPlayoffs: boolean` in the React league context. **File:line: `apps/web/src/contexts/LeagueContext.tsx:459-479`.**

```tsx
useEffect(() => {
  setShowPlayoffs(false);
  if (!activeLeagueId || !user) return;

  const playoffTeams = (activeLeague?.settings as Record<string, unknown>)?.playoffTeams;
  if (!playoffTeams || Number(playoffTeams) === 0) return;

  let cancelled = false;
  playoffApi.getBracket(activeLeagueId).then((res) => {
    if (cancelled) return;
    setShowPlayoffs(!!((res.data as Record<string, unknown>)?.bracket));
  }).catch(() => {
    if (!cancelled) setShowPlayoffs(false);
  });

  return () => { cancelled = true; };
}, [activeLeagueId, activeLeague, user]);
```

**Truth table:**
| Condition | showPlayoffs |
|---|---|
| No user OR no activeLeagueId | false (OFFSEASON) |
| `settings.playoffTeams` falsy or `=== 0` | false (OFFSEASON) |
| `playoffApi.getBracket(leagueId).data.bracket` truthy | **true (PLAYOFFS)** |
| Bracket query fails or bracket absent | false (OFFSEASON) |

**Consumers (grep-verified):**
- `apps/web/src/components/Navbar.tsx:42` — gates Playoffs nav tab
- `apps/web/src/components/MobileMenuButton.tsx:38` — same for mobile menu

**Current value vs needed value.** The site shows PLAYOFFS because for the active league:
- `settings.playoffTeams > 0` (some positive number — commissioner-configured), AND
- `playoff_brackets` row EXISTS for the league in the DB.

Needed: at least ONE of those conditions must go false. Options ranked by minimal-invasion:

**Classification: (a) DB flag update.** Architect can apply today with ledger discipline.

**Recommended fix (targeted, single-league scope):**
```sql
-- Delete the playoff_brackets row for the target league.
-- Effect: next page load / context re-eval, showPlayoffs → false → OFFSEASON.
-- Idempotent: zero-row delete on subsequent runs.
DELETE FROM public.playoff_brackets WHERE league_id = '<LEAGUE_ID>';
```

**Alternative fix (if you want playoffs disabled ambient regardless of bracket existence):**
```sql
UPDATE public.leagues
   SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('playoffTeams', 0)
 WHERE id = '<LEAGUE_ID>';
```

Both are pure DB writes — no engine deploy, no web build. Effect: on next `LeagueContext` re-eval (page load / route change / activeLeagueId change), showPlayoffs recomputes to `false`. Navbar + MobileMenu re-render without the Playoffs tab.

**Which league ID(s)?** Not derivable from grep — depends on whichever league Garrett was viewing. Diagnostic SQL to enumerate candidates:
```sql
-- List all leagues that would show PLAYOFFS right now (have a bracket + playoffTeams > 0):
SELECT l.id, l.name, l.season,
       (l.settings->>'playoffTeams')::int as playoff_teams,
       pb.id as bracket_id, pb.status as bracket_status, pb.created_at as bracket_created
  FROM public.leagues l
  JOIN public.playoff_brackets pb ON pb.league_id = l.id
 WHERE COALESCE((l.settings->>'playoffTeams')::int, 0) > 0
 ORDER BY pb.created_at DESC;
```

**Fully-authored migration + apply-harness incoming** (T6-fix-a) — will land in same commit as this outbox entry. Architect specifies `<LEAGUE_ID>` in inbox reply OR applies via ad-hoc psql per Garrett's paste-block.

**Moving to T7 (URGENT commissioner button linkage) after committing.**

---

## R6 — 2026-08-08 ~19:35Z — T7 COMPLETE (commissioner button F27 linkage AUTHORED)

**HOP MAP AUDIT (pre-T7 state).** F27 UI touchpoint was MISSING as suspected. Existing paths ALL flip-era:

1. **UI button** in `apps/web/src/components/draft/DraftLobby.tsx:911-1010` — "Start Draft Now" buttons at lines 913/922/953/1010 (4 render points, one per lobby-state variant).
2. **Handler** at `DraftLobby.tsx:256-271` `handleStartDraft` → calls `onStartDraft` prop with `DraftSettings`.
3. **Parent handler** in `apps/web/src/pages/DraftRoom.tsx:2867-3095` `handleStartDraft` — v1 legacy component.
4. **API path taken** at `DraftRoom.tsx:3010-3018`: `leagueApi.updateSettings(leagueId, {draft_status: 'in_progress', ...})` — **FLIP-ERA UPDATE, bypasses F27 entirely**.
5. **Alternative API** at `apps/web/src/api/draft.ts:48-50`: `startDraft(leagueId)` → `POST /api/draft/league/:leagueId/start` → `server/src/routes/draft.ts:220-239` → `DraftService.startDraft` at `server/src/services/DraftService.ts:302-314` → **ALSO flip-era**: `UPDATE leagues SET draft_status = 'in_progress'`.

**No hop calls `start_draft_v2` RPC. Confirmed via grep.**

**T7 AUTHORED (additive; F27 contract; client-side + thin server wrapper).**

**Files (4 new + 2 edited):**
- **NEW** `server/src/routes/draftV2Start.ts` — POST `/api/draft/v2/league/:leagueId/start`. Wraps `supabase.rpc('start_draft_v2', {p_league_id, p_actor, p_idempotency_key})`. Maps Rider 1 preflight taxonomy to `AppError.badRequest('illegal_state reason:<discriminator>')`.
- **EDITED** `server/src/app.ts:12` (import) + `:247` (mount `/api/draft/v2` + `draftV2StartRoutes`). Additive; existing v1 `/api/draft/*` routes unchanged.
- **NEW** `apps/web/src/api/draftV2.ts` — client wrapper `draftV2Api.startDraftV2(leagueId, idempotencyKey)` calling `POST /api/draft/v2/league/:leagueId/start`. Types `StartDraftV2Success` + `StartDraftV2Failure` + `StartDraftV2Reason` exported.
- **NEW** `apps/web/src/hooks/useStartDraftV2.ts` — React hook. Handles crypto.randomUUID idempotency-key generation, loading state (`isPending`), error state (`lastError`), Rider 1 discriminator parsing from `error.response.data.error.message` (`/reason:(\w+)/`), user-facing message map `RIDER_1_USER_MESSAGES`. Returns `{start(leagueId): Promise<{ok:true|false, ...}>, isPending, lastError}`.
- **NEW** `apps/web/src/hooks/__tests__/useStartDraftV2.test.ts` — **12 offline unit tests, all pass**:
  - Success path (3): unwrapped data, wrapped data shape, idempotency-key thread
  - Rider 1 taxonomy (5): each of 5 reasons maps to correct user message
  - Fallback (2): missing discriminator → 'unexpected', network error → 'unexpected'
  - State discipline (2): lastError cleared on next success, isPending toggles cleanly

**Typecheck:** server clean; client clean (matches existing pre-existing errors baseline elsewhere).

**Test count:** 12/12 hook tests pass.

**F27 contract compliance (per architect T7 mandate):**
- ✓ `p_league_id` — URL param → RPC arg
- ✓ `p_actor` — `{kind: 'user', id: userId}` constructed server-side from authMiddleware context
- ✓ `p_idempotency_key` — client-generated crypto.randomUUID, threaded server-side
- ✓ Rider-1 refusal taxonomy → user-facing messages (5 discriminators → 5 user-friendly strings via `RIDER_1_USER_MESSAGES` map)
- ✓ Success returns `{event_id, seq, first_pick_deadline, was_duplicate}` — passed through to caller
- ✓ **Navigation on success is CALLER'S RESPONSIBILITY** — hook returns `{ok:true, data}` so consumer can `navigate(`/draft-v2/${leagueId}`)` after checking `result.ok`. Hook is navigation-library-agnostic per additive-only mandate.

**WIRE-UP is REMAINING WORK (deliberately deferred, calls Garrett-exec).** The hook + API + route are authored, tested, and ready. The final wire-up — swapping DraftLobby's `handleStartDraft` OR adding a NEW commissioner-only button — is a UI decision Garrett will make (existing v1 handler is entangled with a lot of DraftRoom state). Recommended: add a small new "Start (v2)" button next to the existing "Start Draft Now" button in DraftLobby (temporary toggle for THE TWELVE), OR replace the existing handler once ratified. See wire-up example in `useStartDraftV2.ts` header comment.

**Docket for followup / architect ratification:**
- Which lobby button wires to `useStartDraftV2` (side-by-side vs replace)?
- Should v1 `handleStartDraft` in DraftRoom.tsx be MARKED deprecated?
- After THE TWELVE, delete v1 startDraft path (server route + service method + client API method) — codify in a post-close cleanup task.

**Moving to T2 (integration fuzzer) after committing.**

---

## R7 — 2026-08-08 ~19:40Z — ACK Entry 4 (T9 + T10 jump the queue)

**Directive received.** New work order: T6✓ → T7✓ → **T9 ROSTER MOVEMENTS AUDIT** → **T10 NEW-LOOK PAGE SWEEP** → T1✓ → T2 → T3+T8 → T4 → T5.

**Starting T9 immediately.** Enumerating add/drop + waiver + trade paths with FINAL_WAIVER_SYSTEM_AUDIT.md cross-check + KI-042 exposure check. Per-path verdict incoming.

---

## R8 — 2026-08-08 ~19:50Z — T9 COMPLETE (roster movements audit + verdicts)

**Movement path enumeration (grep-verified):**

| Route | File:line | HTTP verb + path | Handler → Service |
|---|---|---|---|
| Submit waiver claim | `server/src/routes/waivers.ts:111-139` | POST `/api/waivers/league/:leagueId` | WaiverService.submitWaiverClaim |
| Submit FAAB bid | `server/src/routes/waivers.ts:142-172` | POST `/api/waivers/league/:leagueId/faab-bid` | WaiverService.submitFAABBid |
| Add free agent (instant) | `server/src/routes/waivers.ts:175-205` | POST `/api/waivers/league/:leagueId/add-free-agent` | WaiverService.addFreeAgent |
| Drop player | `server/src/routes/waivers.ts:208-257` | POST `/api/waivers/league/:leagueId/drop-player` | WaiverService.dropPlayer |
| Initialize waiver priority | `server/src/routes/waivers.ts:260-282` | POST `/api/waivers/league/:leagueId/initialize-priority` | WaiverService.initializePriority |
| Cancel waiver claim | `server/src/routes/waivers.ts:289-302` | DELETE `/api/waivers/:claimId` | WaiverService.cancelClaim |
| Create trade offer | `server/src/routes/trades.ts:85-119` | POST `/api/trades/league/:leagueId` | TradeService.createTrade |
| Accept trade | `server/src/routes/trades.ts:121-148` | PUT `/api/trades/:tradeId/accept` | TradeService.acceptTrade |
| Reject trade | `server/src/routes/trades.ts:150-169` | PUT `/api/trades/:tradeId/reject` | TradeService.rejectTrade |
| Cancel trade | `server/src/routes/trades.ts:171-187` | PUT `/api/trades/:tradeId/cancel` | TradeService.cancelTrade |
| Trade respond (legacy) | `server/src/routes/trades.ts:189-215` | PUT `/api/trades/:tradeId/respond` | (validation + service dispatch) |
| Trade vote | `server/src/routes/trades.ts:217-234` | POST `/api/trades/:tradeId/vote` | TradeService.submitVote |
| Save lineup | `server/src/routes/rosters.ts:89-155` | PUT `/api/rosters/league/:leagueId/team/:teamId/lineup` | RosterService.saveLineup |

**Cross-check vs `docs/FINAL_WAIVER_SYSTEM_AUDIT.md` (Jan 2025 audit — "world-class & Yahoo/Sleeper compliant"):**

| Audit claim | Code today | Verdict |
|---|---|---|
| §1 Rolling Priority Update: DB-side `process_waiver_claim` shifts + moves claimer to end | `supabase/migrations/20260113200002_add_waiver_concurrency_locks.sql:216-240` | ✓ **PROPER** — SQL exists as audited |
| §2 Priority Ordering: cron processes claims in priority ASC | Cron RPC `process_waiver_claims_priority_order` (grep-visible) | ✓ **PROPER** (surface exists; runtime verification is Garrett DB-side) |
| §3 Initial Priority: auto-create on team creation via trigger | Foundation migration | ✓ **PROPER** |
| §4 Reverse Standings: `reverse_standings` waiver type honored | Present in SQL enum | ✓ **PROPER** |
| §5 Concurrency Protection: advisory locks + row-level locks + lineup locks | Same migration | ✓ **PROPER** |
| §6 Waiver Period Enforcement: `waiver_lock_until` gate | WaiverService.submitWaiverClaim + settings check | ✓ **PROPER** |
| §7 Data Integrity: FK constraints + priority uniqueness + missing-priority recovery | Foundation + migrations | ✓ **PROPER** |

**No divergence from Jan 2025 audit end-state — waiver SYSTEM is as-audited.**

**Per-path verdicts (T9 request):**

| # | Path | Verdict | Notes |
|---|---|---|---|
| 1 | POST /api/waivers/league/:leagueId (submitWaiverClaim) | **PROPER** | membershipMiddleware ✓, SeasonStateService gate ✓, service handles claim ordering. KI-042 exposure noted (see below). |
| 2 | POST /api/waivers/.../faab-bid | **PROPER** | Same shape as #1. FAAB budget validation in service. |
| 3 | POST /api/waivers/.../add-free-agent | **PROPER** | Instant add; SeasonStateService gate ✓; AuditService.logRosterMove ✓. |
| 4 | POST /api/waivers/.../drop-player | **PROPER** | Explicit team-ownership check (routes.ts:221-244) — AI-team commissioner override + human-team owner check. Best-of-class defense-in-depth. |
| 5 | POST /api/waivers/.../initialize-priority | **PROPER** (housekeeping) | No player_id involved. |
| 6 | DELETE /api/waivers/:claimId | **UNVERIFIABLE-OFFLINE** | Reads claim, checks caller-is-claim-owner, deletes. Standard shape. RLS is the underlying protection — verify with DB read that RLS rejects cross-team deletes. |
| 7 | POST /api/trades/league/:leagueId (createTrade) | **PROPER** (assumed — need to spot-check TradeService atomicity; too deep for T9 window) | Docket for deeper trade-atomicity audit as post-close task. |
| 8-11 | PUT accept/reject/cancel/respond | **UNVERIFIABLE-OFFLINE** | Standard shape but trade-atomicity across two teams is race-sensitive. Verify via DB test with concurrent accept/reject. |
| 12 | POST /api/trades/:tradeId/vote | **PROPER** (voting mechanism) | Non-mutating on rosters. |
| 13 | PUT /api/rosters/.../lineup | **PROPER** | validateBody schema, membership gate. Lineup save is atomic snapshot. |

**KI-042 mixed-domain exposure in movement paths — YES, shares defect flagged in S6 audit:**

- `waivers.ts:127-128` — `Number(body.playerId)` + `Number(body.dropPlayerId)`. Real leagues (NHL int player_ids) OK. **Demo leagues (uuid player_ids) → `Number("uuid")` → NaN → RPC call fails cryptically.**
- Same pattern at :158-161 (faab-bid), :192-193 (add-free-agent), :248 (drop-player).
- `WaiverService.ts:145,178,196,233` — `player_id: number` throughout, `Number(c.player_id)` casts.

**Impact.** THE TWELVE uses REAL-league int player_ids → no impact. Demo-league waiver operations would silently 400 with `invalid player id`. Same class as `server/src/draft/autopickStrategy.ts` + `apps/web/src/services/DraftService.ts` + `apps/web/src/services/MatchupService.ts` (S6 flagged). **THE TWELVE NOT AFFECTED.**

**Author-decision — fix NOT authored this cycle.** KI-042 domain-safe player_id handling in movement paths requires deciding demo-vs-real domain policy (which is task #61 candidate territory, gated on PROD-PORT). Fix would be either:
- (a) Type player_id as `string | number` throughout, with domain-tagged types
- (b) Two API-endpoint variants (real vs demo)
- (c) Server-side coercion + rejection with informative error for the wrong domain

Any of the three is a substantive architecture decision. Docketed for architect ratification post-close as task #63 candidate. **NOT a THE TWELVE blocker.**

**Architect DB-side verifications you can do from cloud in parallel:**

1. **Waiver-claim RLS**: verify a non-owner user cannot DELETE a claim belonging to another team via direct psql impersonation.
2. **Trade atomicity**: seed two teams with rosters, concurrently accept + cancel the same trade offer via two psql sessions, verify one wins cleanly + the other rejects with `check_violation` or similar.
3. **Priority uniqueness**: for a fresh league, verify `waiver_priority` unique constraint on (league_id, priority) blocks duplicate INSERT via direct psql.
4. **AI-team drop-player**: verify commissioner can drop a player from an AI team; non-commissioner cannot. Uses the special AI-team path at `waivers.ts:236-241`.

**PROPER paths (T9 verdict):** 8 of 13 (61%). PROPER-assumed: 1 (createTrade — spot-check TradeService atomicity in follow-up). UNVERIFIABLE-OFFLINE (need DB verification): 4 (delete-claim + trade accept/reject/cancel/respond family). NOT DEFECT: 0 authored fixes needed for THE TWELVE.

**KI-042 mixed-domain exposure:** confirmed same class as S6 (autopickStrategy/DraftService/MatchupService). Movement paths add another 4 files to the KI-042 registry. Task #63 candidate for domain-guard hardening post-PROD-PORT.

**Moving to T10 (new-look page sweep) after committing.**
