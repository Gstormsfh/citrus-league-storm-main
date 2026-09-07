# Goalie interaction is not a skater carry

The next retention-challenger review targeted game 2025020061, event 271. The three changed frames (126–128) assigned control to player 8478048. The official game landing response identifies that player as goalie Igor Shesterkin. Those changes therefore cannot be validated as ordinary skater carry retention.

## Implemented safeguard

`possession_candidates.infer` accepts source-confirmed `goalie_ids`. If the nearest nearby actor is a listed goalie, it returns `goalie_interaction_unresolved`, clears control persistence, and does not promote the next-nearest skater into possession. The goalie remains a competing nearby actor. Actual goalie control, saves, covers and loose-puck proximity require separate evidence; this rule does not assert that goalies cannot possess the puck.

The review bundle builder now supplies goalie IDs from the saved Hall roster. Callers that do not supply roles retain the old behavior; this is not a claim that every entry point has complete role metadata. Continuous feature extraction and the experimental probability fitter remain separate and have not been validated as goalie-control models.

## Saved result

`scripts/proof/results/knies-goalie-role-v2-20260907/report.json` records the targeted before/after rows and source hash. With acquisition/retention 60/84, this replay produced 27 goalie control-candidate frames before the role guard and none after. This is **abstention**, not 27 proven false positives corrected. No per-frame possession truth or calibrated accuracy is established.

The ordinary public PBP request returned 403; it was not bypassed. The already-accessible official landing response supplied goalie roles through its three-star player records. That role source is sufficient for the identified target, but is not a general complete-roster guarantee. The fetched response and receipt are preserved alongside the result. The first failed run's empty output directory is preserved.

Opened and inspected the linked official Knies goal video. Video-to-tracking alignment for this clip has not been established; no frame-level control labels were inferred from the goal description, assists or page title.

## Verification and scope

73 regression tests pass, including goalie abstention, avoiding reassignment to a second-nearest skater, retaining normal skater behavior, retention logic and source-continuity tests. Production, xG weights and existing frozen review bundles remain unchanged.

Sources: [official game landing](https://api-web.nhle.com/v1/gamecenter/2025020061/landing), [official goal video](https://nhl.com/video/nyr-tor-knies-scores-ppg-against-igor-shesterkin-6382866443112).
