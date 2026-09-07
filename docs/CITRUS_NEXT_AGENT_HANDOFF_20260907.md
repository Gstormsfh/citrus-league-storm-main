# Citrus · Next-agent handoff

## Start here

**Mission:** improve trustworthy pre-shot possession/pass evidence, then measure its incremental xG value. Preserve the existing model landscape, source actuals and all prior experiments. Do not mistake a review-tool improvement for measured model accuracy.

**Current branch:** `fix/analytics-contracts-phase-one`. The previous complete research checkpoint is `6bd225c1`; this follow-up packages Garrett's actual review and the response to his feedback. Read current Git status before editing; do not restore the old stash or archive over the integrated tree.

[Full visual mission handoff](citrus-handoff-20260907/index.html) · [Current xG reference](analytics-current-xg-checkpoint-20260907.md) · [Original method-preservation map](analytics-method-preservation-20260906.md)

## Garrett’s feedback — preserve the distinction

Garrett could see control in Carolina stills but could not rewatch that clip to identify the players. Toronto video was watchable and helped him identify players. His follow-up emphasizes that boxes and identifiers would have made the task much easier.

**Do not discard clear control observations because identity is unknown. Do not treat guessed player IDs as truth.** These are separate uncertainties. An obscured puck also does not establish that nobody controls it.

The original export contains 13 observations: seven controlled, three no-control and three not-live-play. Three sampled frames were not submitted. These counts describe review records, not accuracy or training-set sufficiency.

| Evidence | Location / meaning |
| --- | --- |
| Original answers | [Immutable export](citrus-review-handoff-20260907/original-export.json): original bytes retained, including selected IDs and notes |
| Frozen sample identities | [Manifest](citrus-review-handoff-20260907/manifest.json): clip/frame hashes, original video timestamps, source roster |
| Subsequent qualification | [Qualified review](citrus-review-handoff-20260907/qualified-review.json): separate annotation of uncertain Carolina identities, nonvisibility ambiguity and missing samples |
| Local media | `scripts/proof/results/body-possession-review-20260907/garrett-batch-one/` — ignored by Git, not remotely backed up |

All controlled Carolina identities remain unverified based on Garrett's clarification. His Toronto identities remain single-reviewer claims, not independent adjudication. `hall/transfer/frame-024.png` was submitted as no-control with a note that the puck was not visible; preserve the original, but do not use it as a certain loose-puck negative.

## Completed in this follow-up

- Imported and validated the real export against the frozen sample manifest. Preserved the raw export separately from qualifications; packaged both into Git so a next agent can read the actual evidence and notes.
- Added **“Player controls puck; identity unknown”** to the review UI and importer. It preserves a control observation with a null player ID; it does not generate a positive actor label.
- Clarified that no-control means a visibly loose/in-transit puck. Nonvisibility remains uncertain.
- Added **Replay clip from beginning**, a separate original-video link, and an explicit playback-error message. Replay does not change the sampled timestamp being annotated.
- Built a new local review pack at `http://127.0.0.1:8768/garrett-review-v2/`. Original reviewed packs are untouched. It starts empty; do not ask Garrett to repeat all answers or imply the old answers were preloaded.

The root cause of Garrett's Carolina playback failure has **not** been reproduced or established. These are usability/fallback changes, not proof that the original failure is fixed on his device. The new UI still has no autosave and no box overlay. Download before closing.

## Next bounded implementation: useful identifiers without invented identity

1. Reproduce Carolina playback and seek/replay behavior on the actual review surface. Compare media metadata/loading/error state with Toronto. Test both clips and sample-to-video timing; keep the original media hashes unchanged.
2. Add an optional **assisted review mode**, visibly separate from blind review. Existing image-derived person detections can supply neutral labels such as Player A / Player B, but include officials and false positives. Never claim stable tracking or jersey recognition from those boxes alone.
3. Only overlay detections on their original analyzed image timestamps; no interpolated puck or identity. Existing saved body detections cover selected Hall windows, not all Toronto footage. Clearly show missing coverage.
4. Let a reviewer identify a visible box or say control is clear but identity unknown. Preserve the previous blind observation. Record whether boxes, inferred owners or model scores were shown; assisted observations must not silently enter the current blind-only importer contract.
5. Verify camera registration and temporal identity before associating a box with a replay/NHL player. A replay roster lists possible players; it does not establish which video body is which.
6. After verified timing and adjudication, compare the possession candidate with the review evidence. Keep identity error, control error, occlusion and video-cut errors separate. Do not train on the guessed Carolina IDs.

Do not spend the next turn rebuilding the whole audit or fitting an arbitrary confidence multiplier. Finish the small reviewer-identification loop first, then obtain representative game-disjoint labels before claiming calibrated possession or xG improvement.

## Code entry points

| Component | Source |
| --- | --- |
| Blind review UI | `scripts/proof/possession-blind-review.html` |
| Frozen pack builder | `scripts/proof/build_independent_possession_pack.py` |
| Observation import | `data-pipeline/projections/possession_review_import.py` |
| This evidence package | `scripts/proof/package_garrett_review_handoff.py` |
| Pixel-based detector | `scripts/proof/detect_review_bodies.py` |
| Earlier body viewer | `scripts/proof/build_body_review.py`, `scripts/proof/pass-review-viewer.js` |
| Replay candidates / evidence | `data-pipeline/projections/possession_candidates.py`, `possession_evidence.py` |
| Alignment / calibration contracts | `data-pipeline/projections/passing_time_alignment.py`, `possession_probability.py` |

The packaging script uses create-only output. Its original import directory is local-only; the committed export, manifest and qualification report are the portable review evidence. Video files are still needed for visual verification.

## Validation and release boundaries

The follow-up possession/passing/tracking suite passes 100 tests, including acceptance of controlled-but-unidentified observations with null identity. Those are software tests, not a hockey benchmark. Browser behavior and the reported playback failure still need hands-on reproduction. No new model was fitted or deployed here.

To rerun locally:

```sh
PYTHONPATH=/private/tmp/citrus-py312-deps:$PWD/data-pipeline \
 /Users/gstorms/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
 -m pytest data-pipeline/tests/test_possession*.py \
 data-pipeline/tests/test_video_review_coverage.py \
 data-pipeline/tests/test_passing*.py data-pipeline/tests/test_tracked*.py -q
```

The paths above are this Mac's runtime, not a portable dependency lock. No production changes, automatic training-label promotion or model acceptance follows from this handoff. MoneyPuck files, predictions and fitted parameters remain excluded. Preserve finishing/talent, flurry, original input lineage, calibration, physical projections and FPAR requirements from the full mission handoff.

**Definition of done for the next increment:** Garrett can replay either clip, point to the controlling person without guessing an NHL identity, export that uncertainty faithfully, and the next agent can reproduce the observation-to-source join without contamination from model suggestions. Predictive improvement is a later measured gate, not a promise attached to this UI work.
