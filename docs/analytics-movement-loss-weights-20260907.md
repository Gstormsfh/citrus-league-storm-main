# Percentage weighting experiment

Changed the relative training-loss weight for shots following an immediate same-team recorded event within three seconds and with at least ten feet of lateral displacement. Two fixed candidates: 0.5× and 1.5× the ordinary-shot weight. Weights normalized to mean one to maintain the overall regularization scale. Original inputs, tree settings, seed, targets and chronological splits were preserved; validation scoring was unweighted. These are training-example weights, not direct percentage coefficients on individual features or predicted xG.

| Model | Fold 1 Brier | Fold 1 log loss | Fold 2 Brier | Fold 2 log loss |
|---|---:|---:|---:|---:|
| Reference raw model | 0.061189740693280585 | 0.2253990210850298 | 0.06041293784975856 | 0.2229609389950014 |
| Movement shots at 0.5× | 0.06121981873604022 | 0.22549506707760497 | 0.06039472726042482 | 0.2229297168991711 |
| Movement shots at 1.5× | 0.06119094876421423 | 0.2254069213193606 | 0.06043355989170771 | 0.2229602618204486 |

Half weighting improves both second-period metrics, including the movement subset, but worsens both first-period metrics. Increased weighting does not pass either period on both metrics. Neither candidate is promoted. Production remains unchanged.

Evidence: `scripts/proof/results/movement-loss-weights-20260907/`. Runner: `scripts/proof/run_movement_loss_weights.py`. Declaration, full predictions, movement-subset scores, source hashes and completion hashes retained. Pre-shot eligibility and exact relative-weight normalization were tested. Independent Node calculations verified full-population and subset scores and output hashes. Historical source closure verified before and after fitting.

Limitations: previously inspected historical development folds; no untouched validation or production/composed-candidate equivalence. This tests a specific weighting hypothesis, not every possible weighting or the complete legacy factor logic. No MoneyPuck files were used. Failed alternatives remain preserved rather than being overwritten or presented as successes.
