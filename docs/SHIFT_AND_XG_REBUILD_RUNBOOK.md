# Rebuilding the shift, expected-goals and GAR chain

Everything below is re-derivable from `raw_shots`, `raw_nhl_data`, `nhl_shots`
and the NHL's shift charts. No constant is hardcoded that the data can measure
for itself, and no step needs a file moved between two scripts.

Written 26 August 2026, after a night in which five faults were found that none
of the existing checks could see. Each section says what goes wrong when the
step is skipped, because that is the part that is easy to forget.

---

## The order, and why it is that order

```
raw_nhl_data ──► game_strength_intervals ──┐
                                           ├──► player_toi_by_state ──┐
NHL shiftcharts ──► player_shifts_official ┘                          │
                                                                      ├──► player_gar_inputs (view)
nhl_shots ──► raw_shots (time, team, situation code)                  │            │
                    │                                                 │            ▼
                    ▼                                                 │   player_gar_components
             xg_v5_cells / _moat / _era ──► raw_shots.xg_v5 ──► player_onice_xg
```

Anything that **scores** shots must run before anything that **sums** them.
`rebuild_onice_xg` reads `coalesce(xg_v5, 0)`, so a shot scored after the sum is
a shot worth nothing.

---

## 0. Shot fields — run once, and after any archive re-ingest

`rebuild_onice_xg` requires `time_in_period`, `period` and
`event_owner_team_id`. In `raw_shots` the first and third were populated in
2025-26 and **nowhere else**, so on-ice attribution returned zero rows for eight
seasons — cleanly, with no error.

```sql
update public.citrus_ops_config set value_num = 0 where key = 'shot_field_backfill_cursor';
select * from public.citrus_backfill_shot_fields(200000);   -- until remaining = 0
select * from public.citrus_shot_field_coverage();          -- expect 92%+ every season
```

Source is `nhl_shots`, joined on `(game_id, event_id)`. Validated against
2025-26, where `raw_shots` already held the truth: team 100.00%, is_home
100.00%, reconstructed situation code 99.96%, clock 99.97%.

`seconds_elapsed` in `nhl_shots` is the cumulative **game** clock;
`time_in_period = seconds_elapsed - (period-1)*1200`.

Then check the skater counts against the code — they were transposed for the
whole of 2025-26, 23,562 shots, every one an exact swap, invisible at
five-on-five:

```sql
select * from public.citrus_shot_strength_invariant();      -- 0 transposed
```

---

## 1. The model

The cells, the moat and the era layer, in that order. Each reads what the one
before it produced.

```sql
select * from public.citrus_fit_xg_v5_cells(60);

truncate table public.xg_v5_fit_rows;
select * from public.citrus_fit_moat_rows(350000);          -- until remaining = 0
select * from public.citrus_fit_xg_v5_moat(40);

select * from public.citrus_fit_xg_v5_era(60, '{}');        -- see the note below
```

**`p_exclude_seasons` matters.** The era layer renormalises within each season so
that season's expected goals equal its actual goals. A season still in progress
cannot be renormalised against goals it has not scored — fitting one makes its
own total definitionally correct and tells you nothing. Exclude the live season:

```sql
select * from public.citrus_fit_xg_v5_era(60, array[2026]);
```

A season with no fitted row inherits the most recent one, which is the right
default: the era it belongs to is far likelier to be the latest than the mean of
all of them.

Then score:

```sql
update public.citrus_ops_config set value_num = 0 where key = 'xg_v5_rescore_cursor';
select * from public.citrus_rescore_v5_batch(200000);       -- until remaining = 0
select * from public.citrus_rescore_agrees(5000);           -- must read "0 differ"
```

`citrus_rescore_v5_batch` expresses `xg_v5()` as joins because calling the
function per row stopped finishing once the era layer went in.
`citrus_rescore_agrees` samples both and requires them identical — two
expressions of one formula is two places for it to drift.

---

## 2. The shift chain

```powershell
python data-pipeline\acquisition\backfill_shifts.py --dry-run
python data-pipeline\acquisition\backfill_shifts.py
```

About 75 games a minute, so roughly two and a half hours for all 11,870. It is
resumable: `games_needing_shifts` keys off `shift_ingest_quality.verdict`, so a
game that is not `good` stays on the work list and retries by itself.

Then, in the database:

```sql
select * from public.citrus_repair_shift_clocks(2);         -- until it returns nothing
select * from public.citrus_build_strength_batch(200);      -- until remaining = 0
select * from public.citrus_build_toi_batch(1500);          -- until remaining = 0
select * from public.citrus_build_onice_batch(1200);        -- until remaining = 0
```

**Run the clock repair before the derive stages.** Seventeen shifts were found
whose start and end disagreed with their own stated duration by more than a
rounding error — one gave a goalie zero seconds where the chart said twenty
minutes, another inflated a 2025-26 shift by twelve. The rule:

- `end_time` present → the clock is trustworthy, the start failed to parse:
  `start := end - duration`
- `end_time` NULL → the parse failed entirely, the duration is all that survives:
  `end := duration`

Anything whose arithmetic would land outside the period is left alone and keeps
failing `shift_duration_agreement` until somebody looks at it.

**After any model change, force the attribution to rebuild**, because
`player_onice_xg` stores the sums and will not notice that its inputs moved:

```sql
update public.strength_build_state set onice_built_at = null;
```

---

## 3. Player valuation

```sql
select * from public.citrus_rebuild_gar_components(null, 100.0, 25.0, false, 20.0);
```

Arguments, and what each is defending against:

| argument | default | why |
|---|---|---|
| `p_seasons` | `null` = all | history does not change; the nightly run does the current season only |
| `p_min_toi` | 100 | five-on-five minutes to be scored at all |
| `p_rp_pct` | 25 | replacement is the 25th percentile of **value** — the 25th of a for-rate, the 75th of an against-rate. It was 75 for all five, which is backwards for the three where higher is better and put three quarters of the league below replacement |
| `p_allow_uncalibrated` | false | skips a season whose xG does not add up. A GAR number quietly a fifth light is worse than no GAR number |
| `p_min_st_toi` | 20 | special-teams minutes needed to **define** the baseline. With any-time-at-all, a fourth-liner with four power-play minutes set replacement two goals per sixty too low |

Goalies are excluded. A goalie banks three to five thousand minutes and carries
his team's whole on-ice differential; eight of the ten highest GAR seasons in
the table were goalies before this. Goalie value is goals saved above expected
and lives in `goalie_gar`.

---

## 4. Verify

```powershell
python data-pipeline\monitoring\check_data_invariants.py
```

Twelve families, no `--ignore` unless a backfill is genuinely in flight. Exit 2
means at least one failed and the workflow fails with it.

What each family is guarding, in one line:

| family | guards |
|---|---|
| `citrus_data_invariants` | shifts, time on ice, the strength timeline |
| `citrus_model_invariants` | shots, expected goals, on-ice attribution |
| `citrus_leakage_invariant` | an xG column that reads the outcome |
| `citrus_disk_invariants` | data + WAL + projected growth + bloat |
| `citrus_shot_strength_invariant` | skater counts against the NHL's own |
| `citrus_rescore_agrees` | the fast scorer against the definition |
| `citrus_flurry_invariant` | the flurry columns are not copies again |
| `citrus_shift_duration_invariant` | clocks that have come apart |
| `citrus_xg_coverage_invariant` | our model actually scored the new shots |
| `citrus_moneypuck_separation` | nothing serves their column |
| `citrus_gar_invariant` | valuation is fresh and its components are real |
| `citrus_ingest_quality_invariant` | how many charts came back short |

---

## What runs on its own

`nightly_xg_pipeline()` — cron job `nightly-xg-pipeline`, 08:35 UTC — does steps
1's scoring, 2's repair and derive, and 3 for the current season, before the
legacy layers that goalie GSAx still reads. Bounded at twenty batches per stage,
and every driver is resumable, so what one night cannot finish the next night
continues.

`data-invariants.yml` — 11:40 UTC daily and on every push touching
`supabase/migrations`, `data-pipeline` or `scripts/utilities` — runs step 4.

## What still needs a person

- `CITRUS_ALERT_SLACK_WEBHOOK` is unset, so `AlertManager` no-ops silently. The
  exit code is the only signal path that works today.
- A full re-fit (step 1) is deliberate, not scheduled. The model should not
  change under the product without somebody deciding it should.

---

## 2026-08-26 — the chain after the shift backfill completed

All 11,870 games are charted. The model gained two layers and the rebound
feature was rebuilt from our own play-by-play. The order below is the whole
rebuild, and the order matters: **anything that scores shots runs before
anything that sums them.**

### Full rebuild, in order

```sql
-- 0. rebounds first: is_rebound is a dimension in xg_v5_cells and xg_v5_era,
--    so the model cannot be fit before the feature is right.
select * from citrus_derive_rebounds_batch(2000);   -- repeat until remaining = 0
select * from citrus_apply_rebounds_batch(400000);  -- repeat until remaining = 0

-- 1. structure: geometry and context, fit on ALL shots
select * from citrus_fit_xg_v5_cells(60);

-- 2. fit rows carry base, and base comes from the cells above
truncate table xg_v5_fit_rows;
select * from citrus_fit_moat_rows(400000);         -- repeat until remaining = 0
select * from citrus_fit_xg_v5_moat(40);

-- 3. shape, then era. Shape must precede era: era normalises what shape
--    produces. Both regular season only; era also fits the playoff constant.
select * from citrus_fit_xg_v5_shape(24, 200);
select * from citrus_fit_xg_v5_era(60, '{}');

-- 4. rescore every shot, then prove the fast path matches the definition
update citrus_ops_config set value_num = 0 where key = 'xg_v5_rescore_cursor';
select * from citrus_rescore_v5_batch(350000);      -- repeat until remaining = 0
select * from citrus_rescore_agrees(25000);         -- must be 0 of N differ

-- 5. only now: the things that SUM scored shots
select * from citrus_build_toi_batch(700);          -- repeat until remaining = 0
truncate table player_onice_xg;
update strength_build_state set onice_built_at = null;
select * from citrus_build_onice_batch(3000);       -- repeat until remaining = 0

-- 6. GAR sits on top of on-ice, so it is last
select * from citrus_rebuild_gar_components(
  array[2017,2018,2019,2020,2021,2022,2023,2024,2025], 200, 25, false, 20);
select * from citrus_recompute_gar_totals();
```

### Three things not to undo

**The shape layer must stay monotone.** `citrus_fit_xg_v5_shape` runs
pool-adjacent-violators for one reason: a monotone increasing transform of the
score cannot reorder shots, so AUC passes through untouched and only
calibration moves. A free per-band fit would be better on paper and would
quietly change every player ranking. `citrus_xg_shape_invariant` checks both
the band-level and the boundary-level ordering.

**Regular season and playoffs are separated in the model, not just in the
inputs.** `citrus_fit_xg_v5_shape` and `citrus_fit_xg_v5_era` filter to
`game_type = 2`. Playoffs carry one pooled multiplier in `xg_v5_playoff`, fit
after the regular-season chain, from playoff shots only. Do not add a per-season
or per-rebound playoff cell: the season-to-season spread of the playoff effect
(sd 0.038) is smaller than its own sampling noise (0.043), and the playoff
rebound cells hold 354–598 shots a season.

**The scorer rounds to `numeric(9,6)` on purpose.** `raw_shots.xg_v5` is
`numeric(9,6)`, so Postgres rounds on store. Returning full precision made the
`is distinct from` guard in `citrus_rescore_v5_batch` always true, so every
re-run rewrote all 1.02M rows — a full-table UPDATE on the widest table in the
database, which is what filled the disk on 2026-08-26. If you change the
scorer, keep the `round(..., 6)`.

### The rebound window is a measurement, not a convention

`rebound_window_era` holds it: 3 seconds for seasons ≤ 2022, 4 seconds from
2023. The NHL changed how it timestamps goal events between 2022-23 and
2023-24, and the elevated-conversion band moved with it. A gap-0 "rebound"
converting at 1.3% in 2023-24 is a clock, not hockey. If the NHL moves again,
re-measure conversion by gap and add a row — do not edit the function.

### Known gap

17 games of 11,866 (0.14%) still have no on-ice attribution: their shots came
out of the bulk import too impoverished to match back to our play-by-play by
shooter and coordinates, and several of them only received a partial shot set
(45–60 shots against a normal ~85). They are spread across 2017-18 through
2022-23. 2025-26 is complete. `citrus_feature_provenance` reports this as a
warn, deliberately — it should stay visible rather than be tolerated silently.

---

## 2026-08-26 (second pass) — two rulers, and the last mile

### The flurry window has to follow the same clock as rebounds

`rebuild_onice_xg` had a hardcoded `<= 3` for flurry sequencing while the
rebound rule had just moved onto `rebound_window_era`. Because the NHL's
timestamp shift lands exactly on that boundary, from 2023-24 about fifty
rebound goals a season were being split out of the scramble that produced them
and keeping their full, uncompressed xG.

The window now widens to four seconds **only for goal events in the new-clock
era**, because the goal event's clock is the only one that moved — a non-goal
shot at a gap of four means the same thing in both eras. `citrus_flurry_invariant`
gained `flurry_window_matches_the_clock`, which measures the share of goals
sitting just outside the window in each era and fails if they come apart.

**If you ever change one window, change the other.** They are the same
measurement and they read the same table.

### The database being clean is not the same as the product being clean

`citrus_moneypuck_separation()` walks views and SQL function bodies. It passed
all through 2026-08-26 while `calculate_daily_projections.py` — the script
behind the nightly numbers the product shows — was selecting `xg_value`,
`shooting_talent_adjusted_xg` and `flurry_adjusted_xg` straight out of
`raw_shots` over PostgREST. A database-side check cannot see a REST call.

`data-pipeline/monitoring/check_serving_path_provenance.py` is the other half.
It reads source rather than data, needs no credentials, and runs first in the
invariants workflow. It fails the build when a live pipeline file **selects** a
retired column, reports (without failing) writes, DataFrame work and known-dead
files, and carries an `ALLOWED` map for the handful of places that legitimately
measure the old number.

Three live reads were fixed on 2026-08-26:

| file | was reading | now |
|---|---|---|
| `calculate_daily_projections.py` (opponent xGA/60) | `shooting_talent_adjusted_xg`, `flurry_adjusted_xg`, `xg_value` | `xg_v5` |
| `calculate_daily_projections.py` (opponent finishing + high-danger) | `shooting_talent_adjusted_xg`, `xg_value` | `xg_v5` |
| `projection_uncertainty.py` (player season xG) | `xg_value` | `xg_v5` |

**One threshold moved with them.** High-danger was `xg > 0.3` against
`xg_value`, which captured 3.54% of shots. Calibrated `xg_v5` puts only 1.44%
above 0.30 and 3.92% above 0.20, so the constant is now `HIGH_DANGER_XG = 0.20`.
Leaving it at 0.3 would have cut the high-danger population by sixty percent
overnight and read as a league-wide collapse in chance quality. **If the scorer
is refit and the spread moves, re-measure this rather than assuming 0.20.**

### Two shot tables, two models — still an open decision

`raw_shots.xg_v5` (ours, rebuilt today) and `nhl_shots.xg_sql` are both live and
both honest. Measured over 2017-2025:

| | `xg_v5` | `xg_sql` |
|---|---|---|
| AUC | .757 – .776 | .754 |
| Calibration | **1.0000 every season** | 0.990 – 1.085 |
| Worst season | 1.0000 | 1.0848 |
| Playoffs separated | yes | no |
| Rebound feature | Citrus-derived, era-aware | not audited |

`calculate_daily_projections.py` uses `nhl_shots.xg_sql` for the finishing-talent
multiplier and `raw_shots.xg_v5` everywhere else. That is not wrong — it is
undecided. Picking one model of record is a product call, not a data call.

### `player_talent_metrics` is what the app actually reads

Not `player_onice_xg`, not `player_gar_components` — no application code
references either. `player_talent_metrics` is a **table**, rebuilt by
`nightly_projection_batch.py` (cron entry, `main.yml`). It was last written
2026-08-26 08:58 UTC, before the model rebuild, so until that job runs again the
dashboards are showing pre-rebuild numbers with the old projection code's
column choices baked in.
