# Timing-conditioned calibration: development result

## Outcome

The single predeclared timing candidate improves both Brier score and clipped log loss against the saved expanding monthly calibration baseline in **both** original development folds. The declared fold-level point guard passes. This is adaptive retrospective improvement, not production acceptance or evidence of industry-leading accuracy.

Completed evidence: `scripts/proof/results/official-timing-candidate-20260906-full`; health SHA256 `f035ec542fc02d7b91f9ec3f66cd8218c3746bb095f47dc31ace7ebc89e49ed9`. Fixed plan: [analytics-timing-candidate-plan-20260906.md](analytics-timing-candidate-plan-20260906.md), SHA256 `406084699d40ddfc4b6c735ea6f0cdfd2d5188f131734fde0b85098d8595cb8c`.

## Matched comparison

Lower losses are better. Values below are from the completed fold scorecards; differences are candidate minus expanding baseline.

| Evaluation period | Events / games | Baseline Brier → candidate | Baseline log loss → candidate |
| --- | --- | --- | --- |
| Oct 2022–Jun 2023 | 120,080 / 1,378 | 0.0610693005633 → 0.0610452210868 | 0.224890708301 → 0.224802556538 |
| Oct 2023–Jun 2024 | 121,033 / 1,383 | 0.0600255171797 → 0.0595951741151 | 0.221706395801 → 0.220113024831 |

- Fold 1: Brier difference −0.0000240794765; log-loss difference −0.0000881517628.
- Fold 2: Brier difference −0.000430343065; log-loss difference −0.001593370970.

The original fixed-calibration control and expanding-control predictions remain exact. Original evaluation membership, targets and all eight subgroup dimensions are preserved. Timing diagnostics have separate scorecards to respect the unchanged evaluator's dimension limit.

The original paired whole-game resampling procedure gives the following descriptive 95% intervals for candidate-minus-baseline differences:

- Fold 1 Brier: [−0.0000366249092, −0.0000121184184]; log loss: [−0.0001308527424, −0.0000496865366].
- Fold 2 Brier: [−0.0004736684265, −0.0003944060468]; log loss: [−0.0017466376877, −0.0014681113915].

These use the fixed saved predictions, 256 game-level resamples and seed 60906. They do not refit the monthly policies, account for the full adaptive research process, or turn these already-inspected years into an untouched test.

## What changed—and what did not

The new calibration contract jointly adds four ridge-shrunk logit offsets for recorded timing bands within the original immediate same-team prior-shot-on-goal state. Gaps over ten seconds are the reference; other prior states receive no added timing term. Original conditional slopes and offsets are still fitted jointly, so their predictions can change too. Train-unseen timing bands get zero extra adjustment. No category was selected using a current game's goal outcome.

Every monthly map, including the first, was fitted using only the original calibration cohort and strictly earlier outer-month games. There were no raw-model refits, clock rewrites, dropped shots, new MoneyPuck files, production changes or finishing/talent removals. Existing movement features and previous work remain preserved. This run evaluates the neutral xG calibration component, not every downstream model.

## Remaining weaknesses

The aggregate gains do not mean every subgroup improved:

- Fold 1 same-clock and exactly-two-second prior-SOG cells worsen on both point losses. The sparse June 2023 month also worsens slightly on Brier, though log loss improves; it contains only 481 events from five games.
- Fold 2 one-second follow-ups improve from 522.36 to 380.13 expected goals against 134 observed goals. That remains substantial overprediction.
- Fold 2 same-clock follow-ups improve from 79.24 to 72.85 expected goals against seven observed goals. They are not fixed.
- Fold 2 three-to-ten-second follow-ups improve from 372.31 to 455.50 expected goals against 643 observed goals, still underpredicting the total.

All figures above come from the separate timing scorecards and retained monthly scorecards, with no new fitted selection. All nine fold-2 months improve both point losses, but sparse months remain explicitly marked. The source-era timing discontinuity remains unexplained; a useful calibration adjustment is not proof of a recording-system cause.

The next investigation should address the remaining timing bias and the earlier-period regressions with a separately declared earlier-only policy. Do not silently retune this completed candidate. Foundation, finishing/talent, prospective evaluation and FPAR acceptance remain open.

## Verification and preservation

Focused author/independent Python tests: 78 passing. Full offline Python suite: 3,412 passing, 16 network tests deselected, 33 existing deprecation warnings; receipt `scripts/proof/results/timing-candidate-20260906-suite.xml`. Independent Node checker tests: 32 passing. Every real prediction also passed separate scalar, reversed-batch and sampled-singleton arithmetic checks inside the runner.

Independent full-data review: `scripts/proof/results/timing-candidate-review-20260906-full`, health SHA256 `e2222a66a15a3fb606bcb64bed881b9af92f00ae65d03ad166fa59ec7e7f7d38`. It replayed all 241,113 test predictions with maximum scalar error 2.23×10⁻¹⁶ (rounded upward), verified exact original controls and earlier-only saved memberships, and checked 148,395 point quantities across original and timing scorecards. It did not refit models or recompute bootstrap intervals.

An incremental local recovery duplicate preserves this candidate and its independent review; it is not a new cumulative archive of every earlier evidence directory. Existing earlier checkpoints, including `analytics-input-recovery-checkpoint-20260907-000946`, remain intact. Recovery is a local duplicate, not an off-machine backup or certification of a complete production runtime.
