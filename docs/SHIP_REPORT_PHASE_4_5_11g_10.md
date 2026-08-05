# Phase 4.5 chunk 11g.10 — Ship Report

**Deploy SHA:** `527ceb384d280ed3853de6e36000b442a54fdc76` on `phase-4-5-implementation`
**Image:** `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:527ceb38-draft`
**Image digest:** `sha256:d693189d6b2966e27164e9288bec314ef9a34c8907aa4b5165a9c8a39d6cb614`
**Deployed:** 2026-08-04T15:51:55Z, three-way digest chain intact (local build == push receipt == container's `deployment.fingerprint`)
**Acceptance run:** `S2-2026-08-04T18-10-43-804Z` — 36/36 picks, ~28 min, zero interventions, DB census clean (no gaps, snake ordering verified)
**Deployed engine before this ship:** `73a587ff` (F14/F15/F19/F20/F22 all UNSHIPPED to that surface)

---

## HEADLINE

**Seq 35 fired at `driftFromDeadlineMs = -1`.** The exact F20 trigger class — sub-millisecond-early fire against the armed deadline — recurred in the field during tonight's acceptance run and was **absorbed within the 25ms tolerance**. Pick processed normally. No `autopick.stale_timer_skipped` log. No re-arm strikes. Zero recovery escalations. **Last week (2026-07-31) the same condition killed the draft at seq 25/36 and left the engine sitting on a dead league for 44 minutes, logging itself healthy every 30 seconds.** Tonight it is one negative digit in one log line, invisible to users.

This is the strongest possible field confirmation of the F20 fix: the exact bug that motivated the guard tolerance + mandatory re-arm ran through the fixed code and produced normal draft behavior.

---

## Scorecard vs the locked acceptance criteria (A-F)

| | Criterion | Result | Evidence |
|---|---|---|---|
| **A** | Human drafts at slot 3 | **PASS** | Two human picks machine-flagged through the full fixed stack (F14+F15+F19+F20+F22 all live) |
| **B(i)** | Stale banner appears within ~36s of wifi kill | **PASS BY TESTIMONY** | Garrett witnessed the banner appearing. No screenshot capture was taken this run, so the 4010-watchdog-specific wording vs generic reconnecting-banner wording stays a named residual — closes for free when the Playwright fault-injection layer lands. |
| **B(ii)** | NO `auth/v1/logout` calls; session survives | **PASS** | F15/F19 field proof: Garrett drafted pick 22 and sat pick 27's window post-restore WITHOUT ever re-authenticating. The session demonstrably survived the outage window. |
| **B(iii)** | Auto-reconnect + resync + board rebuild COMPLETE vs DB census | **PASS** | Room recovered BY ITSELF, no manual refresh (Garrett's testimony). Combined with the DB census (36/36, no gaps, snake ordering intact) = auto-reconnect + resync + complete rebuild under real network loss, WITNESSED. This is the chunk's founding requirement met. |
| **C** | Freshly-authenticated rejoin (sign out → sign in → rejoin live → draft) | **PASS** (machine-flagged) | Stragglers-run 2026-08-05T00-21-15Z: Ctrl+C harness at pick 5 → F12 → Application → Clear site data → F5 → sign in fresh → rejoined live draft → drafted pick 10 with `is_autopick=false`. Full C dance completed on the deployed URL. |
| **D** | Draft reaches 36/36; raw log census | **PASS** | See "Field census" below. Zero interventions across the run. |
| **E** | F5 census from docker logs BEFORE cleanup restart | **PASS** | See "F5 — first field exercise" below |
| **F** | Managers panel reads "Harness Team 03" per KI-018 (F17) | **PASS** | Screenshot on file. "Harness Team 03 connected." |

---

## PRE-REGISTERED PREDICTION (first of the campaign)

Before Garrett ran the D+E census grep, the source-derived prediction was recorded:

> **"Pure zero across all F20 counts."** Derived from `LobbyManager.processSubmitPick:1826-1832` — after the final pick, in-memory `currentTimerDeadline` is explicitly nulled by the `else` branch on internal `draftStatus` transition. Scanner's edge-(a) NULL check silently skips. Zero strikes, zero recovery attempts, zero `clock_stall_giving_up`.

**Observation:** `stale_timer_skipped=0, clock_stall_recovered=0, clock_stall_giving_up=0`. **Prediction confirmed 3/3 — source-derived falsifiable claim, verified against metal, zero drift.**

Distinct from post-hoc arithmetic reconciliation (which explains observed numbers). This predicted the number from source before it was observed. New evidentiary weight for the record: a fix architecture that composes correctly on cases nobody designed for AND yields testable predictions before running.

---

## F5 — first field exercise

Chunk 11g.10's connection-resilience cull ladder (rung 1 `ws.end(4002)` → rung 2 `ws.close()` → rung 3 `LobbyManager.forceRemoveConnection`) was designed under investigation of a suspected Caddy-tunneled-TCP zombie scenario. Tonight was **the first time it ran in the field.**

**Census:**
```
heartbeat.cull.rung1_end        = 13
heartbeat.cull.rung2_close      = 0
heartbeat.cull.rung3_force_purge = 0
heartbeat.ws_end_threw          = 0
heartbeat.ws_close_threw        = 0
```

**Perfect 12+1 accounting:** 12 harness clients (one per bot in the S2 scenario) + 1 for Garrett's dead browser socket at the wifi-kill window. **Rung 1 sufficient for the abrupt-death class** — `ws.end(4002)` closed every dying connection cleanly, no rung-2 escalation needed, no rung-3 force-purge invoked, zero throws. **Distinct-connection-id verification VERIFIED** — 13 rung-1 lines carry 13 distinct connection ids, no repeat-cull inflation.

**Named residual:** the long-idle 7-hour zombie class — the specific scenario where the Caddy → engine tunneled TCP survives idle for hours after browser TCP dies — remains **unreproduced**. Rung-2 and rung-3 have unit-proven behavior but no field exercise. Bank as "F5 field-exercised at rung 1; long-idle class stays a named unreproduced residual."

---

## F13 — BOTH HALVES CLOSED

**Half 1 — full-run survival (proven 2026-07-31 + 2026-08-04):**
Append-stream NDJSON writer, pre-connect pg 'error' handler, idempotent fault-flush on uncaughtException / unhandledRejection / SIGINT / SIGTERM. Survived multiple full-length runs without incident. Artifacts on disk:
- `scripts/proof/results/S2-2026-08-04T18-10-43-804Z.ndjson`
- `scripts/proof/results/S2-2026-08-04T18-10-43-804Z.summary.txt`

**Half 2 — fault-flush path directly exercised (proven 2026-08-05):**
Stragglers-run S2-2026-08-05T00-21-15-188Z deliberately Ctrl+C'd after pick 5 per the designed choreography. Output produced `── ABORTED (SIGINT) ──` header verbatim + partial summary written to disk. Cadence break independently confirmed by DB census. The named gap — "the fault-flush path itself hasn't been directly exercised in a controlled test" — CLOSES on that header. KI-023 flips to fully RESOLVED.

**F18-family observation (non-blocking, folds into KI-019):** the abort-path summary reported `Samples captured: 0` despite 5 completed picks and 60 delivered observations shown live. The SIGINT counter reads a different accumulator than the one populated during normal run. Instrument-reporting bug, NOT a fault-flush-integrity bug — the header + summary-file existence prove the flush ran correctly. Fix folds into the F18 summary-generator work.

---

## F24 — new finding, NEVER BUILT (registered KI-029 candidate)

**Classification (sharpened per architect):** "The lobby knows the draft ended; the league is never told." The in-memory half of completion WAS deliberately built — `LobbyManager.processSubmitPick:1826-1832`'s else-branch cleanly tears down timer + deadline with a matching comment ("Draft completed. Clear timer + deadline"). The NEVER-BUILT half is the **emitter**: DB `draft_status` never flips to `'completed'` for v2 drafts, and the `draft_completed` event exists in the enum with a live receiver and zero emitters. **A receiver waiting for an emitter that was never built.**

**Evidence chain from source:**
- `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql:867-902` — `submit_pick_v2` unconditionally increments `draft_event_counter` and unconditionally sets `pick_deadline = now + pickTimeLimit + 1s`, even on the final pick. No completion branch.
- `server/src/draft/LobbyManager.ts:2833, 2996` — receiver for `draft_completed` event exists.
- `git grep -rn "'draft_completed'"` — enum + receiver only; **zero code paths emit** the event.

**Compensating control (why this survived every prior run unseen):** the cookbook's manual `set-draft-status --to=completed` runs post-each-acceptance. Without that step, `leagues.draft_status` would stay `'in_progress'` forever for every v2 draft.

**Composed-safety observation (ruling 3 paying rent):** F20's scanner didn't grind forever on the completed-DB-but-live-in-registry lobby because TWO independent guards fire on the same never-designed-for case:
1. `LobbyManager.processSubmitPick`'s else-branch nulls in-memory `currentTimerDeadline`
2. Scanner's edge-(a) NULL check silently skips lobbies with null deadlines
Either alone would suffice; both together are why the pre-registered `clock_stall_giving_up=0` prediction held.

**F23 interaction — MANDATORY sequence:** the F23 (KI-025) DB-side vanished-lobby scanner has NO in-memory lobby view. Neither of the above silencing protections exists for it. As specced today it would grind recovery attempts forever on every completed v2 draft. **F24's fix is a prerequisite for F23, OR F23 must independently derive board-fullness before recovery.**

**Fix shape (own chunk, week-2 refinement tier, Draft-Night adjacent priority):** on final pick, `submit_pick_v2` (a) flips `draft_status='completed'`, (b) emits `draft_completed` via `append_draft_event` (receiver already handles), (c) stops setting a next `pick_deadline`. Ships before the twelve-human draft.

---

## Mandate numbers, with caveats (per architect KI-017 requirement)

Every mandate figure below was measured on tonight's acceptance run OR is carried forward unchanged from prior chunks. **All harness-measured numbers carry the F16 (KI-017) actor-branch caveat:** the harness exercised the `actor.kind='autopick'` branch of `submit_pick_v2` only; human-actor-branch validation covers ~4 browser picks per acceptance run (tonight: 2). Rail (insert / trigger / NOTIFY / broadcast / ordering) is downstream of the actor branch and therefore branch-agnostic — those numbers stand.

| Mandate target | Tonight's result | Notes |
|---|---|---|
| Manual pick submission p95 ≤ 300ms | Not re-measured tonight | Chunk 11g.10 harness numbers stand; two human picks landed cleanly through the fixed stack |
| Autopick latency p95 ≤ 1000ms | Not re-measured tonight | Ratified in prior chunks; 28-min run at ~60s clock is not a latency stress case |
| Pick-to-broadcast fanout p95 ≤ 200ms | Not re-measured tonight | Same |
| Timer accuracy drift < 100ms | Field data: seq 35 drift = **-1ms** (absorbed) | Best drift observation of the campaign; other picks unremarkable |
| Reconnection recovery p95 ≤ 2000ms | Awaiting Garrett's B(iii) testimony to score formally | Board rebuild completeness verified via DB census |

**Drop-rate story (corrected per KI-019 pending F18 fix):** 96/96 delivered on all submitted picks; 12 harness expectations for pick 9 were NOT-SUBMITTED (harness offline — F18/KI-019 partition), not dropped. **True drop rate: 0%.** Tonight's harness summary should be annotated by hand to separate the not-submitted partition from the delivered/dropped partition until F18's summary generator is fixed.

---

## Suite baselines (closing the earlier labeling slip — Amendment 1)

**Pre-campaign baseline (DERIVED, never directly measured):** 45 test files / 942 tests (server). Derived by subtracting the F15+F19 additions (+2 files / +11 tests via `9ea634db`) from the first checkpoint below.

**First MEASURED checkpoint (post `9ea634db`):** 47 files / 953 tests. This is what earlier reports called "pre-campaign baseline" — the labeling slip. Fixed here for the permanent record.

**Chunk 11g.10 checkpoint chain (all measured):**
```
45/942  (derived, pre-9ea634db)
47/953  post-9ea634db          — first measured; F15+F19 tests bundled
48/961  post-88f46ce0          — +8 F20 guard boundary tests
49/970  post-067474e9          — +9 F20 scanner boundary tests
50/971  post-856a5fe0          — +1 CASE 5b outcome test
50/975  post-0752c6fb          — +4 F14 route- and method-level tests
```

**Post-campaign server suite:** **50 files / 975 tests, all green.**

**Full-campaign delta:** **+5 files / +33 tests.** (Prior report's "+3 files / +22 tests" was the post-F15 delta only — corrected.)

**Post-campaign apps/web suite:** **79 files / 1524 pass / 4 fail.** The 4 failures are the standing DST-suspicion date-boundary cluster from the open ledger (ScheduleService × 2, projectionHelper × 2) — unrelated to this campaign. **Every red on the board is a named defect** (F22 unblocked the DraftRoomV2 dark suite of 13 tests during this campaign; before F22 the suite was silently green while executing zero assertions).

Contract tests (unstubbed, hermetic via `.invalid` hostname per RFC 6761 §6.4): server-side + web-side, both confirm supabase-js resolves-with-`AuthRetryableFetchError` on network failure. If that library behavior ever flips to reject, both tests fail immediately.

---

## Zach-briefing corrections required BEFORE that doc goes out

1. **Abandoned-draft claim.** Prior briefing text: engine "autopicked round after round on the configured cadence until the board was full." **Amend or qualify:** tonight's run confirmed 36/36 self-completion with zero interventions **through a live outage** (Garrett present at start, wifi killed mid-draft, drafted through post-restore). The prior claim was ratified in a different scenario (nobody ever connected). "Everyone left mid-draft" was contradicted by the 2026-07-31 F20 stall (which we now know was the guard defect, not the abandoned-draft class). Post-F20 fix: no scenario has produced a stall.
2. **"Same road" sentence** ("human picks and autopicks travel this same road, so there is exactly one place where a pick can become real"). **Amend:** true at the function level, but `submit_pick_v2` BRANCHES on `actor.kind` and the harness only drives one branch. Ship the qualifier: "same function; branches on actor kind; human-actor branch has ~4 field picks of coverage per acceptance run."
3. **KI-013 (F12) refinement.** Engine autopick sources REAL NHL player IDs correctly (tonight: McDavid 8478402 verbatim in DB). F12/KI-013's `#<id>` fallback rendering is a fixture-12 defect only — harness-slot picks look wrong because the FIXTURE uses synthetic ids, not because the engine has any issue picking real players. Demo risk lower than originally logged.

---

## Registry deltas (KI-014..KI-030) landed via commit `527ceb38` + `52317577` + docs commits during the run

- **KI-014** — F6 close-out (mechanism identified as stale cached membership; two beta-triage advance-notice items)
- **KI-015** — F14 (both layers with Amendment 1 live-path trace + Amendment 3 DB-side writer note)
- **KI-016** — F15 (authMiddleware 401→503 discrimination + unstubbed contract test)
- **KI-017** — F16 (harness never drove human-actor branch; ship-report caveat requirement — applied above)
- **KI-018** — F17 (fixture-12 ownership-strip contract; Managers panel reads "Harness Team N")
- **KI-019** — F18 (drop-rate not-submitted partition annotation — applied above)
- **KI-020** — F19 (refreshTokenOnce signout on network failure)
- **KI-021** — F20 code-closed 856a5fe0; **tolerance-absorption path field-validated on the recurred trigger class (seq 35, drift -1, absorbed) via tonight's seq-35 headline.** Re-arm path (beyond-tolerance rejection) and scanner recovery path fired **zero** times in the field — the 0/0/0 census means those two layers remain **unit-proven backstops, unfired in field**. Same sentence discipline as F5's "rung 1 field-exercised; long-idle 7-hour zombie class remains unreproduced residual" applied here for consistency (Amendment 2).
- **KI-022** — F22 (dark suite; structural fix with satisfies type check; 4th instance-of-species)
- **KI-023** — F13 halves (NDJSON+flush proven; SIGINT test pending in mini-run)
- **KI-024** — Cloud Run per-instance cache-coherence architecture note (enriched by F14 Amendment 3)
- **KI-025** — F23 (DB-side vanished-lobby scan; deferred; own chunk; F24 prerequisite noted)
- **KI-026** — RESOLVED tonight via deploy 527ceb38 (deployed engine now runs post-F15 authMiddleware on /api/admin)
- **KI-027** — systemFlags.ts:96 F21-family observability bug (err arg silently dropped)
- **KI-028** — History "Drafted By" column: **NOT REPRODUCED tonight** (rendered team names correctly). Investigation deferred — either a fix landed incidentally this week or the original observation was a symptom of the broken F14 session. Screenshot from tonight's run on file. Keep KI open pending git-log investigation.
- **KI-029** (NEW, candidate) — F24 draft-completion never-built (this report's F24 section)
- **KI-030** (NEW, candidate) — Board widget "36 of 192" totalPicks derivation cosmetic (demo-optics family with KI-013 + KI-028)

---

## Honest ledger — what did NOT close tonight, folded into the follow-up mini-run

- **B(i)** — PASS by testimony (banner witnessed); no capture, so 4010-vs-generic wording stays a named residual — closes for free via Playwright fault-injection layer later
- **B(iii)** — PASS by testimony + DB census (room recovered by itself, no refresh; 36/36 complete against DB)
- **C** freshly-authenticated rejoin — **PASS** (machine-flagged via stragglers-run 2026-08-05T00-21-15Z)
- **F13** second half (fault-flush path directly exercised via SIGINT) — **CLOSED** (same stragglers-run; `── ABORTED (SIGINT) ──` header verbatim + partial summary on disk)
- **F5** distinct-connection-id verification — 13 rung-1 lines, 13 distinct connection ids VERIFIED (no repeat-cull inflation)
- **F18-family SIGINT counter (NEW, non-blocking, KI-019 fold-in)** — the abort-path summary reports `Samples captured: 0` despite N delivered observations shown live. SIGINT counter reads the wrong accumulator. Fix folds into the F18 summary-generator work; does not affect fault-flush integrity.
- **Cleanup snapshot race (NEW, KI-031)** — the engine's 30 s snapshot writer can tick between the cleanup reset's DELETE and the engine restart landing, leaving an orphan snapshot with pre-reset state. Persisted cousin of the seq-dedup bug. Cookbook amended: cleanup gains a final `clear-snapshots.local.mjs --execute` step AFTER the engine restart; `snapshots=0` is now the pristine-baseline tripwire that catches the race whenever it recurs.
- **F18** false-red observed again in the harness summary — annotated by hand for now
- **F24 (KI-029)** — own chunk, week-2 refinement tier, Draft-Night adjacent priority
- **KI-025 (F23)** — deferred pending F24 landing, or independent board-fullness derivation
- **KI-028** — investigation deferred; keep open until we understand whether tonight's clean render was a fix or a symptom-of-the-broken-session
- **KI-030** — cosmetic; ships with demo-cleanup round alongside KI-013
- **KI-027** — one-minute fix any time

---

## Commit chain for the ship-report record

```
9ea634db  fix(F15+F19): auth-provider-unreachable no longer triggers logout
88f46ce0  fix(F20 guard): early-fire tolerance + mandatory re-arm + fail-open cap
e1bc9d00  test(F20 Amendment A): outcome assertions on CASE 3 + CASE 6, prep for scanner
067474e9  feat(F20 Piece 3): global clock-liveness scanner + LobbyManager.attemptClockRecovery
856a5fe0  test(F20 Piece 3 confirmation 2): CASE 5b — scanner-driven autopick outcome
5e5c884e  fix(F22): repair DraftRoomV2 runner mock — 13 previously-dark tests execute
fe268e1c  fix(F14b + F22 structural): myTeamId cross-check with fail-loud + shared runner mock factory
0752c6fb  fix(F14a + F14b honest-copy): teamId out of membership cache, fresh resolver in the pick path
527ceb38  chore(ship-report prep): strip [DR-2 diag] + append KI-014..KI-028 to REGISTRY   ← DEPLOYED
cbcd9020  docs(KI-025): field illustration — post-527ceb38 zombie draft demonstrates F23 gap
52317577  docs(KI-026): RESOLVED — deploy 527ceb38 carries F15 to /api/admin surface
```

---

## Next steps (in order)

1. **Distinct-connection-id verification** on the 13 rung-1 census lines (grep pending)
2. **F13 SIGINT mini-run with criterion C rejoin folded in** — ~10 minutes, standalone short scenario
3. **Ship-report ratification** (this document) at architect final gate
4. **KI-029 (F24) chunk** — Draft-Night adjacent; ships before the twelve-human draft
5. **Full twelve-human draft** on staging — the real end-to-end acceptance case for launch

---

**Report authored:** 2026-08-04
**Author:** Assistant, on the phase-4-5-implementation branch, at the direction of the architect and Garrett as CEO/witness
**Awaiting:** architect final gate
