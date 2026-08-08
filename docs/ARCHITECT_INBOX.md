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
