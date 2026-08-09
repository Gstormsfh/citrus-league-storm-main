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

---

## R9 — 2026-08-08 ~20:05Z — T10 + Entry 5 COMPLETE (new-look page sweep + caricature inventory)

**NEW-LOOK MARKER (concrete).** The Citrus 2.0 design system lives at `apps/web/src/components/citrus2/`. Marker components: `DarkLayout`, `CitrusCard`, `CitrusButton`, `MascotAvatar`, `MascotCard`, `MascotScene`, `MascotPeek`, `HeroCardStack`, `SectionHeader`, `LiveGameTile`, plus tokens.ts (C2 palette: `bg:#0F1F15`, `orange:#FF6B1A`, `sage:#84A57D`, `cream:#FFF8F0`). Style profile: dark forest background, hockey-first, Citrus Squad mascots. **A page is NEW-LOOK if it imports from `@/components/citrus2` OR uses citrus2 components directly.** Confirmed via `Index.tsx:3` docstring: "The legacy pastel homepage components live unchanged in `apps/web/src/components/` until every page has migrated to citrus2."

**Page-by-page classification** (62 pages total, grep-verified via `grep -rln "citrus2" apps/web/src/pages/`):

| Category | Count | Pages |
|---|---|---|
| **NEW-LOOK** (imports citrus2) | 42 | About, Admin, ArmchairGM, Auth, AuthCallback, Blog, Careers, Contact, CreateLeague, DraftRoom, Features, FreeAgents, GMOffice, Guides, Index, LeagueDashboard, Matchup, NHLPlayoffBracket, News, NotFound, OtherTeam, PlayoffBracket, Podcasts, PoolConfidence, PoolPickem, PoolSurvivor, PreviewClone, Pricing, Privacy, Profile, ProfileSetup, ResetPassword, Roster, ScheduleManager, Standings, StormyAssistant, TeamAnalytics, Terms, TradeAnalyzer, VerifyEmail, Waitlist, WaiverWire |
| **LEGACY — Preview scratchpad (out of T10 scope)** | 12 | PreviewAlmanac, PreviewArena, PreviewBoards, PreviewIndex, PreviewMockups, PreviewPress, PreviewPulse, PreviewRedesign, PreviewRink, PreviewSquad, PreviewStadium, PreviewSunlight |
| **LEGACY — Playoff surface (out of T10 scope)** | 4 | PoolPlayoffBracket, PoolPlayoffConfidence, PoolPlayoffHub, PoolPlayoffRoster |
| **LEGACY — Redirect stub** | 1 | Settings.tsx (11 lines, `<Navigate to="/profile?tab=settings">` — target IS new-look) |
| **LEGACY — Draft-flow surface (special case)** | 1 | DraftRoomV2.tsx (921 lines) — LIVE draft room, not regular-season/offseason. Deferring per T10 scope. |

**T10 SCOPE FINDING (per architect's "regular-season pages and offseason pages"):**

**Every page on regular-season and offseason surfaces is ALREADY NEW-LOOK.** Zero conversion authoring required within T10's stated scope. Preview* is scratchpad (not routed for production users). PoolPlayoff* is playoff-surface (out of scope). Settings.tsx redirects to Profile (which IS new-look). DraftRoomV2 is draft-flow (not regular-season/offseason — separate F28 client work covers its display polish).

**Optional MIXED spot-check (out of scope but useful for architect):** grep only detects "imports citrus2" as boolean. A NEW-LOOK-listed page might STILL contain legacy component usages surrounding a single citrus2 import. Full MIXED audit would require per-page component-tree walk (est. ~4hr for 42 pages). Docket task #64 candidate. NOT a THE TWELVE blocker.

---

## R10 — 2026-08-08 ~20:05Z — Entry 5 CARICATURE INVENTORY

**Location:** `apps/web/public/mascots/` (16 files) + `apps/web/public/mockups/` (11 files, but mockups are NOT caricatures — see below).

**Caricature set (canonical, style-anchor for future generation):**

| Filename | Type | Character/Theme | Format |
|---|---|---|---|
| mascot-kiwi.webp | mascot | Kiwi (base) | webp |
| mascot-kiwi-faab.jpg | mascot | Kiwi in FAAB-bidding pose | **jpg (legacy outlier)** |
| mascot-lemon.webp | mascot | Lemon | webp |
| mascot-pineapple.webp | mascot | Pineapple | webp |
| mascot-stormy.webp | mascot | Stormy (Assistant GM) | webp |
| scene-confidence.webp | scene | Pool Confidence | webp |
| scene-cup.webp | scene | Championship / trophy | webp |
| scene-draft.webp | scene | Draft | webp |
| scene-livescoring.webp | scene | Live scoring / matchup | webp |
| scene-pickem.webp | scene | Pool Pickem | webp |
| scene-squad.webp | scene | Squad / roster | webp |
| scene-standings.webp | scene | Standings | webp |
| scene-stormy-ai.webp | scene | Stormy AI (chat) | webp |
| scene-stormy-welcome.webp | scene | Stormy welcome / onboarding | webp |
| scene-survivor.webp | scene | Pool Survivor | webp |
| scene-xg-model.webp | scene | xG model / projections | webp |

**Filename convention:** `mascot-<name>-<optional-action>.webp` for characters; `scene-<theme>.webp` for compositions. All new art SHOULD be `.webp` (mascot-kiwi-faab.jpg is a legacy outlier — docket for consistency).

**Non-caricature imagery flags:**

- **`apps/web/public/mockups/*.jpg` (11 files)** — hero mockups used ONLY by Preview* scratchpad pages. Not on regular-season/offseason surfaces. Docket for removal if Preview* pages retire.
- **`apps/web/public/loading-citrus.png`** — load screen. Not a page image; a citrus-branded loading indicator. Consider caricature-style replacement (docket, low priority).
- **`apps/web/public/og-image.png`** — Open Graph social-share artifact. Not user-facing UI; leave as-is.
- **`apps/web/public/placeholder.svg`** — shadcn/vite scaffold. Unused in production; leave as-is.

**Regular-season + offseason page non-caricature scan:** ZERO non-caricature images detected via grep of `mockups/`, `/loading-citrus`, `/placeholder.svg`, `/og-image` in `apps/web/src/pages/*.tsx` (excluding Preview*) or `apps/web/src/components/**`. **Every image visible on RS/offseason surfaces IS a caricature.**

**Consistency treatment:** existing pages consume caricatures via `MascotAvatar` / `MascotCard` / `MascotScene` / `MascotPeek` components from `apps/web/src/components/citrus2/`. These wrap the `public/mascots/*.webp` files with consistent sizing/framing. **Uniform treatment already in place.**

**NEW ART SLOTS REQUIRED:** none surfaced by the audit. Existing 16-asset set covers identified regular-season/offseason needs.

**`docs/ART_GENERATION_QUEUE.md` authored** (new file) as scaffold — style profile documented, filename convention codified, empty queue with entry template. Ready for any post-Garrett-review additions.

---

## R11 — 2026-08-08 ~20:05Z — T10 + Entry 5 BROWSER-VERIFICATION LIST FOR GARRETT

**For tonight's browser pass (Garrett + volunteers), alongside F28 completion-banner verification, spot-check:**

1. **Homepage (Index.tsx)** — dark forest background, mascot rotation on hero, live pulse indicator. Should feel Sleeper-quality with Citrus warmth.
2. **LeagueDashboard.tsx** — verify NEW-LOOK is fully applied (not just imported).
3. **Standings.tsx** — playoff-zone highlighting (Standings.tsx:832-833 references `isInPlayoffZone` / `isBubble`); verify visual treatment matches C2 palette.
4. **StormyAssistant.tsx** — chat bubble uses `MascotAvatar` for Stormy; verify caricature loads.
5. **PreviewClone.tsx** (edge case — the ONLY Preview page that DOES import citrus2) — confirm it's live-preview of new-look or a testing surface.
6. **DraftRoomV2.tsx** — v2 draft room; **F28 completion banner + F27 commissioner Start button (T7)** live here. Priority visual verification tonight.

**Docket (post-close):** full MIXED-audit per-page walk to confirm NEW-LOOK is USED, not just imported (task #64 candidate).

**Moving to T2 (integration fuzzer) after committing.**

---

## R12 — 2026-08-08 ~20:15Z — ACK Entry 6 (T6 prod-executed ledger + INS-16 addendum + T7 entanglement)

**Directive received.**

**T6 ledger entry APPENDED** to `docs/PROD_CHANGE_LEDGER.md` under new "Rule 1 recorded change: T6 site season-phase (2026-08-08 19:31Z)" section. Verbatim: what/why/before/after/reversal + architect-via-MCP-under-Garrett-grant + timestamp.

**INS-16 addendum APPENDED** to `docs/INSTRUMENT_LEDGER.md`. Repeat-offense recorded — terminal's diagnostic SQL referenced `l.season` + `l.league_type` (neither exists on prod leagues). Reinforcement: prod-facing SQL diagnostic MUST grep-verify columns against `supabase/migrations/*.sql` OR paste `\d public.<table>` into diagnostic header OR add `information_schema.columns` STEP-0 pre-check. Task #66 candidate.

**Docket "Beta League playoffTeams reconfigure at 2026 season setup"** — noted as task #65 candidate in PROD_CHANGE_LEDGER entry.

---

## R13 — 2026-08-08 ~20:15Z — T7 WIRE-UP ENTANGLEMENT ANALYSIS — TWO GAPS SURFACED — STOP

Per architect condition: "If any dependency lacks coverage, STOP, report to outbox, and I will re-rule."

**v1 `handleStartDraft` at `apps/web/src/pages/DraftRoom.tsx:2867-3095` enumerated (228 lines).** Every mutation + external call mapped to v2 coverage:

| # | v1 mutation/call | Line | v2 coverage | Verdict |
|---|---|---|---|---|
| 1 | `setDraftSettings(settings)` | 2970 | Client-local UI state; not draft-flow-dependent | ✓ preserve |
| 2 | `setTimeRemaining(settings.pickTimeLimit)` | 2971 | v2 `DraftTimerV2` reads `snapshot.stateSnapshot.currentPickDeadline` (server truth); local `timeRemaining` obsolete for v2 rendering path | ⚠ obsolete-with-evidence — but preserving is harmless |
| 3 | `DraftService.initializeDraftOrder(leagueId, user.id, teams, draftRounds, true, orderToUse, startDraftType)` | 2993-3001 | **NO v2 COVERAGE** — start_draft_v2 preflight Step 2 requires draft_order rows to exist per round; RAISES `illegal_state: draft_order missing for round X` if not | **GAP-1 (BLOCKING)** |
| 4 | `leagueApi.updateSettings({draft_status:'in_progress', draft_rounds, settings})` | 3010-3018 | REPLACED by `useStartDraftV2` → `start_draft_v2` RPC writes draft_status server-side + emits `draft_started` event | ✓ replaced |
| 5 | `setLeague({...league, draft_status:'in_progress', ...})` | 3028-3037 | Client-local; preserve after useStartDraftV2 success OR refetch via `leagueApi.getLeague` | ✓ preserve |
| 6 | `setDraftPhase(DraftPhase.ACTIVE)` | 3041 | Client-local; preserve after `useStartDraftV2` success (before navigate) | ✓ preserve |
| 7 | `setDraftState(null); setDraftHistory([]); setDraftedPlayerIds(new Set()); setDraftTimerStarted(false)` | 3044-3047 | Client-local; preserve | ✓ preserve |
| 8 | `loadStateAfterStart` polling retry (10x @ 500ms) | 3051-3088 | v2 uses WS + snapshot delivery (F27b-1); no HTTP polling needed. Runner + WS reconnect handle catchup. | ✓ replaced by v2 wire architecture |
| 9 | `AuditService.logDraftEvent('DRAFT_START', leagueId, {teamsCount, rounds})` | 3091-3093 | **NO v2 COVERAGE** — `server/src/routes/draftV2Start.ts` does NOT invoke `AuditService.logDraftEvent`. v1 fired client-side audit; v2 endpoint has no audit call. | **GAP-2 (NON-BLOCKING but architecturally-required)** |

**GAP-1 (BLOCKING): Draft-order initialization prerequisite.**

start_draft_v2 preflight (migration `20260807000000_start_draft_v2.sql`) reads draft_order per round and RAISES on missing. v1 flow explicitly calls `DraftService.initializeDraftOrder(...)` BEFORE flipping status. If wire-up SIMPLY REPLACES the button's onClick without preserving the initialization step, first-time draft ignition FAILS with `illegal_state: draft_order missing for round 1`.

**Options for GAP-1 (architect-decides):**
- **(a) Two-step wire-up:** button onClick performs `DraftService.initializeDraftOrder(...)` FIRST, then on success calls `useStartDraftV2.start(leagueId)`. Preserves v1's initialization semantics. Minimal-invasion. Additive.
- **(b) Extend start_draft_v2 RPC** to init draft_order if missing. Architecturally cleaner — single-RPC ignition. Requires migration change (out of T7 scope per architect additive mandate).
- **(c) Add separate v2 API endpoint** `POST /api/draft/v2/.../initialize-order` mirroring the v1 endpoint. Two API calls from client, symmetric with v1 flow.

**GAP-2 (NON-BLOCKING but expected): Audit log.**

v1 fires `AuditService.logDraftEvent('DRAFT_START', leagueId, {teamsCount, rounds})` client-side. v2 endpoint does not. To match v1 audit coverage, `server/src/routes/draftV2Start.ts` should invoke `AuditService.logDraftEvent(...)` before `return ok(c, data)`. Small server-side addition.

**STOPPING per architect condition.** No wire-up authoring until architect ratifies GAP-1 option + acks GAP-2 audit-log addition. Fallback per architect's Entry 6 language: "fallback: v2 button replaces old button's visibility; old hidden" — reads as: if gap unrecoverable, hide v1 button + expose v2 button separately. But GAP-1 makes the v2 button non-functional as-is → hidden v1 + broken v2 is worse than current state.

**RECOMMENDED (my terminal read, awaiting architect ratification):** Option **(a) two-step wire-up** + GAP-2 audit-log addition in same commit. Both are additive; neither changes existing v1 behavior; both preserve F27 contract. If architect greenlights, I'll author the wire-up in DraftLobby.tsx (swap the `handleStartDraft` prop's handler) + preserve v1 handleStartDraft as `handleStartDraftLegacy_DEPRECATED` with a JSDoc `@deprecated` + task-#67-candidate for post-twelve deletion.

**Moving to T2 (integration fuzzer) while awaiting T7 ratification.**

---

## R14 — 2026-08-08 ~20:25Z — T2 COMPLETE (integration fuzzer, 50,000 sequences green)

**File:** `apps/web/src/stores/__tests__/draftClientStore.fuzzer.test.ts` (new, ~330 lines).

**Coverage.** Extends S2's unit fuzzer beyond `deriveDraftState.foldEvents` to the real `draftClientStore` + optimistic-layer wiring. Exercises the actual React store's `applyEvent` (which wraps foldEvents + snapshot mutation + optimistic reconciliation), NOT foldEvents in isolation.

**Invariants asserted (per architect T2 mandate):**

| Invariant | Sequences | Result |
|---|---|---|
| INV-A — store never throws (applyEvent chain across all adversarial inputs) | 10,000 | ✓ 0 violations |
| INV-B — idempotent under duplicates at store level (state after applyEvent(A) == state after applyEvent(A++A) for derivedState) | 10,000 | ✓ 0 violations |
| INV-C — terminal states absorbing at store level (once derivedState.draftStatus terminal, no applyEvent flips it back) | 10,000 | ✓ 0 violations |
| INV-D — no stuck optimistic entries (recordPending N times + applyEvent(N broadcasts) → pendingActions.size === 0) | 10,000 | ✓ 0 violations |
| INV-E — no duplicate render state (setSnapshot+chain vs setSnapshot({recentEvents: full stream}) produce same derivedState) | 10,000 | ✓ 0 violations |

**Total: 50,000 sequences exercised at store integration level. Zero violations.**

**Note on INV-B semantics:** F28-L4 (docketed pre-shift) — the store's `applyEvent` unconditionally appends to `snapshot.recentEvents` even for duplicate seqs; this creates a UI-cosmetic double-line in the Recent-events pane but does NOT diverge the derivedState (fold is seq-idempotent at :181). INV-B tests derivedState equality specifically, so it passes; the docketed L4 finding is unchanged.

**Cross-workstream:** none of my fuzz sequences drove the WS transport layer (that's runner.ts + reduce.ts, offline-untestable without a fake WS). Integration-fuzzing of the WS layer is a follow-up (task #68 candidate).

**Perf.** 50k sequences run in ~13s total (2.6ms/sequence avg). Confirms integration fuzz is CI-viable.

**Moving to T3+T8 (Capacitor spike plan + Apple App Store gap) after committing.**

---

## R15 — 2026-08-08 ~20:35Z — T3 + T8 COMPLETE (Capacitor spike plan + App Store readiness merged)

**File:** `docs/RUNBOOKS/CAPACITOR_SPIKE_PLAN.md` (new, ~350 lines) — merges T3 + T8 per architect directive.

**10 sections:**
1. **Scope + non-scope** — TestFlight-internal target for spike; full submission deferred.
2. **Prerequisites Garrett must gather BEFORE Aug 15** — 8-item checklist (Apple Dev enrollment, Bundle ID, Xcode 15+, Mac, test device, icons, launch screen, tester group). **Hard blocker if any missing.**
3. **Day-by-day plan (Aug 15-17)**:
   - Aug 15 Fri: prereq verification day
   - Aug 16 Sat: SPIKE DAY step-by-step (Garrett executes) — morning cap-init, midday Xcode signing, afternoon TestFlight upload+distribute+smoke
   - Aug 17 Sun: freeze day, no code changes
4. **Code slots to author BEFORE spike** (author-only today):
   - `capacitor.config.ts.template` — rename on spike day
   - `.gitignore` additions for iOS/Android
   - `package.json` script additions (cap:sync, cap:open:ios, cap:build:ios)
5. **WS behavior on iOS webview (THE TWELVE-critical)** — iOS suspends JS on background/screen-off; WS held by OS network stack; snapshot-resync on resume covers all cases. Verification steps for spike Aug 16 afternoon. Docket: push notifications on on-clock event (APNs setup post-launch).
6. **Signing prerequisites** — Apple Developer membership, certs, provisioning profiles, App Store Connect record, TestFlight tester groups.
7. **Risks + mitigations** — 8-item risk table. Top blockers: no Mac access (rent Scaleway), Apple Dev Org enrollment slow (use Individual first), Bundle ID taken (try alt suffix).
8. **App Store readiness checklist (T8 merged content)** — 4-way classification: DONE / BLOCKS TestFlight / BLOCKS App-Store submission / MUST GATHER (Garrett) / DOCKETED POST-SPIKE. Consolidates gap-doc's Jan 2026 findings into single actionable dashboard.
9. **Post-spike report template** — for Garrett to fill in Aug 16.
10. **Related docs** — cross-refs to gap-doc, runbook, project plan.

**Key findings:**
- **Zero code changes** need to reach the web client for the spike — Capacitor wraps the existing Vite build as-is.
- **WS behavior on background/lock** is the THE-TWELVE-critical risk. Existing snapshot-resync architecture (`runner.ts` backoff + `LobbyManager.addConnection` snapshot delivery + `deriveDraftState.foldEvents` + F27b-1 bootstrap) covers all cases. Docket for push-notification enhancement post-launch.
- **Hard blocker if Garrett lacks Mac** — Xcode is macOS-only. Rent Scaleway or borrow if not already available.
- **Apple Dev enrollment can be slow** — start today (Aug 8-10) if not already enrolled.

**Code slots NOT yet authored** — waiting for Aug 16 (per author-only today; slots are documented in §4 for Garrett/architect to add on spike day).

**Moving to T4 (F23 design doc) after committing.**

---

## R16 — 2026-08-08 ~20:45Z — T4 COMPLETE (F23 design doc ratification-ready)

**File:** `docs/DESIGN_F23_registry_blind_stall_recovery.md` (new, ~200 lines).

**Content:**
- §1 Problem — scanClockLiveness registry-blindness enumerated; 3 states (never-created, idle-evicted, never-hydrated-post-restart). Empirical evidence: 9.5h stalled fixture league 2026-08-06.
- §2 Non-goals — not replacement for scanClockLiveness; not real-time; not fix for legitimate abandoned-mid-draft class (Rider 2 already covered).
- §3 Three design options evaluated (A: DB pg_cron + NOTIFY; B: engine-side DB poll; C: snapshot-freshness heartbeat). **Recommendation: Option B** (single-workstream, reuses recovery path, bounded exposure, 60s cadence).
- §4 Detailed design — LobbyRegistry additions (constant, state field, 4 new methods, boot signal, config env vars, idempotency safety, failure modes, 5 observability log lines, 6 offline test cases).
- §5 8 ratification bars.
- §6 Rollout — author → ratify → implement → deploy → verify → prod-monitor.
- §7 Related work — F20 / F27b-1 / F27b-2 / INS-16 / KI-041 / PROD_CHANGE_LEDGER cross-refs.

**Not a THE TWELVE blocker.** F23 is prod-hardening for the registry-blind residual class. Awaits architect ratification post-close.

**Moving to T5 (KI-042 #61 int-assumption fixes) after committing.**

---

## R17 — 2026-08-08 ~20:55Z — T5 COMPLETE (KI-042 shared utility + autopickStrategy fix + 25 tests)

**Files (new + edited):**
- **NEW** `packages/shared/src/utils/playerIdDomain.ts` — 4 exports:
  - `classifyPlayerId(raw): 'numeric' | 'uuid' | 'invalid'` — regex-based domain classification. Handles null/undefined/empty/negative/NaN/decimal edge cases.
  - `coerceToNumericPlayerId(raw): number | null` — never throws; returns int OR null for silent-drop.
  - `assertNumericPlayerId(raw, context): number` — throws `[KI-042] ${context}: ...` on non-numeric; truncates long inputs defensively.
  - `partitionPlayerIds(raws): {numeric, uuid, invalid}` — batch classifier for row-set processing.
- **NEW** `packages/shared/src/utils/__tests__/playerIdDomain.test.ts` — **25 offline unit tests, all pass**:
  - classifyPlayerId (10): int/numeric-string/uuid (case-insensitive)/null/undefined/empty/whitespace/zero/negative/NaN/Infinity/non-numeric-string/decimals-are-invalid/trims-whitespace
  - coerceToNumericPlayerId (6): int/numeric-string/uuid/null/invalid/never-throws
  - assertNumericPlayerId (6): int/numeric-string/uuid-throws/null-throws/invalid-throws/long-input-truncated
  - partitionPlayerIds (4): mixed-domain/empty/all-numeric/all-uuid
- **EDITED** `packages/shared/src/utils/index.ts` — exports `playerIdDomain` module
- **EDITED** `server/src/draft/autopickStrategy.ts:99-116` — draftedSet construction now uses `coerceToNumericPlayerId` per row; demo-domain uuid rows silently dropped (real-league autopick path unaffected)

**Verification:**
- `npx vitest run playerIdDomain` in `packages/shared/`: 25/25 ✓
- `npx vitest run autopickStrategy` in `server/`: 5/5 ✓ (no regression)
- Server typecheck: clean (no new errors from autopickStrategy edit)
- Shared package build: clean (`npm run build` in `packages/shared/`)

**Sites still to author (docketed as follow-up, deliberately deferred):**

Per S6 + T9 audits, the following sites also have KI-042 exposure but were NOT touched in this cycle to keep the shift scope bounded:
- `apps/web/src/services/DraftService.ts:238` — property passthrough only; type assumption in interface (audit needed to determine assertion vs coerce)
- `apps/web/src/services/MatchupService.ts` — similar audit needed
- `server/src/services/WaiverService.ts:145,178,196,233` — `Number(playerId)` casts throughout
- `server/src/routes/waivers.ts:127-128,158-161,192-193,248` — 4 route handlers

**Recommendation for remaining sites (post-close task):**
- **Server-side waiver routes** (submitWaiverClaim, submitFAABBid, addFreeAgent, dropPlayer) — use `assertNumericPlayerId(body.playerId, 'submitWaiverClaim.playerId')` at route entry. Client gets 400 with `[KI-042] ...` message for demo-domain input. Real leagues unaffected.
- **WaiverService** — service methods accept `number` already; route-level assertion is sufficient.
- **Client DraftService / MatchupService** — audit + wrap with `coerceToNumericPlayerId` at row-processing sites (silent-drop pattern for demo-domain).

**All ready to apply — utility landed, tests green, autopickStrategy demonstrates the pattern.** Post-close cleanup: task #61 remains open with utility now available.

**MOVING TO END-OF-THIRD-SHIFT FINAL SUMMARY after committing.**

---

## R18 — 2026-08-08 ~21:05Z — END-OF-THIRD-SHIFT FINAL SUMMARY

**Directive completion status.** Per Garrett kickoff Entry 2: "Work it CONTINUOUSLY in a single run: finish an item → write its completion notice to the outbox → re-read the inbox → next item... Only when EVERYTHING is exhausted: final outbox summary, then stand by."

**Status.** ALL T-items completed OR STOPPED-with-report per architect condition. Inbox drained (Entries 1-6 all addressed). Standing by for further inbox entries or overnight rest per architect direction.

### T-queue final status

| T-item | Status | Sha | Notes |
|---|---|---|---|
| T1 CLEAN THE SUITE | ✓ COMPLETE | `ae2d6096` | 4 pre-existing failures fixed (timezone off-by-one, test-only). Full web 1555/1555 ✓. |
| T6 SITE SEASON-PHASE URGENT | ✓ COMPLETE (fix applied on prod by architect) | `cf9e70a7` | Mechanism report R5 + fix script authored. Architect executed OPTION B on The Beta League: playoffTeams 6→0. Site OFFSEASON. |
| T7 COMMISSIONER BUTTON URGENT | ⏸ STOPPED per architect condition | `e13a94a2`, `69dc3d3e` | R6 initial + hook + server route + 12 tests landed. R13 entanglement analysis surfaced 2 GAPS (draft-order init prerequisite + audit log). Awaiting architect ratification of Option (a) two-step wire-up. |
| T9 ROSTER MOVEMENTS AUDIT | ✓ COMPLETE | `b91416e0` | 13 movement paths audited. 8 PROPER / 4 UNVERIFIABLE-OFFLINE / 0 DEFECT-needing-fix. KI-042 exposure noted (same class as S6/T5). |
| T10 + Entry5 NEW-LOOK + ART | ✓ COMPLETE | `19161274` | Every RS/offseason page ALREADY NEW-LOOK (imports citrus2). Caricature inventory 16 assets. ART_GENERATION_QUEUE.md scaffold with empty queue (no new art needed today). |
| T2 INTEGRATION FUZZER | ✓ COMPLETE | `e0436d6b` | 5 invariants × 10K sequences = 50K exercised at store integration level. Zero violations. |
| T3 CAPACITOR SPIKE + T8 APP STORE | ✓ COMPLETE | `3e346506` | CAPACITOR_SPIKE_PLAN.md 10 sections. Day-by-day Aug 15-17. WS bg/fg behavior covered. Signing prereqs list. Merged T8 as §8 readiness checklist. |
| T4 F23 DESIGN DOC | ✓ COMPLETE | `d6f6ef5f` | DESIGN_F23_registry_blind_stall_recovery.md. 3 options evaluated → Option B recommended (engine-side DB poll). 8 ratification bars. |
| T5 KI-042 #61 | ✓ COMPLETE (utility + demo fix; remaining 3 sites docketed) | `2ab6314d` | Shared playerIdDomain utility + 25 tests + autopickStrategy fix demonstrating pattern. |

### Third-shift commits (11 total, from `73877ec6` through `2ab6314d`)

| # | Sha | Item |
|---|---|---|
| 1 | `73877ec6` | ACK Entry 1 (channel open) |
| 2 | `ae2d6096` | T1 clean-the-suite |
| 3 | `cf9e70a7` | T6 URGENT mechanism + fix |
| 4 | `e13a94a2` | T7 URGENT wire-up (client + server + tests) |
| 5 | `b91416e0` | T9 roster movements audit |
| 6 | `19161274` | T10+Entry5 new-look sweep + caricature |
| 7 | `69dc3d3e` | Entry 6 response (T6 prod-ledger + INS-16 addendum + T7 entanglement STOP) |
| 8 | `e0436d6b` | T2 integration fuzzer |
| 9 | `3e346506` | T3+T8 Capacitor spike + App Store |
| 10 | `d6f6ef5f` | T4 F23 design doc |
| 11 | `2ab6314d` | T5 KI-042 utility + autopickStrategy fix |

### Full-day commits (28 total: 12 first-shift + 5 second-shift + 11 third-shift)

Complete chronological list in `docs/HANDOFF_2026-08-08_v2.md` §Commits + this outbox's chronological trail (R1 → R18).

### Open architect ratification items (blocking = ❌, non-blocking = ⏸)

| Item | Status | Requires |
|---|---|---|
| T7 wire-up gap resolution (GAP-1 draft_order init + GAP-2 audit log) | ⏸ STOP | Architect re-rule on Option a/b/c |
| N-2 backfill migration application | ⏸ Pending Garrett-exec | Post-THE-TWELVE per Q4 |
| F27b-2 fix engine deploy | ⏸ Pending Garrett-exec | Pre-freeze Aug 17 |
| N-1 harness fix production verify | ⏸ Pending Garrett-exec | Next STEP 5' run |
| F27 CLOSE deploy (F26+F27+F27b-1) already certified | ✓ | — (rollback pin advanced 2026-08-08) |
| KI-034 (draft_state) resolution | ⏸ Post-close per Q4 | Post-twelve backfill migration |
| F23 registry-blind-stall implementation | ⏸ Post-close | Architect ratifies design |
| Task #61 remaining sites (DraftService, MatchupService, WaiverService, waiver routes) | ⏸ Post-close | Utility available; audit + apply |

### Open architect questions (all NON-BLOCKING for THE TWELVE)

1. T7: which option for GAP-1 draft-order init? (a) two-step client wire-up, (b) extend RPC, (c) separate v2 init endpoint. My recommendation: **(a)**.
2. T7: GAP-2 audit log addition to `draftV2Start.ts` — ACK to proceed?
3. Task #52: switch `--mode=lifecycle` default to true-Assert-F, OR keep opt-in mode indefinitely?
4. F28-L3 (docketed): explicit `draft_paused` / `draft_cancelled` reducer cases in `deriveDraftState`?
5. F28-L4 (docketed): dedup `snapshot.recentEvents` at `draftClientStore.applyEvent`?
6. F23 design ratification per §5 bars.
7. Task #61: architect greenlight for the recommended fix pattern (server-side `assertNumericPlayerId` in waiver routes)?

### Blocking checklist for THE TWELVE (from HANDOFF v2, updated)

- [ ] **T7 wire-up** — GAPS resolved + wire-up authored + deployed. **CANNOT DRAFT WITHOUT.** (post-Garrett-return)
- [ ] Group A: F27b-2 engine deploy + STEP 5' green (post-Garrett-return)
- [ ] Group B: N-2 migration applied (post-Garrett-return; not strictly THE-TWELVE-blocking but architect-ratified for hygiene)
- [ ] Group C: F28 web build deployed + browser-verified (post-Garrett-return)
- [ ] Pre-THE-TWELVE dry-run passed (post-Garrett-return + volunteers)

### What's NOT blocking THE TWELVE

- F23 registry-blind-stall recovery (post-close hardening)
- KI-042 #61 remaining sites (post-PROD-PORT scoping)
- Capacitor spike (Aug 16 target; not gate to THE TWELVE which is web-only)
- MIXED audit per-page walk (post-close polish)
- All docketed tasks #52-#68

### Standing rules honored

- **AUTHOR-ONLY**: no prod writes, no rig runs, no gcloud/docker/psql, no npm scripts touching network/DB
- **Offline unit tests only**: 25 new playerIdDomain tests + 12 new useStartDraftV2 tests + 5 new draftClientStore fuzzer tests + timezone-fix on 46 existing web tests → all pass
- **Never guess architect decisions**: T7 STOP + report is the explicit exemplar
- **Time-box + docket**: no item stalled > 90min; T7 STOP + move-on
- **Diff safety arguments**: every commit includes ratification-bar-style rationale
- **INS-16 discipline**: repeat offense on T6 diagnostic SQL captured with reinforcement in ledger

### Standing by

Reading inbox on any new entry per protocol. Next action:
- If architect Entry 7+ lands: ACK immediately + execute per direction + reply
- If Garrett returns: hand-off is docs/HANDOFF_2026-08-08_v2.md (first shift) + outbox trail R1-R18 (subsequent shifts) + this final summary
- Otherwise: idle, no self-queued work

**End of third-shift authoring.**

---

## R19 — T7 WIRE-UP COMPLETE per Entry 7 (2026-08-08 21:00Z / 3:00 MT)

Entry 7 ratified GAP-1 Option (a) + GAP-2 approved. Wire-up authored end-to-end. Ready for Garrett's Group-C deploy.

### What was authored

**GAP-1 Option (a) — two-step client wire-up:**
- `apps/web/src/hooks/useStartDraftFull.ts` (NEW, 170 lines) — wraps: (1) cheap existence check on `draft_order` (Condition 1 re-run safety), (2) `initializeDraftOrder` if missing, (3) `useStartDraftV2.start` (F27 RPC). Unified `isPending = initPending || startDraftV2.isPending` gates UI across full sequence (Condition 3). Failure ordering: init fails → NO ignition attempted; init OK + ignition refused → taxonomy message, league remains safe/retryable (Condition 2). Fresh idempotency key per user-initiated attempt (via `useStartDraftV2.start`).
- `apps/web/src/pages/DraftRoom.tsx` — added `useStartDraftFull` hook at DraftRoom top level (line ~190); NEW `handleStartDraft` for new-draft path calls `startDraftFull.start(...)` + navigates to `/draft-v2/${leagueId}` on success + surfaces Rider-1 taxonomy via toast on failure; rejoin branches preserved verbatim; legacy handler renamed → `handleStartDraftLegacy_DEPRECATED` with `@deprecated` JSDoc citing task #60.
- `apps/web/src/components/draft/DraftLobby.tsx` — added `isStartingDraft?: boolean` prop; threaded to `disabled={isStartingDraft || existing-conditions}` on all 4 Start-Draft-family buttons (Continue Draft / Start Draft Now × 2 / Join Draft Room); labels show `Starting…` / `Joining…` while pending.

**GAP-2 — audit log in v2 route:**
- `server/src/routes/draftV2Start.ts` — added `AuditService` import + `audit.logDraftEvent('DRAFT_START', ...)` block firing SERVER-SIDE AFTER rpc success ONLY (not on attempts); payload includes `wasDuplicate` so idempotent replays are distinguishable in the audit trail. Audit failure does NOT block the response (symmetric with existing draft.ts pattern).

### Re-run safety citation (Condition 1)

`server/src/services/DraftService.ts:317-352` hard-DELETES existing `draft_order` rows for the league then INSERTs fresh. Safe against row duplication BUT changes sessionId + potentially reorders (destructive-then-create). Guard: cheap existence check via `DraftService.getDraftOrder(leagueId, userId, 1)` — if `order.team_order.length === teams.length`, skip init. Handles fresh league (miss → init), retry-after-refusal (hit → skip init → ignition retries with fresh idempotency key), pre-configured league (hit → skip init), double-press mid-sequence (isPending gate blocks second click). Wrong-team-count safety: if existing order has different length than current teams count, treat as "not present" and re-init.

### Tests authored + passing

`apps/web/src/hooks/__tests__/useStartDraftFull.test.ts` — 6 offline tests all pass:
1. init-fails → ignition RPC NEVER called (Condition 2 fail-fast)
2. init-ok + ignition-refused → taxonomy message surfaced, retry safe (Rider-1)
3. happy path existence-check-miss → init runs → ignition succeeds (initSkipped=false)
4. isPending honesty: TRUE during pending window, FALSE after resolve (Condition 3; gates UI double-press)
5. draft_order already present → init SKIPPED, ignition still runs (initSkipped=true, Condition 1)
6. draft_order present but wrong team count → init RUNS (safety fallback)

Combined with earlier useStartDraftV2 tests: **18 tests pass (12 + 6)**.

### Adjustment vs Entry 7's "5 tests"

Entry 7 required 5; delivered 6. Merged the "happy path with navigation callback invoked" into test #3 (navigation is DraftRoom's concern, not the hook's — hook has no navigate prop) + added test #6 (wrong-team-count edge case for Condition 1 safety fallback that Entry 7 didn't call out but is needed for real leagues that grew mid-configuration). Test #4 reframed from "double-press → single sequence only" to "isPending is honest across pending window" because the hook explicitly does NOT dedupe (correct — UI's job via `disabled={isStartingDraft}` on the button); the hook's contract is that isPending is truthful so the UI gate works. If architect wants a UI-level render test proving disabled prop blocks the second click, that's a DraftLobby test — flag if wanted, ~15min.

### Typecheck status

Ran `npx tsc -p tsconfig.app.json --noEmit`. All T7 wire-up errors CLEARED. Remaining error at `DraftRoom.tsx:122:62` is PRE-EXISTING (`n as DraftPhase` in sessionStorage-restore branch, present before T7 touched the file). Full suite has 40+ pre-existing tsc errors in `services/*`, `hooks/useMyTeamIdCrossCheck.ts`, `deriveDraftState.ts:292`, etc. — none introduced by T7 wire-up.

### Deprecation followup

Task #60 CREATED: post-TWELVE deletion of the legacy v1 flip-era surface:
- `apps/web/src/pages/DraftRoom.tsx` handleStartDraftLegacy_DEPRECATED (~230 lines)
- `server/src/routes/draft.ts` POST /league/:leagueId/start (v1 flip route)
- `apps/web/src/api/draft.ts` startDraft() client wrapper
- Any v1 flip-status logic in `DraftService` client if unused
- Gate: T7 v2 route proven for ≥1 full draft cycle without regression

JSDoc on `handleStartDraftLegacy_DEPRECATED` cites task #60 explicitly.

### Flow diagram (end-to-end for THE TWELVE)

```
Commissioner clicks Start Draft in DraftLobby
  → DraftRoom.handleStartDraft (v2)
  → leagueApi.updateSettings (rounds/pickTimeLimit/draftOrder ONLY — NO status flip)
  → useStartDraftFull.start
    → draftOrderExistsForLeague (getDraftOrder round 1)
      → if hit: skip
      → if miss: DraftService.initializeDraftOrder (destructive-then-create)
    → useStartDraftV2.start (crypto.randomUUID idempotency key)
      → draftV2Api.startDraftV2 → POST /api/draft/v2/league/:id/start
        → supabase.rpc('start_draft_v2', {p_league_id, p_actor, p_idempotency_key})
          → Rider 1 preflight taxonomy (or success)
          → append_draft_event('START_DRAFT', ...) + UPDATE leagues SET draft_status='in_progress'
        → AuditService.logDraftEvent('DRAFT_START', ...) with was_duplicate
      → returns {event_id, seq, first_pick_deadline, was_duplicate}
  → navigate(`/draft-v2/${leagueId}`) → DraftRoomV2 mounts → WS bootstrap
```

### Blocking checklist for THE TWELVE — UPDATED

- [x] **T7 wire-up** — GAPS resolved + wire-up authored + 6 offline tests passing. **READY for Garrett's Group-C deploy.**
- [ ] Group A: F27b-2 engine deploy + STEP 5' green (post-Garrett-return, unchanged)
- [ ] Group B: N-2 migration applied (post-Garrett-return, unchanged)
- [ ] Group C: F28 web build deployed + browser-verified — **now bundles T7 wire-up**
- [ ] Pre-THE-TWELVE dry-run passed (post-Garrett-return + volunteers)

### Files changed (uncommitted, ready to commit)

```
NEW: apps/web/src/hooks/useStartDraftFull.ts
NEW: apps/web/src/hooks/__tests__/useStartDraftFull.test.ts
MOD: apps/web/src/pages/DraftRoom.tsx (imports, hook call, handler split, prop pass)
MOD: apps/web/src/components/draft/DraftLobby.tsx (prop + 4 button disable/label sites)
MOD: server/src/routes/draftV2Start.ts (AuditService import + post-success block)
```

### Standing by (unchanged)

Reading inbox for Entry 8+ per protocol. This IS the last blocking item of the day per Entry 7. When Garrett returns: hand-off is docs/HANDOFF_2026-08-08_v2.md (first shift) + outbox trail R1-R19 (subsequent shifts).

**End of R19. THE TWELVE's Start Draft button now exists end to end.**

---

## R20 — Entry 8 executed (2026-08-08 22:10Z / 4:10 MT)

Entry 8 acknowledged. R19 ratification received (thanks for accepting the three test-deviation arguments — navigation is DraftRoom's concern, dedup is UI-gate's job, isPending honesty as hook contract). Three deliverables authored per Entry 8:

### D1 — DraftLobby render test (the ~15min offer, taken)

**File**: `apps/web/src/components/draft/__tests__/DraftLobby.doublePress.test.tsx` (NEW).

Covers all 4 Start-Draft-family buttons rendered by DraftLobby (identified by the actual JSX branches):
1. **BRANCH 1** — `hasExistingDraft + isCommissioner=true` → "Continue Draft" button (`DraftLobby.tsx:921`).
2. **BRANCH 2** — `isDraftQueued + isCommissioner=true` → "Start Draft Now" (queued) button (`DraftLobby.tsx:931`).
3. **BRANCH 3** — default (new) + `isCommissioner=true` → "Start Draft Now" (impromptu) button (`DraftLobby.tsx:963`). This branch is the strictest test — with 12 teams, `teams.length < 4` is FALSE, so the ONLY thing disabling the button is `isStartingDraft`. If a silent refactor drops the `isStartingDraft` term from the disabled expression here, the test fails.
4. **BRANCH 4** — `hasExistingDraft + isCommissioner=false` → "Join Draft Room" button (`DraftLobby.tsx:1020`).

Each test: `isStartingDraft=true` → assert `.toBeDisabled()` on the button + `fireEvent.click` fires + `expect(onStartDraft).not.toHaveBeenCalled()`. Positive control at the end verifies BRANCH 3 with `isStartingDraft=false` DOES fire `onStartDraft` (proves the assertion isn't just watching a permanently-disabled button).

Uses `fireEvent` from `@testing-library/react` (already installed); NO new npm dependencies. **5/5 tests pass.**

### D2 — player_transactions success-recording audit (with file:line citations)

**Answer**: SUCCESS recording lives in `transaction_ledger`, NOT `player_transactions`. Direct citations:

**Server-side success writes to `transaction_ledger`:**
- `server/src/services/WaiverService.ts:540-551` — AI DROP path inserts `{league_id, user_id:null, team_id, type:'DROP', player_id, source, created_at}` into `transaction_ledger`.
- `server/src/services/WaiverService.ts:630-641` — AI ADD path inserts `{league_id, user_id:null, team_id, type:'ADD', player_id, source, created_at}` into `transaction_ledger`.
- `TradeService.ts` and `LeagueService.ts` also reference `transaction_ledger` (grep-confirmed).

**DB-side success also writes to `transaction_ledger`:**
- Migration `20260309000000_cto_audit_fixes.sql:427` comment on the SQL function: `'Full rollback on any failure. Logs to transaction_ledger and failed_transactions.'` — process_roster_move writes ledger on success, failed_transactions on rollback.

**Failure path writes to `failed_transactions`:** confirmed in migrations `20260117000001_create_process_roster_move.sql:288/318`, `20260208500000_fix_roster_sync_and_roster_size.sql:275/291`, `20260309000000_cto_audit_fixes.sql:411/415`, `20260310000000_cto_audit_round2_fixes.sql:170/174`, `20260407200000_relax_goalie_limit.sql:143/147`, `20260407300000_waiver_on_drop.sql:152/156`. All rollback branches. Matches prod's 18 failed rows.

**Reconciliation of prod row counts:**
- `player_transactions = 0` → EXPECTED given the audit finding below (no writer wired up).
- `failed_transactions = 18` → consistent with 18 real-user rollback events over time.
- `waiver_claims = 12` → orthogonal (waiver claim entries, not successful executions).
- `transaction_ledger` (not quoted by architect) → should carry the success row count. Would reconcile against total successful ADD/DROP events. **Ask: architect can quote the current prod count?** If ≥ (waiver_claims_that_succeeded + AI_drops + user_moves), the success-recording story is intact.

**NOT a T9 DEFECT for the audit trail.** The audit trail for user-facing add/drop/waiver-execution is captured — just under `transaction_ledger`, not `player_transactions`. "Only failures are recorded" is FALSE — successes are recorded in `transaction_ledger`.

### D2 — SECONDARY DEFECT DISCOVERED (worth surfacing separately, not part of Entry 8's ask)

`player_transactions` has ZERO writers anywhere in the codebase:
- `server/src/**/*` — 0 references to `player_transactions` (grep confirmed).
- `apps/web/src/**/*` — 0 references.
- Only writer: SQL function `record_player_transaction()` defined in migrations `20260205000000_create_player_transactions_table.sql:92-141` and re-defined in `20260228000000_11th_audit_comprehensive_fixes.sql:804-857`.
- CALL SITES for `record_player_transaction`: ZERO (grep across whole repo confirms). Dead code.

**End-user impact**: `apps/web/src/pages/FreeAgents.tsx:198` calls `PlayerService.getTrendingPlayers(7, 50)` → `server/src/services/PlayerService.ts:327-328` calls RPC `get_trending_players` → RPC reads from `player_transactions` (migration `20260205000000:79`) → returns empty → FreeAgents trending badge has been silently DARK since Feb 2026 (~6 months in prod, presumably no user complaint since users don't notice missing analytics vs. broken analytics).

**Two remediation options (BOTH require prod writes; DEFERRED past THE TWELVE):**
- **Option A (analytics-preserving)**: wire `record_player_transaction()` call into the success write paths (WaiverService.ts:540 + :630 + process_roster_move SQL function). Optionally backfill `player_transactions` from `transaction_ledger` history. Trending starts working immediately.
- **Option B (schema-consolidating)**: rewrite `get_trending_players` RPC to read from `transaction_ledger` instead of `player_transactions`; drop `player_transactions` table + `record_player_transaction` RPC as dead scaffold. Single source of truth for transactions.

**Docket recommendation**: create KI candidate + docket for post-twelve. Not a T9 DEFECT-as-defined (no missing audit trail); it's a KI (dark analytics view since Feb 2026). Awaiting architect ratification for KI-N assignment + option A-vs-B ruling.

### D3 — Q4 backfill migration header addendum

**File**: `supabase/migrations/20260821000000_v1_completed_leagues_backfill_draft_state.sql` — inserted new `KNOWN POPULATIONS` section between SCOPE and NON-GOALS (lines 33+).

Contents:
- Names class (1): ACTIVE / COMPLETED (primary target).
- Names class (2): NOT_STARTED / COMPLETED (deferred, 1 league on staging as of 2026-08-08). Discloses that the WHERE clause sweeps this population into `draft_state='completed'` alongside class (1), because `draft_state IS DISTINCT FROM 'completed'` includes `not_started`. Flags this as intentional-for-now (self-consistent postcondition) even though the true semantic (a never-armed league arguably deserves `draft_state='cancelled'` or a new terminal like `draft_state='never_started'`) is not perfectly captured. Semantic reclassification for class (2) is DEFERRED to post-twelve architect ratification.

**Explicit acknowledgement** to architect: I read Entry 8's phrase "The v1 backfill correctly targets active/completed only" and observed that the current WHERE clause actually DOES also sweep not_started/completed into draft_state=completed. Documented this fact in the header rather than silently narrowing the WHERE to exclude it. If architect prefers the WHERE be narrowed to `draft_state IN ('active','paused')` explicitly (which would leave the 1 not_started/completed staging row untouched, deferring it to a separate migration), that's a ~5min edit — flag if wanted.

### Test / typecheck status

- Ran `npx vitest run src/components/draft/__tests__/DraftLobby.doublePress.test.tsx` → 5/5 pass in ~2.35s.
- Ran `npx vitest run src/hooks/__tests__/useStartDraftFull.test.ts src/hooks/__tests__/useStartDraftV2.test.ts` (from R19 wire-up) → 18/18 still pass.
- No new npm dependencies added (used `fireEvent` from `@testing-library/react` which was already installed; declined `@testing-library/user-event` for the same reason).

### INS-16 discipline for T9 (architect finding correction)

Entry 8's T9 corrections applied: real prod movement/roster tables are `team_lineups(starters,bench)` — NOT "rosters". Movement set = `player_transactions, waiver_claims, waiver_priority, trade_offers, trade_history, trade_votes, transaction_ledger, failed_transactions`. My earlier T9 audit did NOT reference wrong names (was scoped to the movement pipeline in server code, not to a table census), so no INS-16 correction needed against the earlier T9 report. Duly noted for any future T9 census work.

### Files changed (uncommitted, ready to commit)

```
NEW: apps/web/src/components/draft/__tests__/DraftLobby.doublePress.test.tsx  (D1)
MOD: supabase/migrations/20260821000000_v1_completed_leagues_backfill_draft_state.sql  (D3)
MOD: docs/ARCHITECT_INBOX.md   (Entry 8 addition — architect-authored, included per channel protocol)
MOD: docs/TERMINAL_OUTBOX.md   (this R20)
```

D2 is a *report*, not a code change — no files touched for it.

### Standing by

Reading inbox for Entry 9+ per protocol.
- If architect Entry 9 lands: ACK immediately + execute + reply.
- Open follow-ups for architect at Entry 9 (or Garrett's return):
  1. transaction_ledger prod row count so D2 reconciliation closes cleanly.
  2. D2 secondary defect: KI-N assignment + Option A-vs-B ruling for the dead-`player_transactions` scaffold (post-twelve; not urgent).
  3. D3: does architect want the WHERE clause narrowed to exclude not_started/completed (a semantic-preservation edit) or leave it inclusive (a self-consistency edit) — either way documented.
- Otherwise: idle 30-min polling cadence per Garrett-away protocol.

**End of R20.**

---

## R21 — Entry 9 ratifications recorded (2026-08-08 23:35Z / 5:35 MT)

Entry 9 acknowledged. Board is CLEAR per architect. Two ledger updates authored to close the loop.

### KI-046 written — INV-4 narrowing pattern recorded as house standard

**Section**: `docs/REGISTRY.md` — new KI-046 "INV-4 narrowing: house standard for 'invariant met reality' (pattern, not a defect)."

Codifies the four-step pattern per architect Entry 9:
1. Narrow the invariant to the guaranteed input class.
2. Keep the excluded class as a monitored census (same fuzzer, different classification).
3. Set a divergence tripwire rate that would surface either a guarantee regression or a new failure mode.
4. Never delete the excluded-class signal.

Applies concretely at `apps/web/src/stores/__tests__/draftClientStore.fuzzer.test.ts` (INV-4 monotonic-input narrowing + INV-4-EXTENDED divergence canary at 8% baseline / 20% tripwire). Row template + verification test noted for any future invariant-vs-fuzzer setup.

### KI-047 written — vestigial player_transactions table + post-twelve docket

**Section**: `docs/REGISTRY.md` — new KI-047 "Vestigial `player_transactions` table + `record_player_transaction` RPC (0 writers, dark trending analytics)."

Full row includes:
- All 6 schema columns (Severity / Surface / Description / Why deferred / Target phase / Verification test).
- Architect Entry 9's empirical confirmation embedded (transaction_ledger = 14 rows, ADD+DROP; player_transactions = 0).
- Both remediation options documented: (a) wire the writer call into WaiverService.ts:540/630 + process_roster_move (double-write + optional backfill); (b) rewrite `get_trending_players` to read `transaction_ledger` + drop the vestige (architect Entry 9's own recommendation shape).
- FreeAgents trending-badge dark-since-Feb-2026 impact noted.
- Auditor-trap cost (~1hr into Entry 8 audit itself) recorded so the "authoritative-sounding empty table" pattern is a first-class warning.

**Task #66 CREATED**: post-twelve retirement docket, cross-referenced to KI-047. Awaiting architect option-(a)-vs-(b) ratification post-twelve.

### D2/D3 close-out

All three R20 follow-ups from R20 §"Standing by" are RESOLVED:
1. ✅ **transaction_ledger prod count**: architect quoted 14 rows (Entry 9) → success recording confirmed intact. D2 reconciliation CLOSED.
2. ✅ **KI-N assignment for player_transactions**: KI-047 assigned + docketed. Option (a)-vs-(b) ruling deferred to post-twelve.
3. ⏸ **D3 WHERE-clause narrow-vs-inclusive**: Entry 9 did not rule on this; taking silence as "keep the current inclusive WHERE + rely on the KNOWN POPULATIONS header note." If architect intends a narrower WHERE, flag on Entry 10+ and I'll re-author.

### Files changed this cycle (uncommitted, ready to commit)

```
MOD: docs/REGISTRY.md              (KI-046 + KI-047, both new rows before "How to add a row")
MOD: docs/ARCHITECT_INBOX.md       (Entry 9 addition — architect-authored, included per channel protocol)
MOD: docs/TERMINAL_OUTBOX.md       (this R21)
```

No code files touched. Task-list update: task #66 created for KI-047 retirement.

### Standing by (board CLEAR per architect Entry 9)

Architect Entry 9 verbatim: "your board is CLEAR pending Garrett's return. Well worked today."

Interpretation:
- No queued directives from architect.
- No self-queued work — standing rule "idle, no self-queued work" applies.
- Continue 30-min inbox poll cadence for Entry 10+ or Garrett return.

**End of R21. Board clear. Idle.**

---

## R22 — Entry 10 executed: T3+T8 ratified + KI-048 channel pattern recorded (2026-08-09 01:05Z / 7:05 MT)

Entry 10 acknowledged.

### T3+T8 Capacitor Spike Plan — RATIFIED (no action needed)

Architect Entry 10 verbatim: "CAPACITOR_SPIKE_PLAN.md reviewed in full against the Aug 16 spike / Aug 17 freeze calendar: RATIFIED." Zero-web-code-changes finding + WS-suspend/resume analysis (snapshot-resync as recovery spine) both credible + correctly scheduled for device verification on spike day. Long-lead prerequisites (Apple Developer enrollment; Mac access confirmed by ~Aug 11 or rental booked) elevated to Garrett-personal calendar via architect's evening brief — no terminal action.

Task list: task #23 ("Week 2 spike: Capacitor wrap of apps/web") remains pending as its status hasn't changed — it's still queued for the Aug 15-17 window and the plan doc it references is now formally ratified.

### KI-048 written — autonomous-wakes channel pattern

**Section**: `docs/REGISTRY.md` — new KI-048 "Standing channel pattern for unattended-day terminal operation (ScheduleWakeup + inbox/outbox)."

Per architect Entry 10 loop-note: "your self-scheduler's autonomous wakes (R19 at 3:00, R21 at 5:35) are now a proven mechanism — record it in the ledger as the standing channel pattern for future unattended days."

Row includes:
- Full pattern definition (channel = inbox+outbox; wake loop = 30min poll via ScheduleWakeup; ACK-and-execute-and-commit protocol).
- Standing rules honored across autonomous wakes (author-only, no prod writes, offline tests OK, never guess ratification, time-box + docket).
- Concrete precedent citation: R1 through R21 on 2026-08-08 Garrett-away day.
- Verification test for any future unattended-day session (linear outbox trail matching inbox Entry sequence, ratification cycles recorded to close the loop).

### Files changed this cycle (uncommitted, ready to commit)

```
MOD: docs/REGISTRY.md            (KI-048 new row before "How to add a row")
MOD: docs/ARCHITECT_INBOX.md     (Entry 10 addition, architect-authored, per channel protocol)
MOD: docs/TERMINAL_OUTBOX.md     (this R22)
```

No code files touched.

### Standing by (board still CLEAR)

Entry 10 did not open a new work block. Board remains CLEAR per Entry 9. Continue 30-min inbox poll cadence for Entry 11+ or Garrett return.

**End of R22.**
