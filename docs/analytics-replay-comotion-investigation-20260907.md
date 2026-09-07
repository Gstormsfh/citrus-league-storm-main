# Replay pass investigation: useful data exists, completeness is unresolved

## Direct answer

It is not justified to claim the NHL PBP API has nothing useful for passes or pre-shot information. Sparse PBP already supplies causal event-history proxies, actors, coordinates, timing and goal-linked tracking URLs. It does not explicitly record completed passes in the inspected archive. Those are different statements.

The linked tracking data supports a concrete new extraction experiment. No new provider, credentials, production writes or xG training were used.

## Fresh source checks

`scripts/proof/check_replay_nongoal_coverage.cjs` selected the same three pilot games, and each game's first archived goal, saved shot, missed shot and blocked shot before making requests.

- Fresh public `gamecenter/{game}/play-by-play` responses for games 2025020001, 2025020698 and 2025030416 had no new JSON paths relative to the archived bodies.
- All twelve `ppt-replay/{game}/{event}` metadata requests returned HTTP 200.
- The three goal responses included a `goal` object. All nine non-goal responses contained only game/team metadata, without a goal object or replay payload. HTTP success alone must not be mistaken for tracking availability.
- This is a bounded sample of the known public route, not proof that all NHL routes or all non-goal events lack tracking. No guessed sprite files or restricted services were crawled.

Raw response bodies, URLs, response hashes, status codes and the declaration are preserved in `scripts/proof/results/replay-nongoal-coverage-20260907/`.

## Why the first detector missed a promising transfer

In game 2025030416/event 117, the puck moves close to player 8476958 with similar frame-to-frame displacement. It then accelerates away, briefly passes near player 8482702, travels toward player 8475791, and slows into closer co-motion with that player. The old nearest-player rule treated the brief intermediate proximity as a competing contact and rejected the handoff.

This does not prove the intermediate player made no touch. It does show why nearest-body proximity alone is insufficient to establish puck control.

## Implemented exploratory detector

`data-pipeline/projections/tracked_comotion_candidates.py` adds relative puck/player displacement to proximity and separation checks. It requires sustained candidate control at each endpoint and rejects intervening competing co-motion. Missing puck segments and discontinuous clocks are not bridged. Roster-identified goalies are excluded as candidate skater owners. Goal and assist metadata are not detector inputs.

`scripts/proof/test_tracked_comotion_pilot.py` reports every combination of two proximity radii (60, 84) and three relative-displacement limits (12, 24, 36). All distances are native renderer units; motion limits are per replay tick. Parameters are exploratory and informed by the inspected failure, not an independently selected classifier.

Results:

- The 8476958 → 8475791 transfer is recovered in all six settings. Its pair matches the credited primary assister/scorer in the earlier retrospective check, without using that credit to detect it.
- The candidate contact-to-contact interval varies from 1.0 to 1.5 playback seconds. This is **not** validated pass flight time or reception-to-shot delay; endpoint uncertainty is material.
- A second same-team transfer appears in three settings in that same clip and remains unvalidated.
- The other two pilot clips still produce no candidates. Do not interpret this as absence of actual passes.
- Repeated extraction is deterministic. Three synthetic tests pass for fly-by handling, missing puck/clock rejection, label independence and opponent exclusion. These establish software behavior, not real-world precision or recall.

Saved source hashes, all outputs, and detector hash: `scripts/proof/results/tracked-comotion-pilot-20260907/`.

## What this enables and what it does not

There is a viable research path to inferred pass sequences from the existing replay data. For insights, candidates can be inspected alongside the original replay and labeled with uncertainty. Remaining technical work includes video-based ground truth, coordinate scale, exact shot-release alignment, and distinguishing passes from rebounds, deflections, stationary loose pucks and recoveries. Rendered/interpolated trajectories may limit timing and contact inference.

For general xG, representative non-goal coverage remains unresolved. Goal-selected clips cannot simply supply special features for positive outcomes while other shots receive missing values; that introduces outcome-dependent availability. Earlier missed shots inside goal clips are also future-goal-selected. No accuracy gain is claimed from this pass detector.

Next bounded checks: validate candidate control/release/reception against the existing official replay video; inspect the public gamecenter's actually requested resources for non-goal replay support. Do not claim exhaustive absence, silently add another feed, or relax classification just to manufacture passes.
