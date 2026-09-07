# Independent possession review pack

## Garrett's first batch

Use http://127.0.0.1:8768/garrett-batch-one/ on the Mac running the server. This smaller frozen pack contains eight evenly spaced saved samples per clip, selected without model scores. The earlier full pack below is preserved.

Enter Garrett as reviewer. Judge the displayed still's timestamp, using surrounding video for context. Use “Return video to sample time” after playback. Select a state and, only for controlled possession, the visible team/jersey. Add a brief evidence note and save each observation. Unclear identity or possession should remain uncertain. Download observations before closing and attach the JSON in this conversation. Partial batches are accepted; there is no autosave.

Import a downloaded export from the repository root with:

```sh
python3 data-pipeline/projections/possession_review_import.py \
  scripts/proof/results/body-possession-review-20260907/garrett-batch-one/manifest.json \
  /absolute/path/to/citrus-independent-possession-observations.json \
  /absolute/path/to/new-review-import-directory
```

The output directory must not exist. Import preserves the raw export and manifest, validates sample provenance and roster membership, rejects duplicate reviewer/sample observations, and reports completeness. Uncertain and non-play observations remain distinct. No replay alignment, adjudication, training eligibility or production approval is inferred. Import regression checks and the existing possession/passing/tracking suite passed together: 100 tests. These are software tests, not hockey accuracy measurements.

## Earlier full pack

Open http://127.0.0.1:8768/independent-review-ready/ while the local review server runs. Frozen deliverable: `scripts/proof/results/body-possession-review-20260907/independent-review-ready/`.

To serve the pack by itself from the repository root:

```sh
python3 -m http.server 8769 --bind 127.0.0.1 --directory scripts/proof/results/body-possession-review-20260907/independent-review-ready
```

Then open http://127.0.0.1:8769/ locally. For another reviewer, transfer the whole deliverable folder through an authorized channel; localhost links do not work on another person's device. No invitations, uploads or external messages were sent.

## Review procedure

Have each reviewer work independently in a fresh page. Enter reviewer identity, inspect the video around each timestamped still, and select controlled, no control, uncertain, or not live play. The roster lookup provides NHL IDs from team/jersey metadata, not model-suggested owners. If identity or contact is unclear, select uncertain. Save each observation, then download before closing; unsaved form changes and in-page records are not automatically persisted.

The page contains no inferred ownership, replay positions or model scores. Exports retain original video/sample hashes and timestamps and remain single-reviewer, unadjudicated observations. They do not claim a reviewer was blind to earlier work outside this page. Disagreements require adjudication; video observations also need independently verified replay alignment before joining model features. Goalies require separate handling from the skater-control model.

## Scope and checks

This pack contains the existing Hall and Knies video samples, including ambiguous and non-play samples. Selection occurred during development and is goal-biased: it is not a clean, representative held-out test set. No new human labels were collected by building the pack. Fresh independent game-level test data is still required before accuracy claims.

Source video and image hashes were verified before packaging; receipt.json hashes the frozen deliverable. Browser checks verified video seeking to the sampled timestamp, blank-label rejection, clip switching and roster lookup. No browser warnings/errors appeared in the final check. The full regression suite passed 93 tests, including a synthetic end-to-end test from reviewed-label structures through feature joining, fitting, calibration and a disjoint-game test report. Synthetic outcomes are not hockey accuracy.

No production changes, calibrated hockey probabilities or accuracy improvement are claimed. Earlier local draft packs remain preserved; Garrett should start with the smaller batch above.
