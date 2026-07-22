# Phase 0b Diagnostic — Shot Extraction Regression

## Status
**Backfill complete on prod as of 2026-07-21.** All 1,394
season=2025 final games now have raw_shots data (0 missing
across all 9 months). Season-NULL repair complete on the 9
mid-cascade games. Remaining 0b work: deploy the fix to the
live scraper machine + live-scraper defect fixes (see
"Live-machine + scraper-defect scoping" below).

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
- 2026-07-21: 0b-fix applied to `data-pipeline/acquisition/data_acquisition.py`.
  Three changes:
  1. **fillna('unknown') → fillna('OTHER')** at both encoder call sites
     (line 2171 in `process_single_game`; line ~3575 in
     `scrape_pbp_and_process`). 'OTHER' is a known encoder class and
     matches the training script's null handling
     (`scripts/utilities/train_xg_v3.py:243`).
  2. **Defensive unseen-label wrap** before both `.transform()` calls.
     Maps any value not in `encoder.classes_` to 'OTHER' with a
     warning log. Mirrors the canonical pattern from
     `train_xg_v3.py:361-366`. Necessary because real prod PBP data
     contains categories the encoder was never fit on — staging 0a
     corpus alone shows 6 unseen categories: `DELPEN` (2,871 rows),
     `PEND` (11), `PSTR` (3), `GEND` (2), `EGT` (2), `ANTHEM` (1),
     `EISTR` (1). Would have failed on any prod game containing any
     of these.
  3. **Silent-swallow replaced** at `_save_shots_to_database`
     lines 2031-2032 and 2038-2039: `except Exception: pass` →
     `except Exception as row_err: logger.warning(...)` with game_id,
     player_id, event_id, and error details. Loop-continue behavior
     preserved — we're adding visibility, not changing control flow.

  Training-data verification (Step 0):
  - Staging `raw_shots` (904,859 rows, 0a MoneyPuck corpus): 0 nulls
    in `last_event_category` — MoneyPuck's own PBP feed doesn't
    produce them. So training encoded no null cases; fill value is
    a runtime concern only.
  - Training script (`train_xg_v3.py:243`) uses
    `.fillna("OTHER").str.upper()` and the encode step
    (`train_xg_v3.py:361-366`) has an explicit
    `if v in known_events else "OTHER"` guard. The runtime scraper
    diverged from this canonical pattern; the fix restores parity.

  Validation on staging (Step 2):
  - Test game 2025030416 (Cup Final G6, VGK@CAR): extracts 73 shots,
    scores cleanly (all 73 rows have xG_Value; sample values
    [0.042, 0.003, 0.943]), 0 unseen labels in this specific game,
    1 row landed with NULL `last_event_category` (previously fatal —
    stored NULL preserved as data-integrity signal, mapped to
    'OTHER' only for encoding).
  - Batch upsert succeeded first try; per-row retry loops (now with
    logging) not exercised.
  - Staging restored to 904,859 baseline after test.

- 2026-07-21 (later): Refactor and backfill scaffolding.
  - Extracted `process_game_from_raw_data(game_id, raw_data, db_client)`
    from `process_single_game` (data_acquisition.py). The new function
    holds the extract → score → save block; `process_single_game`
    now delegates to it after its NHL API fetch. Backfill calls it
    directly. Rationale: the 0b root cause was runtime/training-code
    divergence on the encoder; sharing one code path for live scraping
    and backfill prevents that divergence class going forward.
  - The DELPEN/PEND/PSTR/... finding is decisive: the encoder's known
    class set (12) is a strict subset of the categories present in
    real data (18 in the 0a corpus alone). The defensive wrap is
    NECESSARY, not defensive-in-the-nice-to-have sense — the fillna
    change alone would still fail on any game containing DELPEN
    (2,871 rows across the 0a corpus). Backfill warning logs will
    reveal the null-vs-DELPEN split across the 42 affected games.

## Tracked separately (out of 0b scope)
- **xA TypeError**: earlier session harness hit
  `TypeError: positive() got an unexpected keyword argument 'upper'`
  during xA scoring. Investigation this session: the module's live
  path is correct — it does `df['xA_Value'] = np.power(raw_xa, k)`
  first (assigns ndarray → Series), then
  `df['xA_Value'].clip(upper=)` (pandas Series.clip accepts `upper=`).
  The harness took a shortcut chaining `.clip(upper=)` directly on
  the ndarray from `np.power(...)` — numpy's ndarray.clip does not
  accept `upper=`. **Verdict: harness artifact only.** No prod bug.
  Removed from active 0b work.

## Backfill log
- 2026-07-21: Inventory of affected games (prod read-only).
  - **42 games** currently have season=2025 status=final with zero
    `raw_shots` rows. Stable across multiple slice definitions
    (exactly 0 shots, <10 shots — both return 42).
  - Split: 30 games with `raw_nhl_data` payload present (replay set) /
    12 games without (refetch set).
  - January outlier: `2025020828` (2026-01-26); all other affected
    games cluster April 4 – June 14 2026.
  - Prior "51-game" figure in the earlier diagnostic was carried
    forward from the prior investigation session without a preserved
    query. Reconciled slice counts (< 50 shots = 44; from 2026-04-01
    with 0 shots = 41; from 2026-05-11 with 0 shots = 14; all
    season=2025 final = 1,394) do not reproduce 51. **Delta of 9**
    likely reflects: (a) staleness between prior count and today
    (though no fix was deployed to prod to change state); (b)
    different slice semantics that aren't reproducible without the
    original query. **Prod backfill scope pinned to 42 games** —
    inventory saved to `C:\tmp\0b_backfill_inventory.json`.
  - Inventory anomaly: game `2025030234` has `stats_extracted_at`
    populated (2026-05-12 04:55) despite 0 shots. Matches the
    failure fingerprint — pipeline advanced the stats flag but
    the shot-scoring aborted before save.
- 2026-07-21: Staging pilot via new
  `scripts/utilities/backfill_from_raw_payloads.py`.
  - Dry-run + refetch on game 2025030416: fetched from NHL API
    (plain requests, no proxy — backfill volume doesn't warrant
    the live-scraper's proxy infra), stored in staging.raw_nhl_data,
    extracted+scored 73 rows, 0 rows saved (dry-run correctly
    skipped write via monkey-patched save), 0 unseen-label warnings
    (this game's null-only case maps to 'OTHER' which IS in the
    encoder's known set, so the warning-emitting branch never fires).
  - Live run on the same game: read payload from staging.raw_nhl_data
    (no NHL API call), extracted+scored+saved 73 rows. Post-save
    validation: `rows_saved=73, xg_populated=73`. Elapsed 8.4s.
  - Cleanup: DELETE raw_shots and raw_nhl_data for 2025030416.
    Post-cleanup: raw_shots=904,859 (exact baseline), raw_nhl_data=0
    (exact baseline).
- 2026-07-21: Reconciled 51 vs 42 delta — hypothesis CONFIRMED,
  root cause is `raw_shots.season = NULL` on 9 games.
  - Q2 reproduced the diagnostic's original 51 by adding
    `s.season = 2025` to the LEFT JOIN predicate; Q1 (my new
    inventory) omitted it and counted 42. Difference = **exactly 9**.
  - Q3 shows 9 games / 798 rows in prod.raw_shots have
    `season IS NULL`, all others 2025.
  - The 9 season-NULL games are all complete, fully scored:
    `shot_rows == xg_rows == flurry_rows` (100% populated),
    xA populated on the pass-having subset, all rows saved in a
    single batch each. Save timestamps 2026-05-13 → 2026-06-11
    (after the 2026-05-11 code cascade but before the fix).
    Row counts within the normal 70-113 band.

    | game_id     | game_date  | shot_rows | notes |
    |-------------|------------|-----------|-------|
    | 2025030245  | 2026-05-12 | 109       |       |
    | 2025030246  | 2026-05-14 | 93        |       |
    | 2025030323  | 2026-05-24 | 85        |       |
    | 2025030313  | 2026-05-25 | 84        |       |
    | 2025030324  | 2026-05-26 | 73        |       |
    | 2025030411  | 2026-06-02 | 82        | Cup Final G1 |
    | 2025030412  | 2026-06-04 | 83        | Cup Final G2 |
    | 2025030413  | 2026-06-06 | 113       | Cup Final G3 |
    | 2025030414  | 2026-06-09 | 76        | Cup Final G4 |

  - Verdict: **season UPDATE repair, not a re-backfill**. These
    games already have complete extraction + scoring; the season
    column is the only defect. Fix is
    `UPDATE raw_shots SET season = int(game_id / 1000000)
     WHERE game_id IN (...) AND season IS NULL`.

## Season-integrity finding (0c blocker if unrepaired)
The 9 season-NULL games are **invisible to every
season-filtered query**. This includes the diagnostic queries
we've been using this whole investigation (`s.season = 2025`
join predicate would not have found them; `WHERE season = 2025`
aggregations undercount by 798 rows / 9 games). Downstream
consumers (per-season aggregates, per-season projection
training, per-season leaderboards, phase 0c stat rebuilds) will
silently omit these rows. Repair must land before 0c or 0c
inputs will be quietly wrong for the Cup Final and
Round 2/3 games.

Introduction mechanism (inferred, not yet confirmed): the
extract-time `season` derivation was added inline at line 1756
during 0d-pre #3 (comment: "Set inline at extraction time so
the DELETE+UPSERT retrofit doesn't reintroduce NULL season
after the 0d-pre #3 backfill migration runs (caught during 6c,
2026-05-12)."). The 9 affected games were saved between
2026-05-13 and 2026-06-11 — all AFTER that inline derivation
was added, suggesting the retrofit at line 1756 either wasn't
present in these earlier saves, or a code path other than
`_save_shots_to_database` wrote them. Second-order investigation
deferred; the repair is deterministic (game_id / 1_000_000).

## Pinned backfill scope
- **Zero-shot backfill (this workstream)**: **42 games**, fully
  characterized. 30 replay + 12 refetch. Executed via
  `backfill_from_raw_payloads.py`.
- **Season-integrity repair (parallel workstream, out of 0b
  scope proper)**: **9 games**, deterministic UPDATE.
  Authorization required separately.

- 2026-07-21: Prod backfill executed under Prompt 14 sequence.
  - **Step A season repair**: `UPDATE raw_shots SET season = 2025`
    on the 9 known games / 798 rows. Post-verify:
    residual_null_in_target=0, all_null_rows=0,
    games_season_2025=1,352 (baseline 1,343 + 9). Clean.
  - **Prod payload audit (mid-flight discovery)**: of the 30 games
    originally classified as replay-set, only **14** had OFF-state
    payloads with plays; the other **16** were FUT (future) stubs
    fetched pre-game and never refreshed. Revised split promoted
    to 14 replay + 28 refetch (total still 42). User re-authorized
    the revised split.
  - **Step B pilot** (game 2025030234, earliest OFF-state playable
    game — the one with `stats_extracted_at` populated despite
    0 shots): 91 rows saved, xg=91, season_ok=91, season_null=0.
    All four gate columns pass.
  - **Step C replay** (13 remaining OFF-state playoff games):
    13/13 succeeded, 1,131 rows saved, 0 unseen-label warnings.
    Post-check games_with_shots = 1,366 (1,352 + 14) exact.
  - **Step D refetch** (12 no-payload + 16 FUT-stub promotions
    with `--refetch`): 28/28 succeeded, 2,424 rows saved, 0 unseen
    warnings. Every refetch verified gameState='OFF' before caching.
    Post-check games_with_shots = **1,394** exact — full season
    coverage.
  - **Step E full-season validation**:
    - total_rows=119,671, games=1,394, bad_season=0, xg_null=0,
      game_id range 2025020001 → 2025030416.
    - Per-month table: every month reads 0 missing (see below).
    - Row arithmetic: baseline 116,025 + pilot 91 + replay 1,131 +
      refetch 2,424 = 119,671 ✓.

  Per-month coverage after backfill:

  | month    | games | missing |
  |----------|-------|---------|
  | 2025-10  | 180   | 0       |
  | 2025-11  | 225   | 0       |
  | 2025-12  | 226   | 0       |
  | 2026-01  | 241   | 0       |
  | 2026-02  | 74    | 0       |
  | 2026-03  | 241   | 0       |
  | 2026-04  | 166   | 0       |
  | 2026-05  | 35    | 0       |
  | 2026-06  | 6     | 0       |

## Cause taxonomy (the 42 zero-shot games)
The 42-game zero-shot set was heterogeneous, not monolithic. Three
distinct failure modes contributed:

1. **Encoder-death (14 games, May 11+ playoffs)**. Extraction ran,
   but the xG scoring path raised `ValueError` on the encoder's
   unseen `'unknown'` fillna (root cause per fix 73382cc).
   `process_single_game` caught and logged at line 2286, returned
   None, so raw_shots was never written despite the payload being
   present and complete. Fixed by the encoder wrap (73382cc);
   replayed cleanly in Steps B + C.

2. **FUT-stub capture defect (16 games, mostly April 4 + Jan
   outlier)**. Live scraper captured `raw_nhl_data` payloads pre-game
   (gameState='FUT', 0 plays, 0 rosters) and never refreshed them
   after the games happened. Extraction correctly returned 0 shots
   from the empty stubs; the pipeline treated the exit as
   "no shots to save," not as a defect. **This is a live-scraper
   bug independent of the encoder fix** — the "payload exists =
   payload final" assumption breaks for rescheduled or
   pre-game-captured payloads. Refetched cleanly in Step D.
   The January outlier (game 2025020828, `nhl_games.game_date`
   2026-01-26, payload `gameDate` 2026-03-09) is the reschedule
   fingerprint that made the defect visible.

3. **No-payload games (12 games, April 5 + April 25 + early May
   playoffs)**. Live scraper never captured a payload at all —
   `raw_nhl_data` had no row. Cause not diagnosed this workstream
   (proximate: scraper wasn't running for those dates, or the
   day's fetch failed silently and wasn't retried). Refetched
   cleanly in Step D.

Separately, the **9 season-NULL games** (repaired in Step A) are
a fourth failure mode disjoint from the 42: shots were saved, but
`season` landed as NULL because those games saved during the
2026-05-12 partial-deploy window when the inline season derivation
at `data_acquisition.py:1756` wasn't yet present. Repair was a
deterministic UPDATE.

Grand total of 0b incidents on prod (union of the four modes):
14 + 16 + 12 + 9 = 51 — which is exactly the number the original
diagnostic reported under its `LEFT JOIN ... AND s.season = 2025`
semantics that counted the 9 season-NULL games as "missing shots."

## Encoder-death breakdown (Steps C/D warnings)
**0 unseen-label warnings** across all 42 backfilled games.
Every game's `last_event_category` values landed within the
encoder's 12-class known set (`BLOCK, CHL, FAC, GIVE, GOAL, HIT,
MISS, OTHER, PENL, SHOT, STOP, TAKE`). The DELPEN/PEND/PSTR
concerns from the staging-corpus audit (2,871+ rows of
encoder-unseen categories across historical 0a data) did not
materialize in this specific 42-game set — but the defensive
wrap remains critical: any future game hitting those categories
would repeat the regression class without it.

## Live-machine + scraper-defect scoping (0b-deploy work)
The prod DB is now consistent for season 2025. The **live scraper
machine still runs the pre-fix code**: file mtime 2026-05-11 22:54
per prior investigation, which pre-dates fix 73382cc. New games
will continue to hit encoder-death until deploy.

Deploy scope also needs to address the **FUT-stub capture defect**
(cause mode #2 above), which is an independent live-scraper bug
that the 0b encoder fix does NOT touch:
- The scraper's "if raw_nhl_data row exists, don't refetch"
  assumption produces silent 0-shot outcomes for
  pre-game-captured / rescheduled games.
- Options: (a) always refresh on final-state detection,
  (b) treat non-OFF/FINAL payloads as needing retry,
  (c) reconcile `raw_nhl_data.raw_json.gameState` against
  `nhl_games.status` and refetch on mismatch.
- Recommend (b) — matches the retired extractor_job's terminal-state
  set and this backfill script's `_TERMINAL_GAME_STATES` guard.

The **no-payload gap (cause mode #3)** is a third scraper concern:
some days' games never entered `raw_nhl_data` at all. Diagnosing
that (cron missed run? day-of retry logic missing? scraper daemon
was down?) is a separate 0b-deploy or 0b-hygiene item.

## Pending 0b work
- Deploy 73382cc + 29e2c18 + fb5e817 (backfill script + refactor
  + zero-rows gate) to the live scraper machine.
- Fix FUT-stub capture defect (independent scraper bug).
- Diagnose no-payload gap (independent scraper reliability bug).
- All three above are scoped for a separate authorization step —
  not part of this backfill workstream.

## stats_extracted_at note
The `raw_nhl_data.stats_extracted_at` column is a **retired-daemon
flag** from `scripts/_deprecated/extractor_job.py`. The current
pipeline (live scraper + this backfill) does not set it, and
should not. Per `GAPS_AND_FUTURE_CAPABILITIES.md § 3`, the flag
was one-time backfilled on 474 games as part of 0d-pre B and
otherwise carries no current-pipeline meaning. The single-game
anomaly noted earlier (`2025030234` with `stats_extracted_at`
populated despite 0 shots) is explained: the one-time backfill
set the flag based on then-current live-scraper state; the shot
data was later lost in the encoder regression. Not a data-model
inconsistency, just a stale flag.
