# Reviewed-source feature reconstruction

The 36 games passing the [shot correspondence review](analytics-reviewed-goal-credit-partition-20260907.md)
now have **3,146 reconstructed feature rows**, including 201 shot-event goals.
The schema exactly matches the frozen candidate: 47 numeric inputs and two
categorical inputs. Missing non-geometric context remains null, not fabricated.
These rows have not yet been passed through candidate inference or evaluated.

## Source and causal checks

`scripts/proof/reconstruct_reviewed_features.py` pins the completed statistical
partition and its consumed source closure. It revalidates original transport,
normalization and final-game receipts, and accepts only the exact reviewed
SOG-only discrepancy. It replays the partition and requires exact equality.
The old source gate still says quarantined; no receipt is changed to complete.

The new offline path reuses existing geometry, strength, prefix and movement
arithmetic. All 37 reviewed non-shot goals are excluded from model rows but kept
in raw history and score updates. The original movement selector resets at goals;
it does not manufacture a preceding shot from an awarded goal. Features are
emitted before current-event score/history updates.

## Preserved first-run defect and correction

The first reconstruction required the opening period descriptor to equal a
two-field object. Official descriptors also include `maxRegulationPeriods`, so
this incorrectly made pre-shot score unknown. **Do not use the first run as the
candidate replay input.** Its code and results are preserved unchanged.

`scripts/proof/repair_reviewed_score_origin.py` applies a separately versioned
correction using the required opening fields while preserving extra metadata.
It reconstructs strict-prefix goal credits, changes only the score-differential
feature and corresponding hashes/availability, and checks final credited totals.
All 3,146 score fields were corrected. No other feature values were changed.

Corrected result:
`scripts/proof/results/reviewed-feature-reconstruction-v2-20260907-full`.
Health SHA-256:
`f28f360cc730db3bdcf194465b2fb41aa327cbc7c380d6639763ad9504634439`.

Preserved first run:
`scripts/proof/results/reviewed-feature-reconstruction-20260907-full`.
Its health SHA-256 is
`15b4e9b720bcfe0cb4c9c3fed468b5fd4ff94830585d5d9df4f8e797f333a5bb`.

## Verification and remaining work

Six focused tests cover goal-credit score effects, movement resets, strict-prefix
independence from future coordinates, missing geometry, source-event drift,
extra official period metadata, and missing score origin. Full offline regression:
**3,551 passed**, 16 network tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/reviewed-feature-reconstruction-20260907-suite.xml`.
A separate Node check verified all corrected health-listed output hashes, all
vector widths/types, and exact schema equality with the frozen candidate fit
receipt. This is not independent scientific sign-off or proof of accuracy gain.

Next: frozen-bundle inference, recovered-population calibration/error analysis,
then explicitly expanded development-cohort validation. Do not call this an
untouched holdout, a fitted talent model, FPAR acceptance, or a production release.
The three withheld games and separate missing-angle event remain unresolved.
Original evidence, models and production are unchanged.
