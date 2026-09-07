# Existing-PBP linked replay pilot

No new provider, feed or credentials added. This pilot follows NHL replay links already present in the archived PBP. No production changes, xG training, pass-quality promotion or commercial-rights claim.

## Repeatability established within the pilot

Collected the first linked goal from the first, middle and last archived 2025–26 game filenames, chosen before retrieval: games 2025020001, 2025020698 and 2025030416. All three normal NHL Goal Visualizer pages successfully supplied their replay JSON. They contain 140, 139 and 140 coordinate frames respectively. The first replay was independently fetched earlier as well; parsed frame contents matched on the repeat retrieval.

Saved raw bodies, source-game hashes, roster metadata, retrieval receipts and health hashes in `scripts/proof/results/linked-replay-pilot-20260907/` using `scripts/proof/collect_linked_replay_sample.cjs`.

NHL's public renderer code confirms one frame per 100 milliseconds of playback and distinguishes the ID-1 object from player markers. Preserved that renderer and its receipt. Raw x/y remain **renderer units**, not asserted feet; timestamps are used as contiguous replay ticks, not a precise alignment with integer-second PBP clock. Do not infer shot-release timestamps from the final frame: clips can include post-goal time.

## What was implemented and tested

`data-pipeline/projections/tracked_transfer_candidates.py` extracts stable nearest-skater contact runs, excluding roster-identified goalies. It requires a proximity threshold, separation from the second-nearest player, at least two consecutive contact frames, a bounded handoff gap and no intervening competing contact. It fails on timestamp gaps instead of bridging them. Missing puck positions suppress handoffs.

Tested radii of 36, 60 and 84 native renderer units without selecting a winner. Four synthetic unit tests passed for pair arithmetic, competing-contact rejection, missing puck/goalie exclusion, goal-label independence and clock-gap rejection. Repeat extraction produced identical results. This establishes deterministic behavior, **not pass-classification accuracy**.

All nine clip/radius combinations produced zero accepted pass candidates under these conservative rules. This is not evidence of zero real passes.

### Useful rejected handoff

In game 2025030416, event 117, both the 60- and 84-unit settings identify stable contacts with player 8476958 followed by player 8475791. The contact-to-contact gap is 0.9 playback seconds. This pair matches the official primary assister and scorer retrospectively. The detector rejects the candidate because the puck briefly becomes closest to a third teammate at frame 61. This could be an incidental fly-by, touch or deflection; nearest-body proximity cannot determine which. Official assist agreement is a helpful check but does not establish exact pass release, reception or trajectory ground truth.

The three clips also provide coordinate histories for roster-identified goalies. Reported spans are explicitly full-clip native-coordinate spans, not pre-shot-only movement or physical-foot measurements.

Receipts: `transfer-analysis.json` and `rejected-handoff-review.json`. Assist/scorer metadata is used only for the retrospective comparison, never as detector input.

## PBP alone versus its linked data

Ordinary PBP can provide recorded actors, event order, locations, team attribution and coarse timing. Those can support probabilistic sequence features. It cannot uniquely reconstruct unrecorded puck travel, player-to-puck control or goalie locations between events. Different real plays can produce the same sparse event records.

Following the existing replay links supplies finer movement without adding a provider. But the scanned links attach only to goals. Earlier non-goal attempts inside those clips remain selected by a future goal, and absent replay data must not become a predictive flag. This cannot be the default all-shot xG input without representative coverage and validation.

## Operational disposition

- Suitable now: reproducible offline linked-replay retrieval, coordinate inspection, retrospective sequence research and honest coverage reporting.
- Not ready: unattended verified-pass tagging, reception-to-shot timing, automatic xG boosts or universal production scoring.
- Next technical work: verify coordinate scale/orientation and shot-time alignment, distinguish sustained puck/player co-motion from fly-bys using relative velocity and trajectory continuity, and validate pass labels against the existing NHL replay/video.
- Before commercial reuse or scheduled production ingestion, confirm applicable rights and access stability. No provider expansion is required for this research path.
