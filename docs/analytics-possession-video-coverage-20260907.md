# Second-clip alignment and video coverage

Saved the publicly loaded original Knies highlight locally, with original decoded presentation timestamps and hashed stills. No new hockey data provider or production service was added. Source media is an observed clear NHL playlist; the temporary playlist URL is preserved locally and should not be published.

Artifacts: `scripts/proof/results/knies-alignment-review-20260907/` contains the trimmed video, source receipt, indexed source stills, contact sheet and `coverage-review.json`.

## What the footage supports

The opening live angle shows Toronto's power-play movement and the goal sequence. It subsequently cuts to celebration. Inspected the contact sheet and individual stills around the point pass, wing reception and shot. Coarse visual/replay landmark intervals yield a mathematically consistent offset hypothesis of -6.7995 to -6.097 seconds relative to replay frame zero.

This is a **single-reviewer provisional hypothesis**, not certified timing or possession truth. Exact contact and identity remain difficult in small, compressed frames. Mathematical consistency alone does not verify the landmarks.

Under that hypothesis, the disputed replay frames 126–128 map to video 5.8005–6.703 seconds, after the reviewed live-angle segment ends at 4.5045 seconds. The next sampled still, at 5.005 seconds, is a celebration close-up. Accordingly, these goalie assignments cannot be visually validated from that angle by extending the offset through the cut. This does not establish that the assignments were false; the relevant evidence is absent.

## Implemented protection

`assess_video_coverage` requires the entire uncertainty interval of a mapped replay window to lie within one reviewed normal-speed video segment. It rejects windows before/after coverage, crossing cuts, spanning two adjacent segments, or relying on a segment marked slow-motion. It does not certify that supplied segment reviews are correct.

The label-to-feature join now invokes this check. Direct fitting requires the corresponding coverage assertion as well. Missing coverage metadata is rejected, not guessed. Existing frozen corpora without reviewed segment metadata intentionally cannot be used for training through this path until that metadata is supplied and audited.

Tests cover containment, uncertain boundaries, camera cuts, slow motion, before-video frames, the Knies interval and actual label-join enforcement. Previous evidence and frozen viewer bundles remain preserved. No production changes, calibrated possession percentage or measured xG improvement is claimed.
