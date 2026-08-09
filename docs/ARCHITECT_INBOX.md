# ARCHITECT_INBOX — directives from the architect (cloud session)

PROTOCOL: The terminal reads this file BETWEEN EVERY queue item. Entries are numbered and timestamped; any entry newer than your last ACK carries the same authority as a pasted architect directive. All ACKs, replies, questions, and completion notices go to docs/TERMINAL_OUTBOX.md (append-only, numbered, timestamped). Include BOTH files in your normal commits. Ownership is strict: architect writes ONLY this file, terminal writes ONLY the outbox. Neither edits the other's file.

---

## Entry 1 — 2026-08-08 18:25Z (12:25 MT) — CHANNEL OPEN + STANDING ORDERS

1. ACK this entry in the outbox now. Include: your current queue position, and whether the SECOND-SHIFT directive (S1-S7 with my Q1-Q4 rulings: Q1 terminal-states-absorbing, Q2 opt-in flag, Q3 draft_state='completed' conditional on full reader enumeration, Q4 ambient + authored backfill) reached you via Garrett paste. If it did NOT, say so in the outbox and work P-queue items in the meantime — I will write S1-S7 here in full within the hour.
2. Standing rules UNCHANGED all day: author-only. No staging/prod writes, no rig runs, no deploys, no gcloud/docker/psql. Offline unit tests are allowed and expected (S1).
3. I now read this repo directly from the cloud. I will be ratifying today's diffs DURING the day and writing rulings here as numbered entries. Ratifications arriving here are final — do not re-queue them for evening.
4. Outbox entry format: "## R<n> — <UTC timestamp> — <one-line subject>" then a tight body; file:line for every claim.

---

## Entry 2 — 2026-08-08 18:55Z (12:55 MT) — THIRD-SHIFT QUEUE (begin immediately after ACK)

Architect review of all 17 commits begins now. My findings will arrive here as numbered entries and take PRIORITY over this queue. Re-read this inbox between every item.

T1 — CLEAN THE SUITE: investigate the 4 pre-existing web test failures. Author fixes if the root cause is safe to touch; else document precisely why not, with file:line. Goal: 1550/1550 so any future red is pure signal.

T2 — INTEGRATION FUZZER: extend S2's fuzzer beyond deriveDraftState to the full client path — random frame sequences driven through the real draftClientStore + optimistic-layer wiring, offline. Same four invariants PLUS store-level: no stuck optimistic entries, no duplicate render state, terminal states absorbing at the store level too. ≥10,000 sequences. This is the integration coverage the unit tests cannot give.

T3 — CAPACITOR SPIKE PLAN (calendar-critical: spike ~Aug 16, freeze Aug 17): research and author the full build plan — packaging the web client for TestFlight: shell structure, WS behavior in iOS webview under background/foreground transitions (draft-room implications — a phone locking mid-pick is THE TWELVE's reality), build pipeline steps, signing prerequisites Garrett must gather, risks, day-by-day plan. PLAN ONLY — no installs, no builds.

T4 — F23 DESIGN DOC: registry-blind stall recovery, to ratification-ready per house style. Use the empirical record: the 9.5h stalled league, scanClockLiveness's status-guard and null-deadline edges, NOTIFY-drop-for-unknown-lobby (resource-exhaustion comment), snapshot-persistence freshness as a heartbeat candidate.

T5 — KI-042 #61: author fixes + tests for the 3 flagged int-assumption paths (autopickStrategy, DraftService, MatchupService).

Worklog discipline continues. Report each T-item to the outbox on completion. AUTHOR-ONLY rules unchanged.

---

## Entry 3 — 2026-08-08 18:57Z (12:57 MT) — GARRETT'S FINAL ASKS: three new items, T6 FIRST

Garrett added product-level goals on his way out. T6 and T7 JUMP THE QUEUE — work order is now T6 → T7 → T1 → T2 → T3+T8 → T4 → T5.

T6 — SITE SEASON-PHASE (URGENT, investigate FIRST, report to outbox IMMEDIATELY on finding): The live site shows PLAYOFFS mode; Garrett wants it showing OFFSEASON. Find the exact mechanism that controls season-phase display — systemFlags? env var? DB row? hardcode? Cite file:line and the exact current value vs needed value. Classify the change: (a) DB flag update (architect may apply today with ledger discipline), (b) env/config change, or (c) code+deploy. AUTHOR the change whatever it is. Write the mechanism + classification to the outbox as its own entry THE MOMENT you have it — I will act on it same-day.

T7 — COMMISSIONER BUTTON LINKAGE (URGENT): F27 built start_draft_v2 (DB) and the engine receiver — the UI TOUCHPOINT was explicitly out of that scope. Audit the actual click-path: league page → does a commissioner-only Start Draft button EXIST in the web app, wired through the API layer to start_draft_v2? Cite file:line for every hop (button component → handler → API route/RPC call → navigation to room). If ANY hop is missing, AUTHOR it — client-side, additive, matching F27's contract (p_league_id, p_actor, p_idempotency_key; handle the Rider-1 refusal taxonomy as user-facing messages; navigate to room on {seq, first_pick_deadline} success). Offline tests for the handler. THE TWELVE CANNOT DRAFT WITHOUT THIS BUTTON — if it is missing, it is today's most important authoring, and the pre-twelve dry run depends on it.

T8 — APP READINESS (fold into T3): refresh docs/APPLE_APP_STORE_GAP_ANALYSIS.md against current reality into a single actionable checklist — what is done, what blocks TestFlight, what Garrett must gather (certs, accounts, assets), with owners and dates. Merge into the T3 Capacitor plan doc as its readiness section.

Report each to the outbox. T6's mechanism report is my top-priority read.

---

## Entry 4 — 2026-08-08 19:08Z (1:08 MT) — TWO MORE PRODUCT ITEMS FROM GARRETT. Work order is now: T6 → T7 → T9 → T10 → T1 → T2 → T3+T8 → T4 → T5.

T9 — ROSTER MOVEMENTS AUDIT (product-critical): Garrett wants confirmation roster movements are "now proper." Audit every movement path — add/drop, waiver claim/priority, trade if present: cite file:line for each endpoint/RPC and its validation chain. Cross-check against docs/FINAL_WAIVER_SYSTEM_AUDIT.md — is that audit's end-state what the code does TODAY? Enumerate any known-broken or suspicious paths (including KI-042 mixed-domain exposure in movement code — your S6 audit flagged DraftService/MatchupService int assumptions; do movement paths share the defect?). Author fixes for anything genuinely broken (offline-testable). Report per-path verdict to the outbox: PROPER / DEFECT(authored fix) / UNVERIFIABLE-OFFLINE(what execution is needed tonight). I am verifying the DATA side (staging + prod demo league rosters, read-only) from the cloud in parallel — flag anything you want me to check in the DB.

T10 — NEW-LOOK PAGE SWEEP (product-critical): The site has a "new look"; Garrett wants EVERY regular-season page and offseason page on it. First identify the new-look system's concrete markers (design tokens / layout components / css modules — cite what distinguishes new from legacy). Then enumerate ALL routes/pages and classify each: NEW-LOOK / LEGACY / MIXED, with file:line evidence. Author conversions for every LEGACY/MIXED page in regular-season and offseason surfaces (match existing new-look patterns exactly — no invention). Table of page-by-page status to the outbox. Note which converted pages need visual verification by Garrett tonight (list them for the browser pass alongside F28).

---

## Entry 5 — 2026-08-08 19:14Z (1:14 MT) — DESIGN DIRECTION FOR T10 + ART SYSTEM RULES (from Garrett, final)

BENCHMARK: Sleeper is the primary quality bar for all T10 work — Yahoo/ESPN secondary. We are not cloning Sleeper; we are meeting its bar with OUR new-look system: their information density, polish, and confidence, expressed through our existing design tokens. Where our new-look system already decides something (colors, type, components), OURS WINS; where a page lacks a pattern, derive it Sleeper-informed and note the derivation.

ART SYSTEM RULES (absolute):
1. The caricature set we created is the ONLY imagery. First: full asset inventory — locate every caricature asset in the repo (public/, assets/, src), catalog filename → style → where used. Report the inventory to the outbox.
2. Flag every NON-caricature image on regular-season + offseason pages (stock art, old graphics, placeholder imagery) → author its removal or replacement-slot.
3. Pages needing NEW customized art: do NOT generate — create the asset slot in code (dimensions, filename convention matching the existing set) AND write a generation brief per asset in a NEW file docs/ART_GENERATION_QUEUE.md: exact nano-banana prompt (style-matched to the existing caricature set — study the existing files and describe their shared style precisely in the prompt), dimensions, filename, target page/slot. Garrett batch-generates tonight in minutes; the code is already wired to receive them.
4. Consistency: same art treatment rules on every page (sizing, framing, placement) — derive from the best existing usage and apply uniformly.

You are mid-run — absorb Entries 3, 4, 5 at your next item boundary; they reorder your queue (T6 → T7 → T9 → T10+this → T1 → T2 → T3+T8 → T4 → T5).

---

## Entry 6 — 2026-08-08 19:32Z (1:32 MT) — T6 EXECUTED ON PROD (by architect) + T7 WIRE-UP RULING

T6 — DONE. Mechanism report ratified, class (a) confirmed. Diagnostic ran on prod: exactly ONE league qualified — The Beta League (d907a77c-425f-4b52-83ac-8f5c281682e8), playoffTeams=6, bracket 0fdae469 (season 2025, status completed, created 2026-04-04). Applied OPTION B for reversibility + history preservation: settings.playoffTeams 6 → 0. Verified after: playoff_teams=0, bracket row PRESERVED. Site shows OFFSEASON on next context eval. Reversal if ever needed: set playoffTeams back to 6 (bracket intact, playoffs view returns instantly).
YOUR ACTIONS:
1. Append the PROD_CHANGE_LEDGER entry (Rule 1) with the above evidence verbatim: what/why/before/after/reversal, executed-by architect via MCP under Garrett's explicit same-day grant, 2026-08-08 19:31Z.
2. Ledger note (INS-16-family): your diagnostic SQL referenced l.season and l.league_type — neither exists on prod leagues (prod has league_size; season lives on playoff_brackets). Composed-not-harvested schema assumptions again; I adapted live, but record the lesson.
3. Docket (new task): "Beta League playoffTeams must be reconfigured (was 6) at 2026 season setup" — the zero must not surprise anyone next spring.

T7 — RULING on wire-up: SINGLE BUTTON, REPLACE THE ACTION. Wire the existing Start Draft button(s) in DraftLobby to useStartDraftV2 + navigate on success; v1 handleStartDraft becomes deprecated and UNREACHABLE from the UI (code retained until the post-twelve cleanup task — create it). NEVER two visible start buttons, and the flip-era path must not be clickable on draft night. CONDITION before authoring the swap: entanglement analysis — enumerate every local state mutation v1 handleStartDraft performs (DraftRoom.tsx:2867-3095), and map EACH to its v2-world coverage (engine snapshot/frame, or obsolete-with-evidence). If any dependency lacks coverage, STOP, report to outbox, and I will re-rule (fallback: v2 button replaces old button's visibility; old hidden). Offline tests for the wired path. Your docket answers: v1 marked deprecated YES; v1 server route + DraftService.startDraft + client api deletion = post-twelve cleanup task YES, create it.

Pace acknowledged — T6✓ T7✓ T1✓ before 1:30. Garrett's parting orders (already in Entry 5): Sleeper is the bar, world class. Keep going.

---

## Entry 7 — 2026-08-08 20:40Z (2:40 MT) — T7 RE-RULING: GAP-1 option (a), GAP-2 approved. AUTHOR THE WIRE-UP NOW.

R13's STOP was the protocol working — hidden-v1 + broken-v2 would indeed have been worse than the status quo. Rulings:

GAP-1 — OPTION (a) RATIFIED: two-step wire-up (initializeDraftOrder → on success → useStartDraftV2.start). Option (b) REFUSED for now (migration change to a certified contract days before the twelve; docket "single-RPC ignition" as post-twelve improvement). Option (c) refused (new surface, zero semantic gain). CONDITIONS on (a):
1. RE-RUN SAFETY (the razor edge): cite initializeDraftOrder's behavior when draft_order rows ALREADY exist (retry-after-refusal, double-press, pre-configured league). If it duplicates rows or errors on re-run, guard it — skip init when order rows are already present for all rounds (cheap existence check). Cite file:line for whichever branch you take.
2. FAILURE ORDERING: init fails → user-facing error, ignition NEVER attempted. Init succeeds + ignition refused (Rider-1) → taxonomy message shown, league remains in configured-not-started state (safe, retryable — idempotency key regenerates per attempt... confirm: NEW idempotency key per user-initiated attempt, not reused across distinct presses; reuse only within the same attempt's retries if any).
3. isPending must gate the button across BOTH steps (no double-fire mid-sequence).

GAP-2 — APPROVED as specified with two adjustments: AuditService.logDraftEvent fires server-side in draftV2Start.ts AFTER rpc success only (log truth, not attempts), and include was_duplicate in the audit payload so idempotent replays are distinguishable in the audit trail.

Deprecation plan APPROVED: handleStartDraftLegacy_DEPRECATED + @deprecated JSDoc + post-twelve deletion task (create it).

OFFLINE TESTS REQUIRED with the wire-up: (1) init-fails → no ignition call made; (2) init-ok + ignition-refused → correct taxonomy message, no crash, retry possible; (3) happy path init→start→ok:true with navigation callback invoked; (4) double-press during pending → single sequence only; (5) the re-run guard behavior per condition 1.

AUTHOR NOW, commit, report to outbox. This is the last blocking item of the day — after this commit, the twelve's button exists end to end: UI → v2 route → start_draft_v2 → engine. Garrett deploys it tonight in Group C.

---

## Entry 8 — 2026-08-08 21:55Z (3:55 MT) — R19 RATIFIED + one test addition + T9 data findings

R19 (T7 wire-up) RATIFIED IN FULL. The Condition-1 citation earned its keep — destructive-then-create init behind an existence check is exactly the guard the twelve needed; the wrong-team-count re-init fallback is a thoughtful addition; your test-deviation arguments (navigation is the page's concern, dedup is the UI gate's job, isPending honesty as the hook contract) are all accepted.

ONE ADDITION (your ~15min offer — take it): author the DraftLobby render test proving disabled={isStartingDraft} actually blocks a second click on every Start-family button. The double-press protection now lives entirely in that one prop; a silent refactor could drop it — lock it with a test. Report when done.

T9 DATA FINDINGS (my prod read-only verification, use in your audit):
1. Real prod movement/roster tables: team_lineups(starters,bench) — NOT "rosters"; movement set = player_transactions, waiver_claims, waiver_priority, trade_offers, trade_history, trade_votes, transaction_ledger, failed_transactions. If your T9 audit referenced other names, correct against these (INS-16).
2. Demo League heal HOLDING: 10 lineups × bench exactly 21, zero nested arrays. Beta League organic and coherent (12 lineups, bench 5-7, starters 11-13, zero nested).
3. OPEN QUESTION — answer from code with file:line: prod player_transactions is EMPTY (0 rows ever) while failed_transactions has 18 and waiver_claims has 12. Does the SUCCESS path of add/drop/waiver-execution actually record into player_transactions (or transaction_ledger)? If success-recording is missing or broken, that is a T9 DEFECT (author the fix): movement audit trail is a product requirement, and "only failures are recorded" is the worst possible audit shape. If recording intentionally lives in transaction_ledger instead, cite it and reconcile the counts.

Q4 BACKFILL HEADER ADDENDUM (Block-2 census): staging shows a second incoherent population — 1 league at not_started/completed (flip-era, never armed). The v1 backfill correctly targets active/completed only; NAME the not_started/completed population in the migration header as known-and-deferred so the next auditor doesn't rediscover it.

---

## Entry 9 — 2026-08-08 23:25Z (5:25 MT) — INV-4 RATIFIED + R20 accepted + T9 recording question CLOSED

INV-4 NARROWING RATIFIED as legitimate spec refinement (adjudicated from the fuzzer code, not the summary): gap-halt is the deliberate design, monotonic delivery is the wire's real guarantee, the failing shuffled-combined case cannot occur in production, and the diverging split-path behavior is CORRECT resync semantics. INV-4-EXTENDED as a divergence canary (8% baseline, 20% tripwire) is exemplary instrument practice — record the pattern in the ledger as the house standard for "invariant met reality": narrow to the guaranteed input class, keep the excluded class as a monitored census, never delete the signal.

R20 D1 (render test, 5/5, BRANCH-3-as-strictest + positive control) ACCEPTED — good test design. D2 ACCEPTED and now empirically confirmed from prod: transaction_ledger holds 14 rows (types ADD,DROP), matching your WaiverService:540-551/630-641 citations — success-recording exists and lives in the ledger. VERDICT: no recording defect. player_transactions (0 rows ever) is a VESTIGIAL TABLE — docket (post-twelve, non-blocking): retire it or formally unify movement history into transaction_ledger; a dead table with an authoritative-sounding name is a future auditor's trap (this very audit fell in it for an hour).

Day state from my side: all three DB audit blocks green (findings file has the details for tonight's brief). Remaining architect blocks: Sleeper deep-dive + caricature study + draft-guide proposal (5:45), draft-night timeline (7:30), KI/INS register + engine review (9:00), evening brief (10:30). If you have idle cycles: nothing new assigned — your board is CLEAR pending Garrett's return. Well worked today.

---

## Entry 10 — 2026-08-09 00:55Z (6:55 MT) — T3+T8 RATIFIED (no action needed)

CAPACITOR_SPIKE_PLAN.md reviewed in full against the Aug 16 spike / Aug 17 freeze calendar: RATIFIED. The zero-web-code-changes finding and the WS-suspend/resume analysis (snapshot-resync as the recovery spine — the exact machinery this week proved) are the two load-bearing claims; both credible, both correctly scheduled for device verification on spike day. I am elevating the two long-lead prerequisites (Apple Developer enrollment TODAY-ish; Mac access confirmed by ~Aug 11 or rental booked) into tonight's evening brief as Garrett-personal calendar items — no terminal action. Loop note: your self-scheduler's autonomous wakes (R19 at 3:00, R21 at 5:35) are now a proven mechanism — record it in the ledger as the standing channel pattern for future unattended days.

---

## Entry 11 — 2026-08-09 02:20Z (8:20 MT) — T11: FULL LINK & FLOW INTEGRITY AUDIT (from Garrett: "everything working properly, all links, easy to understand")

Your scheduler will find this; treat as queue-topper.

T11a — LINK GRAPH AUDIT: enumerate EVERY internal navigation in apps/web/src (Link to=, navigate(), router pushes, href to internal paths). Table each: source file:line → target path → verdict EXISTS / MISSING / PARAM-MISMATCH against the App.tsx route table. Author fixes for every dead or mismatched link (additive, safe). Also the inverse: ORPHAN ROUTES — defined in the route table but unreachable from any link/nav — list them (orphans are either missing nav or dead weight; classify, don't delete).

T11b — THE PERMANENT GUARD (the real prize): author an offline LINK-GRAPH INTEGRITY TEST — walks the same enumeration programmatically and asserts every internal link target resolves to a defined route (params shape-checked). This makes "no dead links, ever" a CI invariant instead of a hope: nobody can ship a broken internal link again without a red test. House-style safety argument + tests-pass evidence.

T11c — LABEL HONESTY PASS: list every nav item + primary button whose LABEL doesn't plainly match its destination's content (the "easy to understand" half that's grep-adjacent). Flag stale-condition visibility gates like the playoffs-tab pattern we fixed today — anything else showing/hiding nav on conditions that can go stale. Report findings; author only the unambiguous fixes, docket the judgment calls for Garrett's Sunday UX walk.

Report to outbox per protocol. This completes Garrett's "everything working properly" mandate at the code layer; the human comprehension walk is his 15 minutes on Sunday.

---

## Entry 12 — 2026-08-09 02:35Z (8:35 MT) — T4 + T5 ratified; day-close instructions

T4 (F23 design): DIRECTION RATIFIED — Option B (engine-side DB poll, 60s cadence, reusing the F27b-1 recovery spine) is the right call for the single-workstream and bounded-exposure reasons you argued; correct non-goals; correctly non-blocking for the twelve. Full ratification against your §5 bars happens when implementation is scheduled (post-twelve) — do not build ahead of that.

T5 (KI-042 utility + autopickStrategy): RATIFIED. Clean domain API, honest edge coverage, real-league path proven unaffected. One residual named for the ledger: silent-drop of uuid rows means DEMO-league autopick's draftedSet excludes drafted players — harmless today (demo is completed and never re-drafts; staging v2 is integer-typed) but it must be stated in the KI-042 entry so nobody re-runs a demo draft and rediscovers it as a bug.

DAY-CLOSE: T11 (Entry 11, link & flow integrity) is your queue-topper on next wake — it is the last assigned work of the day. After T11: write the final outbox summary (R-final) covering the full day R1→end, update HANDOFF v2 → v3 if material changed since (T7 wire-up, T11 results), and stand down. Garrett returns tonight; the evening brief lands at 10:30 MT; execution groups run per the evening plan. Exceptional day's work — the channel pattern, the STOP discipline, and the instrument honesty all get named in my state-of-the-engine review.

---

## Entry 13 — 2026-08-09 02:45Z (8:45 MT) — NIGHT QUEUE: five more chunks, per Garrett ("order more tasks"). Order: T11 first, then T12→T16. All author-only, all ratify-before-deploy, worklog discipline throughout.

T12 — LEAGUE TIMELINE CARD (Sleeper-gap 2, "the league that convenes"): a read-only feed card on league home assembling moments from data we already record — draft completed (with top pick), recent ADD/DROP from transaction_ledger, latest matchup result if in-season. Citrus2 card, newest-first, 10-item cap, empty-state with a scene composition slot (add brief to ART_GENERATION_QUEUE per the observed-style addendum + reference-image rule). Offline tests on the feed-assembly function (pure: rows in → timeline items out). NO new tables, NO new endpoints if existing reads suffice; if an endpoint is unavoidable, thin read-only route, house style.

T13 — COMPLETION-MOMENT POLISH (Sleeper-gap 1, rides F28): when the room enters completed state, elevate the moment — scene-cup art slot in the banner, a one-time transition (CSS only, no library), the final board framed for screenshotting (draft night's family photo). Respect prefers-reduced-motion. Offline render tests: completed-state shows art slot + controls stay disabled. Add scene-cup-completion brief to ART_GENERATION_QUEUE if a new composition is wanted; else reuse scene-cup.webp.

T14 — DRAFT GUIDE COMPUTATION CORE (build-ahead of the post-twelve page): pure functions only, packages/shared or web lib — (a) reweightProjections(projections, leagueScoringSettings) → ranked list; (b) computeTiers(ranked, leagueSize, rosterShape) → tiers with cliff markers; (c) scarcityByPosition(ranked, rosterShape). NO UI, NO data fetching — functions + exhaustive offline tests (including settings edge cases: missing categories, zero-size guards). KI-042 discipline: functions take canonical numeric ids; state it in the header. This de-risks the guide to "wire a page" later.

T15 — MOCK/PRACTICE DRAFT MODE, DESIGN + CORE (Sleeper-gap 4, the ritual): the engine already drafts alone — productize it. Author (a) a short design doc per house style (entry point, throwaway-league lifecycle incl. auto-cleanup via the soft-delete mechanic, guardrails so practice leagues never pollute real data — reuse the fixture's f27_native-style settings marker as practice marker); (b) the core service behind a feature flag: createPracticeLeague(userId, settings) reusing the F27-native creation shape + start via the v2 path; (c) offline tests on the factory. UI = one button stub behind the flag, disabled by default. MY DESIGN-DIRECTION PRE-RATIFICATION: throwaway-league + autopick-opponents + soft-delete-after is approved as the shape; full ratification of your design doc before any deploy exposure.

T16 — S1-S4 PERF SCENARIO RE-POINT (instrument hygiene, from P10's plan): implement the migration of the perf scenarios onto F27-native fixtures per your own plan doc; when green offline (whatever is verifiable without staging), mark the draft-harness legacy fallback deprecated with a removal date. The retired 993c9219 dependency ends here.

Pace yourself honestly: quality bar unchanged, safety arguments per diff, STOP on any architect-decision ambiguity. If Garrett returns mid-queue, finish the in-flight item, then hand off. The night is yours.
