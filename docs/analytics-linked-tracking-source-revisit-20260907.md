# Correction: PBP links to a richer NHL tracking source

Earlier statements about missing tracking were scoped too narrowly to event `details` and isolated event coordinates. PBP event objects also contain `pptReplayUrl`, pointing to separate replay JSON. This is a material source-discovery correction, not evidence that our xG has already incorporated tracking.

## Verified source path

- Archived PBP: `2025/pbp/2025020001.body.json`, goal event 258.
- Official page: https://www.nhl.com/ppt-replay/goal/2025020001/258
- Official metadata: https://api-web.nhle.com/v1/ppt-replay/2025020001/258
- Linked data: https://wsr.nhle.com/sprites/20252026/2025020001/ev258.json

NHL identifies the page as its EDGE Goal Visualizer and describes player/puck tracking. The normal public page successfully loaded the linked JSON with HTTP 200. A standalone direct request previously returned HTTP 403; no credentials, forged headers or access-control bypass were used to retrieve the sample.

The inspected replay contains timestamped frames with an `onIce` collection, actor identifiers, player IDs, team IDs, sweater numbers and x/y positions, including roster-identifiable goalies. Raw coordinate and timestamp units, the puck-object convention, gaps and interpolation must be verified before extracting physical speed or precise possession transitions. A tracking position is not itself a labeled completed pass.

## Coverage and bias

Scanning 1,394 archived 2025–26 game bodies found 443,569 events and 8,528 `pptReplayUrl` links. Every linked event in that scan is a goal. This is the full raw archive, not the smaller eligible model cohort; counts include events excluded from model evaluation.

The event list itself has no explicit pass event type in this scan. Legacy `find_pass_before_shot()` in `data-pipeline/acquisition/data_acquisition.py` selects a same-team prior event within three positive seconds. Its shot-only caller buffer principally supplies prior shot attempts; the function does not establish a pass or require a change of shooter. Preserve its learned signals but do not treat the name as observed ground truth.

The linked source can support investigating actual player/puck proximity transitions, travel trajectories and goalie movement before goals. It is especially useful for retrospective stories and checking whether event-coordinate proxies resemble the real play. Frames may contain earlier non-goal attempts, but goal-selected clips are still not a representative negative sample. Replay availability, future goal metadata and goal-only assists must never become pre-shot predictors.

## Next steps

1. Verify schema conventions, units, timestamp alignment and coverage on a small sample.
2. Infer candidate passes from time-contiguous puck/player interactions, retaining confidence and deflection/rebound ambiguity; validate against the official replay/video.
3. Measure actual tracked goalie displacement only after coordinate/team/player alignment is verified.
4. Establish lawful representative non-goal coverage before training or evaluating a general tracking-augmented xG model. Public browser availability does not itself establish commercial reuse rights.

Evidence: `scripts/proof/revisit_pbp_tracking_sources.cjs` and `scripts/proof/results/pbp-tracking-source-revisit-20260907/`. The source sample and receipt are separate from all model training artifacts. Production unchanged.
