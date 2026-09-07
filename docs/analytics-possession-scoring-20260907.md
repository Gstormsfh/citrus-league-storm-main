# Possession scoring and review experiment

Local review: http://127.0.0.1:8768/possession-review/ (requires the existing local server). Frozen bundle: `scripts/proof/results/body-possession-review-20260907/possession-review/`.

## Implemented

- Continuous per-actor evidence: puck/actor distance, relative movement, nearest competitor margin and consecutive support. Missing stick observations and video identity remain null. A transparent exploratory evidence score is displayed, never a percentage. It is not the fitted probability model.
- Review UI: controlled / no control / uncertain, reviewer, visual evidence, selected player, source hashes and viewing alignment. Suggested owner hidden initially; revealing it is recorded. Export is single-reviewer, unadjudicated and ineligible for training. Reviewers must resolve identity from evidence, not assume a selected roster name is correct.
- Label-to-feature join verifies matching video/replay hashes and actor presence. Uncertain labels are excluded, not converted to negatives.
- Supervised fitting: standardized continuous inputs with learned logistic weights; separate sigmoid calibration; game-disjoint training, calibration and test sets. Duplicate labels, missing features, provisional alignment and unadjudicated labels are rejected. Reviewers/alignment metadata are externally audited assertions: the code cannot certify that review occurred.
- Evaluation code reports held-out Brier, AUC and log loss for the calibrated model, uncalibrated model and training-prior baseline, plus per-game Brier. Synthetic fixtures exercise the code; their results are not hockey performance.

Calibration requires data separate from model fitting: [scikit-learn calibration guidance](https://scikit-learn.org/stable/modules/calibration.html). This implementation estimates per-actor binary control, not jointly constrained ownership; it does not force someone to own a loose puck.

## Actual saved-clip diagnostic

`landmark-consistency.json` records agreement with the previously saved provisional Hall alignment: no asserted owner in frames 62–68 (interior of pass-flight interval); Hall is the control candidate in frames 72–91 (interior of the carry interval). Boundaries are excluded. This agrees with prior review but uses the same clip and provisional timing: **not independent validation, not a calibrated percentage, not an improvement over the previous candidate logic**.

## Still missing

No genuine possession model has been fitted on hockey labels in this run. Existing saved annotations are provisional and single-reviewer; no independent game-disjoint labeled evaluation corpus is available. The calibration code deliberately refuses to turn those into claimed accuracy. Body detection remains separate; automated puck/stick localization and camera registration are not implemented.

Next required data work is adjudicated possession labels across games, with all eligible sampled frames included or exclusions recorded, verified timing, controlled and loose-puck cases, occlusions, and source evidence. Only then fit and evaluate the frozen model. More code or an arbitrary confidence multiplier does not substitute for those labels.

Production, xG training inputs and model weights remain unchanged.

## Label handoff integrity follow-up

The join now verifies the feature record's own frame index and the reviewer’s actual video time/viewing offset, not only the clip hashes and declared replay frame. The viewing offset must be within the corpus alignment interval; observed video time must match that frame/offset within 50 ms. Missing/non-finite timestamps and stale alignments are rejected. This tolerance is a synchronization guard, not certified puck-contact timing.

If a labeled controller lacks required features, the whole join fails instead of silently dropping the positive and retaining other players as negatives. Source feature values, game split and computed targets override similarly named label fields. Seven new regression cases cover these handoff errors; the complete possession/passing suite passes 92 tests. These are software-correctness results, not possession-accuracy measurements.

The remaining evidence bottleneck is independently adjudicated, frame-aligned possession labels across games. No genuine hockey possession classifier has yet been fitted by this experiment, and these changes must not be described as measured xG or calibrated-possession improvements.
