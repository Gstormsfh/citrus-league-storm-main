# T15 design doc — MOCK / PRACTICE DRAFT MODE

**Status.** Design authored 2026-08-09 (T15 architect Entry 13 night queue). **Ratification-ready.** Architect Entry 13 pre-ratified the shape ("throwaway-league + autopick-opponents + soft-delete-after"); this doc names the design boundaries to earn the full ratification before deploy exposure.
**Author.** Terminal.
**Owner.** Engine team (server/src/draft/) + web team (apps/web/src/pages/DraftLobby, DraftRoomV2).
**Priority.** Post-twelve Sleeper-gap 4 ("the ritual") + build-ahead. Feature flag stays FALSE until architect ratifies + Garrett flips post-close.

---

## §1 — Problem

Managers want to practice-draft before opening day: try positions, feel the timer, evaluate autopick's picks, rehearse queue strategies. Sleeper productizes this with a one-button "mock draft" that spins up a throwaway league, autopicks the other seats, and disappears when the manager leaves. Citrus's engine ALREADY drafts alone (F27 + autopick cascade + F24 completion emitter all proven); T15 turns the engine's capability into a UX ritual.

Today the only way to see the draft experience is to start a real league — pollutes the manager's league list, creates real DB rows they can't hide, and interacts with prod scoring. Practice-mode gap prevents low-friction rehearsal.

---

## §2 — Non-goals

- **Not a shared multiplayer mock draft.** Sleeper offers "join a random room with 11 strangers"; that's a marketplace product that requires matchmaking + lobby-fill + reliability guarantees. Out of scope.
- **Not a draft-strategy engine.** Practice mode uses the SAME autopick cascade the real engine uses (projectionsStrategy today). No parallel strategy for opponents.
- **Not a savefile / resume mechanism.** Practice drafts are throwaway — leaving = deleting. No mid-session recovery.
- **Not a replacement for the real draft.** Practice-mode leagues are marked as such; results never touch a real league's roster / scoring / standings.
- **Not a mobile UX design.** T15 authors the shape + core; mobile-first UX polish happens post-T3+T8 Capacitor spike.

---

## §3 — Design shape (pre-ratified by architect Entry 13)

**Throwaway league.** A practice draft = a fresh league with:
- `leagueName = "Practice — <timestamp>"` (unique so multiple concurrent practices don't collide).
- `commissionerId = requesting user`.
- `teams = 12` (Citrus default).
- **1 human seat + 11 autopick seats** (the requesting user gets one team; all other seats are AI-owned).
- `scoring_settings = DEFAULT_SCORING` (@citrus/shared — user does NOT override; keeps practice deterministic).
- `draft_status = 'not_started'`, will F27-ignite immediately after creation.
- **`settings.practice = true`** marker (per Entry 13 verbatim: "reuse the fixture's f27_native-style settings marker as practice marker").
- **`is_deleted = false`, `deleted_at = null`** at creation; soft-delete-only lifecycle.

**Autopick opponents.** All 11 non-human seats are owned by a synthetic AI user (`autopick_user_id` — reused from fixture-12's AI-team pattern). When the timer expires on their pick, engine's normal autopick cascade fires per Rider 2 abandoned-mid-draft handling (proven at commit 8661d3d4). Human user drafts manually via the same UI.

**Soft-delete-after.** When user leaves the practice room OR after N days idle, the league is soft-deleted:
- `is_deleted = true`, `deleted_at = now()`.
- All `LeagueService` list queries filter `is_deleted = false` (existing pattern for regular leagues).
- Draft artifacts (`draft_events`, `draft_picks_v2`, `team_lineups`, etc.) are NOT physically deleted — remain queryable for debugging + KI-042 discipline (mixed-domain player_id rows stay untouched).
- A separate janitor task (docketed, not in T15 scope) hard-deletes soft-deleted practice leagues > 30 days old.

**Guardrails so practice never pollutes real data.**
- Every read query in server-side aggregations (`fetchTransactions`, `computeStandings`, `getLeaderboard`, etc.) MUST filter `NOT settings ? 'practice' OR NOT (settings ->> 'practice')::boolean`. NEW guardrail — requires audit + additions to existing queries.
- Membership APIs treat practice leagues as private-to-commissioner (no other user can be invited or added).
- Waiver / roster APIs are unaffected (practice league has no post-draft season — the moment draft completes, the practice is done).

---

## §4 — Feature flag

Pre-ratified: UI button is a **stub, disabled by default**. Flag:

```
apps/web/src/lib/featureFlags.ts (NEW)
  export const FEATURE_PRACTICE_DRAFT = false;
```

Consumers:
- `apps/web/src/pages/GMOffice.tsx` (or wherever the "start practice" button lands) reads the flag; renders a disabled button with a "Coming soon" tooltip when false, active when true.
- `server/src/services/DraftService.ts:createPracticeLeague` returns `error: 'feature_disabled'` when the flag is false (defense-in-depth if the UI leaks and the client tries the API).

Flag flip requires:
- Architect ratification of THIS design doc.
- Post-TWELVE (no new capacity during THE TWELVE per KI-041 discipline).
- Garrett-manual flip (env var override) — no automatic rollout.

---

## §5 — Ratification bars (architect adjudicates in order)

1. **Throwaway lifecycle model.** Soft-delete-on-leave. Hard-delete via separate janitor > 30 days. Ratify or amend.
2. **Practice marker location.** `settings.practice = true` — reuse of the fixture's f27_native-style pattern. Ratify or specify alternative (e.g., dedicated `leagues.is_practice` column).
3. **Guardrail scope.** Every existing read aggregation query must filter practice-marker. Ratify the enumeration + the audit-then-add rollout OR specify a narrower scope (e.g., "only Standings + Transactions").
4. **Feature flag mechanism.** Static-const boolean in `apps/web/src/lib/featureFlags.ts` (simplest — no env plumbing, no runtime config). Ratify or specify a runtime-config mechanism.
5. **Reuse of `autopick_user_id`.** Fixture-12 uses this synthetic AI user for autopick seats. T15 reuses. Ratify or specify a distinct practice-only AI user.
6. **F27 ignition path.** Practice league starts via the same `start_draft_v2` RPC as real leagues (immediately, no queued state). Ratify or specify a distinct ignition path.
7. **Concurrency policy.** How many concurrent practice leagues can one user have? T15 default: **1** (starting a new practice soft-deletes any prior one owned by the same user). Ratify or specify.
8. **KI-047 interaction.** Practice-league draft_picks rows use numeric player_id (real projections, KI-042 discipline). Ratify.
9. **KI-042 interaction.** Practice-league draft_events → transaction_ledger writes (via WaiverService) would NEVER fire because practice has no post-draft season. Confirm no ledger writes needed for practice; ratify.

---

## §6 — Files to author (T15 scope, this session)

- `docs/DESIGN_T15_practice_draft_mode.md` — this doc.
- `apps/web/src/lib/featureFlags.ts` (NEW) — `FEATURE_PRACTICE_DRAFT = false`.
- `packages/shared/src/utils/practiceDraft.ts` (NEW) — pure factory: `buildPracticeLeaguePayload(userId, options?) → PracticeLeaguePayload` (no I/O; consumers pass to real creation endpoint).
- `packages/shared/src/utils/__tests__/practiceDraft.test.ts` (NEW) — offline tests on the factory (shape correctness, marker present, no-collisions on unique naming).
- **UI button stub deferred until §5 ratification.** Authoring the button requires knowing WHERE it lands (GMOffice? DraftLobby? both?) — architect Sunday walk call.

Files NOT authored yet (post-ratification):
- `server/src/services/DraftService.ts.createPracticeLeague(userId, options)` — server-side factory that writes to DB (guarded by FEATURE_PRACTICE_DRAFT flag).
- Server route + client API wrappers.
- Janitor task for hard-delete > 30 days.
- Aggregation-query audit + additions (§3 guardrails).

---

## §7 — Diff safety argument

**Blast radius today (T15 scope).** Zero DB writes. Zero prod interactions. Design doc + one const + one pure factory + tests. FEATURE_PRACTICE_DRAFT const stays `false` — no UI surface until ratified. Even if the const is accidentally flipped, no server-side service exists to consume the factory's output; the payload would be built and thrown away.

**Post-ratification blast radius.** DB writes create real `leagues` rows marked `settings.practice=true`. Guardrails in §3 prevent bleed into standings / transactions / other aggregations. Soft-delete ensures no permanent litter. Concurrency policy (§5 #7) prevents runaway league creation.

**Reversibility.** Feature flag flip is git commit. Existing practice leagues at flip-off: soft-delete via a one-line UPDATE. No schema changes required for the flip.

---

## §8 — See also

- Architect Entry 13 (2026-08-09) `docs/ARCHITECT_INBOX.md` — T15 pre-ratification of shape.
- Fixture-12 f27_native mode (`scripts/proof/fixture-12-*.local.json`) — reference for the settings-marker pattern.
- KI-041 (cron governance) — flag-flip discipline post-TWELVE.
- KI-047 (vestigial `player_transactions`) — practice-league draft moves DO NOT write to that table (dead code).
- Rider 2 abandoned-mid-draft handling (commit 8661d3d4, 2026-08-08) — engine already drives autopick-only drafts.
- `docs/DESIGN_F27_start_draft_v2.md` — ignition contract that practice leagues reuse.
