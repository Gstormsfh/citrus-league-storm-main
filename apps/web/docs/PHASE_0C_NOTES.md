# Phase 0c investigation notes

Working log for Phase 0c (PBP replay for the 7 moat features across
8 historical seasons). Companion to
`apps/web/docs/PHASE_0_EXECUTION_PLAN.md § 0c`,
`scripts/utilities/replay_pbp_for_moat.py`, and `DATA_INVENTORY.md § 4`
(Phase 0c quirks). PHASE_0B_DIAGNOSTIC.md is closed; new operational
records for 0c land here.

## Full-run halt (2026-07-26)

The 8-season sequential run
(`--seasons 2017,2018,...,2024 --tolerance 15`) halted at the
season-fail-cap on season 2017.

- Games processed: 11 / 1,355
- Complete: 10, `match_integrity_fail`: 1
- Fail rate: 9.09% > cap 3.00%
- has_pass rate at 11-game sample: 4.2% (above probe's 3.2%, in-family
  — not a collapse signal)
- Fail: game 2017020004, coord_backstop delta=16 on
  `(97, 2)` vs `(81, 2)`. Same-net-side (both values in the same coord
  quadrant); MoneyPuck arena adjustment applied a larger correction
  than typical. One unit above tolerance=15.

Cap did its job — stopped the run before more coord edge cases
accumulated. Tolerance-recalibration decision pending. Options: bump
to 20 (would clear this + probably a similar handful) or investigate
each per-game before healing individually. Not touching tonight;
tomorrow's tolerance decision.

## event_id / sort_order — live save path DOES write them

Contrary to an initial concern that these NHL identifiers might be
NULL on live-era prod rows, they are populated on **119,766/119,766**
season=2025 rows across all 1,394 games. Sample audit on the 49
0b-backfill/reconciler-healed games showed the same (4,248/4,248).

Meaning:
- 0c must populate them on historical rows to reach parity with live
  behavior. `replay_pbp_for_moat.py` already includes both in its
  17-column update set — no adaptation needed.
- The prompt-hypothesized enhancement ("live save path doesn't write
  them; enhancement queued") is moot — the live path has been writing
  them since whenever the extraction was authored, and both columns
  are in the `_save_shots_to_database` INSERT list.

## Parity instrument doctrine

Third instance of `/tmp`-harness context drift observed on this
codebase in the past ~week:

1. **Phase 0b investigation harness** — hit `xG_Value` KeyError
   because the harness ran `_extract_shots_from_game` but not the
   downstream xG scoring block that `process_single_game` performs
   between extract and save. The harness thought extraction produced
   `xG_Value`; the live path produced it later.
2. **0c POC harness** — reported `17/90` matches on game
   2024020001 because it tried to match NHL raw coords to MoneyPuck-
   flipped DB coords via the unique constraint. The "successful" 90/90
   match on the SECOND attempt was luck of intra-bucket order
   alignment; the pattern that succeeds on one game does not
   generalize (per the 2020 season pilot that showed 62% integrity
   failure under the same order-based match).
3. **Tonight's 0c parity harness** — first-pass reported 4 diffs
   from failing to consume matches on §16 dedupe-collapsed buckets;
   after the consume-on-match fix, showed 0 diffs across 72,063 cells,
   which likely IS a genuine parity result but IS NOT the same
   instrument as the production call path.

**Doctrine (adopted 2026-07-26):**
- Throwaway `/tmp` harnesses are for CAPTURING errors, never for
  ADJUDICATING correctness.
- Parity tests must run through the production call path, not a
  reconstruction of it. If the production path can't be invoked
  directly against the target data, the smallest honest adaptation is
  to extend the production path with a new mode, not to write a
  parallel path in `/tmp`.
- Existing rung-3 byte-parity result (`--force` reprocess of 6
  already-populated staging games producing byte-identical digests)
  stands as the authoritative parity proof for the 15 moat+companion
  columns produced by `process_game_from_raw_data`.

## Orchestrator-vs-live-era gap (blocker for full-path parity)

`replay_pbp_for_moat.py` cannot be invoked directly against live-era
2025 games because its matcher requires MoneyPuck CSV data
(CSV→DB claim via unique constraint by provenance, then NHL→CSV via
game-seconds). MoneyPuck's `shots_2018-2024.csv` has zero rows for
season 2025 — verified by running:

```
python scripts/utilities/replay_pbp_for_moat.py \
  --game-id 2025020534 --dry-run --env-file .env.prod
```

which prints `[csv] loaded season 2025: 0/786244 rows across 0 games`
and then per-game status becomes `csv:no_rows_for_game` (error).

**Smallest honest adaptation** (deferred — requires editing
`replay_pbp_for_moat.py`, which is currently under a
tree-stability constraint):

Add a live-era code path that:
- Detects empty CSV slice for the season and falls back to direct
  NHL→DB matching on the unique constraint (valid for live-era rows
  by construction: DB rows came from NHL extraction directly, so raw
  coords match).
- Skips the CSV→DB provenance gate for that season.
- Retains the coord-verification backstop.
- Estimated diff size: ~15-30 lines. `_process_game` gets a
  `live_era: bool` branch or the CSV requirement becomes conditional
  on having any rows in `csv_slice`.

Until this lands, full-path parity on live-era rows is proven only
via the existing rung-3 byte-parity evidence. That evidence covers
staging games (2020s + 2024020001) processed by
`process_game_from_raw_data`, which shares the SAME
`_extract_shots_from_game` call the live scraper uses. The
extraction is deterministic on payload input; the two call paths
diverge only in what they do WITH the extraction output, not in the
extraction itself.

## NHL PBP payload drift + duplication trap (2026-07-26)

The 2026-07-26 parity audit surfaced 9 prod rows across 49 games
that had no partner in a naive unique-constraint join against
a fresh NHL API extraction of the same games. Some are §16
dedupe-collapsed buckets (documented); the residue is likely
settled-content revisions after `gameState=OFF` — NHL nudges
coords, corrects playerIds, occasionally inserts/removes events.

**The trap.** The shot-coverage reconciler
(`data-pipeline/monitoring/reconcile_shot_coverage.py`) is
content-blind by design. It detects `no_payload`,
`stale_payload` (gameState-not-terminal), or `no_shots` — but
never "same game, coords nudged 2 units post-facto." A content
refresh through the normal extract → `_save_shots_to_database` →
`on_conflict=(game_id, player_id, shot_x, shot_y, shot_type_code)`
path would DUPLICATE any drifted shot rather than overwrite: a
coord nudge changes the unique key, so the "same" shot lands as a
NEW row beside the stale one. Same mechanism for playerId
corrections.

Safe refresh patterns for the eventual settle-window reconciler
(either, not both):

1. Per-game DELETE-then-INSERT atomic transaction.
2. Event-identity UPDATE via `(game_id, event_id, sort_order)`,
   which are stable across NHL refetches (unlike the
   coord-tuple unique constraint). `event_id` is populated on
   all 119,766/119,766 prod 2025 rows, so this path is
   available.

Full documentation in `DATA_INVENTORY.md § 4`. Tracked for a
future settle-window reconciler variant (backlog: pre-2026-27
season deadline; see the linked GH issue).

## Pending decisions (tomorrow)

- **Tolerance recalibration**: 3% per-season fail-cap is 30x the
  observed per-pair `>15` rate (0.1%), yet triggered on 11 games
  because 1 fail per 11 rounded to 9%. Either raise tolerance to
  clear the small population of large-arena-adjustment shots, or
  investigate each per-game to find a distinguishing feature.
- **Prod transfer path (c1/c2/c3)** per the evening grind report.
- **Whether to promote the live-era adaptation** in
  `replay_pbp_for_moat.py` (would enable end-to-end parity testing
  through the real orchestrator path).
