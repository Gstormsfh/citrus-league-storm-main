# DAY DIRECTIVE — 2026-08-08 (Saturday, Garrett away until tonight)

**Source:** ARCHITECT — REVISED ALL-DAY DIRECTIVE, Saturday Aug 8.
**Supersedes:** morning-of directive with same core queue.
**Persistence:** durable memory across any context compaction.

---

## Verbatim directive text

ARCHITECT — REVISED ALL-DAY DIRECTIVE, Saturday Aug 8. Supersedes this morning's directive. If you already started that queue, keep all completed work, adopt this one from wherever you are. Garrett is away until tonight. You are to work CONTINUOUSLY — there is always a next item; do not end the session while any queue item remains.

STEP 0 — DURABILITY (do first, before any work):
1. Save this entire directive verbatim to docs/DAY_DIRECTIVE_2026-08-08.md and commit it.
2. Create docs/WORKLOG_2026-08-08.md. After EVERY item: append status (done/partial/blocked), commit sha, files touched, open questions. Commit the worklog with each update.
3. After any context compaction, re-read BOTH files before continuing. They are your memory.

STANDING RULES (absolute, unchanged):
- AUTHOR-ONLY. No rig runs, no deploys, no gcloud/docker/psql, no DB writes, no network-touching scripts. Allowed: reads, edits, local commits, typecheck, offline unit tests only.
- Never guess an architect decision: conservative path + TODO + docket + worklog entry, then MOVE ON.
- Time-box: 90 min max stalled on any unknown → docket and advance.
- Every diff ships with a safety argument (what breaks if wrong, why legacy unchanged, what remains unproven). Report all work as AUTHORED, never verified.

VERIFY LOOP (apply to every item): author → typecheck → offline unit tests where possible → re-read your own diff as a hostile reviewer (INS-16 lens: could this be a false green?) → fix or docket → worklog → commit → next item.

CORE QUEUE (from this morning, unchanged in substance):
P0 — F27b-2: the four file:line questions (cursor advance in bootstrapFullEventReplay; delivery path of the 06:38:35.899Z re-delivered seq 1; duplicate seq-1 in ring buffer + what resync-from-0 serves; minimal fix) + authored diff.
P1 — F28 per the ratified brief (docs/ if saved, else this morning's directive): deriveDraftState handles draft_started/draft_completed, IDEMPOTENT + MONOTONIC (completed never reverts); room completion UI replacing the clock, existing visual language; default-branch tolerance for unknown kinds; offline unit tests for all four acceptance cases. Client-only, wire types frozen, non-goals stand.
P2 — #53 harness seq-checker lifecycle awareness.
P3 — #52 draft-harness --pause-after=N + rig true assert F (second observer at pick 6: snapshot 1-5, live 6-12, completion).
P4 — N-2 option (A): AUTHOR (never apply) the migration clearing leagues.draft_state on completion, full apply-harness shape per MIGRATION_SAFETY_GUIDE.
P5 — Docs: three-chunk close doc; INS-16 entry; §15.14 boot vocabulary fix; DEPLOY_PROTOCOL AR-path fix; PROD_CHANGE_LEDGER entries (certified image 0ecbe605 @ sha256:152b7991…, pin advanced, 8b7b43f6 previous-good).

STRETCH QUEUE (start immediately when core completes — do not stop):
P6 — Adversarial self-review: re-read EVERY diff authored today as hostile reviewer; findings fixed or docketed.
P7 — F27b-2 blast-radius sweep (read-only): audit every client consumer of seq/resync (draftClientStore, optimistic layer, deriveDraftState, ws reconnect) for duplicate-seq tolerance; file:line findings to worklog.
P8 — AUTHOR THE TWELVE'S DRAFT-NIGHT RUNBOOK: real-league creation steps, commissioner button path, live decision tree for failures (stalled clock → what to check → container restart call, with exact pre-written PowerShell blocks for Garrett), rollback pins, evidence to capture. Write it so Garrett can run draft night from this one document under pressure.
P9 — Author the pre-twelve dry-run plan: real commissioner-branch auth press (NO service-role bypass), steps, asserts, evidence checklist.
P10 — S1-S4 legacy fixture migration plan: re-point perf scenarios to F27-native leagues; conditions for deleting the draft-harness legacy fallback.
P11 — Opportunistic hardening: extra offline unit tests around deriveDraftState edges; KI-042 consumer audit notes; ledger hygiene.

END OF DAY (only when P0-P11 exhausted or Garrett returns): compile docs/HANDOFF_2026-08-08.md from the worklog — per item: status, shas, deviations, open architect questions, and the ordered EXECUTE list for Garrett. Flag anything you believe blocks the twelve.

---

## Prior morning-of directive (referenced but superseded)

Referenced by "F28 per the ratified brief (docs/ if saved, else this morning's directive)". The morning directive's F28 v1 scope:

  a. deriveDraftState handles kind 'draft_completed' → draftStatus completed, clear on-clock team + deadline; handles 'draft_started' → in_progress + first deadline. BOTH must be IDEMPOTENT (F27b-2 means the client can receive draft_started twice) and MONOTONIC (completed must never revert to in_progress; a stray pick frame after completion must not un-complete the room).
  b. Room UI: completion state replaces the clock — "Draft complete" banner, pick controls disabled, clear next-step CTA (view roster/board). Match existing room visual language; no new design system.
  c. Purely client-side: no server calls, no wire-type changes (draftWire.ts variants are DEPLOYED and frozen), no RPC touches. Additive only.
  d. Any switch you add over event kinds must have a default branch that ignores unknown kinds with a debug log — never throw, never break on future types.

  NON-GOALS (named, do not build): celebration animation, post-draft summary page, push notifications, waiting-room/countdown.

  Acceptance you author now (unit-testable, offline): apply draft_started twice → identical state; snapshot says in_progress then live draft_completed → completed; draft_completed then stray pick frame → stays completed; unknown kind → no throw, state unchanged. Browser verification is Garrett's when he returns — do NOT claim visual verification.
