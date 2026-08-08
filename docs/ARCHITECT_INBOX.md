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
