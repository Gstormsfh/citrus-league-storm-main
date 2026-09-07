# Broadcast bodies and replay possession hypotheses

Implemented offline only. No production xG features, weights or data changed.

Current review: http://127.0.0.1:8768/torchvision-view/ while the local server is running. Packaged assets and immutable hashes are in `scripts/proof/results/body-possession-review-20260907/torchvision-view/`. The original Apple output and Torchvision output remain separate in the parent directory.

## Actual body detection

`scripts/proof/detect_review_bodies.swift` runs Apple's full-body Vision request on saved image pixels, checking each source frame hash. This first baseline failed on the wide broadcast sample: almost all frames had no detections. Its output is preserved, not presented as a usable hockey detector.

`scripts/proof/detect_review_bodies.py` runs Torchvision Faster R-CNN ResNet50 FPN v2's COCO person class. It records the checkpoint hash, library versions, source image hashes, video hash, normalized top-left rectangles and original decoded timestamps. The experimental score cutoff is 0.5, not a possession probability or measured hockey precision. Person detections can include officials, spectators and false positives. No identity association or stable cross-frame body IDs are claimed.

The viewer overlays image-derived rectangles on video only within 34 ms of an analyzed frame. It clears boxes outside those windows. The selected frames cover transfer and shot windows, not the entire clip. No motion interpolation or invented puck location fills the gaps.

## Possession: a separate, explicitly uncertain layer

`data-pipeline/projections/possession_candidates.py` uses the existing replay coordinates, not the video boxes. It requires a separated nearby actor, low relative puck/player motion and consecutive support. Missing puck observations and ambiguous nearest actors reset support. Labels are `unknown`, `contested`, or `control_candidate`; none is confirmed possession. The logic is causal: extending the clip cannot change earlier outputs.

Thresholds are inherited exploratory renderer-scale settings, not calibrated hockey constants. This new state layer is not independently validated against human possession labels. It must not be used for training as ground truth.

Image pixels and replay coordinates are **not registered**. We cannot assign a detected person's box to an NHL player or locate the puck in the video from these outputs alone. Reliable video possession still requires puck/stick observations, camera-aware spatial registration, temporal identity tracking, and reviewed positive/negative cases including occlusions. Body detection alone does not establish stick contact or puck control.

## Reproduce locally

Run the detector with an isolated Python environment containing torch, torchvision and Pillow:

```sh
python scripts/proof/detect_review_bodies.py scripts/proof/results/passing-landmarks-20260907 /absolute/new-detections.json
PYTHONPATH=data-pipeline python scripts/proof/build_body_review.py --detections /absolute/new-detections.json --out /absolute/new-review-directory
python3 -m http.server 8768 --bind 127.0.0.1 --directory /absolute/new-review-directory
```

Outputs are create-only. Keep the original receipts and rejected detector results. Pretrained weights are fetched from the official PyTorch distribution; no MoneyPuck files, new NHL feed or video uploads are used. This is local research, not a license clearance for commercial deployment of every underlying asset.

## Checks and limits

The passing-system regression suite plus five new possession-state tests passed: 52 tests total. Tests cover causality, missing-puck reset, contested situations, non-comoving puck rejection and invalid coordinates. These are software checks, not hockey accuracy measurements. No AUC, Brier, calibration or possession-accuracy improvement is established.

Browser QA: visually inspected image-derived boxes around skaters at the initial review position. Seeking to replay frame 139 cleared every box and displayed the missing-sample/unknown-video-possession message. No browser warning/error logs were reported during that check. JavaScript syntax and `git diff --check` passed. This is a visual spot check, not a detector precision/recall benchmark.

Sources: [Apple full-body detection configuration](https://developer.apple.com/documentation/vision/vndetecthumanrectanglesrequest/upperbodyonly), [Torchvision model and pretrained-weight API](https://docs.pytorch.org/vision/2.0/models.html).
