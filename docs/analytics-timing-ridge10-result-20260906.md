# Weaker timing penalty — completed development experiment

The fixed ridge-10 candidate passes both declared fold-level loss guards against ridge 100. Only the extra timing-offset penalty changed; all original penalties, raw scores, chronological cohorts and subgroup definitions remain unchanged. No production change or automatic acceptance.

Source result: `scripts/proof/results/official-timing-ridge10-20260906-full`, health SHA256 `12eb666e35ab63c3c3f58206d81f8332794c904c5594e92a1fcf7ed69afa1a82`. Plan: [analytics-timing-ridge10-plan-20260906.md](analytics-timing-ridge10-plan-20260906.md), SHA256 `9153733a6251fb85726ae577d5a150f7e7bc713a000d82df5a89edff29c8a635`.

| Period | Ridge-100 Brier → ridge-10 | Ridge-100 log loss → ridge-10 |
| --- | --- | --- |
| Oct 2022–Jun 2023 | 0.0610452211 → 0.0610400710 | 0.2248025565 → 0.2247831427 |
| Oct 2023–Jun 2024 | 0.0595951741 → 0.0594830634 | 0.2201130248 → 0.2196872516 |

The same 120,080 and 121,033 events are evaluated. Fixed, expanding and ridge-100 control predictions remain exact. Both folds improve both point losses; this is incremental adaptive development evidence, not a claim of world-leading accuracy.

Descriptive 95% game-bootstrap intervals for ridge-10 minus ridge-100:

- Fold 1: Brier [−0.00000867692, −0.00000112380]; log loss [−0.00003312063, −0.00000644267].
- Fold 2: Brier [−0.00012537106, −0.00009857866]; log loss [−0.00047134037, −0.00037973842].

These retain the original 256 fixed-prediction resamples and do not account for the full adaptive selection process or refit the monthly policies. These years are not untouched evaluation.

## Remaining problems

In fold 2, one-second follow-up xG falls from 380.13 to 347.42 against 134 actual goals; same-clock xG falls from 72.85 to 61.87 against seven goals. Both remain substantially overpredicted. Three-to-ten-second follow-ups remain underpredicted: 466.03 xG versus 643 goals.

Fold 1 same-clock, two-second and three-to-ten-second groups worsen on both losses. December 2022 worsens on at least one loss; all fold-2 months improve both. Every regression remains in the scorecards. Lowering this penalty helps aggregate performance but does not resolve the source-era shift. Do not continue an undeclared penalty sweep or erase historical evidence.

## Checks

57 focused Python tests and 32 separate-checker Node tests pass. Full offline regression: 3,476 passing, 16 network tests deselected, 33 existing deprecation warnings; `scripts/proof/results/timing-ridge10-20260906-suite.xml`. A direct objective/gradient comparison verifies that the only statistical engine change is the timing ridge. Every prediction also passes scalar/batch consistency checks in the runner.

The completed separate Node replay is `timing-ridge10-review-20260906-full`, health SHA256 `d922cfae252f065cb402716e2962fd79ece817b2a491e92190a6e813bdedbe78`. It checks all 241,113 predictions, the unchanged controls and 204,666 point quantities; maximum scalar prediction error is 2.23×10⁻¹⁶ (rounded upward). It does not refit models or recompute bootstrap intervals.

Incremental local recovery evidence accompanies this result; earlier checkpoints remain separately intact. This work was completed solo; a separate implementation is not an independent-agent review. Original model, finishing/talent work, prior evidence and production remain preserved. Foundation, prospective validation and FPAR acceptance remain open.
