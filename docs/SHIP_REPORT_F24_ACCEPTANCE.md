# F24 Acceptance Report — Draft Completion Emitter (KI-029)

**Date:** 2026-08-05
**Chunk:** F24 / KI-029 — v2 draft-completion emitter
**Migration:** `supabase/migrations/20260805050000_v2_draft_completion_emitter_rebased.sql`
**Live md5:** `0936f891d707da231446d440b452197f` (post-apply, ratified by architect)
**Status:** **CLOSED** — emitter contract fully machine-proven; residual F26 gated before THE TWELVE.

## TL;DR

DB-side emitter shipped and proved end-to-end on staging. Architect ratified A/B/D blocks with independent verification (sha256 recompute, event census, marker set). C block surfaced F26 (KI-035) as a NEW defect in the engine's *external-apply* reception path — not a bug in the emitter but a gap in the receiver that acceptance was the first to exercise. F24 close-out ships without an F26 fix; F26 fix + engine deploy is gated before THE TWELVE.

## Block-by-block adjudication

### A. leagues transition — PASS

- `leagues.draft_status='completed'`
- `leagues.pick_deadline=NULL`
- `leagues.draft_event_counter=13`

Flip is the RPC's own — ignition-guarded within the same transaction as the pick INSERT (D3 placement invariant). No lag, no race window.

### B. draft_completed event — PASS

Seq 13 landed with:
- Payload `{total_picks:12, completed_at}`
- NULL idempotency key (single-fire per D3 lock discipline)
- Actor inherited from final-pick caller
- `correlation_id` == pick 12's correlation (threads completion to triggering pick)
- **Architect's independent sha256 recompute MATCHES stored `payload_hash`** — Amendment 4's server-computed hash verified end-to-end

Event census on `draft_events` for the league:
- Seqs 1..13 gap-free
- No duplicate seqs
- No orphaned events

**Observations (non-defect, documented):**
1. Completion event `event_version=1` (append_draft_event default; same as `draft_started`). Pick events at `version=2` (batch-2 bump) — expected version-domain divergence, not a defect.
2. Pick `payload_hash` is caller-domain by design (idempotency token from the caller's payload; not DB-recomputable). Only completion `payload_hash` is server-computed (Amendment 4).
3. `leagues.draft_state='active'` unchanged post-completion (Amendment 2 evidence-closed; KI-034 documents the deliberate non-write).

### C. Engine external-apply broadcast — TRUE NEGATIVE → F26 (KI-035)

Zero `draft_completed` frames observed in the ndjson capture across all 12 connected clients.

Engine-side evidence:
- `2026-08-05T18:26:07.082Z external_event.applied league=<lg> seq=13 type=draft_completed broadcasted=false`
- All 12 clients still connected at that timestamp
- Client-side WS closes cascade began +88 ms later (client timer-expiry cascade induced by F26)
- `2026-08-05T18:27:03Z RAISE WARNING clock fired but draftStatus=completed — ignored (timer should have been cancelled)` — F20 guard absorbed + announced the residual expiry that F26 failed to prevent

**Root cause (KI-035 / F26):** `server/src/draft/LobbyManager.ts:2833-2835` external-apply switch's `case 'draft_completed'` sets internal status only. Does NOT (1) broadcast, (2) cancel armed timer, (3) initiate teardown. Internal-path receiver at 1826-1832 does all three — field-proven pre-F24. External path was never exercised until acceptance (because prior chunks never emitted `draft_completed`).

**Severity:** UX / wrong-signal, not liveness. DB completes correctly; F20 guard absorbs the timer residual; no data corruption. But no production user would understand why the room went silent and their timer never rang.

**Gate:** F26 fix + engine deploy before THE TWELVE (12-human draft on staging). See KI-035 for surface + verification.

### D. Picks 1-12 clean — PASS

- All 12 picks applied + broadcast clean end-to-end
- Cursor dedup worked as designed
- Zero pick-path defects
- One WARNING at 18:27:03 — F26-induced residual, F20 guard behaved correctly

## Emitter architecture that shipped

Preserved through the F25 rebase and Amendments 1-4:

- **Structural SUM** `SUM(jsonb_array_length(team_order))` filtered `deleted_at IS NULL` (D1 + Amendment 3 mirror)
- **D2 defense-in-depth guard** — `IF v_total_picks > 0 AND p_pick_number >= v_total_picks`
- **D8 absorb-and-announce WARNING** on impossible strict-greater case
- **Amendment 1 UPDATE** — `draft_status='completed', pick_deadline=NULL`
- **Amendment 4 completion event** — `append_draft_event('draft_completed', v_completion_payload, NULL, v_completion_hash, p_actor, v_correlation_id)` with sha256-hashed payload
- Snake/linear only (D5)
- `draft_state` unwritten (Amendment 2; KI-034)

## Direct-apply harness — instrument ledger this campaign

The apply itself surfaced four instrument-family defects across INS-4..INS-7, all caught safely by the transactional wrap. Cumulative pattern documented in `docs/INSTRUMENT_LEDGER.md`:

| ID | Failure mode | Cost |
|---|---|---|
| INS-4 | STEP 0 whole-body regex false-red on `'pick_deadline'` | Refused a correct apply; adjudicated → hash pin |
| INS-5 | STEP 3 four markers false-red (window overflow + contiguous-pattern kill) | Refused a correct apply; adjudicated → self-anchored regex + dry-run harness |
| INS-6 | STEP 4a psql `:'var'` interpolation skipped inside dollar-quoted DO body | Runtime syntax error, full rollback; fix → transaction-local GUC bridge + rehearsal script |
| INS-7 | Wire `client_encoding` default on Windows mangled non-ASCII source bytes | Cosmetic divergence in comments + D8 WARNING literal; no remediation; Rule 3 added |

Standing rules added to `docs/MIGRATION_SAFETY_GUIDE.md`:
- **Rule 1** — Capture-before-replace: `pg_get_functiondef` output committed with every `CREATE OR REPLACE FUNCTION` migration
- **Rule 2** — Real SQL in direct-apply history rows (byte-exact; no placeholders)
- **Rule 3** — `client_encoding=UTF8` forced on every `psql -f` apply

Standing enforcement triad now: `ON_ERROR_STOP` + transactional wrap + `client_encoding=UTF8`.

## Commit stack for F24 (chronological)

```
7d4c7323 fix(F24 rebase / F25 recovery): supersede 20260805023419 with batch-2 base
1f7b5328 fix(apply-f24-rebase INS-4): STEP 0 hash-pin + windowed diagnostics
2aa44ae1 fix(apply-f24-rebase INS-5): STEP 3 markers — 4 false-reds patched, dry-run gate
0d179263 evidence(F25): pg_get_functiondef capture of F25-broken submit_pick_v2 body (pre-rebase)
ac42e4f9 fix(apply-f24-rebase INS-6): psql→plpgsql bridge via transaction-local GUC + rehearsal gate
e1377a9b docs(INS-7 / Rule 3): psql -f client_encoding=UTF8 required on direct applies
```

Then the acceptance-close commit (this addendum + REGISTRY KI-029/KI-035).

## Next on the board

1. **F26 / KI-035** — fix + engine deploy. Gate before THE TWELVE.
2. **SL-1 triage** — auto-fix-integrity dead for ≥8 days (UUID-to-integer cast crash in team_lineups bench-repair). Dual-lane per task #39.
3. **THE TWELVE** — 12-human draft on staging. Gated by F26 close.
4. **KI-013 / KI-028 / KI-030** — demo-optics cosmetics before first Zach demo.
