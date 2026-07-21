# Phase 0b Diagnostic — Shot Extraction Regression

## Status
Investigation in progress. Regression identified during
pre-0b scoping. Fix + backfill pending.

## Headline finding
Handoff-stated 0b scope (~360-game Oct-Dec 2025 gap) was
stale — already closed by 0d-pre #6 backlog drain in May.
Real scope: 51 games with 0 shot rows in prod, Apr-Jun 2026,
including all 6 Stanley Cup Final games. Root cause: a
structural extraction regression introduced ~2026-05-11 by
the 0d-pre cascade. New games continue to land as 0-shot
until fixed.

## Root-cause investigation summary
- Change surface: only 4 cascade commits touched
  data_acquisition.py; 4e714f3 dominates (+141/-23; next
  biggest +36/-6). File mtime on the live machine 2026-05-11
  22:54 = the exact extraction-collapse date.
- Save path: process_single_game → _extract_shots_from_game
  (line 1007) → xG scoring block (lines 2166-2278) →
  _save_shots_to_database (line 1718).
- Eliminated: retired-module import breakage (extractor_job
  references are comments only).
- Hypothesis 1 (HIGH): Bug D's 38 added columns include a
  type mismatch → batch upsert fails 22P02 → per-row retries
  also fail → all swallowed by `except Exception: pass` →
  game lands with 0 shots. Matches the bimodal 51-zeros
  distribution and mirrors the 0a
  shot_angle_rebound_royal_road bug class.
- Hypothesis 2 (MED): encoder ValueError in the xG step
  aborts extraction for some payloads.
- Hypothesis 3 (LOW): re-added dropped column → 42703.
  Diff argues against.

## Silent-swallow finding (independent of root cause)
_save_shots_to_database's per-row retry loop uses
`except Exception: pass` (lines 2031-2032, 2038-2039), which
would convert any schema regression into silent data loss.
Not the culprit for the current 51-game symptom (save is
never reached), but a latent hazard that must be fixed in
0b-fix. Add error logging at minimum; reconsider the swallow
entirely.

## Investigation log
- 2026-07-21: Hypothesis 1 test harness result on staging
  (test game 2025030416, Stanley Cup Final Game 6, VGK@CAR,
  2026-06-14). Hypothesis 1 **FALSIFIED**, Hypothesis 2
  **CONFIRMED**. Findings:
  - Bug D column audit: all 40 added columns exist in
    staging raw_shots with schema types matching pandas
    dtypes (numeric ↔ float64/int64, boolean cast at save).
    No schema regression on Bug D columns.
  - Failure fires BEFORE save reached, in the xG scoring
    block at line 2170:
    ```
    ValueError: y contains previously unseen labels: 'unknown'
    ```
    (sklearn's error truncates 'unknown' → 'unkno' in the
    message; the actual unseen label is 'unknown'.)
  - Cause: `fillna('unknown')` at line 2171 fills NaN
    `last_event_category` values with the literal string
    `'unknown'`, but the fitted `LAST_EVENT_CATEGORY_ENCODER`
    was trained on 12 NHL event categories that do NOT
    include `'unknown'`:
    ```
    encoder.classes_ = [BLOCK, CHL, FAC, GIVE, GOAL, HIT,
                        MISS, OTHER, PENL, SHOT, STOP, TAKE]
    ```
    Test-game input contained: [FAC, HIT, MISS, OTHER, SHOT,
    TAKE, unknown] — 6 known + 1 unknown (from a single
    row where prior event was NULL).
  - Mechanism: any game with ≥1 shot whose prior event is
    null triggers the encoder failure → `process_single_game`
    catches at line 2286, logs, returns None. Game is
    marked processed in nhl_games (upstream) but raw_shots
    gets zero rows. Bimodal all-or-nothing failure matches.
  - Why 2026-05-11: 0d-pre Bug C (2026-05-07) added the
    `previous_all_plays` all-events buffer and populated
    `last_event_category` on shot records for the first
    time. Pre-Bug-C, the column didn't exist, so the
    encoder was never called. Post-Bug-C, every game with
    a null prior-event condition hits the fitted encoder
    with an unseen `'unknown'` label.
  - Staging unaffected: 904,859 raw_shots rows before and
    after harness run (failure fires before any DB write).
    Defensive DELETE for game 2025030416 executed and
    confirmed no-op.
  - Same failure surface exists in `scrape_pbp_and_process`
    at line ~3600 (encoder call with same fillna pattern).
    Both call sites need the fix.
  - Next: 0b-fix scoping. Immediate patch is a one-liner
    (`fillna('unknown')` → `fillna('OTHER')`, since 'OTHER'
    is a known encoder class semantically closest to
    "unknown prior event"). Longer-term: wrap encoder
    transform with a known-class filter, and fix the
    silent-swallow retry loop.

## Fix log
_(empty — pending 0b-fix)_

## Backfill log
_(empty — pending 0b-fix)_
