# Passing review integration

Implemented an offline connection between candidate detection and reviewed sequence geometry. This is not connected to production inference or training.

## Outputs

`scripts/proof/export_passing_review_packets.py` exported all seven previously collected replay clips to `scripts/proof/results/passing-review-packets-20260907/`. Source replay hashes are checked against retrieval receipts, and replay URLs are reconciled to their archived PBP events. Packets retain original video/replay references, parameter settings, source hashes and stable candidate IDs.

Each candidate starts as `unreviewed`, with `geometry: null`. No inferred net position or shot-release frame is filled in. Different settings can describe the same event; candidate variants are not unique passes. Empty detection remains unknown, not a no-pass label. No real passes have yet been frame-reviewed through this interface.

## Review API

`projections.passing_sequence_review.measure_reviewed(body, annotation)` accepts an annotation containing:

- Exact replay `source_sha256`.
- `classification: reviewed_direct_pass`, reviewer and evidence reference.
- Explicit release, reception and shot frame indices, strictly ordered inside the clip.
- Passer, receiver, shooter and team IDs. The direct-pass measurement requires receiver = shooter.
- Coordinate units, orientation/net reference and net coordinates in the same frame.
- Seconds per tick and a timing reference.
- `coordinate_transform` with positive isotropic `units_per_renderer_unit`, two-element `origin_renderer`, and `axis_signs` containing +1/-1 for each axis. Puck coordinates are transformed; supplied net coordinates must already be in that output frame. A physical-unit label alone is insufficient.
- `alignment_anchors`: at least three distinct named landmarks, each with an evidence reference, a `video_seconds` interval and a `replay_ticks` interval. Ticks refer to the source timestamps, not assumed video times. Their offset intervals must intersect; conflicting evidence withholds measurement.

The implementation verifies source binding, actor/team presence, contiguous timestamps and finite puck positions throughout the reviewed interval. It calculates geometry and separate flight/reception-to-shot durations only after those checks. Frames after the shot do not affect the measurements. Annotation provenance records reviewer assertions; code does not independently certify their accuracy.

Unknown/rejected examples must remain in review records. They are not accepted by the direct-pass measurement function and must not silently become negative training labels. Independent annotations may describe passes missed by the detector, preventing review from being restricted to successful detections.

## Verification

Twenty-five tests pass across review integration, passing geometry and co-motion detection. Checks cover source mismatches, unreviewed classifications, missing provenance, invalid timing, wrong actor/team, missing puck segments, deterministic packets and post-shot coordinate independence.

These are software tests, not pass precision/recall or xG validation. All measurements remain `production_eligible: false` and `model_training_eligible: false`. Actual frame annotation, detector accuracy evaluation and representative non-goal coverage are still outstanding.

## Reconciliation update

The complete pass-system suite now passes 47 tests. The revised contract fixes a unit-labeling risk in the initial adapter: native coordinates are no longer merely labeled with caller-provided physical units. It also requires consistent video/replay landmark intervals before accepting reviewed geometry. `passing_time_alignment.py` preserves duration bounds and refuses overlapping endpoint order; those bounds are not statistical confidence intervals. Its alignment assumes an uninterrupted normal-speed video segment, not slow motion or edited transitions.

Receiver endpoint movement is explicitly identified as movement between puck reception/shot locations, not measured skater path length. Net-centred bearing change remains separate from actual goalie movement. Existing archived runs remain unchanged and reflect their pinned earlier implementation.

No real sequence has yet passed the new three-landmark alignment requirement. The visually reviewed Hall pass-then-carry remains useful qualitative evidence, not an exact-timing training label.
