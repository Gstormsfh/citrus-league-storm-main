# Single bounded recent-timing experiment

Declared before this experiment's fitting. This is adaptive retrospective
development, not an untouched holdout or production authorization.

Control: saved composed ridge-10 candidate predictions. Preserve all raw-model
inputs, probabilities and existing maps. Candidate adds one scalar logit offset
for each of four immediate-prior-same-team-SOG timing bands (0s, >0–1s, >1–<3s,
3–10s). Other events remain bit-for-bit unchanged.

At each calendar month start, use only original-population events from the
preceding 90 calendar days, strictly before that start, within the current
validation fold. Use their saved prequential control predictions, not predictions
from a map fitted with their own outcomes. Recovered games never train offsets.
The initial month has no such history and remains unchanged. A band with fewer
than 30 events or fewer than 10 games also receives exactly zero adjustment.

Fit each offset by minimizing summed Bernoulli log loss plus 0.5 × 10 × offset².
Use bounded bisection of the monotone derivative on [-10,10], 80 iterations.
Input/output probability epsilon is 1e-6, consistent with the control. No other
penalty, window, threshold or candidate will be swept in this experiment.

Save exact training keys/date range/support, fitted offsets and monthly held-out
predictions. Compare Brier and clipped log loss against control separately for
original, recovered and expanded populations in both folds. Report all monthly
and timing-band regressions; compare game-bootstrap paired Brier differences
descriptively. Fold-level point guard requires neither loss to worsen on the
original population in either fold. Passing is not model acceptance.

Non-timing controls must remain exact, model/source hashes must remain fixed,
training/test games must be disjoint and all original/recovered events must be
covered once. FPAR and production remain gated. Negative results are retained.
