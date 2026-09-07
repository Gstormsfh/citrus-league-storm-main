# Full-period calibration transfer result

The frozen monthly expanding calibration policy passed its declared point-loss
guard in both original outer-validation periods. All refitted months improved
both Brier score and log loss on point estimates; the first month in each period
was exactly unchanged by design. This is a modest, positive retrospective
result—not an untouched test, production promotion or industry-ranking claim.

## Frozen experiment and retained evidence

Plan: `analytics-calibration-transfer-plan-20260906.json`, SHA-256
`f60544d9eb9ce69fb0c6041947d9c7bde401864cc69371e35f88f7622f909f6e`.
It was declared before fitting, using retained dates and identities to fix every
monthly population. An independent pre-fit audit reproduced all block receipts.

Run: `scripts/proof/results/official-calibration-transfer-20260906-full/`.
Health SHA-256:
`6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b`.
All original movement raw-model inputs and parameters, full-calibration initial
maps, context rules, penalties, initialization and optimizer settings were frozen.
No raw-model or shooter model was fitted. Each later monthly map used all
original calibration rows plus strictly earlier outer-period dates. The new
bounded engine retained every row rather than relaxing the memory limit.

## Matched accuracy results

Differences below are expanding minus fixed; negative is better. Intervals are
the declared 95% whole-game bootstrap intervals on the saved fitted predictions.

| Period / metric | Fixed | Expanding | Difference [95% interval] |
|---|---:|---:|---:|
| Oct 2022–Jun 2023 / Brier | 0.061125805 | 0.061069301 | −0.000056504 [−0.000075740, −0.000037362] |
| Oct 2022–Jun 2023 / log loss | 0.225090313 | 0.224890708 | −0.000199605 [−0.000257045, −0.000141843] |
| Oct 2023–Jun 2024 / Brier | 0.060098779 | 0.060025517 | −0.000073262 [−0.000091883, −0.000058172] |
| Oct 2023–Jun 2024 / log loss | 0.221949190 | 0.221706396 | −0.000242794 [−0.000311521, −0.000187074] |

The first period contains 120,080 events, 1,378 games and 8,648 goals; the second
contains 121,033 events, 1,383 games and 8,478 goals. All nine calendar blocks per
period were retained. June has only five and nine games respectively, so its
point improvements are not treated as supported monthly inferential results.
Aggregate intervals favor expanding calibration for both metrics in both
periods. This does not imply that every monthly or subgroup interval excludes
zero or that the retrospective policy-selection uncertainty is accounted for.

## What remains unresolved

Aggregate calibration is not universally fixed. In the first period, expanding
predictions still exceed observed goal rate by about 0.002649 (observed minus
expected interval [−0.004126, −0.001249]). The second period's corresponding gap
is +0.000147, with an interval spanning zero. Lower scoring loss is not proof of
perfect calibration, especially within shot-quality and context subgroups.

Specific remaining diagnostics in both periods:

- Prior same-team shot-on-goal cases overpredict by about 0.687 and 0.608
  percentage points; both saved gap intervals remain below zero.
- The 5–10% prediction bands underpredict by about 0.293 and 0.686 percentage
  points. The 20–35% bands overpredict by about 2.144 and 1.639 percentage points.
- Unknown prior context underpredicts by about 1.710 and 5.147 percentage points
  on 573 and 661 events respectively; only the second gap interval excludes zero.

Reliability-band memberships are model-specific, not a same-shot causal
decomposition. These are reasons for source/context fidelity and missingness
diagnostics, not permission to fit ad hoc corrections on validation labels.

These are previously inspected historical cohorts. The first period's outer
games also appear in the second period's original calibration population.
Earlier outer-period labels update later maps, so this is not a fixed-heldout
evaluation or two statistically independent replications. Historical game dates
simulate availability; they do not prove actual completion/ingestion times or
source-revision cutoffs. Fixed-fit game bootstrap intervals omit refitting,
adaptive policy selection and longer-range dependence.

The old prospective reservation remains unchanged and does not cover this new
policy. Later-season movement export certification, real availability lineage
and a new prospective reservation remain required before stronger deployment
claims. No finishing, talent, FPAR or foundation gate is closed by this result;
existing inputs and evidence remain preserved. Production is unchanged.

## Verification

Before execution: 39 Python tests (16 author, 23 independent) and 18 independent
JavaScript checker tests passed. Full offline suite: **3,157 passed**, 16 network
tests deselected, 33 existing deprecation warnings. Receipt:
`scripts/proof/results/calibration-transfer-20260906-suite.xml`.
The Citrus number-verification skill tied the reported quantities to these
retained scorecards and receipts rather than inherited model claims.

Independent completed review:
`scripts/proof/results/calibration-transfer-review-20260906-full/`, health SHA-256
`b0e503eb32721cd1bc493e8f727436eb461df4a0ed379e985676f549968064f5`.
It verified 13,151 file hashes and 78,821 point comparisons across monthly and
aggregate scorecards. Scalar JSON calibration replay had maximum prediction
error `2.220446049250313e-16` in both periods. Point-score arithmetic differed by
at most `3.637978807091713e-12`. The checker did not refit models, independently
recompute bootstrap intervals or reconstruct raw event features.

The sixteen actual map fits took about 149.54 seconds in total (individual fits
about 5.34–13.49 seconds), excluding source verification, inference, scoring and
archival. This is a local fitting measurement, not a production latency promise.
