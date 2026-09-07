# Control-retention challenger

## Finding and implementation

Hard distance cutoffs can interrupt an established carry when stickhandling moves the puck just outside the acquisition boundary. `possession_candidates.infer` now accepts an optional `retention_radius`. The wider boundary applies only after the same nearest player has established sustained control. New acquisition still uses the original radius. Competing-player ambiguity, excessive relative puck motion, missing puck data and invalid timestamps retain their rejection/reset behavior. The default retention radius equals the acquisition radius, preserving default decisions.

## Actual experiment

Compared acquisition/retention 60/60 against 60/84 renderer units. All other settings unchanged. These are development choices after inspecting Hall, not optimized or validated constants.

In the previously defined provisional Hall carry interval, the stricter baseline abstained on frames 77–84; the challenger retained Hall through those eight frames. Both abstained throughout the provisional pass-flight interior. Both stopped asserting control at the same shot-boundary frame. **The existing 84-unit default already handled this carry; this is not an improvement over that default.**

Across seven saved replays the challenger changed 39 frame assignments: 8 in Hall and 31 elsewhere. Correctness of those additional assignments is not established. Expanding retention can incorrectly prolong possession, so those changes require video review before choosing this setting.

`scripts/proof/results/body-possession-review-20260907/retention-challenger.json` preserves every changed frame, input hashes, settings and code hashes. Reproduce with `PYTHONPATH=data-pipeline python3 scripts/proof/evaluate_possession_retention.py /absolute/new-report.json`.

## Visual evidence, without overstating it

Inspected the saved shot sequence contact sheet and three individual source images. At video 8.008 seconds the attacker appears to carry toward the net with the defender separated. At 8.875533 seconds the defender overlaps the stick/puck region, making precise control harder to establish. The wide transfer still at 6.272933 seconds does not resolve exact puck contact reliably.

These observations, original image hashes and uncertainty are recorded in `hall-disputed-visual-review.json`. They are explicitly single-reviewer, model-exposed, unadjudicated observations. Player identity is not independently legible in these stills. They are not approved labels or independent model validation.

## Status

Optional challenger implemented and software-tested. Default inference settings, frozen viewer artifacts, xG model and production remain unchanged. No possession accuracy percentage or AUC/Brier gain is established. The result identifies a concrete temporal-control mechanism worth testing; it does not replace the need for independently reviewed, game-disjoint labels.
