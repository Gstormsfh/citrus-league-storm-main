# Calibration refinement and portable inference checkpoint

Status: improved development losses and verified portability, **not accepted**.
Production, hosted databases, serving flags and the original prospective
reservations are unchanged. This is an adaptive experiment on already-inspected,
current-revision historical development data, not independent or prospective
confirmation.

## Measured result

The [pre-fit plan](analytics-calibration-plan-20260906.json) fixed five
calibrators, penalties, two chronological folds, full source replay and a
no-worse-than-prior-sigmoid guard for both losses in each fold. The raw enhanced
model was refitted in memory with the unchanged prior configuration and exact
train medians/vocabulary. No legacy model was deserialized.

| Candidate | Equal-fold mean Brier | Equal-fold mean log loss | Declared guard |
|---|---:|---:|---|
| Raw | 0.060864434 | 0.224381308 | Fails fold 2 |
| Prior logit sigmoid | 0.060797618 | 0.224239026 | Passes |
| Isotonic | 0.060761018 | 0.224518294 | Fails fold 1 log loss |
| Beta | 0.060800173 | 0.224248078 | Fails both folds |
| Context-aware beta | 0.060716239 | 0.223930724 | Passes; next development candidate |

The selected candidate's Brier/log loss are 0.061274262 / 0.225583251 in
fold 1 and 0.060158216 / 0.222278197 in fold 2. Selected-minus-prior-sigmoid
Brier differences are −0.000033073 (95% interval −0.000066191 to −0.000004978)
and −0.000129686 (−0.000160415 to −0.000095713). Log-loss differences are
−0.000156351 (−0.000264188 to −0.000052834) and −0.000460253
(−0.000579874 to −0.000327586).

These intervals use the unchanged 256 paired whole-game resamples, conditional
on fitted candidates. They do not incorporate refitting, adaptive selection,
multiple comparisons or prospective generalization. Both losses measure more
than calibration alone. The gain is modest; the baseline is retained.

## What improved, and what did not

All five candidates, every reliability bin, every paired comparison and all
77 subgroups in each fold remain in the complete machine review. All eight
dimensions were inspected: shot type, strength, defending empty net, season,
home-rink identity, game type, previous-event type and prior same-team SOG.

The prior-same-team-SOG observed-minus-predicted gap improved from −0.012961
to −0.010474 in fold 1 and from −0.012916 to −0.008571 in fold 2, but both
new intervals remain below zero. Tip-in gaps improved in both folds; the
backhand gap improved slightly in fold 1 and substantially in fold 2.
This context describes the preceding recorded shot, **not** a confirmed
rebound or possession boundary.

Important remaining weaknesses:

- The 0.20–0.35 probability bin still overpredicts in both folds: gaps
  −0.035347 and −0.036061. The 0.35–0.50 bin also overpredicts in both.
  The 0.05–0.10 bin still underpredicts in both.
- Fold 1 expects 9,130.08 goals against 8,648 observed, slightly worse than
  the prior sigmoid's 9,120.88. Fold 2 expects 8,529.64 against 8,478,
  closer than the prior 8,539.98. A closer aggregate does not prove calibration.
- Fold 2 5v4 overprediction worsened (gap −0.006124), and 5v3 worsened
  (−0.025971). Fold 1 snap shots changed from underprediction to overprediction.
  Empty-net conditioning also needs care: fold 1's gap changes sign.
- Poke/tip-in overprediction remains in both folds; deflected shots remain
  overpredicted in fold 2. Unknown prior-SOG context remains underpredicted
  in fold 2. Sparse strength/shot categories retain unavailable intervals.
- Rink checks are descriptive, not causal recording-bias estimates.

No subgroup threshold was invented after seeing these results. Improvements
do not erase regressions or substitute for the full acceptance process.

## End-to-end probability portability

The independent Python JSON feature design equals the fitted design exactly.
JSON tree inference matches the fresh training-library predictions with zero
measured difference on all calibration and validation rows. The fresh raw,
sigmoid and isotonic validation vectors also exactly reproduce their preserved
predecessors.

The separately committed TypeScript module streams the same unchanged feature
export and verifies the full populations against a pinned completed Python
health receipt. Fold 1 checks 119,916 calibration and 120,080 validation rows;
fold 2 checks 120,080 and 121,033. Validation checks all five calibrators,
while calibration checks raw probabilities and explicit context receipts.
The maximum selected-candidate discrepancy is 2.78e-16; the maximum across
all candidates is 7.08e-13 for isotonic, within the predeclared 1e-12 tolerance.
The latter can amplify tiny raw floating-point differences near close knots;
it is not reported as exact equality.

The TypeScript scorer is absent from the serving barrel. Missing and unseen
categories remain distinct. In particular, fold 1 validation contains 840
shot-type values unseen during calibration, handled by the declared zero-offset
policy and counted explicitly. Artifact pinning, exact cohort consumption,
source/code rehashing, invalid inputs, tree topology, cancellation and
create-only failures are separate checks. There is no TypeScript PBP reparse,
hosted scoring integration, final serving fit or new prospective reservation
in this checkpoint.

## Evidence organization and preservation

[Compact machine index](analytics-calibration-result-index-20260906.json) pins
the completed result, health and full machine review. The complete review
was placed, byte-identically, with experiment artifacts at
`scripts/proof/results/official-calibration-review-20260906/review.json`,
instead of duplicating a large generated file in tracked documentation.
The review retains all candidates/subgroups, not only favorable slices.

The new source commit and all three new evidence roots are covered by a
separate create-only local archive; see
[preservation receipt](analytics-calibration-checkpoint-archive-20260906.json).
Original files and earlier archives remain in place. These are local
duplicates, not off-machine disaster-recovery backups.

The closing independent hash check matched all 17 inventoried legacy model
artifacts, all 18 first-experiment proof files (including the original
reservation), all six compressed archives across the three checkpoints, and
the five newly indexed result/review files. No model was deserialized.

Verification before the real fit: 1,611 offline Python tests passed, 16 network
tests deselected, 33 existing datetime warnings. The full shared TypeScript
suite passed 284 tests and type checking. The separate proof harness passed
8 synthetic tests; preservation orchestration passed 3. These counts are
implementation checks, not quality claims.
Final web and server TypeScript checks also passed using their existing
project configurations; no application-serving code was changed by this step.

## Research and next overnight work

The beta family follows the published probability-calibration methodology;
identity-centered regularization and additive context offsets are original
Citrus development choices. Our prior sigmoid already operates on log odds
and includes the identity map; ordinary beta did not improve this dataset.
[Kull et al., primary paper](https://proceedings.mlr.press/v54/kull17a.html).
Keep calibration fitting disjoint from evaluation; aggregate losses alone do
not establish reliable probability bins.
[scikit-learn calibration guidance](https://scikit-learn.org/1.5/modules/calibration.html).

Continue researching a bounded, smoothly regularized calibration alternative
for the remaining shape errors, with a new declaration before any new real fit.
Do not alter this plan/code/evidence or repeatedly tune to these validation
labels while calling them fresh evidence. Any additional development must
state its adaptive history, maintain the fixed comparison baseline, inspect
all slices and preserve failed candidates.

Then complete the local model→publication→consumer validation without swapping
legacy or neutral variants implicitly. Resolve remaining event identity, TOI,
season/writer coverage, fitted rink/legacy-SQL lineage and operational gates.
FPAR still requires validated physical forecasts, common horizon, supported
scoring categories, eligibility and feasible replacement allocation; it is not
GAR renamed. The complete
[method-preservation map](analytics-method-preservation-20260906.md) stays in
force, including flurry/rebounds, talent, goalie, opportunity and uncertainty.

No additional approval is needed for these bounded local lanes. Hosted writes,
deployment, paid resources and new data rights remain outside this run. Future
observations cannot be manufactured overnight. No MoneyPuck files or fitted
actuals entered this work, and no industry-standard or full-mission-completion
claim is made.
