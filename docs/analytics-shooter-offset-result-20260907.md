# Shooter-offset development result: not promoted

The declared earlier-month player adjustment fails the original-cohort point guard in both folds. Neutral ridge-recent remains the reference; no existing finishing artifacts or production values were changed.

| Original cohort | Neutral Brier | Shooter-conditioned Brier | Neutral log loss | Shooter-conditioned log loss |
|---|---:|---:|---:|---:|
| Fold 1 | 0.061002465697801454 | 0.061005867305838436 | 0.22463187894349046 | 0.22456673034789085 |
| Fold 2 | 0.05921239612098902 | 0.05924450620090625 | 0.21861966893179718 | 0.21870233243020537 |

Brier worsens in both original folds; log loss improves only in the first. The point guard is not relaxed after inspecting these results. No significance or intrinsic-talent conclusion follows from these point estimates.

Expanded-cohort diagnostics also show Brier regressions separately in regular-season and playoff populations. Predictions without earlier player evidence remain exactly unchanged, including high-probability attempts: no inherited 0.50 cap. Earlier-history predictions, not unknown-player defaults, account for the changes.

## What was actually tested

See [the pre-result declaration](analytics-shooter-offset-plan-20260907.md). One fixed prior and one within-fold, earlier-month, game-type-separated player log-odds adjustment were tested against the frozen neutral probabilities. Team changes preserve player history. Original events alone train the adjustment; recovered events only evaluate it. All non-shot goal credits remain outside fitting and prediction exposure.

This is a limited residual-prediction test, not a test of all possible finishing estimators and not a replication of the legacy ratio estimator. It lacks multi-season prior-player history and cannot establish persistent ability. No TOI, forecast opportunity, posterior interval calibration, physical allocation or downstream daily projection integration was validated. Existing finishing inputs remain required and preserved; this failure does not justify removing them.

MoneyPuck's [public explanation](https://www.moneypuck.com/about.htm) distinguishes neutral xG from Bayesian shooter adjustment but does not specify enough detail to reproduce its exact estimator. Citrus's legacy discrete ratio approximation, daily forecast ratio and this Bernoulli-offset experiment are distinct implementations. No MoneyPuck data or model files were used.

## Reproducible evidence

- Runner: `scripts/proof/run_shooter_offset.py`; six focused tests.
- Result: `scripts/proof/results/shooter-offset-20260907-full`.
- Health SHA-256: `eb1fc96e642cae76844ae3f1d50591a698db5b39839bf2fe48dbf9860a249817`.
- Independent scalar reviewer: `node scripts/proof/review_shooter_offset.mjs`.
- Reviewer verifies all 244,259 predictions, 14,577 player-month fits, exact earlier-only fit membership and support, unmodified neutral probabilities and actors, output file hashes and scalar arithmetic. Maximum gradient residual: 1.4453716001838757e-14; maximum probability difference: 2.220446049250313e-16.
- Full offline suite: 3,617 passed, 16 network tests deselected, 33 existing warnings. Receipt: `scripts/proof/results/shooter-offset-20260907-suite.xml`.

Next work should establish a source-bound multi-season player-history baseline and isolate context/goalie confounding before declaring persistent talent. Do not repeatedly retune this prior on the same inspected folds or use shooter-conditioned probabilities as another finishing denominator. Foundation, prospective validation, production and FPAR gates remain open.
