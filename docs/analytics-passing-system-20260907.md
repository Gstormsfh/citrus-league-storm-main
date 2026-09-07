# Citrus passing system — offline implementation

The executable pipeline is `data-pipeline/projections/passing_system.py`.

It connects source-bound transfer detection, annotation review, continuous geometry, and detector evaluation. It is an offline research system, not a deployed passing feed or demonstrated xG improvement.

## Run

From the repository root, with the project Python environment:

```sh
PYTHONPATH=data-pipeline python3 -m projections.passing_system \
  --replay scripts/proof/results/linked-replay-pilot-20260907/2025030416-117.json \
  --receipt scripts/proof/results/linked-replay-pilot-20260907/2025030416-117.json.receipt.json \
  --pbp scripts/proof/results/historical-official-freeze-20260906/2025/pbp/2025030416.body.json \
  --event 117 \
  --out /tmp/citrus-passing-117-review.json
```

The output parent directory must exist. Existing outputs are refused, preserving evidence. Optional `--reviews path.json` accepts a list of reviewed-direct-pass, uncertain or rejected annotations. Optional `--labels path.json` evaluates detection against an exhaustively annotated frame window. Review fields are documented in `analytics-passing-review-integration-20260907.md`.

## Output contract

- `packet`: candidates with fixed setting, stable identity, source hash and unknown status.
- `reviewed_measurements`: source-bound reviewed direct passes with angular displacement, lateral/longitudinal distance, receiver movement and separate flight/shot-delay durations.
- `unresolved_reviews`: uncertain/rejected annotations preserved with reviewer, evidence and reason.
- `detector_evaluation`: null unless complete-window labels are supplied. Missing labels never imply perfect or zero accuracy.
- `input_sha256` and `code_sha256`: exact inputs and implementation pinned by the CLI.
- Production and training eligibility remain false.

## Detector evaluation contract

Labels must include `source_sha256`, `exhaustive: true`, `reviewer`, `evidence_reference`, inclusive `start_frame` / `end_frame`, `unknown_intervals`, and an explicit `passes` list. Each pass supplies directed passer/receiver/team IDs and release/reception frame indices. Labels may include events that the detector missed; they must not be constructed only by accepting its suggestions.

Evaluation is separate for all six fixed settings. A match requires the same directed actor pair/team and both endpoints within the declared tolerance (default three frames). Maximum-cardinality bipartite matching prevents one true pass from validating multiple detections and avoids greedy assignment failures. Unmatched eligible detections count as false positives; unmatched truth counts as false negatives. Candidates crossing window boundaries or unknown intervals are excluded. Empty denominators produce null precision/recall. Settings are not independent votes or calibrated confidence.

The label set must reflect the detector's general same-team-transfer scope, not only primary assists. Goal-selected clip evaluation cannot establish all-shot generalization. Reviewed declarations are recorded assertions; this software does not independently certify footage labels.

## Verification performed

- Forty-two tests pass across the system, review, geometry and two detector modules.
- Tests cover one-to-one matching, duplicate false positives, missed labels, unknown intervals, wrong direction, maximum matching, empty denominators, invalid provenance, source mismatch and duplicate reviews, plus existing causal/geometry checks.
- The CLI completed on all seven previously collected NHL clips. Outputs and summary are in `scripts/proof/results/passing-system-run-20260907/`.
- All seven correctly remain `offline_review_required`; no real frame-reviewed annotations were fabricated. Counts in those files are parameter-specific candidate variants, not unique verified passes.

## Remaining work

Independent frame-level pass/shot annotation, detector precision/recall on those labels, verified physical coordinate mapping, and representative non-goal coverage remain necessary before predictive xG integration. The next useful work is labeling and validating the real clips, not treating this implementation's passing tests as hockey accuracy.
