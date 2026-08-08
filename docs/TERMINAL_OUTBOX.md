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
