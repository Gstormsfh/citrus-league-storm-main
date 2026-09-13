# Original workbook prospect review — 2026-09-13

The original 69-player cohort now has a complete reviewed matrix: 18 existing forecasts remain exact, 31 additional skaters have explicit low-confidence NHL opportunity priors, and 20 profiles have conditional NHL rates with unallocated season workload. This review preserves all 674 previously projected canonical player objects, every existing rate component, team clubs, goalie allocations, and schedule. The draft source revision is `dcabf0d48ce13ee8104cd1fa90da46c4bc980abd518e62eb3e059c60b3769e1a`; publication approval and activation are separate guarded operations.

`review-patch.json` replays against reviewed coverage source `70badf9420160b354d9c083775c72524c16d36dacffe913ad20cc62a707248b5`. `matrix.json` contains each player's organization, rate basis, workload decision, dated opportunity evidence, and independently sourced non-NHL actuals. Non-NHL actuals are evidence, not imported NHL counts or fitted league translations.

## Rate and opportunity methods

Missing zero-history rates use the existing measured `project_rookies` position/draft-band coefficients. These remain DEFAULT estimates, not individual NHLe conversions. Harrison Brunicke's rates come from the existing `project_ros` model because he has NHL history. Existing supported rates remain unchanged; missing signed plus/minus components use their documented model/cohort source.

`opportunity-measurement.sql` measures regular-season NHL participation for the 2025 season-directory cohort, retaining players with zero subsequent NHL appearances. It selects 525 skaters with 0–24 prior NHL games. The directory is not proven to be a preseason snapshot, so selection bias and one-season uncertainty remain. The descriptive means are explicit opportunity assumptions, not calibrated individual predictions. Low-history draft picks 1–31 are pooled to avoid an undersized subgroup.

The source stores conditional rate and workload separately. Expected games are scaled from the measured 82-game schedule to the target team's verified schedule once. New estimates are proportionally reduced only where they exceed unallocated team capacity; no workload is increased to fill a budget. Final games are rounded down to six decimals, with the actual per-player allocation factor retained. This preserves the strict database capacity guard. College/overseas commitments, unresolved injury constraints and unallocated goalie workloads do not become invented zero forecasts.

`organization_prior_remaining` decays the immutable prior in proportion to remaining team games. It does not subtract appearances from an expected opportunity mean. Its `actual_gp` is explicitly null with `not_used_by_prior` semantics; existing policies retain their missing-participation guards. A second roster-probability multiplier is prohibited. Rate × workload produces counts once.

## Review and verification

Independent review verified coefficient matching, exact patch replay, all 674 unchanged forecast objects and exact decimal sums for all 32 team budgets. Remaining capacity is 0.000001 skater games in CAR and 0.000002 in NSH after downward rounding. Goalies retain the prior team totals without adding starts. Python review tests and real-migration SQL tests cover provenance, derivation, invalid metadata, missing participation, repeated refresh, and season exhaustion.

This artifact does not claim that every prospect has an active NHL role, that every workload is known, or that the app's native manual QA is complete.
